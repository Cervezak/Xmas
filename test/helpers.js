import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function createDatabase() {
  const engine = new PGlite();
  await engine.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await engine.exec(await readFile(new URL('../supabase/migrations/202610260001_santa.sql', import.meta.url), 'utf8'));
  await engine.exec('set role service_role;');
  return {
    engine,
    async rpc(name, args = {}) {
      const calls = {
        santa_rate_limit: ['select public.santa_rate_limit($1, $2) as data', [args.input_key, args.input_scope]],
        santa_submit: ['select public.santa_submit($1::jsonb) as data', [JSON.stringify(args.input_data)]],
        santa_snapshot: ['select public.santa_snapshot() as data', []],
        santa_remove: ['select public.santa_remove($1::uuid) as data', [args.input_id]],
        santa_save_draw: ['select public.santa_save_draw($1::uuid[]) as data', [`{${args.input_ids?.join(',') || ''}}`]],
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
  return { name: 'Testovací Elf', phone: '+420 777 123 456', statements: ['cozy', 'cookies'], timing: 'last-minute', confirmed: true, idempotencyKey: randomUUID(), ...overrides };
}

export const testEnvironment = {
  SUPABASE_URL: 'https://test.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key-never-used-for-network',
  ADMIN_PASSWORD: 'local-test-password-only-123456789',
  RATE_LIMIT_SALT: 'local-test-salt-only-12345678901234567890',
};
