import {useRef,useState} from 'react';
import {STATEMENTS,TIMINGS} from '../shared/questionnaire.js';
import {gamesApi} from '../shared/games.js';

export default function GuestQuestionnaire({year,person,profile,gameId,disabled,onBusy,onComplete}) {
  const [open,setOpen]=useState(false);
  const [statements,setStatements]=useState([]);
  const [timing,setTiming]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [error,setError]=useState('');
  const request=useRef(null);
  if(profile?.completed)return <section className="guest-questionnaire"><p className="eyebrow">ČESTNÝ ELFÍ TITUL</p><h3>{person.name}</h3><p className="guest-title">{profile.elfTitle}</p><p className="muted">Dobrovolný dotazník je uložený.</p></section>;
  const submit=async(event)=>{
    event.preventDefault();setError('');
    if(!request.current)request.current=crypto.randomUUID();
    onBusy(true);
    try{
      const result=await gamesApi('guest-profile',{year,participantId:person.id,gameId,statements,timing,confirmed,requestId:request.current});
      onComplete(result);
    }catch(failure){setError(failure.message);}
    finally{onBusy(false);}
  };
  return <section className="guest-questionnaire">
    <h3>Elfí titul i pro tebe, {person.name}</h3>
    <p>Dobrovolně vyplň vánoční dotazník a získej svůj titul. Telefon nepotřebuješ; do losování dárků se tím nepřihlašuješ.</p>
    {!open?<button className="secondary" type="button" disabled={disabled} onClick={()=>setOpen(true)}>Vyplnit dobrovolný dotazník</button>:<form onSubmit={submit}>
      <fieldset disabled={disabled}><legend>Bez čeho to nejsou Vánoce?</legend><p className="muted">Vyber 1 až 3 výroky. Vybráno: {statements.length} / 3.</p>
        <div className="guest-profile-options">{STATEMENTS.map((choice)=><label className="game-choice" key={choice.id}>
          <input type="checkbox" value={choice.id} disabled={!statements.includes(choice.id) && statements.length>=3} checked={statements.includes(choice.id)} onChange={()=>setStatements((old)=>old.includes(choice.id)?old.filter((id)=>id!==choice.id):[...old,choice.id])} />
          <span><span aria-hidden="true">{choice.icon} </span><strong>{choice.label}</strong><small>{choice.detail}</small></span>
        </label>)}</div>
      </fieldset>
      <fieldset disabled={disabled}><legend>Kdy lovíš dárky?</legend>{TIMINGS.map((choice)=><label className="game-choice" key={choice.id}>
        <input type="radio" name="guest-timing" required value={choice.id} checked={timing===choice.id} onChange={()=>setTiming(choice.id)} /><span><strong>{choice.label}</strong><small>{choice.detail}</small></span>
      </label>)}</fieldset>
      <label className="confirmation"><input type="checkbox" required disabled={disabled} checked={confirmed} onChange={(event)=>setConfirmed(event.target.checked)} /><span>Odpovědi sedí. Potvrzuji odeslání; potom už je nezměním.</span></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="games-buttons"><button className="primary" disabled={disabled || statements.length===0 || !timing || !confirmed}>{disabled?'Ukládám…':'Odeslat a získat elfí titul'}</button><button className="secondary" type="button" disabled={disabled} onClick={()=>setOpen(false)}>Zatím nevyplňovat</button></div>
    </form>}
  </section>;
}
