import { useCallback,useEffect,useRef,useState } from 'react';
import { gamesApi,formatGameDate } from '../shared/games.js';

export function GamePlay({game,personId,onAttempt,submitting}) {
  const [answers,setAnswers]=useState(()=>game.progress?.answers ?? game.questions.map(()=>-1));
  const request=useRef(null);
  const ended=game.status==='archived';
  const solved=Boolean(game.progress?.solved);
  const shown=solved || ended?(game.progress?.answers ?? game.questions.map(()=>-1)):answers;
  const readOnly=ended || solved || !personId;
  const submit=async(event)=>{
    event.preventDefault();
    const key=JSON.stringify(answers);
    if(!request.current || request.current.key!==key)request.current={key,id:crypto.randomUUID()};
    if(await onAttempt(answers,request.current.id))request.current=null;
  };
  return <article className="game-play">
    <p className="eyebrow">{ended?'ARCHIV · UKONČENÁ HRA':'PRÁVĚ HRAJEME'}</p><h3>{game.title}</h3>
    <p className="muted">{formatGameDate(game.startsAt)} → {formatGameDate(game.endsAt)}</p>
    <p className="game-story">{game.body}</p>
    {game.kind==='image' && game.imageData && <img className="game-image" src={game.imageData} alt={'Obrázková hádanka: '+game.title} />}
    {!personId && <p className="notice">Pro hraní nebo zobrazení svého výsledku nejdřív vyber jméno nahoře.</p>}
    {ended && <p className="notice">Hra skončila. Můžeš si prohlédnout řešení a výsledky, další pokusy už nejsou možné.</p>}
    {solved && <p className="notice" role="status">Správně vyřešeno! Tvoje odpovědi jsou uložené a uzamčené.</p>}
    {ended && game.progress && !solved && <p className="muted">Označené možnosti jsou z tvého posledního pokusu. Správné řešení je označené zvlášť.</p>}
    <form onSubmit={submit}>
      {game.questions.map((question,index)=><fieldset className="game-choices" disabled={readOnly || submitting} key={index}>
        <legend>{question.label}</legend>
        {question.options.map((option,position)=><label key={position} className={'game-choice '+(shown[index]===position?'selected ':'')+(game.solutions?.[index]===position?'correct':'')}>
          <input type="radio" name={'answer-'+game.id+'-'+index} required checked={shown[index]===position} onChange={()=>setAnswers(answers.map((old,place)=>place===index?position:old))} />
          <span>{option}{game.solutions?.[index]===position && <strong className="game-correct"> ✓ Správně</strong>}</span>
        </label>)}
      </fieldset>)}
      {!ended && !solved && personId && <button className="primary" disabled={submitting || answers.some((answer)=>answer<0)}>{submitting?'Ověřuji…':'Ověřit odpovědi'}</button>}
    </form>
    {game.revealText && <div className="game-point"><h4>Jak to bylo doopravdy</h4><p className="game-story">{game.revealText}</p></div>}
    <details className="game-results"><summary>Kdo tuto hru řešil</summary>
      {game.players.length===0?<p className="muted">Tuto hru zatím nikdo neřešil.</p>:<div className="history-table-wrap"><table className="history-table"><thead><tr><th>Jméno</th><th>Vyřešeno</th></tr></thead><tbody>{game.players.map((player,index)=><tr key={index}><td>{player.name}</td><td>{player.solved?'Ano':'Ne'}</td></tr>)}</tbody></table></div>}
    </details>
  </article>;
}

export default function GamesSection({year}) {
  const [personId,setPersonId]=useState(null);
  const [gameId,setGameId]=useState(null);
  const [view,setView]=useState(null);
  const [loading,setLoading]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState('');
  const sequence=useRef(0);
  const playing=useRef(false);
  const live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;sequence.current+=1;};},[]);
  const load=useCallback(async()=>{
    if(playing.current)return;
    const token=++sequence.current;setLoading(true);
    try{
      const data=await gamesApi('list',{year,participantId:personId,gameId});
      if(live.current && token===sequence.current){setView({data,personId,gameId});setError('');}
    }catch(failure){if(live.current && token===sequence.current)setError(failure.message);}
    finally{if(live.current && token===sequence.current)setLoading(false);}
  },[year,personId,gameId]);
  useEffect(()=>{
    load();
    const visible=()=>{if(document.visibilityState==='visible')load();};
    const timer=window.setInterval(visible,30000);
    window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);sequence.current+=1;};
  },[load]);
  const data=view?.data;
  useEffect(()=>{setFeedback('');},[data?.game?.id]);
  const ready=view && view.personId===personId && view.gameId===gameId;
  const game=ready?data.game:null;
  const selected=data?.names.find((person)=>person.id===personId);
  const attempt=async(answers,requestId)=>{
    if(!game || !personId)return false;
    const token=++sequence.current;playing.current=true;setSubmitting(true);setError('');setFeedback('');
    try{
      const result=await gamesApi('attempt',{year,gameId:game.id,participantId:personId,answers,requestId,expectedRevision:game.revision});
      if(live.current && token===sequence.current){
        setView({data:result,personId,gameId});
        setFeedback(result.game.progress?.solved?'Všechno správně! 🎄':'Ještě to není ono. Zkus odpovědi upravit.');
      }
      return true;
    }catch(failure){if(live.current)setError(failure.message);return false;}
    finally{playing.current=false;if(live.current){setSubmitting(false);setLoading(false);}}
  };
  return <section className="family-games" aria-labelledby="family-games-heading">
    <div className="section-toolbar"><div><p className="eyebrow">TROCHA RODINNÉHO PÁTRÁNÍ</p><h2 id="family-games-heading">Vánoční záhady · {year}</h2></div>
      <button className="secondary" type="button" disabled={submitting || loading} onClick={()=>{setFeedback('');load();}}>Obnovit hry</button></div>
    <p>Vyber své jméno a pusť se do hry. Jména neověřujeme — spoléháme na to, že každý hraje sám za sebe.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && loading && <p role="status">Načítám rodinné záhady…</p>}
    {data && <>
      {data.names.length===0?<p className="muted">Jména se tu objeví po losování tohoto ročníku.</p>:<div className="game-roster" aria-label="Vyber své jméno">{data.names.map((person)=><button className="game-person" type="button" key={person.id} aria-pressed={personId===person.id} disabled={submitting} onClick={()=>{setPersonId(person.id);setFeedback('');setError('');}}>
        <strong>{person.name}</strong><span>Vyřešené hry: {person.solvedGames}</span>
      </button>)}</div>}
      {selected && <p className="game-selected" role="status">Hraješ jako <strong>{selected.name}</strong>.</p>}
      {data.names.length>0 && <p className="muted">U každého jména vidíš počet vyřešených her za celý ročník.</p>}
      <label htmlFor={'game-archive-'+year}>Aktuální hra a archiv</label>
      <select id={'game-archive-'+year} disabled={submitting} value={gameId ?? ''} onChange={(event)=>{setGameId(event.target.value || null);setFeedback('');setError('');}}>
        <option value="">Aktuální hra</option>{data.games.filter((item)=>item.status==='archived').map((item)=><option key={item.id} value={item.id}>{item.title} · {formatGameDate(item.startsAt)} → {formatGameDate(item.endsAt)}</option>)}
      </select>
      {!ready?<p role="status">Načítám vybranou hru a výsledek…</p>:!game?<p className="empty-state">{data.nextStartsAt?'Další hra začne '+formatGameDate(data.nextStartsAt)+'.':'První záhada se tu objeví, až ji organizátor spustí.'}</p>:<>
        {feedback && <p className="notice" role="status">{feedback}</p>}
        <GamePlay key={game.id+':'+game.revision+':'+(personId ?? 'visitor')} game={game} personId={personId} submitting={submitting} onAttempt={attempt} />
      </>}
    </>}
  </section>;
}
