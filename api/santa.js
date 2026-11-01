import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { validateSubmission, smsText } from '../shared/questionnaire.js';
import { drawCircle } from '../server/draw.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const hash = (value) => createHash('sha256').update(value).digest();
const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isYear = (value) => Number.isInteger(value) && value >= 2020 && value <= 2100;
const isRevision = (value) => Number.isSafeInteger(value) && value >= 0;

const databaseErrors = {
  SANTA_CLOSED: 'Losování už proběhlo. Přihlášky jsou uzavřené.',
  SANTA_CHANGED: 'Data se změnila. Obnov seznam a zkontroluj jej znovu.',
  SANTA_MINIMUM: 'K losování jsou potřeba alespoň 3 účastníci.',
  SANTA_RETRY_CHANGED: 'Tato přihláška už byla odeslána s jinými údaji.',
  SANTA_NOT_FOUND: 'Účastník už v tomto ročníku není.',
  SANTA_YEAR_CHANGED: 'Změnil se aktivní ročník. Obnov stránku; původní odpovědi zůstávají u původního roku.',
  SANTA_YEAR_NOT_FOUND: 'Tento ročník neexistuje.',
  SANTA_YEAR_EXISTS: 'Tento ročník už existuje.',
  SANTA_INVALID_YEAR: 'Zadej rok mezi 2020 a 2100.',
  SANTA_VERSION_NOT_FOUND: 'Tato verze losování neexistuje.',
  SANTA_IDENTITY_REQUIRED: 'Nejdřív potvrď totožnost všech účastníků pro propojení s historií.',
  SANTA_IDENTITY_LOCKED: 'Po novém losování už nelze měnit propojení účastníků s historií.',
  SANTA_INVALID_PERSON: 'Zvolená osoba neexistuje.',
  SANTA_DUPLICATE_PERSON: 'Tato osoba už má v ročníku jinou přihlášku. Nejdřív prověř duplicitu.',
  SANTA_HISTORY_UNMAPPED: 'Loňská historie obsahuje nepotvrzené totožnosti. Nejdřív je doplň v minulém ročníku.',
  SANTA_HISTORY_MISSING: 'Historie minulého roku zatím není načtená. Nejdřív spusť připravený soukromý SQL import.',
  SANTA_REPEAT: 'Los obsahuje loňské přiřazení. Původní výsledek zůstává zachovaný.',
  SANTA_SAME_DRAW: 'Nový los je stejný jako předchozí. Původní verze zůstává zachovaná.',
  SANTA_HISTORY_ONLY: 'Ručně importovaná historie je pouze ke čtení.',
  SANTA_HISTORY_REFERENCED: 'Na tento ročník už navazuje losování dalšího roku. Historii nelze měnit.',
  SANTA_SMS_CONFIRM: 'Před přelosováním potvrď, že SMS s dosavadním výsledkem ještě nebyly odeslány.',
  SANTA_SMS_LOCKED: 'Tento ročník je uzamčený po rozeslání SMS a nelze jej přelosovat.',
};

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
      if (!['event', 'submit', 'admin-list', 'admin-delete', 'admin-draw', 'admin-create-year', 'admin-activate-year', 'admin-person', 'admin-lock'].includes(input.action)) throw new HttpError(400, 'Neznámá operace.');
      if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY || !environment.ADMIN_PASSWORD || environment.ADMIN_PASSWORD.length < 24 || !environment.RATE_LIMIT_SALT || environment.RATE_LIMIT_SALT.length < 32) throw new HttpError(503, 'Dílna ještě není připojená. Zkus to prosím později.');
      const client = database ?? createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) },
      });
      const rpc = async (name, args = {}) => {
        const { data, error } = await client.rpc(name, args);
        if (error) {
          if (databaseErrors[error.message]) throw new HttpError(409, databaseErrors[error.message]);
          throw new HttpError(503, 'Dílna je právě nedostupná. Zkus to za chvíli; své odpovědi máš stále zde.');
        }
        return data;
      };
      if (input.action === 'event') { send(200, await rpc('santa_public_event')); return; }
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
        const { year, ...hashInput } = participant;
        const requestHash = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');
        const result = await rpc('santa_submit', { input_data: { ...participant, requestHash } });
        send(200, { year: result.year, name: result.name, elfTitle: result.elfTitle });
        return;
      }
      const password = typeof request.headers.authorization === 'string' && request.headers.authorization.startsWith('Bearer ')
        ? request.headers.authorization.slice(7) : '';
      if (!timingSafeEqual(hash(password), hash(environment.ADMIN_PASSWORD))) {
        await limit('login');
        throw new HttpError(401, 'Heslo do dílny nesedí.');
      }
      await limit('admin');
      if (input.year !== undefined && !isYear(input.year)) throw new HttpError(400, databaseErrors.SANTA_INVALID_YEAR);
      if (input.action !== 'admin-list' && !isYear(input.year)) throw new HttpError(400, databaseErrors.SANTA_INVALID_YEAR);
      if (input.action === 'admin-list' && input.version !== undefined && (!Number.isInteger(input.version) || input.version < 1)) throw new HttpError(400, 'Neplatná verze.');
      if (['admin-delete', 'admin-person', 'admin-draw', 'admin-lock'].includes(input.action) && !isRevision(input.revision)) throw new HttpError(400, 'Obnov data před provedením změny.');
      if (input.action === 'admin-create-year') {
        await rpc('santa_create_year', { input_year: input.year });
      }
      if (input.action === 'admin-activate-year') {
        if (!isYear(input.expectedActiveYear) || input.confirmation !== 'AKTIVOVAT ' + input.year) throw new HttpError(400, 'Potvrď aktivaci zvoleného ročníku.');
        await rpc('santa_activate_year', { input_year: input.year, input_expected_active: input.expectedActiveYear });
      }
      if (input.action === 'admin-delete') {
        if (!isUuid(input.id)) throw new HttpError(400, 'Neplatný účastník.');
        await rpc('santa_remove', { input_id: input.id, input_year: input.year, input_revision: input.revision });
      }
      if (input.action === 'admin-person') {
        if (!isUuid(input.id) || !['', 'new'].includes(input.personId) && !isUuid(input.personId)) throw new HttpError(400, 'Neplatná totožnost.');
        await rpc('santa_set_person', {
          input_year: input.year, input_id: input.id, input_person_id: isUuid(input.personId) ? input.personId : null,
          input_revision: input.revision, input_create_person: input.personId === 'new',
        });
      }
      if (input.action === 'admin-draw') {
        if (input.confirmation !== (input.expectedVersion ? 'PRELOSOVAT' : 'LOSOVAT')) throw new HttpError(400, 'Potvrď losování předepsaným slovem.');
        const snapshot = await rpc('santa_snapshot', { input_year: input.year });
        if (snapshot.revision !== input.revision || (snapshot.currentVersion ?? 0) !== input.expectedVersion) throw new HttpError(409, databaseErrors.SANTA_CHANGED);
        if (snapshot.draws.some((draw) => draw.smsLockedAt)) throw new HttpError(409, databaseErrors.SANTA_SMS_LOCKED);
        if (snapshot.historyReferenced) throw new HttpError(409, databaseErrors.SANTA_HISTORY_REFERENCED);
        if (snapshot.draws.some((draw) => draw.source === 'manual')) throw new HttpError(409, databaseErrors.SANTA_HISTORY_ONLY);
        if (snapshot.currentVersion && input.confirmUnsent !== true) throw new HttpError(409, databaseErrors.SANTA_SMS_CONFIRM);
        const actualIds = snapshot.participants.map((participant) => participant.id).sort();
        if (!Array.isArray(input.participantIds) || JSON.stringify([...input.participantIds].sort()) !== JSON.stringify(actualIds)) throw new HttpError(409, databaseErrors.SANTA_CHANGED);
        if (actualIds.length < 3) throw new HttpError(409, databaseErrors.SANTA_MINIMUM);
        if (snapshot.participants.some((participant) => !participant.personId)) throw new HttpError(409, databaseErrors.SANTA_IDENTITY_REQUIRED);
        if (snapshot.previousDraw?.pairs.length < 3) throw new HttpError(409, databaseErrors.SANTA_HISTORY_MISSING);
        if (snapshot.previousDraw?.pairs.some((pair) => !pair.giverPersonId || !pair.receiverPersonId)) throw new HttpError(409, databaseErrors.SANTA_HISTORY_UNMAPPED);
        const personToParticipant = new Map(snapshot.participants.map((participant) => [participant.personId, participant.id]));
        const forbiddenPairs = (snapshot.previousDraw?.pairs ?? []).map((pair) => [personToParticipant.get(pair.giverPersonId), personToParticipant.get(pair.receiverPersonId)]).filter((pair) => pair.every(Boolean));
        let circle;
        try {
          circle = chooseCircle(actualIds, { forbiddenPairs, avoidPairs: snapshot.assignments.map((pair) => [pair.giver_id, pair.receiver_id]) });
        } catch (error) {
          if (['SANTA_NO_SOLUTION', 'SANTA_SEARCH_LIMIT'].includes(error.code)) throw new HttpError(409, error.message);
          throw error;
        }
        await rpc('santa_save_draw', {
          input_year: input.year, input_ids: circle, input_revision: input.revision, input_expected_version: input.expectedVersion,
          input_previous_version: snapshot.previousDraw?.version ?? 0, input_confirm_unsent: input.confirmUnsent === true,
        });
      }
      if (input.action === 'admin-lock') {
        if (input.confirmation !== 'UZAMKNOUT' || !Number.isInteger(input.version) || input.version < 1) throw new HttpError(400, 'Potvrď uzamčení výsledku slovem UZAMKNOUT.');
        await rpc('santa_lock_draw', { input_year: input.year, input_version: input.version, input_revision: input.revision });
      }
      const snapshot = await rpc('santa_snapshot', {
        input_year: input.year ?? null,
        ...(input.action === 'admin-list' && input.version !== undefined ? { input_version: input.version } : {}),
      });
      const draw = snapshot.draws.find((item) => item.version === snapshot.selectedVersion);
      const messages = snapshot.selectedVersion === snapshot.currentVersion && draw?.source !== 'manual'
        ? snapshot.assignments.filter((entry) => entry.giverPhone).map((entry) => ({
          giverId: entry.giver_id, receiverId: entry.receiver_id, phone: entry.giverPhone,
          text: smsText({ name: entry.giverName }, { name: entry.receiverName, statements: entry.receiverStatements }),
        })) : [];
      send(200, { ...snapshot, messages });
    } catch (error) {
      if (error.status === 429) response.setHeader('Retry-After', '900');
      send(error.status ?? 500, { error: error.status ? error.message : 'Něco se v dílně zadrhlo. Zkus to za chvíli.' });
    }
  };
}

export default createHandler();
