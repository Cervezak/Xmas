import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTestApp,createDatabase,drawRequest,submission} from './helpers.js';
import {validateSubmission,elfTitle} from '../shared/questionnaire.js';
import {validateGame} from '../api/games.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const original='data:image/png;base64,'+Buffer.concat([Buffer.from(png.split(',')[1],'base64'),Buffer.from([0])]).toString('base64');
const make=(extra={})=>({id:randomUUID(),revision:0,kind:'image',title:'Rozpoznání hosta',body:'Kdo je na karikatuře?',
  questions:[{label:'Kdo to je?',options:['První','Druhý']}],solutions:[1],imageData:png,revealImageData:original,revealText:'Původní fotografie',
  startsAt:new Date(Date.now()+300000).toISOString(),published:true,...extra});
let app,draw,guest,other,photo,next,profileRequest;
const save=async(game)=>(await app.games('admin-save',{year:2026,game},true));
const read=(extra={})=>app.games('list',{year:2026,...extra});
const remove=(game,extra={})=>app.games('admin-remove',{year:2026,gameId:game.id,expectedRevision:game.revision,confirmation:'ODSTRANIT',...extra},true);
const play=(game,id,answers)=>app.games('attempt',{year:2026,gameId:game.id,participantId:id,expectedRevision:game.revision,requestId:randomUUID(),answers});
before(async()=>{
  app=await createTestApp();
  const enrolled=await app.enroll(['Losovaný Elf A','Losovaný Elf B','Losovaný Elf C']);
  draw=(await app.admin('admin-draw',drawRequest(enrolled))).body;
});
after(async()=>{if(app)await app.close();});

test('new admin code refuses to save photos until the database extension is present',async()=>{
  const rpc=app.database.rpc;
  const count=(await app.database.engine.query('select count(*)::integer as count from public.santa_games')).rows[0].count;
  app.database.rpc=async(name,args)=>{
    const result=await rpc(name,args);
    if(name==='santa_games_admin' && result.data){const {guests,...oldShape}=result.data;return {...result,data:oldShape};}
    return result;
  };
  try{
    const result=await save(make({published:false}));
    assert.equal(result.status,503);
    assert.ok(result.body.error.includes('202611040001'));
    assert.equal((await app.database.engine.query('select count(*)::integer as count from public.santa_games')).rows[0].count,count);
  }finally{app.database.rpc=rpc;}
});

test('adding game-only players extends the public roster without altering the draw, participant count or SMS',async()=>{
  for(const name of ['Herní Host D','Herní Host E'])assert.equal((await app.games('admin-add-guest',{year:2026,name},true)).status,200);
  const admin=(await app.games('admin-list',{year:2026},true)).body;
  [guest,other]=admin.guests;
  assert.equal(admin.guests.length,2);
  assert.equal((await app.games('admin-add-guest',{year:2026,name:'herní host d'},true)).status,409);
  const publicData=(await read()).body;
  assert.equal(publicData.names.length,5);
  assert.equal(publicData.names.filter((name)=>name.guest).length,2);
  const untouched=(await app.admin('admin-list')).body;
  assert.deepEqual(untouched.assignments,draw.assignments);
  assert.deepEqual(untouched.messages,draw.messages);
  assert.equal(untouched.revision,draw.revision);
  assert.equal(untouched.participants.length,3);
  const injected=await app.admin('admin-draw',drawRequest(draw,{participantIds:[...draw.participants.map((person)=>person.id),guest.id]}));
  assert.equal(injected.status,409);
});

test('a guest can complete the optional questionnaire without a phone, with idempotent permanent title and private preferences',async()=>{
  profileRequest=randomUUID();
  const input={year:2026,participantId:guest.id,requestId:profileRequest,statements:['cozy','family'],timing:'early',confirmed:true,elfTitle:'FORGED'};
  const responses=await Promise.all([app.games('guest-profile',input),app.games('guest-profile',input)]);
  assert.ok(responses.every((response)=>response.status===200));
  const result=responses[0].body;
  assert.deepEqual(result.guestProfile,{completed:true,elfTitle:elfTitle(input.statements,input.timing)});
  assert.ok(!JSON.stringify(result.guestProfile).includes('statements'));
  assert.equal(result.names.find((name)=>name.id===guest.id).profileCompleted,true);
  const reload=(await read({participantId:guest.id})).body;
  assert.deepEqual(reload.guestProfile,result.guestProfile);
  assert.equal((await app.games('guest-profile',{...input,requestId:randomUUID(),timing:'last-minute'})).status,409);
  assert.equal((await app.games('guest-profile',{...input,participantId:draw.participants[0].id})).status,409);
  const admin=(await app.games('admin-list',{year:2026},true)).body;
  assert.deepEqual(admin.guests.find((person)=>person.id===guest.id).profile.statements,['cozy','family']);
  assert.equal((await app.admin('admin-list')).body.participants.length,3);
});

test('the original reveal image stays hidden before solving and is revealed only to a solved name or in the archive',async()=>{
  photo=(await save(make())).body.selectedGame;
  assert.equal(photo.revealImageData,original);
  assert.equal((await read({gameId:photo.id,participantId:guest.id})).status,409);
  await app.database.engine.query("update public.santa_games set starts_at=now()-interval '2 hours' where id=$1",[photo.id]);
  const unsolved=(await read({gameId:photo.id,participantId:guest.id})).body;
  assert.equal(unsolved.game.revealImageData,null);
  assert.ok(!JSON.stringify(unsolved).includes(original));
  assert.equal((await play(photo,guest.id,[0])).body.game.revealImageData,null);
  const solved=await play(photo,guest.id,[1]);
  assert.equal(solved.status,200);
  assert.equal(solved.body.game.revealImageData,original);
  assert.equal((await read({gameId:photo.id,participantId:other.id})).body.game.revealImageData,null);
  assert.equal((await read({gameId:photo.id,participantId:guest.id})).body.names.find((name)=>name.id===guest.id).solvedGames,1);
  const admin=(await app.games('admin-get',{year:2026,gameId:photo.id},true)).body;
  assert.equal((await save({...admin.selectedGame,revealImageData:png})).status,409);
});

test('deleting an unused draft or future game requires admin confirmation and the correct revision',async()=>{
  const draft=(await save(make({published:false}))).body.selectedGame;
  assert.equal((await app.games('admin-remove',{year:2026,gameId:draft.id,expectedRevision:draft.revision,confirmation:'ODSTRANIT'})).status,401);
  assert.equal((await remove(draft,{confirmation:''})).status,400);
  assert.equal((await remove(draft,{expectedRevision:draft.revision+1})).status,409);
  assert.equal((await remove(draft)).status,200);
  assert.equal((await app.games('admin-get',{year:2026,gameId:draft.id},true)).status,409);
  const future=(await save(make({startsAt:new Date(Date.now()+3600000).toISOString()}))).body.selectedGame;
  assert.equal((await remove(future)).status,200);
  assert.equal((await app.database.engine.query('select count(*)::integer as count from public.santa_games where id=$1',[future.id])).rows[0].count,0);
});

test('two image payloads fit the upload limit and the reveal photo uses the same image validation',async()=>{
  assert.throws(()=>validateGame(make({revealImageData:'data:image/svg+xml;base64,AAAA'})));
  const bytes=Buffer.alloc(500000);
  bytes[0]=255;bytes[1]=216;bytes[2]=255;
  const large='data:image/jpeg;base64,'+bytes.toString('base64');
  const response=await save(make({published:false,imageData:large,revealImageData:large}));
  assert.equal(response.status,200);
  assert.equal(response.body.selectedGame.revealImageData,large);
  assert.equal((await remove(response.body.selectedGame)).status,200);
});

test('cancelling a played game hides it, preserves admin results and never reopens its predecessor',async()=>{
  next=(await save(make({title:'Druhá hra',startsAt:new Date(Date.now()+7200000).toISOString()}))).body.selectedGame;
  await app.database.engine.query("update public.santa_games set starts_at=now()-interval '1 hour' where id=$1",[next.id]);
  const archive=(await read({gameId:photo.id,participantId:other.id})).body;
  assert.equal(archive.game.status,'archived');
  assert.equal(archive.game.revealImageData,original);
  assert.equal((await play(next,guest.id,[1])).status,200);
  const before=(await app.games('admin-get',{year:2026,gameId:next.id},true)).body;
  assert.equal((await remove(before.selectedGame)).status,200);
  const publicData=(await read()).body;
  assert.equal(publicData.currentGameId,null);
  assert.equal(publicData.game,null);
  assert.ok(!publicData.games.some((game)=>game.id===next.id));
  assert.equal((await read({gameId:next.id})).status,409);
  assert.equal((await play(next,guest.id,[1])).status,409);
  assert.equal(publicData.names.find((person)=>person.id===guest.id).solvedGames,1);
  const old=(await read({gameId:photo.id})).body.game;
  assert.equal(old.status,'archived');
  assert.equal(old.endsAt,archive.game.endsAt);
  const admin=(await app.games('admin-get',{year:2026,gameId:next.id},true)).body;
  assert.equal(admin.games.find((game)=>game.id===next.id).status,'cancelled');
  assert.deepEqual(admin.results,before.results);
  assert.equal((await app.admin('admin-list')).body.participants.length,3);
});

test('guest and deletion functions remain private and cannot modify another year',async()=>{
  assert.equal((await app.games('admin-add-guest',{year:2026,name:'Neoprávněný'})).status,401);
  for(const role of ['anon','authenticated']){
    await app.database.engine.exec('set role '+role);
    try{
      for(const query of ['select * from public.santa_game_players','select * from public.santa_game_roster',
        "select public.santa_games_remove(2026,null,0)","select public.santa_games_add_guest(2026,'Host','host')",
        "select public.santa_games_guest_profile(2026,null,'{}',null)"])
        await assert.rejects(app.database.engine.query(query),/permission denied/);
    }finally{await app.database.engine.exec('set role service_role');}
  }
  await app.admin('admin-create-year',{year:2027});
  assert.equal((await app.games('admin-remove',{year:2027,gameId:photo.id,expectedRevision:photo.revision,confirmation:'ODSTRANIT'},true)).status,409);
  const futureYear=(await app.games('admin-list',{year:2027},true)).body;
  assert.deepEqual(futureYear.guests,[]);
});

test('migration preserves existing game scores and player IDs when moving foreign keys to the game roster',async()=>{
  let participantId,gameId,resultBefore;
  const db=await createDatabase({history:false,beforeGameExtension:async(engine)=>{
    const payload=validateSubmission(submission({name:'Původní hráč'}));
    await engine.query('select public.santa_submit($1::jsonb)',[JSON.stringify({...payload,requestHash:'migration-test'})]);
    participantId=(await engine.query('select id from public.santa_participants')).rows[0].id;
    gameId=randomUUID();
    await engine.query("insert into public.santa_games(id,year,kind,title,body,questions,solutions,starts_at,published) values($1,2026,'story','Původní hra','Text',$2::jsonb,'[0]',now()-interval '1 hour',true)",[gameId,JSON.stringify([{label:'Kdo?',options:['A','B']}])]);
    await engine.query("insert into public.santa_game_results(game_id,participant_id,participant_name,attempts,best_correct,solved,answers) values($1,$2,'Původní hráč',3,1,true,'[0]')",[gameId,participantId]);
    resultBefore=(await engine.query('select * from public.santa_game_results')).rows;
  }});
  try{
    assert.deepEqual((await db.engine.query('select * from public.santa_game_results')).rows,resultBefore);
    const player=(await db.engine.query('select id,participant_id,guest from public.santa_game_players')).rows[0];
    assert.equal(player.id,participantId);assert.equal(player.participant_id,participantId);assert.equal(player.guest,false);
  }finally{await db.engine.close();}
});
