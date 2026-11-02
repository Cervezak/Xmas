import { useEffect,useRef,useState } from 'react';
import { formatGameDate,pragueInput,pragueToUtc,GAME_STATES } from '../shared/games.js';

const questionsFor = (count) => Array.from({length:count},(_,index)=>({label:count===1?'Kdo nebo co je na obrázku?':'Kdo je osoba '+(index+1)+'?',options:['','']}));
const freshGame = () => ({id:crypto.randomUUID(),revision:0,kind:'story',title:'',body:'',questions:questionsFor(3),
  solutions:[-1,-1,-1],imageData:null,revealText:'',startsLocal:pragueInput(Date.now()+5*60000),published:false,lockedAt:null});

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
  const sequence=useRef(0);
  useEffect(()=>()=>{sequence.current+=1;},[]);
  const operate=async(action,extra={},open=false)=>{
    const token=++sequence.current;
    setBusy(true);setError('');setNote('');
    try{
      const result=await request(action,{year,...extra});
      if(token!==sequence.current)return false;
      setData(result);
      if(open && result.selectedGame){setDraft({...result.selectedGame,startsLocal:pragueInput(result.selectedGame.startsAt)});setDirty(false);setPreview(false);}
      return true;
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
  const locked=Boolean(draft?.lockedAt || meta?.status==='archived');
  const started=meta?.status==='active' || meta?.status==='archived';
  const save=async(published)=>{
    try{
      const startsAt=draft.startsAt && pragueInput(draft.startsAt)===draft.startsLocal?draft.startsAt:pragueToUtc(draft.startsLocal);
      const game={...draft,published,startsAt};
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
    {data && <div className="game-admin-list">{data.games.length===0?<p className="empty-state">Zatím tu není žádná hra. Začni tlačítkem Nová hra.</p>:data.games.map((game)=><article key={game.id} className={'game-list-row '+(draft?.id===game.id?'selected':'')}>
      <div><strong>{game.title}</strong><p>{GAME_STATES[game.status]} · {formatGameDate(game.startsAt)} → {game.published?formatGameDate(game.endsAt):'koncept'}<br />Řešilo: {game.playerCount} · pokusy: {game.attemptCount}</p></div>
      <button type="button" className="secondary" disabled={busy} onClick={()=>{if(mayLeave())operate('admin-get',{gameId:game.id},true);}}>{game.lockedAt || game.status==='archived'?'Prohlédnout':'Otevřít'}</button>
    </article>)}</div>}
    {draft && <div className="game-editor">
      <div className="section-toolbar"><h3>{draft.revision?'Upravit / prohlédnout hru':'Nová hra'}</h3><button type="button" className="secondary" onClick={()=>setPreview(!preview)}>{preview?'Zpět k editoru':'Náhled hry'}</button></div>
      {locked && <p className="notice">Tato hra je uzamčená. Zadání i správné odpovědi zůstávají zachované.</p>}
      <form onSubmit={(event)=>{event.preventDefault();save(true);}}>
        <fieldset className="game-editor-fields" disabled={busy || locked}>
          <label htmlFor="game-kind">Typ hry</label><select id="game-kind" value={draft.kind} onChange={(event)=>{
            const kind=event.target.value;
            const blank=draft.questions.every((question)=>question.options.every((option)=>!option));
            change({kind,...(blank?{questions:questionsFor(kind==='image'?1:3),solutions:kind==='image'?[-1]:[-1,-1,-1]}:{})});
          }}><option value="story">Historka – přiřazení osob</option><option value="image">Rozpoznání obrázku</option></select>
          <label htmlFor="game-title">Název hry</label><input id="game-title" maxLength={120} required value={draft.title} onChange={(event)=>change({title:event.target.value})} />
          <label htmlFor="game-start">Zobrazit od (český čas)</label><input id="game-start" type="datetime-local" required disabled={busy || locked || started} value={draft.startsLocal} onChange={(event)=>change({startsLocal:event.target.value})} />
          <small>Pro nové zveřejnění vyber budoucí čas. Pro rychlé spuštění stačí čas za několik minut.</small>
          <label htmlFor="game-body">{draft.kind==='story'?'Celý text historky':'Zadání k obrázku'}</label><textarea id="game-body" rows={8} maxLength={16000} required value={draft.body} onChange={(event)=>change({body:event.target.value})} />
          {draft.kind==='image' && <><label htmlFor="game-image">Nahrát obrázek nebo připravené obrysy</label><input id="game-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={async(event)=>{
            const file=event.target.files?.[0];if(!file)return;const id=draft.id;
            setBusy(true);setError('');
            try{const imageData=await readGameImage(file);setDraft((old)=>old?.id===id?{...old,imageData}:old);setDirty(true);}
            catch(failure){setError(failure.message);}finally{setBusy(false);}
          }} /><small>JPG, PNG nebo WebP do 10 MB. Web obrázek zmenší před uložením.</small>{draft.imageData && <img className="game-image" src={draft.imageData} alt="Nahraný obrázek hry" />}</>}
          <label htmlFor="game-question-count">Počet otázek / osob</label><select id="game-question-count" value={draft.questions.length} onChange={(event)=>{
            const count=Number(event.target.value);change({questions:Array.from({length:count},(_,index)=>draft.questions[index] || questionsFor(3)[index]),solutions:Array.from({length:count},(_,index)=>draft.solutions[index]??-1)});
          }}>{[1,2,3].map((count)=><option key={count} value={count}>{count}</option>)}</select>
          {draft.questions.map((question,index)=><section className="game-question-editor" key={index}>
            <label htmlFor={'game-question-'+index}>Otázka {index+1}</label><input id={'game-question-'+index} maxLength={160} required value={question.label} onChange={(event)=>setQuestion(index,{...question,label:event.target.value})} />
            <p className="muted">Napiš možnosti a označ jednu správnou odpověď.</p>
            {question.options.map((option,optionIndex)=><div className="game-option-editor" key={optionIndex}>
              <label className="game-answer-radio"><input type="radio" name={'correct-'+index} required checked={draft.solutions[index]===optionIndex} onChange={()=>change({solutions:draft.solutions.map((old,position)=>position===index?optionIndex:old)})} /><span className="sr-only">Správná odpověď, otázka {index+1}, možnost {optionIndex+1}</span></label>
              <input aria-label={'Otázka '+(index+1)+', možnost '+(optionIndex+1)} value={option} required maxLength={80} onChange={(event)=>setQuestion(index,{...question,options:question.options.map((old,position)=>position===optionIndex?event.target.value:old)})} />
              <button type="button" className="text-button" disabled={question.options.length<=2} onClick={()=>{
                const selected=draft.solutions[index];change({questions:draft.questions.map((old,position)=>position===index?{...old,options:old.options.filter((unused,i)=>i!==optionIndex)}:old),
                  solutions:draft.solutions.map((old,position)=>position===index?(selected===optionIndex?-1:selected>optionIndex?selected-1:selected):old)});
              }}>Odebrat<span className="sr-only"> možnost {optionIndex+1} u otázky {index+1}</span></button>
            </div>)}
            <button type="button" className="secondary" disabled={question.options.length>=10} onClick={()=>setQuestion(index,{...question,options:[...question.options,'']})}>Přidat možnost</button>
          </section>)}
          <label htmlFor="game-reveal">Pointa po vyřešení nebo skončení hry (nepovinné)</label><textarea id="game-reveal" rows={4} maxLength={4000} value={draft.revealText} onChange={(event)=>change({revealText:event.target.value})} />
        </fieldset>
        {!locked && <div className="games-buttons"><button className="primary" disabled={busy}>{started?'Potvrdit změny zadání':'Potvrdit a naplánovat'}</button><button type="button" className="secondary" disabled={busy || started} onClick={()=>save(false)}>Uložit koncept</button></div>}
      </form>
      {preview && <section className="game-preview"><p className="eyebrow">NÁHLED PRO ORGANIZÁTORA</p><h3>{draft.title || 'Název hry'}</h3><p className="game-story">{draft.body}</p>{draft.kind==='image' && draft.imageData && <img className="game-image" src={draft.imageData} alt="Náhled hádanky" />}
        {draft.questions.map((question,index)=><div key={index}><strong>{question.label}</strong><ul>{question.options.map((option,position)=><li key={position}>{option || 'Nevyplněná možnost'}{draft.solutions[index]===position?' ✓':''}</li>)}</ul></div>)}</section>}
      {data?.selectedGame?.id===draft.id && <><h3>Kdo hru řešil</h3>{data.results.length===0?<p className="muted">Zatím žádné pokusy.</p>:<div className="history-table-wrap"><table className="history-table"><thead><tr><th>Jméno</th><th>Pokusy</th><th>Nejlepší výsledek</th><th>Vyřešeno</th></tr></thead><tbody>{data.results.map((result)=><tr key={result.participantId}><td>{result.name}</td><td>{result.attempts}</td><td>{result.bestCorrect} / {draft.questions.length}</td><td>{result.solved?'Ano':'Ne'}</td></tr>)}</tbody></table></div>}</>}
    </div>}
  </section>;
}
