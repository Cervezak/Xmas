import { useEffect,useRef,useState } from 'react';
import { formatGameDate,pragueInput,pragueToUtc,GAME_STATES,formatRiddleSolution } from '../shared/games.js';
import {STATEMENTS,TIMINGS} from '../shared/questionnaire.js';

const questionsFor = (count) => Array.from({length:count},(_,index)=>({label:count===1?'Kdo nebo co je na obrázku?':'Kdo je osoba '+(index+1)+'?',options:['','']}));
const freshGame = () => ({id:crypto.randomUUID(),revision:0,kind:'story',title:'',body:'',questions:questionsFor(3),
  solutions:[-1,-1,-1],imageData:null,revealText:'',revealImageData:null,startsLocal:pragueInput(Date.now()+5*60000),published:false,lockedAt:null});

async function readGameImage(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10*1024*1024) throw new Error('Vyber JPG, PNG nebo WebP do 10 MB.');
  const data = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Obrázek se nepodařilo přečíst.'));reader.readAsDataURL(file);});
  const image = await new Promise((resolve,reject)=>{const picture=new Image();picture.onload=()=>resolve(picture);picture.onerror=()=>reject(new Error('Obrázek se nepodařilo otevřít.'));picture.src=data;});
  if(image.width*image.height>40000000)throw new Error('Obrázek má příliš velké rozlišení. Vyber menší kopii.');
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,1400/Math.max(image.width,image.height));
  canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Prohlížeč neumí připravit obrázek.');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  for(const quality of [0.85,0.7,0.5,0.3]){
    const output=canvas.toDataURL('image/jpeg',quality);
    if(output.length<680000)return output;
  }
  throw new Error('Obrázek je i po zmenšení příliš velký. Zkus menší rozlišení.');
}

export default function AdminGames({year,active,request}) {
  const [data,setData]=useState(null);
  const [draft,setDraft]=useState(null);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [note,setNote]=useState('');
  const [preview,setPreview]=useState(false);
  const [guestName,setGuestName]=useState('');
  const [removeOpen,setRemoveOpen]=useState(false);
  const [removeConfirmation,setRemoveConfirmation]=useState('');
  const sequence=useRef(0);
  useEffect(()=>()=>{sequence.current+=1;},[]);
  const operate=async(action,extra={},open=false)=>{
    const token=++sequence.current;
    setBusy(true);setError('');setNote('');
    try{
      const result=await request(action,{year,...extra});
      if(token!==sequence.current)return false;
      setData(result);
      if(open && result.selectedGame){setDraft({...result.selectedGame,startsLocal:pragueInput(result.selectedGame.startsAt)});setDirty(false);setPreview(false);setRemoveOpen(false);setRemoveConfirmation('');}
      return result;
    }catch(failure){if(token===sequence.current)setError(failure.message);return false;}
    finally{if(token===sequence.current)setBusy(false);}
  };
  useEffect(()=>{
    if(!active || data)return;
    let live=true;const token=++sequence.current;
    setBusy(true);setError('');
    request('admin-list',{year}).then((result)=>{if(live && token===sequence.current)setData(result);})
      .catch((failure)=>{if(live && token===sequence.current)setError(failure.message);})
      .finally(()=>{if(live && token===sequence.current)setBusy(false);});
    return()=>{live=false;};
  },[active,year,request,data]);
  const change=(patch)=>{setDraft((old)=>({...old,...patch}));setDirty(true);setNote('');};
  const mayLeave=()=>!dirty || window.confirm('Opustit neuložené úpravy této hry?');
  const meta=data?.games.find((game)=>game.id===draft?.id);
  const locked=Boolean(draft?.lockedAt || draft?.cancelledAt || ['archived','cancelled'].includes(meta?.status));
  const started=['active','archived','cancelled'].includes(meta?.status);
  const uploadImage=async(file,field)=>{
    if(!file)return;const id=draft.id;setBusy(true);setError('');
    try{const imageData=await readGameImage(file);setDraft((old)=>old?.id===id?{...old,[field]:imageData}:old);setDirty(true);}
    catch(failure){setError(failure.message);}finally{setBusy(false);}
  };
  const save=async(published)=>{
    try{
      const startsAt=draft.startsAt && pragueInput(draft.startsAt)===draft.startsLocal?draft.startsAt:pragueToUtc(draft.startsLocal);
      const game={...draft,published,startsAt,solutions:draft.kind==='riddle'?draft.solutions.map((answer)=>Array.isArray(answer)?answer.map((variant)=>variant.trim()).filter(Boolean):answer):draft.solutions};
      if(await operate('admin-save',{game},true))setNote(published?'Hra je uložená a zveřejní se podle termínu.':'Koncept je uložený. Na veřejném webu se nezobrazí.');
    }catch(failure){setError(failure.message);}
  };
  const setQuestion=(index,question)=>change({questions:draft.questions.map((old,position)=>position===index?question:old)});
  return <section className="admin-section games-admin">
    <div className="section-toolbar"><div><p className="eyebrow">RODINNÉ ZÁHADY</p><h2>Easter eggy · {year}</h2></div><div className="games-buttons">
      <button type="button" className="secondary" disabled={busy} onClick={()=>operate('admin-list')}>Obnovit hry</button>
      <button type="button" className="primary" disabled={busy} onClick={()=>{if(mayLeave()){setDraft(freshGame());setDirty(false);setPreview(false);setError('');setNote('');}}}>Nová hra</button></div></div>
    <p className="muted">Čas zadáváš pro Česko. Každá zveřejněná hra poběží do začátku následující. Po prvním pokusu nebo po ukončení jsou zadání a řešení uzamčené.</p>
    {error && <p className="error" role="alert">{error}</p>}{note && <p className="notice" role="status">{note}</p>}
    {!data && busy && <p role="status">Načítám hry…</p>}
    {data && <details className="guest-admin"><summary>Hráči pouze pro easter eggy ({data.guests?.length ?? 0})</summary>
      <p className="muted">Tato jména mohou hrát a dobrovolně vyplnit dotazník. Nevstupují do losování ani do SMS.</p>
      <form onSubmit={async(event)=>{event.preventDefault();if(await operate('admin-add-guest',{name:guestName}))setGuestName('');}}>
        <label htmlFor="guest-name">Jméno nového hráče</label><div className="season-input-row"><input id="guest-name" required minLength={2} maxLength={60} value={guestName} disabled={busy} onChange={(event)=>setGuestName(event.target.value)} /><button className="secondary" disabled={busy}>Přidat pouze do her</button></div>
      </form>
      {(data.guests ?? []).map((guest)=><article className="guest-admin-row" key={guest.id}><strong>{guest.name}</strong><p>{guest.elfTitle || 'Dobrovolný dotazník zatím není vyplněný.'}</p>
        {guest.profile && <details><summary>Odpovědi v dotazníku</summary><ul>{guest.profile.statements.map((id)=><li key={id}>{STATEMENTS.find((choice)=>choice.id===id)?.label}</li>)}</ul><p>{TIMINGS.find((choice)=>choice.id===guest.profile.timing)?.label}</p></details>}
      </article>)}
    </details>}
    {data && <div className="game-admin-list">{data.games.length===0?<p className="empty-state">Zatím tu není žádná hra. Začni tlačítkem Nová hra.</p>:data.games.map((game)=><article key={game.id} className={'game-list-row '+(draft?.id===game.id?'selected':'')}>
      <div><strong>{game.title}</strong><p>{GAME_STATES[game.status]} · {formatGameDate(game.startsAt)} → {game.published?formatGameDate(game.endsAt):'koncept'}<br />Řešilo: {game.playerCount} · pokusy: {game.attemptCount}</p></div>
      <button type="button" className="secondary" disabled={busy} onClick={()=>{if(mayLeave())operate('admin-get',{gameId:game.id},true);}}>{game.lockedAt || ['archived','cancelled'].includes(game.status)?'Prohlédnout':'Otevřít'}</button>
    </article>)}</div>}
    {draft && <div className="game-editor">
      <div className="section-toolbar"><h3>{draft.revision?'Upravit / prohlédnout hru':'Nová hra'}</h3><button type="button" className="secondary" onClick={()=>setPreview(!preview)}>{preview?'Zpět k editoru':'Náhled hry'}</button></div>
      {locked && <p className="notice">Tato hra je uzamčená. Zadání i správné odpovědi zůstávají zachované.</p>}
      <form onSubmit={(event)=>{event.preventDefault();save(true);}}>
        <fieldset className="game-editor-fields" disabled={busy || locked}>
          <label htmlFor="game-kind">Typ hry</label><select id="game-kind" value={draft.kind} onChange={(event)=>{
            const kind=event.target.value;
            const switchFormat=(kind==='riddle')!==(draft.kind==='riddle');
            const blank=draft.kind==='riddle'?draft.solutions.every((answer)=>!formatRiddleSolution(answer,'').trim()):draft.questions.every((question)=>question.options.every((option)=>!option));
            if(switchFormat && !blank && !window.confirm('Změna typu vymaže dosavadní otázky a odpovědi. Pokračovat?'))return;
            change({kind,...(switchFormat || blank?{questions:kind==='riddle'?[{label:'Jaká je tvoje odpověď?'}]:questionsFor(kind==='image'?1:3),solutions:kind==='riddle'?['']:kind==='image'?[-1]:[-1,-1,-1]}:{})});
          }}><option value="story">Historka – přiřazení osob</option><option value="image">Rozpoznání obrázku</option><option value="riddle">Hádanka – otevřená odpověď</option></select>
          <label htmlFor="game-title">Název hry</label><input id="game-title" maxLength={120} required value={draft.title} onChange={(event)=>change({title:event.target.value})} />
          <label htmlFor="game-start">Zobrazit od (český čas)</label><input id="game-start" type="datetime-local" required disabled={busy || locked || started} value={draft.startsLocal} onChange={(event)=>change({startsLocal:event.target.value})} />
          <small>Pro nové zveřejnění vyber budoucí čas. Pro rychlé spuštění stačí čas za několik minut.</small>
          <label htmlFor="game-body">{draft.kind==='story'?'Celý text historky':draft.kind==='riddle'?'Text hádanky':'Zadání k obrázku'}</label><textarea id="game-body" rows={8} maxLength={16000} required value={draft.body} onChange={(event)=>change({body:event.target.value})} />
          {draft.kind==='image' && <><label htmlFor="game-image">Nahrát obrázek nebo připravené obrysy</label><input id="game-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event)=>uploadImage(event.target.files?.[0],'imageData')} /><small>JPG, PNG nebo WebP do 10 MB. Web obrázek zmenší před uložením.</small>{draft.imageData && <img className="game-image" src={draft.imageData} alt="Nahraný obrázek hry" />}</>}
          <label htmlFor="game-question-count">Počet otázek / osob</label><select id="game-question-count" value={draft.questions.length} onChange={(event)=>{
            const count=Number(event.target.value);change({questions:Array.from({length:count},(_,index)=>draft.questions[index] || (draft.kind==='riddle'?{label:'Odpověď '+(index+1)}:questionsFor(3)[index])),solutions:Array.from({length:count},(_,index)=>draft.solutions[index]??(draft.kind==='riddle'?'':-1))});
          }}>{[1,2,3].map((count)=><option key={count} value={count}>{count}</option>)}</select>
          {draft.questions.map((question,index)=><section className="game-question-editor" key={index}>
            <label htmlFor={'game-question-'+index}>Otázka {index+1}</label><input id={'game-question-'+index} maxLength={160} required value={question.label} onChange={(event)=>setQuestion(index,{...question,label:event.target.value})} />
            {draft.kind==='riddle'?<>
              <label htmlFor={'game-solution-'+index}>Uznávané odpovědi {index+1} – každá na nový řádek</label><textarea id={'game-solution-'+index} rows={4} required maxLength={3219} value={formatRiddleSolution(draft.solutions[index],'\n')} placeholder={'zvon\nzvonek\nzvoneček'} onChange={(event)=>change({solutions:draft.solutions.map((old,position)=>position===index?event.target.value.split('\n'):old)})} />
              <p className="muted">Stačí shoda s jednou variantou. Nejvýše 20 variant, každá do 160 znaků. Velká a malá písmena, diakritika a mezery navíc nerozhodují. Například „zvoneček“ i „ZVONECEK“ platí stejně.</p>
            </>:<><p className="muted">Napiš možnosti a označ jednu správnou odpověď.</p>
            {question.options.map((option,optionIndex)=><div className="game-option-editor" key={optionIndex}>
              <label className="game-answer-radio"><input type="radio" name={'correct-'+index} required checked={draft.solutions[index]===optionIndex} onChange={()=>change({solutions:draft.solutions.map((old,position)=>position===index?optionIndex:old)})} /><span className="sr-only">Správná odpověď, otázka {index+1}, možnost {optionIndex+1}</span></label>
              <input aria-label={'Otázka '+(index+1)+', možnost '+(optionIndex+1)} value={option} required maxLength={80} onChange={(event)=>setQuestion(index,{...question,options:question.options.map((old,position)=>position===optionIndex?event.target.value:old)})} />
              <button type="button" className="text-button" disabled={question.options.length<=2} onClick={()=>{
                const selected=draft.solutions[index];change({questions:draft.questions.map((old,position)=>position===index?{...old,options:old.options.filter((unused,i)=>i!==optionIndex)}:old),
                  solutions:draft.solutions.map((old,position)=>position===index?(selected===optionIndex?-1:selected>optionIndex?selected-1:selected):old)});
              }}>Odebrat<span className="sr-only"> možnost {optionIndex+1} u otázky {index+1}</span></button>
            </div>)}
            <button type="button" className="secondary" disabled={question.options.length>=10} onClick={()=>setQuestion(index,{...question,options:[...question.options,'']})}>Přidat možnost</button></>}
          </section>)}
          <label htmlFor="game-reveal">Pointa po vyřešení nebo skončení hry (nepovinné)</label><textarea id="game-reveal" rows={4} maxLength={4000} value={draft.revealText} onChange={(event)=>change({revealText:event.target.value})} />
          {draft.kind==='image' && <><label htmlFor="game-reveal-image">Originální fotka do pointy (nepovinné)</label><input id="game-reveal-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event)=>uploadImage(event.target.files?.[0],'revealImageData')} /><small>Zobrazí se až po správném vyřešení nebo v archivu. JPG, PNG nebo WebP do 10 MB.</small>
            {draft.revealImageData && <><img className="game-image" src={draft.revealImageData} alt="Originální fotografie do pointy" /><button className="secondary" type="button" onClick={()=>{change({revealImageData:null});document.getElementById('game-reveal-image').value='';}}>Odebrat originální fotku</button></>}
          </>}
        </fieldset>
        {!locked && <div className="games-buttons"><button className="primary" disabled={busy}>{started?'Potvrdit změny zadání':'Potvrdit a naplánovat'}</button><button type="button" className="secondary" disabled={busy || started} onClick={()=>save(false)}>Uložit koncept</button></div>}
      </form>
      {preview && <section className="game-preview"><p className="eyebrow">NÁHLED PRO ORGANIZÁTORA</p><h3>{draft.title || 'Název hry'}</h3><p className="game-story">{draft.body}</p>{draft.kind==='image' && draft.imageData && <img className="game-image" src={draft.imageData} alt="Náhled hádanky" />}
        {draft.questions.map((question,index)=><div key={index}><strong>{question.label}</strong>{draft.kind==='riddle'?<p>Správná odpověď: {formatRiddleSolution(draft.solutions[index]) || 'Nevyplněná odpověď'} ✓</p>:<ul>{question.options.map((option,position)=><li key={position}>{option || 'Nevyplněná možnost'}{draft.solutions[index]===position?' ✓':''}</li>)}</ul>}</div>)}
        {(draft.revealText || draft.kind==='image' && draft.revealImageData) && <div className="game-point"><h4>Pointa po vyřešení</h4><p className="game-story">{draft.revealText}</p>{draft.kind==='image' && draft.revealImageData && <img className="game-image" src={draft.revealImageData} alt="Náhled originální fotografie po vyřešení" />}</div>}
      </section>}
      {draft.revision>0 && !draft.cancelledAt && <section className="game-remove">
        {!removeOpen?<button type="button" className="text-button danger-text" disabled={busy} onClick={()=>{setRemoveOpen(true);setRemoveConfirmation('');}}>{started || draft.lockedAt?'Zrušit hru':draft.published?'Smazat hru':'Smazat koncept'}</button>:<form onSubmit={async(event)=>{
          event.preventDefault();const result=await operate('admin-remove',{gameId:draft.id,expectedRevision:draft.revision,confirmation:removeConfirmation});
          if(result){setDraft(null);setDirty(false);setRemoveOpen(false);setRemoveConfirmation('');setNote(result.removed?'Hra byla smazána.':'Hra byla zrušena a stažena z veřejného webu. Výsledky zůstávají v administraci.');}
        }}><p className="notice">{started || draft.lockedAt?'Hra se stáhne z veřejného webu a přestane se počítat do vyřešených her. Dosavadní výsledky zůstanou v administraci.':'Koncept nebo dosud nespouštěná hra a její obrázky se smažou natrvalo.'}</p><label htmlFor="game-remove-confirm">Pro potvrzení napiš ODSTRANIT</label>
          <div className="season-input-row"><input id="game-remove-confirm" value={removeConfirmation} disabled={busy} onChange={(event)=>setRemoveConfirmation(event.target.value)} /><button className="danger" disabled={busy || removeConfirmation!=='ODSTRANIT'}>Potvrdit odstranění</button><button className="secondary" type="button" disabled={busy} onClick={()=>setRemoveOpen(false)}>Zpět</button></div>
        </form>}
      </section>}
      {data?.selectedGame?.id===draft.id && <><h3>Kdo hru řešil</h3>{data.results.length===0?<p className="muted">Zatím žádné pokusy.</p>:<div className="history-table-wrap"><table className="history-table"><thead><tr><th>Jméno</th><th>Pokusy</th><th>Nejlepší výsledek</th><th>Vyřešeno</th></tr></thead><tbody>{data.results.map((result)=><tr key={result.participantId}><td>{result.name}</td><td>{result.attempts}</td><td>{result.bestCorrect} / {draft.questions.length}</td><td>{result.solved?'Ano':'Ne'}</td></tr>)}</tbody></table></div>}</>}
    </div>}
  </section>;
}
