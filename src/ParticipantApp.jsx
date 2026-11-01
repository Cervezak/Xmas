import { useEffect, useRef, useState } from 'react';
import { STATEMENTS, TIMINGS, validateSubmission } from '../shared/questionnaire.js';
import { api, Header, Footer } from './common.jsx';
import { readSeasonSession, saveSeasonSession } from '../shared/season-storage.js';
import Illustration from './Illustration.jsx';

function NameBadge({ name, onSave, locked }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (editing && !locked) return <form className="name-edit" onSubmit={(event) => { event.preventDefault(); if (value.trim().length >= 2) { onSave(value.trim()); setEditing(false); } }}><label className="sr-only" htmlFor="edit-name">Upravit jméno</label><input id="edit-name" autoFocus required minLength={2} maxLength={60} value={value} onChange={(event) => setValue(event.target.value)} /><button className="small-button" type="submit">Uložit</button><button className="text-button" type="button" onClick={() => setEditing(false)}>Zrušit</button></form>;
  return <div className="name-badge"><span className="avatar" aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase('cs')}</span><span><small>V DÍLNĚ JAKO</small><strong>{name}</strong></span>{!locked && <button className="text-button" type="button" onClick={() => { setValue(name); setEditing(true); }}>Upravit <span aria-hidden="true">↗</span></button>}</div>;
}

export default function ParticipantApp() {
  const [event, setEvent] = useState(null);
  const [eventError, setEventError] = useState('');
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const load = async () => {
      const requestId = ++sequence;
      try {
        const result = await api('event');
        if (!Number.isInteger(result.year) || typeof result.registrationOpen !== 'boolean') throw new Error('Nepodařilo se načíst ročník.');
        if (active && requestId === sequence) {
          setEvent((previous) => previous?.year === result.year && previous.registrationOpen === result.registrationOpen ? previous : result);
          setEventError('');
        }
      } catch (failure) { if (active && requestId === sequence) setEventError(failure.message); }
    };
    const refreshVisible = () => { if (document.visibilityState === 'visible') load(); };
    load();
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const timer = window.setInterval(refreshVisible, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refreshAttempt]);
  const refresh = () => setRefreshAttempt((attempt) => attempt + 1);
  if (!event) return <div className="site-shell"><Header /><main className="status-page" aria-live="polite"><h1>{eventError ? 'Dílna se ještě neozvala.' : 'Otevíráme Santovu dílnu…'}</h1>{eventError && <><p className="error" role="alert">{eventError}</p><button className="secondary" onClick={refresh}>Zkusit znovu</button></>}</main><Footer /></div>;
  return <SeasonParticipantApp key={event.year} event={event} eventError={eventError} onRefresh={refresh} />;
}

export function SeasonParticipantApp({ event, eventError, onRefresh }) {
  const year = event.year;
  const [draft] = useState(() => readSeasonSession('draft', year));
  const [receipt, setReceipt] = useState(() => {
    const saved = readSeasonSession('receipt', year);
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
  const nameInputRef = useRef(null);
  const questionnaireHeadingRef = useRef(null);
  const reviewRef = useRef(null);
  const resultRef = useRef(null);
  const previousStepRef = useRef({ named, reviewing });

  useEffect(() => { if (!receipt) saveSeasonSession('draft', year, { name, named, statements, timing, idempotencyKey }); }, [name, named, statements, timing, idempotencyKey, receipt, year]);
  useEffect(() => { if (reviewing) reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [reviewing]);
  useEffect(() => { if (receipt) resultRef.current?.focus(); }, [receipt]);
  useEffect(() => {
    const previousStep = previousStepRef.current;
    const target = previousStep.named && !named
      ? nameInputRef.current
      : named && !reviewing && (!previousStep.named || previousStep.reviewing)
        ? questionnaireHeadingRef.current
        : null;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    previousStepRef.current = { named, reviewing };
  }, [named, reviewing]);

  const updateName = (value) => { setName(value); setReviewing(false); setConfirmed(false); };
  const goBack = () => {
    setError('');
    setSelectionNote('');
    setConfirmed(false);
    if (reviewing) setReviewing(false);
    else setNamed(false);
  };
  const selectStatement = (id) => {
    setSelectionNote('');
    if (statements.includes(id)) setStatements(statements.filter((selected) => selected !== id));
    else if (statements.length < 3) setStatements([...statements, id]);
    else setSelectionNote('Tři už máš. Pokud chceš jiný výrok, nejdřív jeden odškrtni.');
  };
  const prepareSubmission = (event) => {
    event.preventDefault(); setError('');
    try { validateSubmission({ year, name, phone, statements, timing, confirmed: true, idempotencyKey }); setReviewing(true); }
    catch (failure) { setError(failure.message); }
  };
  const submit = async (event) => {
    event.preventDefault();
    const website = new FormData(event.currentTarget).get('website');
    setBusy(true); setError('');
    try {
      const result = await api('submit', { year, name, phone, statements, timing, confirmed, idempotencyKey, website });
      saveSeasonSession('receipt', year, result); saveSeasonSession('draft', year, null);
      setReceipt(result); setPhone('');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  return <div className="site-shell"><Header year={year}>{(named || receipt) && <NameBadge name={receipt?.name || name} onSave={updateName} locked={Boolean(receipt) || busy || !event.registrationOpen} />}</Header>
    {eventError && <p className="notice" role="status">Aktuální stav ročníku se nepodařilo ověřit. {eventError}</p>}
    {receipt ? <main className="success-page" ref={resultRef} tabIndex={-1}>
      <div className="success-seal" aria-hidden="true">✧</div><p className="eyebrow">RAZÍTKO ZE SEVERNÍHO PÓLU</p>
      <h1>Jsi v tom, <em>{receipt.name}!</em></h1><p className="lead">Přihláška pro Vánoce {year} bezpečně přistála v Santově dílně.</p>
      <div className="elf-certificate"><span className="tiny-stars" aria-hidden="true">✦ &nbsp; ✧ &nbsp; ✦</span><p>ODE DNEŠKA NOSÍŠ ČESTNÝ ELFÍ TITUL</p><h2>{receipt.elfTitle}</h2><span className="certificate-rule" /><small>Uděleno za mimořádné zásluhy o vánoční atmosféru.</small></div>
      <div className="sms-note"><span aria-hidden="true">✉</span><p><strong>A koho letos potěšíš?</strong><br />To zůstává ještě chvilku tajemstvím. Po losování ti přijde SMS.</p></div>
      <p className="muted">Odeslání je definitivní. Potřebuješ něco opravit? Ozvi se organizátorovi.</p>
      <button className="text-button" onClick={() => { saveSeasonSession('receipt', year, null); saveSeasonSession('draft', year, null); setReceipt(null); setName(''); setNamed(false); setStatements([]); setTiming(''); setReviewing(false); setConfirmed(false); setIdempotencyKey(crypto.randomUUID()); }}>Vyplnit za dalšího člověka <span aria-hidden="true">→</span></button>
    </main> : !event.registrationOpen ? <main className="status-page"><p className="eyebrow">VÁNOCE {year}</p><h1>Santa už rozdal úkoly.</h1><p className="lead">Přihlášky pro tento ročník jsou uzavřené. Pokud už jsi přihlášený/á, informace přijde od organizátora.</p><button className="secondary" onClick={onRefresh}>Znovu načíst stav</button></main> : <main>
      <section className="hero"><div className="hero-copy"><p className="eyebrow"><span /> TAJNÉ NADĚLOVÁNÍ, OPRAVDOVÁ RADOST</p><h1>Malé tajemství.<br />Velká <em>radost.</em></h1><p className="lead">Někdo chystá překvapení pro tebe.<br />A ty zase pro někoho dalšího.</p><p className="hero-caption">Pár odpovědí, trocha vánočního kouzla.<br />Zbytek nech na Santovi.</p></div><div className="hero-art"><Illustration /><span className="art-caption">PŠŠŠT. TADY SE CHYSTAJÍ PŘEKVAPENÍ.</span></div></section>
      {!named ? <section className="welcome-card"><div><p className="eyebrow">01 / PRVNÍ ZASTÁVKA</p><h2>Jak ti Santa říká?</h2><p>Ať víme, komu rezervovat místo na saních.</p></div><form onSubmit={(event) => { event.preventDefault(); if (name.trim().length >= 2) { setName(name.trim()); setNamed(true); } }}><label htmlFor="santa-name">Tvoje jméno nebo přezdívka</label><div className="input-with-button"><input ref={nameInputRef} id="santa-name" name="name" placeholder="Třeba David" autoComplete="name" required minLength={2} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /><button className="primary" type="submit">To jsem já <span aria-hidden="true">→</span></button></div><small>Ideálně tak, aby tě ostatní poznali.</small></form></section> : <>
        <div className="section-divider"><span aria-hidden="true">✧</span></div>
        <nav className="form-navigation" aria-label="Navigace dotazníkem"><button className="secondary" type="button" disabled={busy} onClick={goBack}><span aria-hidden="true">←</span>{reviewing ? 'Zpět k dotazníku' : 'Zpět ke jménu'}</button></nav>
        {!reviewing ? <form className="questionnaire" onSubmit={prepareSubmission}>
          <fieldset><legend><span className="eyebrow">01 / TVOJE VÁNOČNÍ DNA</span><span className="question-heading" ref={questionnaireHeadingRef} tabIndex={-1}>Bez čeho to nejsou Vánoce?</span></legend><div className="question-intro"><p>Vyber až 3 výroky, ve kterých se poznáváš. Správně je to po tvém.</p><span className="selection-count" aria-live="polite">{statements.length} / 3 vybráno</span></div>
            <div className="statements-grid">{STATEMENTS.map((statement) => <label className={`statement-card ${statements.includes(statement.id) ? 'selected' : ''}`} key={statement.id}><input type="checkbox" checked={statements.includes(statement.id)} onChange={() => selectStatement(statement.id)} /><span className="statement-icon" aria-hidden="true">{statement.icon}</span><span className="card-check" aria-hidden="true">{statements.includes(statement.id) ? '✓' : '+'}</span><strong>{statement.label}</strong><small>{statement.detail}</small></label>)}</div><p className="selection-note" role="status">{selectionNote || 'Malá nápověda: první vybraný výrok prozradí tvůj elfí talent.'}</p>
          </fieldset>
          <fieldset className="timing-section"><legend><span className="eyebrow">02 / RUKU NA SRDCE</span><span className="question-heading">Kdy lovíš dárky?</span></legend><p className="muted">Santa nesoudí. Jen si dělá poznámky.</p><div className="timings-grid">{TIMINGS.map((item) => <label className={`timing-card ${timing === item.id ? 'selected' : ''}`} key={item.id}><input type="radio" name="timing" value={item.id} checked={timing === item.id} onChange={() => setTiming(item.id)} /><span className="timing-icon" aria-hidden="true">{item.icon}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span><span className="radio-mark" aria-hidden="true" /></label>)}</div></fieldset>
          <section className="contact-section"><div><p className="eyebrow">03 / TAJNÁ ZPRÁVA NA CESTĚ</p><h2>Kam ti má Santa napsat?</h2><p>Po losování ti SMS prozradí, koho obdaruješ.<br />Telefon uvidí jen organizátor.</p></div><div><label htmlFor="phone">Tvoje telefonní číslo</label><input id="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+420 777 123 456" required maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /><small>České číslo můžeš zadat i bez předvolby.</small></div></section>
          {error && <p className="error" role="alert">{error}</p>}<div className="submit-row"><span><span aria-hidden="true">♧</span> Tvoje odpovědi zůstávají v dílně.</span><button className="primary" type="submit">Zkontrolovat přihlášku <span aria-hidden="true">→</span></button></div>
        </form> : <section className="review-card" ref={reviewRef}><p className="eyebrow">POSLEDNÍ POHLED PŘED ODLETEM</p><h2>Všechno sedí, {name}?</h2><p>Po odeslání už přihlášku na webu nezměníš.</p><dl><div><dt>Santa ti říká</dt><dd>{name}</dd></div><div><dt>SMS přijde na</dt><dd>{phone}</dd></div><div><dt>Tvoje vánoční DNA</dt><dd><ul className="review-answers" role="list">{statements.map((id) => {
            const statement = STATEMENTS.find((item) => item.id === id);
            return <li key={id}><span className="review-answer-icon" aria-hidden="true">{statement.icon}</span><span>{statement.label}</span></li>;
          })}</ul></dd></div><div><dt>Dárky nakupuješ</dt><dd>{TIMINGS.find((item) => item.id === timing)?.label}</dd></div></dl>
          <form onSubmit={submit}><div className="honeypot" aria-hidden="true"><label htmlFor="website">Webová stránka</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div><label className="confirmation"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>Všechno sedí. Přihlašuji se do tajného nadělování a potvrzuji definitivní odeslání.</span></label>{error && <p className="error" role="alert">{error}</p>}<div className="review-actions"><button className="text-button" type="button" disabled={busy} onClick={goBack}>← Ještě něco upravit</button><button className="primary" type="submit" disabled={!confirmed || busy}>{busy ? 'Posílám do dílny…' : 'Definitivně odeslat'} <span aria-hidden="true">✧</span></button></div></form>
        </section>}
      </>}
      <div className="how-it-works"><span><b>01</b> Představ se</span><span className="step-line" /><span><b>02</b> Ukaž své vánoční já</span><span className="step-line" /><span><b>03</b> Vyhlížej tajnou SMS</span></div>
    </main>}
    <Footer />
  </div>;
}
