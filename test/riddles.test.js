import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTestApp,createDatabase} from './helpers.js';
import {validateGame} from '../api/games.js';

const make=(extra={})=>({id:randomUUID(),revision:0,kind:'riddle',title:'Vánoční hádanka',body:'Kdo se schovává za vánočním stromkem?',
  questions:[{label:'Kdo to je?'}],solutions:['Děda Mirek'],revealText:'Našel jsi dědu!',
  startsAt:new Date(Date.now()+300000).toISOString(),published:true,...extra});
let app,game,player,other;
const save=(value)=>app.games('admin-save',{year:2026,game:value},true);
const read=(extra={})=>app.games('list',{year:2026,...extra});
const play=(answers,extra={})=>app.games('attempt',{year:2026,gameId:game.id,participantId:player.id,answers,requestId:randomUUID(),expectedRevision:game.revision,...extra});
before(async()=>{
  app=await createTestApp();
  for(const name of ['Herní Hadač A','Herní Hadač B'])assert.equal((await app.games('admin-add-guest',{year:2026,name},true)).status,200);
  [player,other]=(await app.games('admin-list',{year:2026},true)).body.guests;
});
after(async()=>{if(app)await app.close();});

test('riddle validation accepts text solutions only and rejects empty, long or malformed answers',async()=>{
  assert.deepEqual(validateGame(make({solutions:[' Děda Mirek ']})).solutions,['Děda Mirek']);
  for(const extra of [{solutions:[0]},{solutions:[' ']},{solutions:['\u0301']},{solutions:['x'.repeat(161)]},
    {solutions:['Děda\nMirek']},{questions:[{label:'Kdo?',options:['Děda','Santa']}]},{solutions:[]}]){
    assert.throws(()=>validateGame(make(extra)));
    assert.equal((await save(make(extra))).status,400);
    const direct=await app.database.rpc('santa_games_save',{input_year:2026,input_game:make(extra)});
    assert.equal(direct.error?.message,'SANTA_GAME_INVALID');
  }
  const unauthed=await app.games('admin-save',{year:2026,game:make()});assert.equal(unauthed.status,401);
});

test('new riddle type requires its SQL update before any save and future solutions remain private',async()=>{
  const rpc=app.database.rpc;
  app.database.rpc=async(name,args)=>{
    const result=await rpc(name,args);
    if(name==='santa_games_admin' && result.data){const {supportsRiddles,...old}=result.data;return {...result,data:old};}
    return result;
  };
  try{const missing=await save(make());assert.equal(missing.status,503);assert.match(missing.body.error,/202611080001_riddles/);}
  finally{app.database.rpc=rpc;}
  const created=await save(make());assert.equal(created.status,200);game=created.body.selectedGame;
  const listing=await read();assert.equal(listing.body.game,null);assert.ok(!JSON.stringify(listing.body).includes('Děda Mirek'));
  await app.database.engine.query("update public.santa_games set starts_at=now()-interval '1 hour' where id=$1",[game.id]);
  const active=await read({participantId:player.id});assert.equal(active.body.game.kind,'riddle');
  assert.deepEqual(active.body.game.questions,[{label:'Kdo to je?'}]);assert.equal(active.body.game.solutions,null);
  assert.ok(!JSON.stringify(active.body).includes('Děda Mirek'));
});

test('Czech case and accents, decomposed Unicode and extra spaces compare equally on the server',async()=>{
  const variants=['Děda Mirek','DĚDA MIREK','DEDA MIREK','deda mirek','  děda   MIREK  ','Děda Mirek'.normalize('NFD'),'DĚDA\u00a0MIREK'];
  for(const answer of variants){
    const {rows}=await app.database.engine.query('select public.santa_game_answer_key($1) as key',[answer]);assert.equal(rows[0].key,'deda mirek');
  }
  const {rows}=await app.database.engine.query("select public.santa_game_answer_key('PŘÍLIŠ ŽLUŤOUČKÝ KŮŇ ÚPĚL ĎÁBELSKÉ ÓDY') as key");
  assert.equal(rows[0].key,'prilis zlutoucky kun upel dabelske ody');
  const wrong=await play(['Santa']);assert.equal(wrong.status,200);assert.equal(wrong.body.game.progress.solved,false);assert.equal(wrong.body.game.solutions,null);
  const locked=await save({...game,solutions:['Někdo jiný']});assert.equal(locked.status,409);
  const requestId=randomUUID();const correct=await play(['  DEDA   mirek  '],{requestId});assert.equal(correct.status,200);assert.equal(correct.body.game.progress.solved,true);
  assert.deepEqual(correct.body.game.progress.answers,['  DEDA   mirek  ']);assert.deepEqual(correct.body.game.solutions,['Děda Mirek']);
  assert.equal((await play(['  DEDA   mirek  '],{requestId})).body.outcome.duplicate,true);
  assert.equal((await play(['Santa'])).body.outcome.alreadySolved,true);
  const reload=await read({participantId:player.id});assert.deepEqual(reload.body.game.progress.answers,['  DEDA   mirek  ']);assert.equal(reload.body.names.find((name)=>name.id===player.id).solvedGames,1);
  const unsolved=await read({participantId:other.id});assert.equal(unsolved.body.game.solutions,null);assert.equal(unsolved.body.game.revealText,'');
  assert.doesNotMatch(JSON.stringify(correct.body),/"(?:attempts|correctAnswers|bestCorrect|correctCount)":/);
  const stats=(await app.games('admin-get',{year:2026,gameId:game.id},true)).body.results[0];assert.equal(stats.attempts,2);assert.equal(stats.bestCorrect,1);
});

test('riddle attempts reject numeric, blank or excessive answers without counting, and archive reveals the answer read-only',async()=>{
  for(const answers of [[0],[' '],['x'.repeat(161)],['\u0301'],['A','B']]){
    const invalid=await play(answers,{participantId:other.id});assert.ok([400,409].includes(invalid.status));
  }
  assert.equal((await play(['mirek deda'],{participantId:other.id})).body.game.progress.solved,false);
  assert.equal((await play(['deda mirek!'],{participantId:other.id})).body.game.progress.solved,false);
  const next=(await save(make({title:'Další hra'}))).body.selectedGame;
  await app.database.engine.query('update public.santa_games set starts_at=now()-interval \'1 minute\' where id=$1',[next.id]);
  const archived=await read({gameId:game.id,participantId:other.id});assert.equal(archived.body.game.status,'archived');assert.deepEqual(archived.body.game.solutions,['Děda Mirek']);
  assert.equal((await play(['deda mirek'],{participantId:other.id})).status,409);
});

test('several open answers use the same best-score rule without changing choice games',async()=>{
  const created=await save(make({title:'Tři hádanky',questions:[{label:'První'},{label:'Druhá'},{label:'Třetí'}],solutions:['Soňa','Sněhulák','Vánoční stromeček']}));
  assert.equal(created.status,200);const multi=created.body.selectedGame;
  await app.database.engine.query("update public.santa_games set starts_at=now()-interval '10 seconds' where id=$1",[multi.id]);
  const send=(answers)=>play(answers,{gameId:multi.id,expectedRevision:multi.revision,participantId:other.id});
  assert.equal((await send(['SONA','sob','snih'])).status,200);
  assert.equal((await send(['nevim','SNEHULAK','VANOCNI STROMECEK'])).status,200);
  const results=(await app.games('admin-get',{year:2026,gameId:multi.id},true)).body.results[0];assert.equal(results.bestCorrect,2);assert.equal(results.attempts,2);assert.equal(results.solved,false);
  assert.equal((await send(['sona','snehulak','vanocni stromecek'])).body.game.progress.solved,true);
  for(const role of ['anon','authenticated']){
    await app.database.engine.exec('set role '+role);
    try{await assert.rejects(app.database.engine.query("select public.santa_game_answer_key('Děda')"),/permission denied/);}
    finally{await app.database.engine.exec('set role service_role');}
  }
});

test('riddle migration preserves existing choice games, revisions and recorded results',async()=>{
  const gameId=randomUUID(),personId=randomUUID();
  const db=await createDatabase({history:false,beforeRiddles:async(engine)=>{
    await engine.query("insert into public.santa_game_players(id,year,name,name_key) values($1,2026,'Starý hráč','stary hrac')",[personId]);
    await engine.query("insert into public.santa_games(id,year,kind,title,body,questions,solutions,starts_at,published,locked_at,revision) values($1,2026,'story','Původní','Text',$2::jsonb,'[0]',now()-interval '1 hour',true,now(),4)",[gameId,JSON.stringify([{label:'Kdo?',options:['A','B']}])]);
    await engine.query("insert into public.santa_game_results(game_id,participant_id,participant_name,attempts,best_correct,solved,answers,solved_at) values($1,$2,'Starý hráč',2,1,true,'[0]',now())",[gameId,personId]);
  }});
  try{
    const result=await db.rpc('santa_games_admin',{input_year:2026,input_id:gameId});assert.equal(result.error,null);
    assert.equal(result.data.selectedGame.kind,'story');assert.equal(result.data.selectedGame.revision,4);assert.deepEqual(result.data.selectedGame.solutions,[0]);
    assert.equal(result.data.results[0].attempts,2);assert.equal(result.data.results[0].solved,true);
  }finally{await db.engine.close();}
});
