import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { STATEMENTS,TIMINGS,elfTitle,normalizeName } from '../shared/questionnaire.js';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const hash = (value) => createHash('sha256').update(value).digest();
const messages = {
  SANTA_YEAR_CHANGED: 'Změnil se aktivní ročník. Obnov stránku.',
  SANTA_YEAR_NOT_FOUND: 'Ročník neexistuje.',
  SANTA_CHANGED: 'Hra se mezitím změnila. Obnov seznam a otevři ji znovu.',
  SANTA_GAME_INVALID: 'Zkontroluj zadání, možnosti, správné odpovědi a termín.',
  SANTA_GAME_NOT_FOUND: 'Tato hra ještě není dostupná nebo neexistuje.',
  SANTA_GAME_PLAYER: 'Vyber jméno ze seznamu hráčů.',
  SANTA_GUEST_EXISTS: 'Toto jméno už v ročníku existuje.',
  SANTA_GUEST_PROFILE_DONE: 'Tento doplňkový dotazník už je vyplněný. Obnov stránku a uvidíš uložený titul.',
  SANTA_GAME_ENDED: 'Tato hra už není aktivní. Načti aktuální hru nebo archiv.',
  SANTA_GAME_LOCKED: 'Hra už byla rozehrána nebo ukončena. Zadání a řešení jsou uzamčené.',
  SANTA_GAME_SCHEDULE: 'Již spuštěnou hru nelze stáhnout ani změnit její termín.',
  SANTA_GAME_FUTURE: 'Zveřejněnou hru naplánuj na budoucí čas, například za několik minut.',
  SANTA_GAME_TIME_TAKEN: 'Na stejný okamžik už je naplánovaná jiná hra.',
  SANTA_RETRY_CHANGED: 'Tento pokus už byl uložen s jinými odpověďmi. Obnov hru.',
};
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function validateImage(value,required) {
  if(value==null && !required)return null;
  const invalid=()=>{throw new ApiError(400,messages.SANTA_GAME_INVALID);};
  const match=typeof value==='string' && /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match || value.length>700000)invalid();
  const bytes=Buffer.from(match[2],'base64');
  const valid=match[1]==='jpeg'?bytes[0]===255 && bytes[1]===216 && bytes[2]===255
    :match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    :bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP';
  if(!valid || bytes.length>512000 || bytes.toString('base64')!==match[2])invalid();
  return value;
}

export function validateGame(game) {
  const invalid = () => { throw new ApiError(400, messages.SANTA_GAME_INVALID); };
  const text = (value, max, empty = false) => {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) invalid();
    return value.trim();
  };
  if (!game || typeof game !== 'object' || !uuid(game.id) || !Number.isSafeInteger(game.revision) || game.revision < 0 ||
    !['story','image'].includes(game.kind) || typeof game.published !== 'boolean') invalid();
  const title = text(game.title,120);
  const body = text(game.body,16000);
  const revealText = text(game.revealText ?? '',4000,true);
  if (!Array.isArray(game.questions) || game.questions.length < 1 || game.questions.length > 3 ||
    !Array.isArray(game.solutions) || game.solutions.length !== game.questions.length) invalid();
  const questions = game.questions.map((question,index) => {
    if (!question || !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 10) invalid();
    const options = question.options.map((option) => text(option,80));
    if (new Set(options).size !== options.length || !Number.isInteger(game.solutions[index]) || game.solutions[index] < 0 || game.solutions[index] >= options.length) invalid();
    return { label: text(question.label,160), options };
  });
  if (typeof game.startsAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(game.startsAt) || !Number.isFinite(Date.parse(game.startsAt))) invalid();
  const imageData = game.kind === 'image' ? validateImage(game.imageData,true) : null;
  const revealImageData = game.kind === 'image' ? validateImage(game.revealImageData,false) : null;

  return { id:game.id,revision:game.revision,kind:game.kind,title,body,questions,solutions:game.solutions,
    revealText,imageData,revealImageData,startsAt:new Date(game.startsAt).toISOString(),published:game.published };
}
async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError(415,'Požadavek musí být JSON.');
  if (Number(request.headers['content-length']) > 1800000) throw new ApiError(413,'Obrázek nebo zadání je příliš velké.');
  let body = request.body;
  if (body === undefined) {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += Buffer.byteLength(chunk); if (size > 1800000) throw new ApiError(413,'Obrázek nebo zadání je příliš velké.'); chunks.push(Buffer.from(chunk)); }
    body = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)) > 1800000) throw new ApiError(413,'Obrázek nebo zadání je příliš velké.');
  try { return typeof body === 'string' ? JSON.parse(body) : body; } catch { throw new ApiError(400,'Neplatný požadavek.'); }
}
export function createGamesHandler({ environment = process.env, database } = {}) {
  return async (request,response) => {
    response.setHeader('Cache-Control','no-store, max-age=0');
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options','nosniff');
    const send = (status,body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    try {
      if (request.method !== 'POST') { response.setHeader('Allow','POST'); throw new ApiError(405,'Použij POST.'); }
      const input = await readBody(request);
      if (!input || !['list','attempt','guest-profile','admin-list','admin-get','admin-save','admin-remove','admin-add-guest'].includes(input.action)) throw new ApiError(400,'Neznámá operace.');
      if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY || environment.ADMIN_PASSWORD?.length < 24 || !environment.ADMIN_PASSWORD ||
        !environment.RATE_LIMIT_SALT || environment.RATE_LIMIT_SALT.length < 32) throw new ApiError(503,'Hry ještě nejsou připojené.');
      const client = database ?? createClient(environment.SUPABASE_URL,environment.SUPABASE_SERVICE_ROLE_KEY,{
        auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})},
      });
      const rpc = async (name,args) => {
        const {data,error} = await client.rpc(name,args);
        if (error) throw new ApiError(messages[error.message] ? 409 : 503,messages[error.message] || 'Hry jsou právě nedostupné. Zkus to za chvíli.');
        return data;
      };
      const address = environment.VERCEL === '1' ? String(request.headers['x-vercel-forwarded-for'] ?? 'unknown').split(',')[0].trim() : request.socket?.remoteAddress ?? 'local';
      const key = createHmac('sha256',environment.RATE_LIMIT_SALT).update(address).digest('hex');
      const limit = async (scope) => { if (!await rpc('santa_rate_limit',{input_key:key,input_scope:scope})) throw new ApiError(429,'Chvilku zpomal a zkus to později.'); };
      const admin = input.action.startsWith('admin-');
      if (admin) {
        const password = typeof request.headers.authorization === 'string' && request.headers.authorization.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
        if (!timingSafeEqual(hash(password),hash(environment.ADMIN_PASSWORD))) { await limit('login'); throw new ApiError(401,'Heslo do dílny nesedí.'); }
        await limit('admin');
      } else await limit(['attempt','guest-profile'].includes(input.action) ? 'games-play' : 'games-read');
      if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) throw new ApiError(400,'Neplatný ročník.');
      if (input.gameId != null && !uuid(input.gameId) || input.participantId != null && !uuid(input.participantId)) throw new ApiError(400,'Neplatná hra nebo jméno.');
      if (admin) {
        let id = input.gameId ?? null;
        let removed;
        const schema=await rpc('santa_games_admin',{input_year:input.year,input_id:null});
        if(!Array.isArray(schema.guests))throw new ApiError(503,'Nejdřív spusť aktualizaci databáze 202611040001_game_guests_and_reveals.sql.');
        if(input.action==='admin-list' && !id){send(200,schema);return;}
        if (input.action === 'admin-get' && !id) throw new ApiError(400,'Vyber hru.');
        if (input.action === 'admin-save') id = await rpc('santa_games_save',{input_year:input.year,input_game:validateGame(input.game)});
        if(input.action==='admin-remove'){
          if(!id || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<1 || input.confirmation!=='ODSTRANIT')throw new ApiError(400,'Potvrď odstranění hry slovem ODSTRANIT.');
          removed=await rpc('santa_games_remove',{input_year:input.year,input_id:id,input_revision:input.expectedRevision});
          id=null;
        }
        if(input.action==='admin-add-guest'){
          const name=typeof input.name==='string'?input.name.replace(/\s+/g,' ').trim():'';
          if(name.length<2 || name.length>60 || /[\p{Cc}\p{Cf}<>]/u.test(name))throw new ApiError(400,'Jméno musí mít 2 až 60 znaků.');
          await rpc('santa_games_add_guest',{input_year:input.year,input_name:name,input_name_key:normalizeName(name)});
        }
        send(200,{...await rpc('santa_games_admin',{input_year:input.year,input_id:id}),...(removed!==undefined?{removed}:{})});
        return;
      }
      let outcome;
      if(input.action==='guest-profile'){
        if(!uuid(input.participantId) || !uuid(input.requestId) || input.confirmed!==true || input.website ||
          !Array.isArray(input.statements) || input.statements.length<1 || input.statements.length>3 ||
          new Set(input.statements).size!==input.statements.length || input.statements.some((id)=>!STATEMENTS.some((choice)=>choice.id===id)) ||
          !TIMINGS.some((choice)=>choice.id===input.timing))throw new ApiError(400,'Vyber 1 až 3 výroky, načasování a potvrď odeslání.');
        await rpc('santa_games_guest_profile',{input_year:input.year,input_id:input.participantId,input_request:input.requestId,
          input_profile:{statements:input.statements,timing:input.timing,elfTitle:elfTitle(input.statements,input.timing)}});
      }
      if (input.action === 'attempt') {
        if (!uuid(input.gameId) || !uuid(input.participantId) || !uuid(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Array.isArray(input.answers) ||
          input.answers.length < 1 || input.answers.length > 3 || input.answers.some((answer)=>!Number.isInteger(answer) || answer < 0 || answer > 9)) throw new ApiError(400,messages.SANTA_GAME_INVALID);
        outcome = await rpc('santa_games_attempt',{input_year:input.year,input_game:input.gameId,input_participant:input.participantId,input_answers:input.answers,input_request:input.requestId,input_revision:input.expectedRevision});
      }
      const result = await rpc('santa_games_public',{input_year:input.year,input_game:input.gameId ?? null,input_participant:input.participantId ?? null});
      send(200,{
        ...result,
        names:result.names.map(({id,name,solvedGames,guest,profileCompleted})=>({id,name,solvedGames,guest,profileCompleted})),
        game:result.game ? {
          ...result.game,
          progress:result.game.progress ? {
            solved:result.game.progress.solved,answers:result.game.progress.answers,solvedAt:result.game.progress.solvedAt,
          } : null,
          players:result.game.players.map(({name,solved})=>({name,solved})),
        } : null,
        ...(outcome ? {outcome:{duplicate:outcome.duplicate,alreadySolved:outcome.alreadySolved}} : {}),
      });
    } catch(error) {
      if (error.status === 429) response.setHeader('Retry-After','900');
      send(error.status ?? 500,{error:error.status ? error.message : 'Hry se na chvíli zadrhly. Zkus to znovu.'});
    }
  };
}
export default createGamesHandler();
