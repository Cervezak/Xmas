import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createHandler } from '../api/santa.js';
import { createGamesHandler } from '../api/games.js';
import { normalizeName } from '../shared/questionnaire.js';

export async function createDatabase({ legacySetup, history = true, beforeGameExtension, beforeRiddles } = {}) {
  const engine = new PGlite();
  await engine.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await engine.exec(await readFile(new URL('../supabase/migrations/202610260001_santa.sql', import.meta.url), 'utf8'));
  if (legacySetup) await legacySetup(engine);
  await engine.exec(await readFile(new URL('../supabase/migrations/202611010001_seasons_and_versions.sql', import.meta.url), 'utf8'));
  await engine.exec(await readFile(new URL('../supabase/migrations/202611010002_sms_rules.sql', import.meta.url), 'utf8'));
  await engine.exec(await readFile(new URL('../supabase/migrations/202611020001_easter_games.sql', import.meta.url), 'utf8'));
  if(beforeGameExtension)await beforeGameExtension(engine);
  await engine.exec(await readFile(new URL('../supabase/migrations/202611040001_game_guests_and_reveals.sql', import.meta.url), 'utf8'));
  if(beforeRiddles)await beforeRiddles(engine);
  await engine.exec(await readFile(new URL('../supabase/migrations/202611080001_riddles.sql', import.meta.url), 'utf8'));
  if (history) {
    const people = [];
    for (const name of familyNames) {
      const result = await engine.query('insert into public.santa_people(name,name_key) values($1,$2) returning id', [name, normalizeName(name)]);
      people.push(result.rows[0].id);
    }
    for (const [index, pair] of historyPairs.entries()) {
      await engine.query('insert into public.santa_draw_entries(year,version,entry_no,giver_person_id,receiver_person_id,giver_name,receiver_name) values(2025,1,$1,$2,$3,$4,$5)',
        [index + 1, people[pair[0]], people[pair[1]], familyNames[pair[0]], familyNames[pair[1]]]);
    }
  }
  await engine.exec('set role service_role;');
  return {
    engine,
    async rpc(name, args = {}) {
      const calls = {
        santa_games_remove: ['select public.santa_games_remove($1::integer,$2::uuid,$3::bigint) as data',[args.input_year,args.input_id,args.input_revision]],
        santa_games_add_guest: ['select public.santa_games_add_guest($1::integer,$2::text,$3::text) as data',[args.input_year,args.input_name,args.input_name_key]],
        santa_games_guest_profile: ['select public.santa_games_guest_profile($1::integer,$2::uuid,$3::jsonb,$4::uuid) as data',[args.input_year,args.input_id,JSON.stringify(args.input_profile),args.input_request]],
        santa_games_save: ['select public.santa_games_save($1::integer,$2::jsonb) as data', [args.input_year,JSON.stringify(args.input_game)]],
        santa_games_admin: ['select public.santa_games_admin($1::integer,$2::uuid) as data', [args.input_year,args.input_id ?? null]],
        santa_games_public: ['select public.santa_games_public($1::integer,$2::uuid,$3::uuid) as data', [args.input_year,args.input_game ?? null,args.input_participant ?? null]],
        santa_games_attempt: ['select public.santa_games_attempt($1::integer,$2::uuid,$3::uuid,$4::jsonb,$5::uuid,$6::bigint) as data', [args.input_year,args.input_game,args.input_participant,JSON.stringify(args.input_answers),args.input_request,args.input_revision]],
        santa_rate_limit: ['select public.santa_rate_limit($1, $2) as data', [args.input_key, args.input_scope]],
        santa_public_event: ['select public.santa_public_event() as data', []],
        santa_submit: ['select public.santa_submit($1::jsonb) as data', [JSON.stringify(args.input_data)]],
        santa_snapshot: ['select public.santa_snapshot($1::integer, $2::integer) as data', [args.input_year ?? null, args.input_version ?? null]],
        santa_set_rules: ['select public.santa_set_rules($1::integer,$2::text,$3::bigint) as data', [args.input_year, args.input_rules, args.input_revision]],
        santa_remove: ['select public.santa_remove($1::uuid,$2::integer,$3::bigint) as data', [args.input_id, args.input_year, args.input_revision]],
        santa_create_year: ['select public.santa_create_year($1::integer) as data', [args.input_year]],
        santa_activate_year: ['select public.santa_activate_year($1::integer,$2::integer) as data', [args.input_year, args.input_expected_active]],
        santa_set_person: ['select public.santa_set_person($1::integer,$2::uuid,$3::uuid,$4::bigint,$5::boolean) as data', [args.input_year, args.input_id, args.input_person_id, args.input_revision, args.input_create_person ?? false]],
        santa_save_draw: ['select public.santa_save_draw($1::integer,$2::uuid[],$3::bigint,$4::integer,$5::integer,$6::boolean) as data', [args.input_year, '{' + (args.input_ids?.join(',') || '') + '}', args.input_revision, args.input_expected_version, args.input_previous_version, args.input_confirm_unsent ?? false]],
        santa_lock_draw: ['select public.santa_lock_draw($1::integer,$2::integer,$3::bigint) as data', [args.input_year, args.input_version, args.input_revision]],
      };
      if (!calls[name]) throw new Error('Unknown test RPC');
      try {
        const result = await engine.query(...calls[name]);
        return { data: result.rows[0].data, error: null };
      } catch (error) { return { data: null, error: { message: error.message } }; }
    },
  };
}

export function submission(overrides = {}) {
  return { name: 'Testovací Elf', phone: '+420 777 123 456', statements: ['cozy', 'cookies'], timing: 'last-minute', confirmed: true, idempotencyKey: randomUUID(), year: 2026, ...overrides };
}

export const testEnvironment = {
  SUPABASE_URL: 'https://test.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key-never-used-for-network',
  ADMIN_PASSWORD: 'local-test-password-only-123456789',
  RATE_LIMIT_SALT: 'local-test-salt-only-12345678901234567890',
};

export const familyNames = Array.from({ length: 10 }, (unused, index) => 'Testovací osoba ' + String(index + 1).padStart(2, '0'));
export const historyPairs = [[0, 1], [1, 0], [2, 7], [3, 8], [4, 9], [5, 6], [6, 2], [7, 3], [8, 4], [9, 5]];

export async function createTestApp(options = {}) {
  const database = await createDatabase(options);
  const santaHandler = createHandler({ environment: testEnvironment, database, ...(options.chooseCircle ? { chooseCircle: options.chooseCircle } : {}) });
  const gamesHandler = createGamesHandler({ environment: testEnvironment, database });
  const server = createServer((request,response) => (request.url === '/api/games' ? gamesHandler : santaHandler)(request,response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = async (body, password, overrides = {}) => {
    const { path = '', ...fetchOptions } = overrides;
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: 'Bearer ' + password } : {}) },
      body: JSON.stringify(body), ...fetchOptions,
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const admin = (action, data = {}) => request({ action, ...data }, testEnvironment.ADMIN_PASSWORD);
  return {
    database, request, admin,
    games: (action,data = {},authenticated = false) => request({action,...data},authenticated ? testEnvironment.ADMIN_PASSWORD : undefined,{path:'/api/games'}),
    async enroll(names, year = 2026) {
      for (const name of names) {
        const result = await request({ action: 'submit', ...submission({ name, year }) });
        if (result.status !== 200) throw new Error(JSON.stringify(result.body));
      }
      let result = await admin('admin-list', { year });
      for (const participant of result.body.participants) {
        const matching = result.body.people.find((person) => person.name === participant.name);
        result = await admin('admin-person', { year, revision: result.body.revision, id: participant.id, personId: matching?.id ?? 'new' });
        if (result.status !== 200) throw new Error(JSON.stringify(result.body));
      }
      return result.body;
    },
    async close() { await new Promise((resolve) => server.close(resolve)); await database.engine.close(); },
  };
}

export function drawRequest(snapshot, overrides = {}) {
  return { year: snapshot.year, revision: snapshot.revision, participantIds: snapshot.participants.map((participant) => participant.id),
    expectedVersion: snapshot.currentVersion ?? 0, confirmation: snapshot.currentVersion ? 'PRELOSOVAT' : 'LOSOVAT',
    confirmUnsent: Boolean(snapshot.currentVersion), ...overrides };
}
