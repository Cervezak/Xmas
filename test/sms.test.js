import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { smsText } from '../shared/questionnaire.js';
import { createTestApp, drawRequest } from './helpers.js';

let app;
before(async () => { app = await createTestApp(); });
after(async () => { if (app) await app.close(); });

test('SMS keep the greeting, include the giver title and place multiline rules immediately before the farewell', () => {
  const rules = 'Připrav 2–3 dárky.\nCelková hodnota nejvýše 3 000 Kč.';
  const text = smsText({ name: 'Testovací Elf', elfTitle: 'Mistr stuh' }, { name: 'Druhý Elf', statements: ['cozy'] }, rules);
  assert.ok(text.startsWith('Ahoj Testovací Elf! Tady Santova dílna.'));
  assert.ok(text.includes('Tvůj elfí titul: Mistr stuh.'));
  assert.ok(text.includes('Letos tajně obdaruješ: Druhý Elf.'));
  assert.ok(!text.includes('Malá nápověda'));
  assert.ok(!text.includes('Deka, čaj a nikam nemusím.'));
  assert.ok(text.endsWith('Pravidla pro letošní nadělování:\n' + rules + '\n\nPšššt, nech si to pro sebe. Veselé Vánoce!'));
  const empty = smsText({ name: 'Elf' }, { name: 'Druhý', statements: [] }, '');
  assert.ok(!empty.includes('undefined'));
  assert.ok(!empty.includes('Pravidla pro'));
  assert.ok(!empty.includes('Malá nápověda'));
});

test('rules are private, belong to one year and fresh years do not inherit last-year rules', async () => {
  const initial = await app.admin('admin-list', { year: 2026 });
  assert.equal(initial.body.rules, 'Připrav 2–3 dárky v celkové hodnotě nejvýše 3 000 Kč.');
  assert.equal((await app.request({ action: 'admin-rules', year: 2026, revision: initial.body.revision, rules: 'Cizí pravidla' })).status, 401);
  await app.admin('admin-create-year', { year: 2027 });
  const next = await app.admin('admin-list', { year: 2027 });
  assert.equal(next.body.rules, '');
  const saved = await app.admin('admin-rules', { year: 2027, revision: next.body.revision, rules: 'Pravidla pouze pro 2027' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.rules, 'Pravidla pouze pro 2027');
  assert.equal((await app.admin('admin-list', { year: 2026 })).body.rules, initial.body.rules);
  assert.deepEqual((await app.request({ action: 'event' })).body, { year: 2026, registrationOpen: true });
  for (const role of ['anon', 'authenticated']) {
    await app.database.engine.exec('set role ' + role);
    try {
      await assert.rejects(app.database.engine.query("select public.santa_set_rules(2026, 'Přepsat', 0)"), /permission denied/);
    } finally { await app.database.engine.exec('set role service_role'); }
  }
});

test('invalid rules, stale edits and manual-history edits cannot overwrite stored rules', async () => {
  const original = (await app.admin('admin-list', { year: 2026 })).body;
  for (const rules of [null, 42, 'x'.repeat(2001), 'skrytý\u0007znak']) {
    assert.equal((await app.admin('admin-rules', { year: 2026, revision: original.revision, rules })).status, 400);
  }
  assert.equal((await app.admin('admin-rules', { year: 2026, rules: 'Bez revize' })).status, 400);
  const invalid = await app.database.rpc('santa_set_rules', { input_year: 2026, input_rules: 'x'.repeat(2001), input_revision: original.revision });
  assert.equal(invalid.error.message, 'SANTA_INVALID_RULES');
  const saved = await app.admin('admin-rules', { year: 2026, revision: original.revision, rules: '  První řádek\r\nDruhý řádek  ' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.rules, 'První řádek\nDruhý řádek');
  assert.equal((await app.admin('admin-rules', { year: 2026, revision: original.revision, rules: 'Zastaralá změna' })).status, 409);
  const historical = (await app.admin('admin-list', { year: 2025 })).body;
  assert.equal((await app.admin('admin-rules', { year: 2025, revision: historical.revision, rules: 'Nový text' })).status, 409);
  assert.equal((await app.admin('admin-list', { year: 2026 })).body.rules, saved.body.rules);
});

test('confirmed rules update SMS even after final locking, retaining exact draw versions, recipient and giver titles', async () => {
  const enrolled = await app.enroll(['Nový Elf A', 'Nový Elf B', 'Nový Elf C']);
  const drawn = await app.admin('admin-draw', drawRequest(enrolled));
  assert.equal(drawn.status, 200);
  const locked = await app.admin('admin-lock', { year: 2026, revision: drawn.body.revision, version: 1, confirmation: 'UZAMKNOUT' });
  assert.equal(locked.status, 200);
  const rules = '2–3 dárky\nCelkový rozpočet: nejvýše 3 000 Kč.';
  const updated = await app.admin('admin-rules', { year: 2026, revision: locked.body.revision, rules });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.currentVersion, locked.body.currentVersion);
  assert.deepEqual(updated.body.draws, locked.body.draws);
  assert.deepEqual(updated.body.assignments, locked.body.assignments);
  assert.equal(updated.body.registrationOpen, false);
  for (const message of updated.body.messages) {
    const giver = updated.body.participants.find((person) => person.id === message.giverId);
    const receiver = updated.body.assignments.find((entry) => entry.giver_id === message.giverId);
    assert.ok(message.text.includes('Tvůj elfí titul: ' + giver.elfTitle));
    assert.ok(message.text.includes(receiver.receiverName));
    assert.ok(message.text.includes(rules));
  }
  const refreshed = await app.admin('admin-list', { year: 2026 });
  assert.deepEqual(refreshed.body.messages, updated.body.messages);
  const cleared = await app.admin('admin-rules', { year: 2026, revision: refreshed.body.revision, rules: '' });
  assert.equal(cleared.status, 200);
  assert.ok(cleared.body.messages.every((message) => !message.text.includes('Pravidla pro')));
  assert.deepEqual(cleared.body.assignments, locked.body.assignments);
});
