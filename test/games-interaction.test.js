import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {randomUUID} from 'node:crypto';
import {createTestApp,drawRequest} from './helpers.js';
import {pragueInput} from '../shared/games.js';

let app,dom,vite,GamesSection,AdminGames,createRoot,root,story,second;
const originals=new Map();
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const revealPng='data:image/png;base64,'+Buffer.concat([Buffer.from(png.split(',')[1],'base64'),Buffer.from([0])]).toString('base64');
const mount=async(Component,props)=>{
  if(root)await act(async()=>root.unmount());
  root=createRoot(dom.window.document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Component,props)));
};
const until=async(predicate)=>{
  const deadline=Date.now()+12000;
  while(!predicate()){if(Date.now()>deadline)throw new Error('UI did not reach the expected state: '+dom.window.document.body.textContent.slice(-700));await act(async()=>new Promise((resolve)=>setTimeout(resolve,15)));}
};
const click=async(text)=>{
  const button=[...dom.window.document.querySelectorAll('button')].find((item)=>item.textContent===text && !item.closest('[hidden]'));
  assert.ok(button,'Missing button: '+text);await act(async()=>button.click());
};
const input=async(id,value)=>{
  const element=dom.window.document.getElementById(id);assert.ok(element,'Missing input: '+id);
  const prototype=element.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:element.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;
  await act(async()=>{Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);element.dispatchEvent(new dom.window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));});
};
const choosePerson=async()=>{
  await until(()=>dom.window.document.querySelectorAll('.game-person').length===3);
  await act(async()=>dom.window.document.querySelector('.game-person').click());
  await until(()=>dom.window.document.querySelector('.game-play') && dom.window.document.querySelector('.game-selected'));
};
const chooseAnswers=async(answers)=>{await act(async()=>{answers.forEach((answer,index)=>dom.window.document.querySelectorAll('.game-choices')[index].querySelectorAll('input')[answer].click());});};

before(async()=>{
  app=await createTestApp();
  const enrolled=await app.enroll(['Herní Adam','Herní Bára','Herní Cyril']);
  assert.equal((await app.admin('admin-draw',drawRequest(enrolled))).status,200);
  const draft={id:randomUUID(),revision:0,kind:'story',title:'UI historka',body:'Osoba 1 vaří.\nOsoba 2 zpívá.\nOsoba 3 balí.',
    questions:[1,2,3].map((n)=>({label:'Kdo je osoba '+n+'?',options:['První','Druhý']})),solutions:[1,0,1],revealText:'Opravdová pointa',
    startsAt:new Date(Date.now()+60000).toISOString(),published:true};
  story=(await app.games('admin-save',{year:2026,game:draft},true)).body.selectedGame;
  assert.ok(story);
  await app.database.engine.query("update public.santa_games set starts_at=now()-interval '2 hours' where id=$1",[story.id]);
  dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
    HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,FileReader:dom.window.FileReader,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const nativeFetch=globalThis.fetch;originals.set('fetch',Object.getOwnPropertyDescriptor(globalThis,'fetch'));
  globalThis.fetch=async(url,options)=>{
    if(url!=='/api/games')return nativeFetch(url,options);
    const result=await app.request(JSON.parse(options.body),undefined,{path:'/api/games'});
    return {ok:result.status===200,status:result.status,json:async()=>result.body};
  };
  ({createRoot}=await import('react-dom/client'));
  vite=await createServer({configFile:false,root:process.cwd(),plugins:[react()],server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  GamesSection=(await vite.ssrLoadModule('/src/GamesSection.jsx')).default;
  AdminGames=(await vite.ssrLoadModule('/src/AdminGames.jsx')).default;
});
after(async()=>{
  if(root)await act(async()=>root.unmount());
  if(vite)await vite.close();
  if(dom)dom.window.close();
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  if(app)await app.close();
});

test('public gameplay records wrong attempts, restores a solved name after reload and disables all further editing',async()=>{
  await mount(GamesSection,{year:2026});await choosePerson();
  await chooseAnswers([0,0,0]);await click('Ověřit odpovědi');
  await until(()=>dom.window.document.body.textContent.includes('Ještě to není ono.'));
  assert.equal(dom.window.document.querySelector('.game-score'),null);
  assert.ok(!dom.window.document.body.textContent.includes('1 / 3 správně'));
  assert.ok([...dom.window.document.querySelectorAll('.game-person span')].every((span)=>/^Vyřešené hry: \d+$/.test(span.textContent)));
  assert.equal(dom.window.document.querySelector('.game-point'),null);
  await chooseAnswers([1,0,1]);await click('Ověřit odpovědi');
  await until(()=>dom.window.document.body.textContent.includes('Správně vyřešeno!'));
  assert.ok([...dom.window.document.querySelectorAll('.game-choices')].every((field)=>field.disabled));
  assert.ok(dom.window.document.querySelector('.game-point').textContent.includes('Opravdová pointa'));
  assert.equal([...dom.window.document.querySelectorAll('button')].some((button)=>button.textContent==='Ověřit odpovědi'),false);
  await mount(GamesSection,{year:2026});await choosePerson();
  await until(()=>dom.window.document.body.textContent.includes('Správně vyřešeno!'));
  assert.equal(dom.window.document.querySelector('.game-score'),null);
  assert.ok(dom.window.document.querySelector('.game-person span').textContent.includes('Vyřešené hry: 1'));
  assert.deepEqual([...dom.window.document.querySelectorAll('.game-choices')].map((field)=>[...field.querySelectorAll('input')].findIndex((radio)=>radio.checked)),[1,0,1]);
});

test('focus refresh switches the active game and the archive shows dates, solvers and read-only answers',async()=>{
  const game={id:randomUUID(),revision:0,kind:'image',title:'UI obrázek',body:'Co vidíš?',imageData:png,
    questions:[{label:'Co to je?',options:['Vločka','Sob']}],solutions:[0],revealText:'',
    startsAt:new Date(Date.now()+60000).toISOString(),published:true};
  second=(await app.games('admin-save',{year:2026,game},true)).body.selectedGame;
  await app.database.engine.query("update public.santa_games set starts_at=now()-interval '1 hour' where id=$1",[second.id]);
  await act(async()=>dom.window.dispatchEvent(new dom.window.Event('focus')));
  await until(()=>dom.window.document.querySelector('.game-play h3')?.textContent==='UI obrázek');
  assert.ok(dom.window.document.querySelector('.game-image'));
  await input('game-archive-2026',story.id);
  await until(()=>dom.window.document.querySelector('.game-play h3')?.textContent==='UI historka');
  assert.ok(dom.window.document.querySelector('.game-play').textContent.includes('Hra skončila.'));
  assert.ok(dom.window.document.querySelector('.game-play > .muted').textContent.includes('→'));
  assert.ok(dom.window.document.querySelector('.game-results').textContent.includes('Herní Adam'));
  assert.deepEqual([...dom.window.document.querySelectorAll('.game-results th')].map((cell)=>cell.textContent),['Jméno','Vyřešeno']);
  assert.ok([...dom.window.document.querySelectorAll('.game-choices')].every((field)=>field.disabled));
  const log=await app.database.engine.query('select count(*)::integer as count from public.santa_game_attempts where game_id=$1',[story.id]);
  assert.equal(log.rows[0].count,2);
});

test('admin editor uploads an image, saves a private draft, previews it and schedules it without revealing future content',async()=>{
  const request=async(action,data)=>{
    const response=await app.games(action,data,true);
    if(response.status!==200){const error=new Error(response.body.error);error.status=response.status;throw error;}
    return response.body;
  };
  await mount(AdminGames,{year:2026,active:true,request});
  await until(()=>dom.window.document.querySelector('.game-admin-list'));
  await click('Nová hra');
  await input('game-kind','image');
  await input('game-title','Nový obrázek z editoru');
  await input('game-body','Poznáš tento obrázek?');
  await input('game-start',pragueInput(Date.now()+3600000));
  await input('game-question-0','Kdo je na obrázku?');
  const options=dom.window.document.querySelectorAll('.game-option-editor > input');
  await act(async()=>{
    ['Sob','Sněhulák'].forEach((text,index)=>{
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(options[index],text);
      options[index].dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    });
  });
  await act(async()=>dom.window.document.querySelector('.game-answer-radio input').click());
  // jsdom does not decode images or draw canvas; emulate these two browser primitives.
  const oldImage=Object.getOwnPropertyDescriptor(globalThis,'Image');
  const canvas=dom.window.HTMLCanvasElement.prototype;
  const oldContext=canvas.getContext,oldData=canvas.toDataURL;
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class {width=1;height=1;set src(value){queueMicrotask(()=>this.onload());}}});
  canvas.getContext=()=>({fillRect(){},drawImage(){}});
  let outputImage=png;
  canvas.toDataURL=()=>outputImage;
  try{
    const file=new dom.window.File([Buffer.from(png.split(',')[1],'base64')],'test.png',{type:'image/png'});
    const element=dom.window.document.getElementById('game-image');
    Object.defineProperty(element,'files',{configurable:true,value:[file]});
    await act(async()=>element.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
    await until(()=>dom.window.document.querySelector('.game-image'));
    outputImage=revealPng;
    const revealFile=new dom.window.File([Buffer.from(revealPng.split(',')[1],'base64')],'original.png',{type:'image/png'});
    const revealInput=dom.window.document.getElementById('game-reveal-image');
    Object.defineProperty(revealInput,'files',{configurable:true,value:[revealFile]});
    await act(async()=>revealInput.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
    await until(()=>dom.window.document.querySelector('img[alt="Originální fotografie do pointy"]')?.getAttribute('src')===revealPng);
  }finally{
    if(oldImage)Object.defineProperty(globalThis,'Image',oldImage);else delete globalThis.Image;
    canvas.getContext=oldContext;canvas.toDataURL=oldData;
  }
  await click('Uložit koncept');
  await until(()=>dom.window.document.body.textContent.includes('Koncept je uložený.'));
  assert.ok(!dom.window.document.querySelector('[role="alert"]'));
  await click('Náhled hry');
  assert.ok(dom.window.document.querySelector('.game-preview').textContent.includes('Sob ✓'));
  assert.equal(dom.window.document.querySelectorAll('.game-preview img').length,2);
  await click('Potvrdit a naplánovat');
  await until(()=>dom.window.document.body.textContent.includes('Hra je uložená a zveřejní se podle termínu.'));
  const listed=await app.games('admin-list',{year:2026},true);
  const created=listed.body.games.find((game)=>game.title==='Nový obrázek z editoru');
  assert.equal(created.status,'scheduled');
  const stored=await app.games('admin-get',{year:2026,gameId:created.id},true);
  assert.equal(stored.body.selectedGame.imageData,png);
  assert.equal(stored.body.selectedGame.revealImageData,revealPng);
  assert.deepEqual(stored.body.selectedGame.solutions,[0]);
  const publicData=await app.games('list',{year:2026});
  assert.ok(!JSON.stringify(publicData.body).includes('Nový obrázek z editoru'));
  assert.ok(!JSON.stringify(publicData.body).includes(revealPng));
  const historyRow=[...dom.window.document.querySelectorAll('.game-list-row')].find((row)=>row.querySelector('strong').textContent==='UI historka');
  await act(async()=>historyRow.querySelector('button').click());
  await until(()=>dom.window.document.getElementById('game-title')?.value==='UI historka');
  const results=dom.window.document.querySelector('.game-editor table');
  assert.ok(results.textContent.includes('Pokusy'));
  assert.ok(results.textContent.includes('Nejlepší výsledek'));
  const cells=results.querySelectorAll('tbody tr:first-child td');
  assert.equal(cells[1].textContent,'2');
  assert.equal(cells[2].textContent,'3 / 3');
});

test('admin can delete a scheduled game and cancel an active one with explicit confirmation',async()=>{
  const request=async(action,data)=>{
    const response=await app.games(action,data,true);
    if(response.status!==200)throw new Error(response.body.error);
    return response.body;
  };
  await mount(AdminGames,{year:2026,active:true,request});
  await until(()=>dom.window.document.querySelector('.game-admin-list'));
  const futureRow=[...dom.window.document.querySelectorAll('.game-list-row')].find((row)=>row.querySelector('strong').textContent==='Nový obrázek z editoru');
  await act(async()=>futureRow.querySelector('button').click());
  await until(()=>dom.window.document.getElementById('game-title')?.value==='Nový obrázek z editoru');
  await click('Smazat hru');
  assert.equal([...dom.window.document.querySelectorAll('button')].find((button)=>button.textContent==='Potvrdit odstranění').disabled,true);
  await input('game-remove-confirm','ODSTRANIT');await click('Potvrdit odstranění');
  await until(()=>dom.window.document.body.textContent.includes('Hra byla smazána.'));
  assert.ok(!dom.window.document.querySelector('.game-admin-list').textContent.includes('Nový obrázek z editoru'));
  const currentRow=[...dom.window.document.querySelectorAll('.game-list-row')].find((row)=>row.querySelector('strong').textContent==='UI obrázek');
  await act(async()=>currentRow.querySelector('button').click());
  await until(()=>dom.window.document.getElementById('game-title')?.value==='UI obrázek');
  await click('Zrušit hru');await input('game-remove-confirm','ODSTRANIT');await click('Potvrdit odstranění');
  await until(()=>dom.window.document.body.textContent.includes('Hra byla zrušena'));
  const publicData=await app.games('list',{year:2026});
  assert.equal(publicData.body.currentGameId,null);
  assert.equal(publicData.body.games.find((game)=>game.id===story.id).status,'archived');
});

test('game-only players can be added in admin and complete their optional questionnaire on the main page without entering the draw',async()=>{
  await act(async()=>{dom.window.document.querySelector('.guest-admin').open=true;});
  for(const name of ['Herní Dana','Herní Emil']){
    await input('guest-name',name);await click('Přidat pouze do her');
    await until(()=>[...dom.window.document.querySelectorAll('.guest-admin-row > strong')].some((item)=>item.textContent===name));
  }
  const originalDraw=(await app.admin('admin-list')).body;
  assert.equal(originalDraw.participants.length,3);
  const chooseGuest=async()=>{
    await until(()=>dom.window.document.querySelectorAll('.game-person').length===5);
    const button=[...dom.window.document.querySelectorAll('.game-person')].find((item)=>item.querySelector('strong').textContent==='Herní Dana');
    await act(async()=>button.click());
    await until(()=>dom.window.document.querySelector('.guest-questionnaire'));
  };
  await mount(GamesSection,{year:2026});await chooseGuest();
  await click('Vyplnit dobrovolný dotazník');
  assert.equal(dom.window.document.querySelector('.guest-questionnaire input[type="tel"]'),null);
  await act(async()=>dom.window.document.querySelector('.guest-questionnaire input[value="cozy"]').click());
  await act(async()=>dom.window.document.querySelector('.guest-questionnaire input[value="early"]').click());
  await act(async()=>dom.window.document.querySelector('.guest-questionnaire .confirmation input').click());
  await click('Odeslat a získat elfí titul');
  await until(()=>dom.window.document.querySelector('.guest-title'));
  const title=dom.window.document.querySelector('.guest-title').textContent;
  assert.ok(title.includes('Velmistr zachumlání'));
  await mount(GamesSection,{year:2026});await chooseGuest();
  await until(()=>dom.window.document.querySelector('.guest-title'));
  assert.equal(dom.window.document.querySelector('.guest-title').textContent,title);
  assert.equal(dom.window.document.querySelector('.guest-questionnaire form'),null);
  const after=(await app.admin('admin-list')).body;
  assert.deepEqual(after.assignments,originalDraw.assignments);
  assert.deepEqual(after.messages,originalDraw.messages);
  assert.equal(after.participants.length,3);
});

test('admin creates an open riddle and players can type accent-insensitive answers, reload success and view the archive',async()=>{
  const request=async(action,data)=>{
    const response=await app.games(action,data,true);
    if(response.status!==200)throw new Error(response.body.error);
    return response.body;
  };
  await mount(AdminGames,{year:2026,active:true,request});
  await until(()=>dom.window.document.querySelector('.game-admin-list'));
  await click('Nová hra');await input('game-kind','riddle');
  assert.equal(dom.window.document.querySelector('.game-option-editor'),null);
  assert.equal(dom.window.document.querySelector('#game-image'),null);
  await input('game-title','UI hádanka');await input('game-body','Kdo zpívá u stromečku?');
  await input('game-start',pragueInput(Date.now()+3600000));
  await input('game-solution-0','Děda Mirek');
  await click('Uložit koncept');await until(()=>dom.window.document.body.textContent.includes('Koncept je uložený.'));
  await click('Náhled hry');assert.ok(dom.window.document.querySelector('.game-preview').textContent.includes('Správná odpověď: Děda Mirek'));
  await click('Potvrdit a naplánovat');await until(()=>dom.window.document.body.textContent.includes('Hra je uložená a zveřejní se podle termínu.'));
  const listing=(await app.games('admin-list',{year:2026},true)).body;
  const riddle=listing.games.find((item)=>item.title==='UI hádanka');
  await app.database.engine.query("update public.santa_games set starts_at=now()-interval '10 seconds' where id=$1",[riddle.id]);
  const selectName=async()=>{
    await until(()=>dom.window.document.querySelectorAll('.game-person').length===5);
    await act(async()=>dom.window.document.querySelector('.game-person').click());
    await until(()=>dom.window.document.querySelector('.game-play input[type="text"]') && dom.window.document.querySelector('.game-selected'));
  };
  await mount(GamesSection,{year:2026});await selectName();
  const answerId='riddle-'+riddle.id+'-0';
  const verify=()=>[...dom.window.document.querySelectorAll('button')].find((item)=>item.textContent==='Ověřit odpovědi');
  assert.equal(verify().disabled,true);assert.ok(!dom.window.document.querySelector('.game-play').textContent.includes('Děda Mirek'));
  await input(answerId,'   ');assert.equal(verify().disabled,true);
  await input(answerId,'Santa');await click('Ověřit odpovědi');await until(()=>dom.window.document.body.textContent.includes('Ještě to není ono.'));
  assert.equal(dom.window.document.querySelector('.game-correct'),null);
  await input(answerId,'  DEDA   mirek  ');await click('Ověřit odpovědi');await until(()=>dom.window.document.body.textContent.includes('Správně vyřešeno!'));
  assert.equal(dom.window.document.querySelector('.game-choices').disabled,true);
  assert.ok(dom.window.document.querySelector('.game-correct').textContent.includes('Děda Mirek'));
  await mount(GamesSection,{year:2026});await selectName();
  await until(()=>dom.window.document.body.textContent.includes('Správně vyřešeno!'));
  assert.equal(dom.window.document.getElementById(answerId).value,'  DEDA   mirek  ');assert.equal(verify(),undefined);
  const next=(await app.games('admin-save',{year:2026,game:{id:randomUUID(),revision:0,kind:'riddle',title:'Další UI hádanka',body:'Co padá?',
    questions:[{label:'Odpověď'}],solutions:['Sníh'],startsAt:new Date(Date.now()+300000).toISOString(),published:true}},true)).body.selectedGame;
  await app.database.engine.query('update public.santa_games set starts_at=now()-interval \'1 second\' where id=$1',[next.id]);
  await act(async()=>dom.window.dispatchEvent(new dom.window.Event('focus')));await until(()=>dom.window.document.querySelector('.game-play h3')?.textContent==='Další UI hádanka');
  await input('game-archive-2026',riddle.id);await until(()=>dom.window.document.querySelector('.game-play h3')?.textContent==='UI hádanka');
  assert.ok(dom.window.document.querySelector('.game-play').textContent.includes('Hra skončila.'));
  assert.equal(dom.window.document.querySelector('.game-choices').disabled,true);assert.ok(dom.window.document.querySelector('.game-correct').textContent.includes('Děda Mirek'));
});
