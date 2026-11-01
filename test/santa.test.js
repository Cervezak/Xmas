import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { drawCircle } from '../server/draw.js';
import { validateSubmission, normalizeName } from '../shared/questionnaire.js';
import { readSeasonSession, saveSeasonSession } from '../shared/season-storage.js';
import { createTestApp, submission, testEnvironment } from './helpers.js';

let app;
before(async () => { app = await createTestApp(); });
after(async () => { if (app) await app.close(); });

test('validation rejects malformed submissions and missing years', () => {
  for (const overrides of [
    { statements: ['cozy', 'snow', 'cookies', 'music'] }, { statements: ['cozy', 'cozy'] }, { statements: [] },
    { statements: ['invented'] }, { timing: 'invented' }, { confirmed: false }, { phone: '123' },
    { name: '<script>alert(1)</script>' }, { website: 'spam.example' }, { year: undefined }, { year: 3000 },
  ]) assert.throws(() => validateSubmission(submission(overrides)));
  assert.equal(validateSubmission(submission({ phone: '777 123 456' })).phone, '+420777123456');
  assert.equal(validateSubmission(submission({ phone: '00421 901 123 456' })).phone, '+421901123456');
  assert.equal(normalizeName('  ŽOFIE   Nováková  '), 'zofie novakova');
});

function assertCircle(circle, ids, forbidden = []) {
  assert.deepEqual([...circle].sort(), [...ids].sort());
  const edges = new Map(circle.map((giver, index) => [giver, circle[(index + 1) % circle.length]]));
  for (const [giver, receiver] of edges) {
    assert.notEqual(giver, receiver);
    assert.notEqual(edges.get(receiver), giver);
    assert.ok(!forbidden.some((pair) => pair[0] === giver && pair[1] === receiver));
  }
  const visited = new Set();
  let current = circle[0];
  for (let index = 0; index < ids.length; index += 1) { visited.add(current); current = edges.get(current); }
  assert.equal(visited.size, ids.length);
  assert.equal(current, circle[0]);
}

test('600 random circles cover everyone once and never create reciprocal pairs', () => {
  assert.throws(() => drawCircle(['one', 'two']));
  assert.throws(() => drawCircle(['one', 'one', 'two']));
  for (const size of [3, 4, 5, 10, 50, 100]) {
    const ids = Array.from({ length: size }, () => randomUUID());
    for (let attempt = 0; attempt < 100; attempt += 1) assertCircle(drawCircle(ids), ids);
  }
});

test('constraints exclude last-year edges and rerolls exclude the identical previous result', () => {
  const ids = Array.from({ length: 10 }, () => randomUUID());
  const forbidden = ids.map((giver, index) => [giver, ids[(index + 1) % ids.length]]);
  const first = drawCircle(ids, { forbiddenPairs: forbidden });
  assertCircle(first, ids, forbidden);
  const avoidPairs = first.map((giver, index) => [giver, first[(index + 1) % first.length]]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const circle = drawCircle(ids, { forbiddenPairs: forbidden, avoidPairs });
    assertCircle(circle, ids, forbidden);
    assert.ok(circle.some((giver, index) => !avoidPairs.some((pair) => pair[0] === giver && pair[1] === circle[(index + 1) % circle.length])));
  }
});

test('fallback finds a solution, proves impossibility, and distinguishes search exhaustion', () => {
  const ids = ['alpha', 'beta', 'gamma'];
  const fixedShuffle = (bound) => bound - 1;
  const valid = drawCircle(ids, { chooseIndex: fixedShuffle, forbiddenPairs: [['alpha', 'beta']] });
  assertCircle(valid, ids, [['alpha', 'beta']]);
  assert.throws(() => drawCircle(ids, { forbiddenPairs: [['alpha', 'beta'], ['alpha', 'gamma']] }), { code: 'SANTA_NO_SOLUTION' });
  assert.throws(() => drawCircle(ids, { chooseIndex: fixedShuffle, forbiddenPairs: [['alpha', 'beta']], searchLimit: 0 }), { code: 'SANTA_SEARCH_LIMIT' });
});

test('browser state is isolated by year and legacy 2026 receipts migrate without leaking into 2027', () => {
  const entries = new Map([['santa-receipt', JSON.stringify({ name: 'Starý Elf', elfTitle: 'Starý titul' })]]);
  const storage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) };
  assert.equal(readSeasonSession('receipt', 2026, storage).name, 'Starý Elf');
  assert.equal(readSeasonSession('receipt', 2027, storage), null);
  saveSeasonSession('receipt', 2026, { name: 'Starý Elf', elfTitle: 'Starý titul' }, storage);
  assert.equal(entries.has('santa-receipt'), false);
  saveSeasonSession('draft', 2027, { name: 'Nový Elf' }, storage);
  assert.equal(readSeasonSession('draft', 2026, storage), null);
  assert.equal(readSeasonSession('draft', 2027, storage).name, 'Nový Elf');
  saveSeasonSession('receipt', 2026, null, storage);
  assert.equal(readSeasonSession('receipt', 2026, storage), null);
  assert.equal(readSeasonSession('draft', 2027, storage).name, 'Nový Elf');
});

test('public status exposes only year and registration state; historical data requires admin login', async () => {
  const status = await app.request({ action: 'event' });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { year: 2026, registrationOpen: true });
  for (const action of ['admin-list', 'admin-delete', 'admin-draw', 'admin-person', 'admin-create-year', 'admin-activate-year', 'admin-lock']) {
    const result = await app.request({ action, year: 2025 });
    assert.equal(result.status, 401);
    assert.deepEqual(Object.keys(result.body), ['error']);
    assert.equal(result.headers.get('cache-control'), 'no-store, max-age=0');
  }
});

test('all private tables and season RPCs deny anonymous and authenticated database roles', async () => {
  const rpcCalls = [
    'select public.santa_public_event()', 'select public.santa_snapshot()',
    "select public.santa_submit('{}'::jsonb)", "select public.santa_rate_limit('key','submit')",
    'select public.santa_create_year(2027)', 'select public.santa_activate_year(2027,2026)',
    "select public.santa_remove(null,2026,0)", "select public.santa_set_person(2026,null,null,0)",
    "select public.santa_save_draw(2026,'{}'::uuid[],0,0,1)", 'select public.santa_lock_draw(2026,1,0)',
  ];
  for (const role of ['anon', 'authenticated']) {
    await app.database.engine.exec('set role ' + role);
    try {
      for (const table of ['santa_participants', 'santa_legacy_assignments', 'santa_event', 'santa_settings', 'santa_people', 'santa_draws', 'santa_draw_entries', 'santa_rate_limits']) {
        await assert.rejects(app.database.engine.query('select * from public.' + table), /permission denied/);
      }
      for (const sql of rpcCalls) await assert.rejects(app.database.engine.query(sql), /permission denied/);
    } finally { await app.database.engine.exec('reset role; set role service_role'); }
  }
});

test('HTTP rejects bad request formats, oversized bodies, and malformed choices', async () => {
  assert.equal((await app.request({ action: 'submit' }, null, { method: 'GET', body: undefined })).status, 405);
  assert.equal((await app.request({ action: 'submit' }, null, { body: '{' })).status, 400);
  assert.equal((await app.request({ action: 'submit' }, null, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.request({ action: 'submit', extra: 'x'.repeat(9000) })).status, 413);
  assert.equal((await app.request({ action: 'submit', ...submission({ statements: ['unknown'] }) })).status, 400);
  assert.equal((await app.admin('admin-create-year', { year: '2027' })).status, 400);
});

test('rate limits persist, isolate scopes, and do not block a correct admin password after bad guesses', async () => {
  for (let index = 0; index < 10; index += 1) assert.equal((await app.database.rpc('santa_rate_limit', { input_key: 'test-ip', input_scope: 'login' })).data, true);
  assert.equal((await app.database.rpc('santa_rate_limit', { input_key: 'test-ip', input_scope: 'login' })).data, false);
  assert.equal((await app.database.rpc('santa_rate_limit', { input_key: 'test-ip', input_scope: 'submit' })).data, true);
  let result;
  for (let index = 0; index < 11; index += 1) result = await app.request({ action: 'admin-list' }, 'bad-password');
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '900');
  assert.equal((await app.request({ action: 'admin-list' }, testEnvironment.ADMIN_PASSWORD)).status, 200);
});
