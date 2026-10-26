import { useState } from 'react';
import { STATEMENTS, TIMINGS, normalizeName } from '../shared/questionnaire.js';
import { api, Header, Footer } from './common.jsx';

export default function AdminApp() {
  const [password, setPassword] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const [drawConfirmation, setDrawConfirmation] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState('');
  const execute = async (action, data = {}) => {
    setBusy(true); setError('');
    try { setSnapshot(await api(action, data, password)); setDeleteId(null); setReviewed(false); setDrawConfirmation(''); }
    catch (failure) { setError(failure.message); if (failure.status === 401) { setSnapshot(null); setPassword(''); } }
    finally { setBusy(false); }
  };
  const participants = snapshot?.participants || [];
  const duplicateIds = new Set(participants.filter((participant) => participants.some((other) => other.id !== participant.id && (other.nameKey === participant.nameKey || other.phone === participant.phone))).map((participant) => participant.id));
  const filtered = participants.filter((participant) => normalizeName(`${participant.name} ${participant.phone}`).includes(normalizeName(filter)));
  const copy = async (message) => {
    try { await navigator.clipboard.writeText(message.text); setCopied(message.giverId); }
    catch { setError('Kopírování prohlížeč nepovolil. Označ a zkopíruj text SMS ručně.'); }
  };

  return <div className="site-shell admin-shell"><Header><span className="season">POUZE PRO ORGANIZÁTORA</span></Header><main className="admin-main">
    {!snapshot ? <section className="admin-login"><p className="eyebrow">ZA DVEŘMI SANTOVY DÍLNY</p><h1>Vstup pro <em>vrchního elfa.</em></h1><p>Účastníci, losování a tajné zprávy na jednom místě.</p><form onSubmit={(event) => { event.preventDefault(); execute('admin-list'); }}><label htmlFor="admin-password">Heslo do dílny</label><input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Otevírám…' : 'Odemknout dílnu'} <span aria-hidden="true">→</span></button></form></section> : <>
      <div className="admin-title"><div><p className="eyebrow">VELÍN TAJNÉHO NADĚLOVÁNÍ</p><h1>Ahoj, vrchní elfe.</h1></div><button className="secondary" disabled={busy} onClick={() => { setSnapshot(null); setPassword(''); setRevealed(false); setError(''); }}>Odhlásit</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="admin-stats"><div><strong>{participants.length}</strong><span>účastníků v dílně</span></div><div><strong>{duplicateIds.size}</strong><span>přihlášek k prověření</span></div><div><strong className="state-word">{snapshot.drawnAt ? 'Vylosováno' : 'Otevřeno'}</strong><span>{snapshot.drawnAt ? new Date(snapshot.drawnAt).toLocaleString('cs-CZ') : 'přihlášky stále přicházejí'}</span></div></div>
      <section className="admin-section"><div className="section-toolbar"><h2>Seznam účastníků</h2><button className="secondary" disabled={busy} onClick={() => execute('admin-list')}>Obnovit seznam ↻</button></div>{duplicateIds.size > 0 && <p className="notice">Označené přihlášky mají stejné jméno nebo telefon. Zkontroluj je a případné duplicity odeber před losováním. Sdílené číslo může být v pořádku.</p>}
        <label htmlFor="participant-filter" className="sr-only">Hledat účastníka</label><input className="filter-input" id="participant-filter" type="search" placeholder="Hledat podle jména nebo telefonu…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <div className="participant-list">{filtered.map((participant) => <article className="participant-row" key={participant.id}><div className="participant-info"><div className="participant-name"><strong>{participant.name}</strong>{duplicateIds.has(participant.id) && <span className="duplicate-tag">Prověřit duplicitu</span>}</div><p>{participant.phone} <span aria-hidden="true">·</span> {new Date(participant.createdAt).toLocaleString('cs-CZ')}</p><div className="answer-chips">{participant.statements.map((id) => <span key={id}>{STATEMENTS.find((item) => item.id === id)?.label || id}</span>)}<span>{TIMINGS.find((item) => item.id === participant.timing)?.label}</span></div><small className="muted">{participant.elfTitle}</small></div>{!snapshot.drawnAt && <div className="delete-controls">{deleteId === participant.id ? <><span>Opravdu odebrat?</span><button className="danger" disabled={busy} onClick={() => execute('admin-delete', { id: participant.id })}>Potvrdit odebrání</button><button className="text-button" disabled={busy} onClick={() => setDeleteId(null)}>Zrušit</button></> : <button className="text-button danger-text" disabled={busy} onClick={() => setDeleteId(participant.id)}>Odebrat</button>}</div>}</article>)}</div>{!filtered.length && <p className="empty-state">{participants.length ? 'Tomuhle hledání neodpovídá žádný elf.' : 'Zatím tu není žádný účastník. První saně teprve přijedou.'}</p>}
      </section>
      {!snapshot.drawnAt ? <section className="draw-panel"><p className="eyebrow">AŽ BUDOU VŠICHNI NA PALUBĚ</p><h2>Jedno losování. Spousta překvapení.</h2><p>Každý obdaruje jednoho a od jednoho dostane dárek. Vznikne jeden náhodný kruh bez sebe-přiřazení a vzájemných dvojic. Potřebuješ alespoň 3 účastníky.</p><p><strong>Losování uzavře přihlášky i úpravy seznamu. Výsledek už nelze přelosovat.</strong></p><form onSubmit={(event) => { event.preventDefault(); execute('admin-draw', { confirmation: drawConfirmation, participantIds: participants.map((participant) => participant.id) }); }}><label className="confirmation"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} required /><span>Zkontroloval/a jsem účastníky i možné duplicity. Všichni jsou přihlášení.</span></label><label htmlFor="draw-confirm">Pro potvrzení napiš LOSOVAT</label><div className="draw-input-row"><input id="draw-confirm" value={drawConfirmation} onChange={(event) => setDrawConfirmation(event.target.value)} autoComplete="off" /><button className="primary" disabled={busy || participants.length < 3 || !reviewed || drawConfirmation !== 'LOSOVAT'}>{busy ? 'Losuji…' : 'Spustit tajné losování'} <span aria-hidden="true">✧</span></button></div></form></section> : <section className="admin-section sms-section"><div className="section-toolbar"><div><p className="eyebrow">PŘEKVAPENÍ JE PŘIPRAVENÉ</p><h2>SMS k ručnímu odeslání</h2></div><button className="secondary" onClick={() => setRevealed(!revealed)}>{revealed ? 'Skrýt tajné zprávy' : 'Zobrazit tajné zprávy'}</button></div><p className="muted">Každý text je určený jednomu účastníkovi. Zkopíruj jej do zprávy, nebo otevři SMS na telefonu. Odeslání potvrdíš sám/sama. Delší text s diakritikou se může rozdělit do více SMS.</p>{revealed && <div className="sms-grid">{snapshot.messages.map((message) => <article className="sms-card" key={message.giverId}><p className="eyebrow">PRO: {participants.find((participant) => participant.id === message.giverId)?.name}</p><strong>{message.phone}</strong><p className="sms-body">{message.text}</p><div className="sms-actions"><button className="secondary" onClick={() => copy(message)}>{copied === message.giverId ? 'Zkopírováno ✓' : 'Kopírovat text'}</button><a className="text-button" href={`sms:${message.phone}?body=${encodeURIComponent(message.text)}`}>Otevřít SMS ↗</a></div></article>)}</div>}</section>}
    </>}
  </main><Footer /></div>;
}
