import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { validateSubmission } from '../shared/questionnaire.js';
import { createTestApp, createDatabase, submission, drawRequest, familyNames, historyPairs } from './helpers.js';

let app;
let latest;
let original;
let retryPayload;
before(async () => { app = await createTestApp(); });
after(async () => { if (app) await app.close(); });
const edges = (snapshot) => snapshot.assignments.map((entry) => entry.giver_id + ':' + entry.receiver_id).sort();
const assertNoHistoricalRepeats = (snapshot) => {
  for (const entry of snapshot.assignments) assert.ok(!snapshot.previousDraw.pairs.some((pair) => pair.giverPersonId === entry.giverPersonId && pair.receiverPersonId === entry.receiverPersonId));
};

test('manual history retains all ten directed pairs, including the reciprocal pair, without inventing dates or phones', async () => {
  const result = await app.admin('admin-list', { year: 2025 });
  assert.equal(result.status, 200);
  assert.equal(result.body.currentVersion, 1);
  assert.equal(result.body.draws[0].source, 'manual');
  assert.equal(result.body.drawnAt, null);
  assert.equal(result.body.participants.length, 0);
  assert.equal(result.body.messages.length, 0);
  assert.deepEqual(result.body.assignments.map((entry) => [entry.giverName, entry.receiverName]), historyPairs.map((pair) => [familyNames[pair[0]], familyNames[pair[1]]]));
  assert.ok(result.body.assignments.every((entry) => entry.giverPhone === null));
  assert.equal((await app.admin('admin-draw', drawRequest(result.body))).status, 409);
});

test('a ten-person draw is atomic, concurrent requests cannot create two initial versions, and last-year edges are excluded', async () => {
  const snapshot = await app.enroll(familyNames);
  assert.ok(snapshot.participants.every((participant) => participant.personId));
  const key = (await app.database.engine.query('select idempotency_key from public.santa_participants where name = $1', [familyNames[0]])).rows[0].idempotency_key;
  retryPayload = { action: 'submit', ...submission({ name: familyNames[0], idempotencyKey: key }) };
  const retried = await app.request(retryPayload);
  assert.equal(retried.status, 200);
  assert.deepEqual(Object.keys(retried.body).sort(), ['elfTitle', 'name', 'year']);
  assert.equal((await app.request({ ...retryPayload, name: 'Přepsané jméno' })).status, 409);
  const ids = familyNames.map((name) => snapshot.participants.find((person) => person.name === name).id);
  const forged = await app.database.rpc('santa_save_draw', { input_year: 2026, input_ids: ids, input_revision: snapshot.revision, input_expected_version: 0, input_previous_version: 1 });
  assert.equal(forged.error.message, 'SANTA_REPEAT');
  assert.equal((await app.database.rpc('santa_snapshot')).data.currentVersion, null);
  const request = drawRequest(snapshot);
  const concurrent = await Promise.all([app.admin('admin-draw', request), app.admin('admin-draw', request)]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
  latest = concurrent.find((result) => result.status === 200).body;
  original = structuredClone(latest);
  assert.equal(latest.currentVersion, 1);
  assert.equal(latest.draws.length, 1);
  assert.equal(latest.assignments.length, 10);
  assert.equal(latest.messages.length, 10);
  assertNoHistoricalRepeats(latest);
  for (const message of latest.messages) {
    const entry = latest.assignments.find((pair) => pair.giver_id === message.giverId);
    assert.equal(message.phone, entry.giverPhone);
    assert.ok(message.text.includes(entry.receiverName));
  }
  assert.deepEqual((await app.request({ action: 'event' })).body, { year: 2026, registrationOpen: false });
  assert.equal((await app.request({ action: 'submit', ...submission({ name: 'Pozdní účastník' }) })).status, 409);
  assert.equal((await app.request(retryPayload)).status, 200);
});

test('reroll requires unsent-SMS confirmation, creates a different version, and preserves exact archived assignments', async () => {
  const denied = await app.admin('admin-draw', drawRequest(latest, { confirmUnsent: false }));
  assert.equal(denied.status, 409);
  assert.equal((await app.admin('admin-list')).body.draws.length, 1);
  const staleRequest = drawRequest(latest);
  const rolled = await app.admin('admin-draw', staleRequest);
  assert.equal(rolled.status, 200);
  latest = rolled.body;
  assert.equal(latest.currentVersion, 2);
  assert.equal(latest.draws.length, 2);
  assert.notDeepEqual(edges(latest), edges(original));
  assertNoHistoricalRepeats(latest);
  assert.equal(latest.draws[0].previousYear, 2025);
  assert.equal(latest.draws[0].previousVersion, 1);
  const archive = await app.admin('admin-list', { year: 2026, version: 1 });
  assert.deepEqual(edges(archive.body), edges(original));
  assert.equal(archive.body.selectedVersion, 1);
  assert.equal(archive.body.currentVersion, 2);
  assert.equal(archive.body.messages.length, 0);
  assert.equal((await app.admin('admin-draw', staleRequest)).status, 409);
  const mapping = new Map(latest.assignments.map((entry) => [entry.giver_id, entry.receiver_id]));
  const circle = [latest.assignments[0].giver_id];
  while (circle.length < latest.assignments.length) circle.push(mapping.get(circle[circle.length - 1]));
  const same = await app.database.rpc('santa_save_draw', { input_year: 2026, input_ids: circle, input_revision: latest.revision, input_expected_version: 2, input_previous_version: 1, input_confirm_unsent: true });
  assert.equal(same.error.message, 'SANTA_SAME_DRAW');
  assert.equal((await app.admin('admin-list')).body.currentVersion, 2);
});

test('final SMS lock blocks reroll and roster edits while current SMS remain readable', async () => {
  const locked = await app.admin('admin-lock', { year: 2026, revision: latest.revision, version: latest.currentVersion, confirmation: 'UZAMKNOUT' });
  assert.equal(locked.status, 200);
  latest = locked.body;
  assert.ok(latest.draws[0].smsLockedAt);
  assert.equal((await app.admin('admin-draw', drawRequest(latest))).status, 409);
  assert.equal((await app.admin('admin-delete', { year: 2026, revision: latest.revision, id: latest.participants[0].id })).status, 409);
  assert.equal(latest.messages.length, 10);
});

test('creating a year does not activate it; explicit activation starts fresh registrations and keeps old data', async () => {
  const created = await app.admin('admin-create-year', { year: 2027 });
  assert.equal(created.status, 200);
  assert.equal(created.body.year, 2027);
  assert.equal(created.body.activeYear, 2026);
  assert.equal(created.body.participants.length, 0);
  assert.equal(created.body.currentVersion, null);
  assert.equal((await app.admin('admin-create-year', { year: 2027 })).status, 409);
  assert.equal((await app.admin('admin-activate-year', { year: 2027, expectedActiveYear: 2025, confirmation: 'AKTIVOVAT 2027' })).status, 409);
  assert.equal((await app.admin('admin-activate-year', { year: 2027, expectedActiveYear: 2026, confirmation: 'AKTIVOVAT 2027' })).status, 200);
  assert.deepEqual((await app.request({ action: 'event' })).body, { year: 2027, registrationOpen: true });
  assert.equal((await app.request({ action: 'submit', ...submission({ name: 'Starý panel' }) })).status, 409);
  assert.equal((await app.request(retryPayload)).status, 200);
  const fresh = await app.enroll([familyNames[0], familyNames[2], familyNames[8]], 2027);
  for (const participant of fresh.participants) assert.equal(participant.personId, latest.participants.find((old) => old.name === participant.name).personId);
  const drawn = await app.admin('admin-draw', drawRequest(fresh));
  assert.equal(drawn.status, 200);
  assertNoHistoricalRepeats(drawn.body);
  const old = (await app.admin('admin-list', { year: 2026 })).body;
  assert.equal(old.participants.length, 10);
  assert.equal(old.draws.length, 2);
  assert.equal(old.currentVersion, 2);
  assert.equal(old.historyReferenced, true);
});

test('legacy migration preserves existing participants, the original draw and its timestamp as version one', async () => {
  const names = ['Historický Elf První', 'Historický Elf Druhý', 'Historický Elf Třetí'];
  let originalIds;
  let originalTime;
  let legacyPayload;
  const isolated = await createTestApp({ legacySetup: async (engine) => {
    for (const name of names) {
      const payload = submission({ name });
      legacyPayload ??= { action: 'submit', ...payload };
      const participant = validateSubmission(payload);
      const { year, ...hashInput } = participant;
      const requestHash = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');
      await engine.query('select public.santa_submit($1::jsonb)', [JSON.stringify({ ...participant, requestHash })]);
    }
    originalIds = (await engine.query('select id from public.santa_participants order by name')).rows.map((person) => person.id);
    await engine.query('select public.santa_save_draw($1::uuid[])', ['{' + originalIds.join(',') + '}']);
    originalTime = (await engine.query('select drawn_at from public.santa_event')).rows[0].drawn_at;
  } });
  try {
    let snapshot = (await isolated.admin('admin-list')).body;
    assert.equal(snapshot.currentVersion, 1);
    assert.equal(snapshot.draws[0].source, 'legacy');
    assert.equal((await isolated.request(legacyPayload)).status, 200);
    assert.equal(new Date(snapshot.drawnAt).toISOString(), new Date(originalTime).toISOString());
    assert.deepEqual(snapshot.participants.map((person) => person.id).sort(), [...originalIds].sort());
    for (let index = 0; index < originalIds.length; index += 1) assert.ok(snapshot.assignments.some((entry) => entry.giver_id === originalIds[index] && entry.receiver_id === originalIds[(index + 1) % originalIds.length]));
    assert.equal((await isolated.admin('admin-draw', drawRequest(snapshot))).status, 409);
    const archived = edges(snapshot);
    for (const participant of snapshot.participants) {
      const result = await isolated.admin('admin-person', { year: 2026, revision: snapshot.revision, id: participant.id, personId: 'new' });
      assert.equal(result.status, 200); snapshot = result.body;
    }
    const rolled = await isolated.admin('admin-draw', drawRequest(snapshot));
    assert.equal(rolled.status, 200);
    assert.equal(rolled.body.currentVersion, 2);
    assert.deepEqual(edges((await isolated.admin('admin-list', { year: 2026, version: 1 })).body), archived);
    await assert.rejects(isolated.database.engine.query('delete from public.santa_legacy_assignments'), /permission denied/);
    await isolated.admin('admin-create-year', { year: 2027 });
    await isolated.admin('admin-activate-year', { year: 2027, expectedActiveYear: 2026, confirmation: 'AKTIVOVAT 2027' });
    const next = await isolated.enroll(names, 2027);
    assert.equal((await isolated.admin('admin-draw', drawRequest(next))).status, 200);
    const linked = (await isolated.admin('admin-list', { year: 2026 })).body;
    const denied = await isolated.admin('admin-draw', drawRequest(linked));
    assert.equal(denied.status, 409);
    assert.match(denied.body.error, /dalšího roku/);
  } finally { await isolated.close(); }
});

test('identities are never guessed and the same person cannot have two registrations within a year', async () => {
  const isolated = await createTestApp();
  try {
    for (let count = 0; count < 2; count += 1) assert.equal((await isolated.request({ action: 'submit', ...submission({ name: familyNames[0] }) })).status, 200);
    let snapshot = (await isolated.admin('admin-list')).body;
    assert.ok(snapshot.participants.every((person) => person.personId === null));
    const personId = snapshot.people.find((person) => person.name === familyNames[0]).id;
    snapshot = (await isolated.admin('admin-person', { year: 2026, revision: snapshot.revision, id: snapshot.participants[0].id, personId })).body;
    const rejected = await isolated.admin('admin-person', { year: 2026, revision: snapshot.revision, id: snapshot.participants[1].id, personId });
    assert.equal(rejected.status, 409);
    assert.match(rejected.body.error, /jinou přihlášku/);
    const removed = await isolated.admin('admin-delete', { year: 2026, revision: snapshot.revision, id: snapshot.participants[1].id });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.participants.length, 1);
    const stale = await isolated.admin('admin-delete', { year: 2026, revision: snapshot.revision, id: snapshot.participants[0].id });
    assert.equal(stale.status, 409);
  } finally { await isolated.close(); }
});

test('impossible historical constraints return an error without creating or replacing a draw', async () => {
  const isolated = await createTestApp();
  try {
    const snapshot = await isolated.enroll(familyNames.slice(0, 3));
    const result = await isolated.admin('admin-draw', drawRequest(snapshot));
    assert.equal(result.status, 409);
    assert.match(result.body.error, /nelze vytvořit/);
    const after = (await isolated.admin('admin-list')).body;
    assert.equal(after.currentVersion, null);
    assert.equal(after.draws.length, 0);
    assert.equal(after.registrationOpen, true);
  } finally { await isolated.close(); }
});

test('the same idempotency key is isolated across years and stale-year submissions cannot enter a new season', async () => {
  const isolated = await createTestApp();
  try {
    const payload = { action: 'submit', ...submission() };
    assert.equal((await isolated.request(payload)).status, 200);
    await isolated.admin('admin-create-year', { year: 2027 });
    await isolated.admin('admin-activate-year', { year: 2027, expectedActiveYear: 2026, confirmation: 'AKTIVOVAT 2027' });
    assert.equal((await isolated.request({ ...payload, year: 2027 })).status, 200);
    assert.equal((await isolated.request({ ...payload, idempotencyKey: randomUUID() })).status, 409);
    assert.equal((await isolated.request(payload)).status, 200);
    const rows = (await isolated.database.engine.query('select id,year from public.santa_participants order by year')).rows;
    assert.deepEqual(rows.map((row) => row.year), [2026, 2027]);
    assert.notEqual(rows[0].id, rows[1].id);
  } finally { await isolated.close(); }
});

test('a missing private historical import blocks a new draw instead of silently omitting restrictions', async () => {
  const database = await createDatabase({ history: false });
  try {
    for (const name of ['První nový', 'Druhý nový', 'Třetí nový']) {
      await database.rpc('santa_submit', { input_data: { ...validateSubmission(submission({ name })), requestHash: 'test' } });
    }
    let snapshot = (await database.rpc('santa_snapshot')).data;
    for (const participant of snapshot.participants) {
      assert.equal((await database.rpc('santa_set_person', { input_year: 2026, input_id: participant.id, input_person_id: null, input_revision: snapshot.revision, input_create_person: true })).error, null);
      snapshot = (await database.rpc('santa_snapshot')).data;
    }
    const result = await database.rpc('santa_save_draw', { input_year: 2026, input_ids: snapshot.participants.map((person) => person.id), input_revision: snapshot.revision, input_expected_version: 0, input_previous_version: 1 });
    assert.equal(result.error.message, 'SANTA_HISTORY_MISSING');
    assert.equal((await database.rpc('santa_snapshot')).data.currentVersion, null);
  } finally { await database.engine.close(); }
});

test('database rejects noncanonical UUID arrays and a stale previous-year version without saving a partial draw', async () => {
  const isolated = await createTestApp();
  try {
    const snapshot = await isolated.enroll(['Tvarový Elf První', 'Tvarový Elf Druhý', 'Tvarový Elf Třetí']);
    const ids = snapshot.participants.map((person) => person.id);
    for (const array of ['[0:2]={' + ids.join(',') + '}', '{{' + ids.join(',') + '}}', '{' + [ids[0], ids[0], ids[1]].join(',') + '}']) {
      await assert.rejects(isolated.database.engine.query('select public.santa_save_draw(2026,$1::uuid[],$2::bigint,0,1,false)', [array, snapshot.revision]), /SANTA_CHANGED/);
    }
    const stale = await isolated.database.rpc('santa_save_draw', { input_year: 2026, input_ids: ids, input_revision: snapshot.revision, input_expected_version: 0, input_previous_version: 2 });
    assert.equal(stale.error.message, 'SANTA_CHANGED');
    const unchanged = (await isolated.admin('admin-list')).body;
    assert.equal(unchanged.currentVersion, null);
    assert.equal(unchanged.registrationOpen, true);
    assert.equal(unchanged.draws.length, 0);
  } finally { await isolated.close(); }
});
