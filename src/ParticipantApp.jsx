import { useEffect, useRef, useState } from 'react';
import { STATEMENTS, TIMINGS, validateSubmission } from '../shared/questionnaire.js';
import { api, readSession, saveSession, Header, Footer } from './common.jsx';
import Illustration from './Illustration.jsx';

function NameBadge({ name, onSave, locked }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (editing && !locked) return <form className="name-edit" onSubmit={(event) => { event.preventDefault(); if (value.trim().length >= 2) { onSave(value.trim()); setEditing(false); } }}><label className="sr-only" htmlFor="edit-name">Upravit jméno</label><input id="edit-name" autoFocus required minLength={2} maxLength={60} value={value} onChange={(event) => setValue(event.target.value)} /><button className="small-button" type="submit">Uložit</button><button className="text-button" type="button" onClick={() => setEditing(false)}>Zrušit</button></form>;
  return <div className="name-badge"><span className="avatar" aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase('cs')}</span><span><small>V DÍLNĚ JAKO</small><strong>{name}</strong></span>{!locked && <button className="text-button" type="button" onClick={() => { setValue(name); setEditing(true); }}>Upravit <span aria-hidden="true">↗</span></button>}</div>;
}

export default function ParticipantApp() {
  const [draft] = useState(() => readSession('santa-draft'));
  const [receipt, setReceipt] = useState(() => {
    const saved = readSession('santa-receipt');
    return typeof saved?.name === 'string' && typeof saved?.elfTitle === 'string' ? saved : null;
  });
  const [name, setName] = useState(typeof draft?.name === 'string' ? draft.name : '');
  const [named, setNamed] = useState(draft?.named === true);
  const [statements, setStatements] = useState(Array.isArray(draft?.statements) ? draft.statements.filter((id) => STATEMENTS.some((item) => item.id === id)).slice(0, 3) : []);
  const [timing, setTiming] = useState(TIMINGS.some((item) => item.id === draft?.timing) ? draft.timing : '');
  const [phone, setPhone] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => draft?.idempotencyKey || crypto.randomUUID());
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectionNote, setSelectionNote] = useState('');
  const reviewRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => { if (!receipt) saveSession('santa-draft', { name, named, statements, timing, idempotencyKey }); }, [name, named, statements, timing, idempotencyKey, receipt]);
  useEffect(() => { if (reviewing) reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [reviewing]);
  useEffect(() => { if (receipt) resultRef.current?.focus(); }, [receipt]);

  const updateName = (value) => { setName(value); setReviewing(false); setConfirmed(false); };
  const selectStatement = (id) => {
    setSelectionNote('');
    if (statements.includes(id)) setStatements(statements.filter((selected) => selected !== id));
    else if (statements.length < 3) setStatements([...statements, id]);
    else setSelectionNote('Tři už máš. Pokud chceš jiný výrok, nejdřív jeden odškrtni.');
  };
  const prepareSubmission = (event) => {
    event.preventDefault(); setError('');
    try { validateSubmission({ name, phone, statements, timing, confirmed: true, idempotencyKey }); setReviewing(true); }
    catch (failure) { setError(failure.message); }
  };
  const submit = async (event) => {
    event.preventDefault();
    const website = new FormData(event.currentTarget).get('website');
    setBusy(true); setError('');
    try {
      const result = await api('submit', { name, phone, statements, timing, confirmed, idempotencyKey, website });
      saveSession('santa-receipt', result); saveSession('santa-draft', null);
      setReceipt(result); setPhone('');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  return <div className="site-shell"><Header>{(named || receipt) && <NameBadge name={receipt?.name || name} onSave={updateName} locked={Boolean(receipt) || busy} />}</Header>
    {receipt ? <main className="success-page" ref={resultRef} tabIndex={-1}>
      <div className="success-seal" aria-hidden="true">✧</div><p className="eyebrow">RAZÍTKO ZE SEVERNÍHO PÓLU</p>
      <h1>Jsi v tom, <em>{receipt.name}!</em></h1><p className="lead">Přihláška bezpečně přistála v Santově dílně.</p>
      <div className="elf-certificate"><span className="tiny-stars" aria-hidden="true">✦ &nbsp; ✧ &nbsp; ✦</span><p>ODE DNEŠKA NOSÍŠ ČESTNÝ ELFÍ TITUL</p><h2>{receipt.elfTitle}</h2><span className="certificate-rule" /><small>Uděleno za mimořádné zásluhy o vánoční atmosféru.</small></div>
      <div className="sms-note"><span aria-hidden="true">✉</span><p><strong>A koho letos potěšíš?</strong><br />To zůstává ještě chvilku tajemstvím. Po losování ti přijde SMS.</p></div>
      <p className="muted">Odeslání je definitivní. Potřebuješ něco opravit? Ozvi se organizátorovi.</p>
      <button className="text-button" onClick={() => { saveSession('santa-receipt', null); saveSession('santa-draft', null); setReceipt(null); setName(''); setNamed(false); setStatements([]); setTiming(''); setReviewing(false); setConfirmed(false); setIdempotencyKey(crypto.randomUUID()); }}>Vyplnit za dalšího člověka <span aria-hidden="true">→</span></button>
    </main> : <main>
      <section className="hero"><div className="hero-copy"><p className="eyebrow"><span /> TAJNÉ NADĚLOVÁNÍ, OPRAVDOVÁ RADOST</p><h1>Malé tajemství.<br />Velká <em>radost.</em></h1><p className="lead">Někdo chystá překvapení pro tebe.<br />A ty zase pro někoho dalšího.</p><p className="hero-caption">Pár odpovědí, trocha vánočního kouzla.<br />Zbytek nech na Santovi.</p></div><div className="hero-art"><Illustration /><span className="art-caption">PŠŠŠT. TADY SE CHYSTAJÍ PŘEKVAPENÍ.</span></div></section>
      {!named ? <section className="welcome-card"><div><p className="eyebrow">01 / PRVNÍ ZASTÁVKA</p><h2>Jak ti Santa říká?</h2><p>Ať víme, komu rezervovat místo na saních.</p></div><form onSubmit={(event) => { event.preventDefault(); if (name.trim().length >= 2) { setName(name.trim()); setNamed(true); } }}><label htmlFor="santa-name">Tvoje jméno nebo přezdívka</label><div className="input-with-button"><input id="santa-name" name="name" placeholder="Třeba David" autoComplete="name" required minLength={2} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /><button className="primary" type="submit">To jsem já <span aria-hidden="true">→</span></button></div><small>Ideálně tak, aby tě ostatní poznali.</small></form></section> : <>
        <div className="section-divider"><span aria-hidden="true">✧</span></div>
        {!reviewing ? <form className="questionnaire" onSubmit={prepareSubmission}>
          <fieldset><legend><span className="eyebrow">01 / TVOJE VÁNOČNÍ DNA</span><span className="question-heading">Bez čeho to nejsou Vánoce?</span></legend><div className="question-intro"><p>Vyber až 3 výroky, ve kterých se poznáváš. Správně je to po tvém.</p><span className="selection-count" aria-live="polite">{statements.length} / 3 vybráno</span></div>
            <div className="statements-grid">{STATEMENTS.map((statement) => <label className={`statement-card ${statements.includes(statement.id) ? 'selected' : ''}`} key={statement.id}><input type="checkbox" checked={statements.includes(statement.id)} onChange={() => selectStatement(statement.id)} /><span className="statement-icon" aria-hidden="true">{statement.icon}</span><span className="card-check" aria-hidden="true">{statements.includes(statement.id) ? '✓' : '+'}</span><strong>{statement.label}</strong><small>{statement.detail}</small></label>)}</div><p className="selection-note" role="status">{selectionNote || 'Malá nápověda: první vybraný výrok prozradí tvůj elfí talent.'}</p>
          </fieldset>
          <fieldset className="timing-section"><legend><span className="eyebrow">02 / RUKU NA SRDCE</span><span className="question-heading">Kdy lovíš dárky?</span></legend><p className="muted">Santa nesoudí. Jen si dělá poznámky.</p><div className="timings-grid">{TIMINGS.map((item) => <label className={`timing-card ${timing === item.id ? 'selected' : ''}`} key={item.id}><input type="radio" name="timing" value={item.id} checked={timing === item.id} onChange={() => setTiming(item.id)} /><span className="timing-icon" aria-hidden="true">{item.icon}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span><span className="radio-mark" aria-hidden="true" /></label>)}</div></fieldset>
          <section className="contact-section"><div><p className="eyebrow">03 / TAJNÁ ZPRÁVA NA CESTĚ</p><h2>Kam ti má Santa napsat?</h2><p>Po losování ti SMS prozradí, koho obdaruješ.<br />Telefon uvidí jen organizátor.</p></div><div><label htmlFor="phone">Tvoje telefonní číslo</label><input id="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+420 777 123 456" required maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /><small>České číslo můžeš zadat i bez předvolby.</small></div></section>
          {error && <p className="error" role="alert">{error}</p>}<div className="submit-row"><span><span aria-hidden="true">♧</span> Tvoje odpovědi zůstávají v dílně.</span><button className="primary" type="submit">Zkontrolovat přihlášku <span aria-hidden="true">→</span></button></div>
        </form> : <section className="review-card" ref={reviewRef}><p className="eyebrow">POSLEDNÍ POHLED PŘED ODLETEM</p><h2>Všechno sedí, {name}?</h2><p>Po odeslání už přihlášku na webu nezměníš.</p><dl><div><dt>Santa ti říká</dt><dd>{name}</dd></div><div><dt>SMS přijde na</dt><dd>{phone}</dd></div><div><dt>Tvoje vánoční DNA</dt><dd>{statements.map((id) => <span className="review-chip" key={id}>{STATEMENTS.find((item) => item.id === id).label}</span>)}</dd></div><div><dt>Dárky nakupuješ</dt><dd>{TIMINGS.find((item) => item.id === timing)?.label}</dd></div></dl>
          <form onSubmit={submit}><div className="honeypot" aria-hidden="true"><label htmlFor="website">Webová stránka</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div><label className="confirmation"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>Všechno sedí. Přihlašuji se do tajného nadělování a potvrzuji definitivní odeslání.</span></label>{error && <p className="error" role="alert">{error}</p>}<div className="review-actions"><button className="text-button" type="button" disabled={busy} onClick={() => { setReviewing(false); setConfirmed(false); setError(''); }}>← Ještě něco upravit</button><button className="primary" type="submit" disabled={!confirmed || busy}>{busy ? 'Posílám do dílny…' : 'Definitivně odeslat'} <span aria-hidden="true">✧</span></button></div></form>
        </section>}
      </>}
      <div className="how-it-works"><span><b>01</b> Představ se</span><span className="step-line" /><span><b>02</b> Ukaž své vánoční já</span><span className="step-line" /><span><b>03</b> Vyhlížej tajnou SMS</span></div>
    </main>}
    <Footer />
  </div>;
}
