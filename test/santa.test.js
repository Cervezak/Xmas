import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../api/santa.js';
import { drawCircle } from '../server/draw.js';
import { validateSubmission, normalizeName } from '../shared/questionnaire.js';
import { createDatabase, submission, testEnvironment } from './helpers.js';

let database;
let server;
let baseUrl;
before(async () => {
  database = await createDatabase();
  server = createServer(createHandler({ environment: testEnvironment, database }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (database) await database.engine.close();
});

async function request(body, password, options = {}) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}) },
    body: JSON.stringify(body),
    ...options,
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test('validation rejects forged choices, excessive selections, invalid phones and missing consent', () => {
  for (const overrides of [
    { statements: ['cozy', 'snow', 'cookies', 'music'] },
    { statements: ['cozy', 'cozy'] },
    { statements: [] },
    { statements: ['invented'] },
    { timing: 'invented' },
    { confirmed: false },
    { phone: '123' },
    { name: '<script>alert(1)</script>' },
    { website: 'spam.example' },
  ]) assert.throws(() => validateSubmission(submission(overrides)));
  assert.equal(validateSubmission(submission({ phone: '777 123 456' })).phone, '+420777123456');
  assert.equal(validateSubmission(submission({ phone: '00421 901 123 456' })).phone, '+421901123456');
  assert.equal(normalizeName('  ŽOFIE   Nováková  '), 'zofie novakova');
});

test('random circle always covers all participants once, has no self or reciprocal edges', () => {
  assert.throws(() => drawCircle(['one', 'two']));
  assert.throws(() => drawCircle(['one', 'one', 'two']));
  for (const size of [3, 4, 5, 10, 50, 100]) {
    const ids = Array.from({ length: size }, () => randomUUID());
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const circle = drawCircle(ids);
      assert.deepEqual([...circle].sort(), [...ids].sort());
      const edges = new Map(circle.map((giver, index) => [giver, circle[(index + 1) % size]]));
      let current = circle[0];
      const seen = new Set();
      for (let index = 0; index < size; index += 1) {
        assert.notEqual(edges.get(current), current);
        assert.notEqual(edges.get(edges.get(current)), current);
        seen.add(current);
        current = edges.get(current);
      }
      assert.equal(seen.size, size);
      assert.equal(current, circle[0]);
    }
  }
});

test('anonymous and authenticated database roles cannot read any table or call any RPC', async () => {
  for (const role of ['anon', 'authenticated']) {
    await database.engine.exec(`set role ${role};`);
    try {
      for (const table of ['santa_participants', 'santa_assignments', 'santa_event', 'santa_rate_limits']) {
        await assert.rejects(database.engine.query(`select * from public.${table}`), /permission denied/);
      }
      await assert.rejects(database.engine.query('select public.santa_snapshot()'), /permission denied/);
      await assert.rejects(database.engine.query("select public.santa_submit('{}'::jsonb)"), /permission denied/);
      await assert.rejects(database.engine.query("select public.santa_rate_limit('key','submit')"), /permission denied/);
      await assert.rejects(database.engine.query('select public.santa_remove($1::uuid)', [randomUUID()]), /permission denied/);
      await assert.rejects(database.engine.query("select public.santa_save_draw('{}'::uuid[])"), /permission denied/);
    } finally { await database.engine.exec('reset role; set role service_role;'); }
  }
});

test('HTTP rejects unauthenticated admin operations and unsafe request formats', async () => {
  for (const action of ['admin-list', 'admin-delete', 'admin-draw']) {
    const result = await request({ action });
    assert.equal(result.status, 401);
    assert.deepEqual(Object.keys(result.body), ['error']);
    assert.equal(result.headers.get('cache-control'), 'no-store, max-age=0');
  }
  assert.equal((await request({ action: 'admin-list' }, 'wrong-password')).status, 401);
  assert.equal((await request({ action: 'submit' }, null, { method: 'GET', body: undefined })).status, 405);
  assert.equal((await request({ action: 'submit' }, null, { body: '{' })).status, 400);
  assert.equal((await request({ action: 'submit' }, null, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request({ action: 'submit', extra: 'x'.repeat(9000) })).status, 413);
  assert.equal((await request({ action: 'submit', ...submission({ statements: ['unknown'] }) })).status, 400);
});

test('submission, idempotent retry, manual duplicate removal, stale draw protection and private SMS', async () => {
  const payload = { action: 'submit', ...submission({ name: 'Žofie Test' }) };
  const first = await request(payload);
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.body).sort(), ['elfTitle', 'name']);
  assert.match(first.body.elfTitle, /Velmistr zachumlání/);
  assert.equal((await request(payload)).status, 200);
  assert.equal((await request({ ...payload, name: 'Změna po odeslání' })).status, 409);
  const duplicate = await request({ ...payload, idempotencyKey: randomUUID() });
  assert.equal(duplicate.status, 200);
  let admin = await request({ action: 'admin-list' }, testEnvironment.ADMIN_PASSWORD);
  assert.equal(admin.body.participants.length, 2);
  assert.equal(admin.body.participants[0].nameKey, admin.body.participants[1].nameKey);
  const removedId = admin.body.participants[1].id;
  const removed = await request({ action: 'admin-delete', id: removedId }, testEnvironment.ADMIN_PASSWORD);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.participants.length, 1);
  assert.equal((await request({ action: 'admin-delete', id: removedId }, testEnvironment.ADMIN_PASSWORD)).status, 409);
  const tooSmall = await request({ action: 'admin-draw', confirmation: 'LOSOVAT', participantIds: removed.body.participants.map((participant) => participant.id) }, testEnvironment.ADMIN_PASSWORD);
  assert.equal(tooSmall.status, 409);
  for (const name of ['Testovací Sob', 'Testovací Perníček', 'Testovací Skořice']) {
    assert.equal((await request({ action: 'submit', ...submission({ name }) })).status, 200);
  }
  admin = await request({ action: 'admin-list' }, testEnvironment.ADMIN_PASSWORD);
  const ids = admin.body.participants.map((participant) => participant.id);
  assert.equal((await request({ action: 'admin-draw', confirmation: 'LOSOVAT', participantIds: ids.slice(1) }, testEnvironment.ADMIN_PASSWORD)).status, 409);
  const invalidDraw = await database.rpc('santa_save_draw', { input_ids: [ids[0], ids[0], ids[2], ids[3]] });
  assert.equal(invalidDraw.error.message, 'SANTA_CHANGED');
  const drawn = await request({ action: 'admin-draw', confirmation: 'LOSOVAT', participantIds: ids }, testEnvironment.ADMIN_PASSWORD);
  assert.equal(drawn.status, 200);
  assert.ok(drawn.body.drawnAt);
  assert.equal(drawn.body.assignments.length, 4);
  assert.equal(drawn.body.messages.length, 4);
  const edges = new Map(drawn.body.assignments.map((assignment) => [assignment.giver_id, assignment.receiver_id]));
  for (const [giverId, receiverId] of edges) {
    assert.notEqual(giverId, receiverId);
    assert.notEqual(edges.get(receiverId), giverId);
    const message = drawn.body.messages.find((item) => item.giverId === giverId);
    const giver = drawn.body.participants.find((item) => item.id === giverId);
    const receiver = drawn.body.participants.find((item) => item.id === receiverId);
    assert.equal(message.phone, giver.phone);
    assert.ok(message.text.includes(receiver.name));
    assert.ok(!message.text.includes(receiver.phone));
  }
  assert.equal((await request({ action: 'admin-delete', id: ids[0] }, testEnvironment.ADMIN_PASSWORD)).status, 409);
  assert.equal((await request({ action: 'admin-draw', confirmation: 'LOSOVAT', participantIds: ids }, testEnvironment.ADMIN_PASSWORD)).status, 409);
  assert.equal((await request({ action: 'submit', ...submission({ name: 'Pozdní elf' }) })).status, 409);
  assert.equal((await request(payload)).status, 200);
  assert.equal((await request({ action: 'admin-list' })).status, 401);
});

test('rate limit persists in the database and isolates scopes', async () => {
  for (let index = 0; index < 10; index += 1) assert.equal((await database.rpc('santa_rate_limit', { input_key: 'isolated-ip-hash', input_scope: 'login' })).data, true);
  assert.equal((await database.rpc('santa_rate_limit', { input_key: 'isolated-ip-hash', input_scope: 'login' })).data, false);
  assert.equal((await database.rpc('santa_rate_limit', { input_key: 'isolated-ip-hash', input_scope: 'submit' })).data, true);
});

test('a changed roster rolls back and two concurrent draw requests save only one immutable result', async () => {
  const isolated = await createDatabase();
  try {
    for (const name of ['Testovací A', 'Testovací B', 'Testovací C']) {
      const result = await isolated.rpc('santa_submit', { input_data: { ...validateSubmission(submission({ name })), requestHash: 'test-hash' } });
      assert.equal(result.error, null);
    }
    const original = (await isolated.rpc('santa_snapshot')).data;
    const staleIds = original.participants.map((participant) => participant.id);
    await isolated.rpc('santa_remove', { input_id: staleIds[0] });
    const tooSmall = await isolated.rpc('santa_save_draw', { input_ids: staleIds.slice(1) });
    assert.equal(tooSmall.error.message, 'SANTA_MINIMUM');
    await isolated.rpc('santa_submit', { input_data: { ...validateSubmission(submission({ name: 'Nový Testovací Elf' })), requestHash: 'another-hash' } });
    const stale = await isolated.rpc('santa_save_draw', { input_ids: staleIds });
    assert.equal(stale.error.message, 'SANTA_CHANGED');
    const fresh = (await isolated.rpc('santa_snapshot')).data;
    assert.equal(fresh.assignments.length, 0);
    assert.equal(fresh.drawnAt, null);
    const ids = fresh.participants.map((participant) => participant.id);
    const results = await Promise.all([
      isolated.rpc('santa_save_draw', { input_ids: drawCircle(ids) }),
      isolated.rpc('santa_save_draw', { input_ids: drawCircle(ids) }),
    ]);
    assert.equal(results.filter((result) => result.error === null).length, 1);
    assert.equal(results.find((result) => result.error)?.error.message, 'SANTA_CLOSED');
    const finalSnapshot = (await isolated.rpc('santa_snapshot')).data;
    assert.equal(finalSnapshot.assignments.length, 3);
    assert.ok(finalSnapshot.drawnAt);
  } finally { await isolated.engine.close(); }
});

test('too many invalid admin logins return HTTP 429 without exposing data', async () => {
  let result;
  for (let attempt = 0; attempt < 11; attempt += 1) result = await request({ action: 'admin-list' }, 'wrong-password');
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '900');
  assert.deepEqual(Object.keys(result.body), ['error']);
  assert.equal((await request({ action: 'admin-list' }, testEnvironment.ADMIN_PASSWORD)).status, 200);
});
