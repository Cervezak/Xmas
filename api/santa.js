import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { validateSubmission, smsText } from '../shared/questionnaire.js';
import { drawCircle } from '../server/draw.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const hash = (value) => createHash('sha256').update(value).digest();

async function readBody(request) {
  if (Number(request.headers['content-length']) > 8192) throw new HttpError(413, 'Formulář je příliš velký.');
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Požadavek musí být ve formátu JSON.');
  let body = request.body;
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += Buffer.byteLength(chunk);
      if (size > 8192) throw new HttpError(413, 'Formulář je příliš velký.');
      chunks.push(Buffer.from(chunk));
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)) > 8192) throw new HttpError(413, 'Formulář je příliš velký.');
  try { return typeof body === 'string' ? JSON.parse(body) : body; }
  catch { throw new HttpError(400, 'Formulář nemá správný formát.'); }
}

export function createHandler({ environment = process.env, database, chooseCircle = drawCircle } = {}) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    try {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new HttpError(405, 'Tento požadavek není podporovaný.');
      }
      const input = await readBody(request);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Formulář nemá správný formát.');
      if (!['submit', 'admin-list', 'admin-delete', 'admin-draw'].includes(input.action)) throw new HttpError(400, 'Neznámá operace.');
      if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY || !environment.ADMIN_PASSWORD || environment.ADMIN_PASSWORD.length < 24 || !environment.RATE_LIMIT_SALT || environment.RATE_LIMIT_SALT.length < 32) throw new HttpError(503, 'Dílna ještě není připojená. Zkus to prosím později.');
      const client = database ?? createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) } });
      const rpc = async (name, args = {}) => {
        const { data, error } = await client.rpc(name, args);
        if (error) {
          const known = {
            SANTA_CLOSED: 'Losování už proběhlo. Přihlášky jsou uzavřené.',
            SANTA_CHANGED: 'Seznam se změnil. Obnov jej a zkontroluj účastníky znovu.',
            SANTA_MINIMUM: 'K losování jsou potřeba alespoň 3 účastníci.',
            SANTA_RETRY_CHANGED: 'Tato přihláška už byla odeslána s jinými údaji. Obnov stránku.',
            SANTA_NOT_FOUND: 'Účastník už v seznamu není.',
          };
          if (known[error.message]) throw new HttpError(409, known[error.message]);
          throw new HttpError(503, 'Dílna je právě nedostupná. Zkus to za chvíli; své odpovědi máš stále zde.');
        }
        return data;
      };
      const address = environment.VERCEL === '1'
        ? String(request.headers['x-vercel-forwarded-for'] ?? 'unknown').split(',')[0].trim()
        : request.socket?.remoteAddress ?? 'local';
      const clientKey = createHmac('sha256', environment.RATE_LIMIT_SALT).update(address).digest('hex');
      const limit = async (scope) => {
        if (!await rpc('santa_rate_limit', { input_key: clientKey, input_scope: scope })) throw new HttpError(429, 'Chvilku zpomal. Zkus to znovu za 15 minut.');
      };
      if (input.action === 'submit') {
        let participant;
        try { participant = validateSubmission(input); }
        catch (error) { throw new HttpError(400, error.message); }
        await limit('submit');
        const requestHash = createHash('sha256').update(JSON.stringify(participant)).digest('hex');
        const result = await rpc('santa_submit', { input_data: { ...participant, requestHash } });
        send(200, { name: result.name, elfTitle: result.elfTitle });
        return;
      }
      const password = typeof request.headers.authorization === 'string' ? request.headers.authorization.replace(/^Bearer /, '') : '';
      if (!timingSafeEqual(hash(password), hash(environment.ADMIN_PASSWORD))) {
        await limit('login');
        throw new HttpError(401, 'Heslo do dílny nesedí.');
      }
      await limit('admin');
      if (input.action === 'admin-delete') {
        if (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) throw new HttpError(400, 'Neplatný účastník.');
        await rpc('santa_remove', { input_id: input.id });
      }
      if (input.action === 'admin-draw') {
        if (input.confirmation !== 'LOSOVAT') throw new HttpError(400, 'Potvrď losování slovem LOSOVAT.');
        const snapshot = await rpc('santa_snapshot');
        const actualIds = snapshot.participants.map((participant) => participant.id).sort();
        if (!Array.isArray(input.participantIds) || JSON.stringify([...input.participantIds].sort()) !== JSON.stringify(actualIds)) throw new HttpError(409, 'Seznam se změnil. Obnov jej a zkontroluj účastníky znovu.');
        if (actualIds.length < 3) throw new HttpError(409, 'K losování jsou potřeba alespoň 3 účastníci.');
        await rpc('santa_save_draw', { input_ids: chooseCircle(actualIds) });
      }
      const snapshot = await rpc('santa_snapshot');
      const participantsById = new Map(snapshot.participants.map((participant) => [participant.id, participant]));
      const messages = snapshot.assignments.map((assignment) => {
        const giver = participantsById.get(assignment.giver_id);
        const receiver = participantsById.get(assignment.receiver_id);
        return { giverId: giver.id, receiverId: receiver.id, phone: giver.phone, text: smsText(giver, receiver) };
      });
      send(200, { ...snapshot, messages });
    } catch (error) {
      if (error.status === 429) response.setHeader('Retry-After', '900');
      send(error.status ?? 500, { error: error.status ? error.message : 'Něco se v dílně zadrhlo. Zkus to za chvíli.' });
    }
  };
}

export default createHandler();
