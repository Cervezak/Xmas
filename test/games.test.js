import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestApp,drawRequest } from './helpers.js';
import { validateGame } from '../api/games.js';
import { pragueInput,pragueToUtc,formatGamePeriod } from '../shared/games.js';

let app,roster,story,image,solvedRequest;
const future = (minutes) => new Date(Date.now()+minutes*60000).toISOString();
const makeGame = (overrides={}) => ({id:randomUUID(),revision:0,kind:'story',title:'Tajná historka',body:'Osoby 1, 2 a 3 se sešly.',
  questions:[0,1,2].map((index)=>({label:'Kdo je osoba '+(index+1)+'?',options:['Osoba A','Osoba B','Osoba C']})),
  solutions:[0,1,2],revealText:'Neveřejná pointa',startsAt:future(30),published:true,imageData:null,...overrides});
const save = (game) => app.games('admin-save',{year:2026,game},true);
const assertPublicStatsHidden = (response) => {
  if(response.status===200)assert.doesNotMatch(JSON.stringify(response.body),/"(?:attempts|correctAnswers|bestCorrect|correctCount)":/);
  return response;
};
const read = async(data={}) => assertPublicStatsHidden(await app.games('list',{year:2026,...data}));
const attempt = async(answers,requestId=randomUUID(),gameId=story.id,participantId=roster.participants[0].id) =>
  assertPublicStatsHidden(await app.games('attempt',{year:2026,gameId,participantId,answers,requestId,expectedRevision:gameId===image?.id?image.revision:story.revision}));
const adminProgress = async(gameId=story.id) => {
  const result=await app.games('admin-get',{year:2026,gameId},true);
  assert.equal(result.status,200);
  return result.body.results.find((player)=>player.participantId===roster.participants[0].id);
};
before(async()=>{
  app=await createTestApp();
  const enrolled=await app.enroll(['Herní Elf A','Herní Elf B','Herní Elf C']);
  const drawn=await app.admin('admin-draw',drawRequest(enrolled));
  assert.equal(drawn.status,200);
  roster=drawn.body;
});
after(async()=>{if(app)await app.close();});

test('Prague scheduling handles summer, winter and ambiguous or nonexistent daylight-saving times',()=>{
  const startsAt='2026-11-08T21:15:00Z', endsAt='2026-11-13T21:15:00Z';
  assert.match(formatGamePeriod({startsAt,status:'active'}),/^Probíhá od .*konec zatím není naplánovaný$/);
  assert.match(formatGamePeriod({startsAt,endsAt,status:'active'}),/^Probíhá od .* · do /);
  assert.match(formatGamePeriod({startsAt,endsAt,status:'archived'}),/^Hrálo se .* – /);
  assert.match(formatGamePeriod({startsAt,status:'archived'}),/^Ukončená hra/);
  assert.match(formatGamePeriod({startsAt,status:'scheduled'}),/^Začne /);
  assert.match(formatGamePeriod({startsAt,status:'draft'}),/^Koncept/);
  assert.match(formatGamePeriod({startsAt,endsAt,status:'cancelled'}),/^Zrušená hra/);
  assert.equal(pragueToUtc('2026-12-01T00:00'),'2026-11-30T23:00:00.000Z');
  assert.equal(pragueToUtc('2026-07-01T00:00'),'2026-06-30T22:00:00.000Z');
  assert.equal(pragueInput('2026-11-30T23:00:00.000Z'),'2026-12-01T00:00');
  assert.throws(()=>pragueToUtc('2026-03-29T02:30'));
  assert.throws(()=>pragueToUtc('2026-10-25T02:30'));
  assert.throws(()=>validateGame(makeGame({solutions:[0,1,9]})));
  assert.throws(()=>validateGame(makeGame({kind:'image',imageData:'data:image/svg+xml;base64,AAAA'})));
  assert.throws(()=>validateGame(makeGame({kind:'image',imageData:'data:image/png;base64,AAAA'})));
});

test('game tables, solutions and RPCs require server credentials; the admin API rejects unauthenticated edits',async()=>{
  for(const action of ['admin-list','admin-get','admin-save']) assert.equal((await app.games(action,{year:2026})).status,401);
  for(const role of ['anon','authenticated']){
    await app.database.engine.exec('set role '+role);
    try{
      for(const name of ['santa_games','santa_game_results','santa_game_attempts','santa_game_schedule'])
        await assert.rejects(app.database.engine.query('select * from public.'+name),/permission denied/);
      for(const query of ["select public.santa_games_admin(2026)","select public.santa_games_public(2026)","select public.santa_games_save(2026,'{}')","select public.santa_games_attempt(2026,null,null,'[]',null,1)"])
        await assert.rejects(app.database.engine.query(query),/permission denied/);
    }finally{await app.database.engine.exec('set role service_role');}
  }
});

test('drafts and future stories/images never appear in public payloads, and optimistic revisions prevent overwrites',async()=>{
  const draft=await save(makeGame({title:'Soukromý koncept',published:false}));
  assert.equal(draft.status,200);
  story=(await save(makeGame())).body.selectedGame;
  assert.ok(story);
  const scheduled=await save({...story,title:'Naplánovaná tajná historka'});
  assert.equal(scheduled.status,200);
  assert.equal((await save(story)).status,409);
  story=scheduled.body.selectedGame;
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const photo=await save(makeGame({kind:'image',title:'Tajný obrázek',imageData:png,questions:[{label:'Co je na obrázku?',options:['Sníh','Sob']}],solutions:[1],startsAt:future(90)}));
  assert.equal(photo.status,200);
  image=photo.body.selectedGame;
  const listing=await read();
  assert.equal(listing.status,200);
  assert.equal(listing.body.names.length,3);
  assert.deepEqual(listing.body.games,[]);
  assert.equal(listing.body.game,null);
  assert.ok(listing.body.nextStartsAt);
  for(const forbidden of ['Soukromý koncept','Naplánovaná tajná historka','Tajný obrázek','Neveřejná pointa',png])
    assert.ok(!JSON.stringify(listing.body).includes(forbidden));
  assert.equal((await read({gameId:story.id})).status,409);
  assert.ok(listing.body.names.every((name)=>Object.keys(name).sort().join(',')==='guest,id,name,profileCompleted,solvedGames'));
});

test('server time selects the active game without exposing answers or family draw details',async()=>{
  await app.database.engine.query("update public.santa_games set starts_at=now()-interval '2 hours' where id=$1",[story.id]);
  const listing=await read({participantId:roster.participants[0].id});
  assert.equal(listing.status,200);
  assert.equal(listing.body.currentGameId,story.id);
  assert.equal(listing.body.game.status,'active');
  assert.equal(listing.body.game.solutions,null);
  assert.equal(listing.body.game.revealText,'');
  assert.equal(listing.body.game.progress,null);
  for(const word of ['giverPhone','receiverName','elfTitle','phone','idempotencyKey']) assert.ok(!JSON.stringify(listing.body).includes(word));
  assert.equal((await read({gameId:image.id})).status,409);
  assert.equal((await attempt([0,0,0],randomUUID(),story.id,randomUUID())).status,409);
  assert.equal((await attempt([0,0])).status,409);
  const stale=await app.games('attempt',{year:2026,gameId:story.id,participantId:roster.participants[0].id,answers:[0,1,2],requestId:randomUUID(),expectedRevision:story.revision-1});
  assert.equal(stale.status,409);
  assert.equal((await app.games('admin-get',{year:2026,gameId:story.id},true)).body.selectedGame.lockedAt,null);
});

test('one submission counts once, best correct answers do not accumulate, and first play permanently locks content',async()=>{
  const first=await attempt([0,0,0]);
  assert.equal(first.status,200);
  const firstStats=await adminProgress();
  assert.equal(firstStats.attempts,1);
  assert.equal(firstStats.bestCorrect,1);
  assert.equal(first.body.game.solutions,null);
  const second=await attempt([2,1,2]);
  assert.equal(second.status,200);
  const secondStats=await adminProgress();
  assert.equal(secondStats.attempts,2);
  assert.equal(secondStats.bestCorrect,2);
  const player=second.body.names.find((name)=>name.id===roster.participants[0].id);
  assert.equal(player.solvedGames,0);
  const current=await app.games('admin-get',{year:2026,gameId:story.id},true);
  assert.ok(current.body.selectedGame.lockedAt);
  assert.equal(current.body.results[0].attempts,2);
  assert.equal((await save({...current.body.selectedGame,title:'Přepsané zadání'})).status,409);
});

test('concurrent retries are idempotent and reusing the request ID with different answers is rejected',async()=>{
  const id=randomUUID();
  const responses=await Promise.all([attempt([0,2,0],id),attempt([0,2,0],id)]);
  assert.ok(responses.every((response)=>response.status===200));
  assert.deepEqual(responses.map((response)=>response.body.outcome.duplicate).sort(),[false,true]);
  const fresh=await read({gameId:story.id,participantId:roster.participants[0].id});
  assert.equal(fresh.status,200);
  const stats=await adminProgress();
  assert.equal(stats.attempts,3);
  assert.equal(stats.bestCorrect,2);
  assert.equal((await attempt([0,1,2],id)).status,409);
});

test('full success persists selected answers across reloads and prevents all subsequent changes',async()=>{
  solvedRequest=randomUUID();
  const success=await attempt([0,1,2],solvedRequest);
  assert.equal(success.status,200);
  const stats=await adminProgress();
  assert.equal(stats.attempts,4);
  assert.equal(stats.bestCorrect,3);
  assert.equal(success.body.game.progress.solved,true);
  assert.deepEqual(success.body.game.progress.answers,[0,1,2]);
  assert.deepEqual(success.body.game.solutions,[0,1,2]);
  assert.equal(success.body.game.revealText,'Neveřejná pointa');
  const reload=await read({gameId:story.id,participantId:roster.participants[0].id});
  assert.deepEqual(reload.body.game.progress,success.body.game.progress);
  const later=await attempt([2,0,0]);
  assert.equal(later.status,200);
  assert.equal(later.body.outcome.alreadySolved,true);
  assert.deepEqual(later.body.game.progress,reload.body.game.progress);
  assert.equal((await app.database.engine.query('select count(*)::integer as count from public.santa_game_attempts where game_id=$1',[story.id])).rows[0].count,4);
});

test('the next game archives the preceding one with dates and named results, and new attempts after its end are rejected',async()=>{
  await app.database.engine.query("update public.santa_games set starts_at=now()-interval '1 hour' where id=$1",[image.id]);
  const current=await read();
  assert.equal(current.body.currentGameId,image.id);
  assert.equal(current.body.game.kind,'image');
  assert.ok(current.body.game.imageData.startsWith('data:image/png;'));
  assert.equal(current.body.game.solutions,null);
  const before=await app.database.engine.query('select count(*)::integer as count from public.santa_game_attempts');
  const late=await attempt([0,1,2],randomUUID(),story.id,roster.participants[1].id);
  assert.equal(late.status,409);
  const after=await app.database.engine.query('select count(*)::integer as count from public.santa_game_attempts');
  assert.equal(after.rows[0].count,before.rows[0].count);
  const archive=await read({gameId:story.id,participantId:roster.participants[1].id});
  assert.equal(archive.body.game.status,'archived');
  assert.ok(new Date(archive.body.game.startsAt)<new Date(archive.body.game.endsAt));
  assert.deepEqual(archive.body.game.solutions,[0,1,2]);
  assert.equal(archive.body.game.players.length,1);
  assert.deepEqual(Object.keys(archive.body.game.players[0]).sort(),['name','solved']);
  assert.equal((await adminProgress()).attempts,4);
  assert.equal(archive.body.game.progress,null);
  const retry=await attempt([0,1,2],solvedRequest);
  assert.equal(retry.status,200);
  assert.equal(retry.body.outcome.duplicate,true);
  const imageSolved=await attempt([1],randomUUID(),image.id);
  assert.equal(imageSolved.status,200);
  assert.equal(imageSolved.body.game.progress.solved,true);
  const player=imageSolved.body.names.find((name)=>name.id===roster.participants[0].id);
  const storyStats=await adminProgress(story.id),imageStats=await adminProgress(image.id);
  assert.equal(storyStats.bestCorrect+imageStats.bestCorrect,4);
  assert.equal(storyStats.attempts+imageStats.attempts,5);
  assert.equal(player.solvedGames,2);
});

test('scheduling cannot change the past, duplicate a publication time, or move scores across years',async()=>{
  assert.equal((await save(makeGame({startsAt:new Date(Date.now()-10000).toISOString()}))).status,409);
  const futureGame=makeGame({startsAt:future(500)});
  assert.equal((await save(futureGame)).status,200);
  assert.equal((await save(makeGame({startsAt:futureGame.startsAt}))).status,409);
  const invalid={...makeGame(),questions:[{label:'Otázka',options:['A','B'],secret:'nesmí proniknout'}],solutions:[0]};
  const direct=await app.database.rpc('santa_games_save',{input_year:2026,input_game:invalid});
  assert.equal(direct.error.message,'SANTA_GAME_INVALID');
  await app.admin('admin-create-year',{year:2027});
  const next=await app.games('admin-list',{year:2027},true);
  assert.deepEqual(next.body.games,[]);
  assert.equal((await app.games('list',{year:2027})).status,409);
  const updated=(await app.admin('admin-list')).body;
  await app.admin('admin-activate-year',{year:2027,expectedActiveYear:updated.activeYear,confirmation:'AKTIVOVAT 2027'});
  assert.equal((await read()).status,409);
});
