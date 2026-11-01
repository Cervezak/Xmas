import { useState } from 'react';

export default function DrawPanel({ snapshot, busy, execute, onError }) {
  const [reviewed, setReviewed] = useState(false);
  const [confirmUnsent, setConfirmUnsent] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [lockConfirmation, setLockConfirmation] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState('');
  const selected = snapshot.draws.find((draw) => draw.version === snapshot.selectedVersion);
  const isCurrent = snapshot.selectedVersion === snapshot.currentVersion;
  const locked = snapshot.draws.some((draw) => draw.smsLockedAt);
  const manual = snapshot.draws.some((draw) => draw.source === 'manual');
  const unmapped = snapshot.participants.some((participant) => !participant.personId);
  const historyMissing = snapshot.previousDraw && snapshot.previousDraw.pairs.length < 3;
  const historyUnmapped = snapshot.previousDraw?.pairs.some((pair) => !pair.giverPersonId || !pair.receiverPersonId);
  const reroll = Boolean(snapshot.currentVersion);
  const expectedText = reroll ? 'PRELOSOVAT' : 'LOSOVAT';
  const repeats = snapshot.assignments.filter((entry) => entry.giverPersonId && entry.receiverPersonId && snapshot.previousDraw?.pairs.some((pair) => pair.giverPersonId === entry.giverPersonId && pair.receiverPersonId === entry.receiverPersonId)).length;
  const generate = async (event) => {
    event.preventDefault();
    if (await execute('admin-draw', { expectedVersion: snapshot.currentVersion ?? 0, confirmation, confirmUnsent,
      participantIds: snapshot.participants.map((participant) => participant.id) })) {
      setReviewed(false); setConfirmUnsent(false); setConfirmation(''); setRevealed(false);
    }
  };
  const copy = async (message) => {
    try { await navigator.clipboard.writeText(message.text); setCopied(message.giverId); }
    catch { onError('Kopírování prohlížeč nepovolil. Označ a zkopíruj text SMS ručně.'); }
  };
  return <>
    {snapshot.draws.length > 0 && <section className="admin-section draw-history"><div className="section-toolbar"><div><p className="eyebrow">HISTORIE LOSOVÁNÍ</p><h2>Vánoce {snapshot.year} · verze {snapshot.selectedVersion}</h2></div><div><label htmlFor="draw-version">Prohlížet verzi</label><select id="draw-version" disabled={busy} value={snapshot.selectedVersion} onChange={(event) => execute('admin-list', { version: Number(event.target.value) })}>{snapshot.draws.map((draw) => <option key={draw.version} value={draw.version}>Verze {draw.version}{draw.version === snapshot.currentVersion ? ' — aktuální' : ' — archiv'}{draw.source === 'manual' ? ' · ruční historie' : draw.source === 'legacy' ? ' · původní los' : ''}</option>)}</select></div></div>
      <p className="muted">{selected?.source === 'manual' ? 'Ručně vložená historie. Původní párování je zachované přesně, včetně případných vzájemných dvojic.' : selected?.source === 'legacy' ? 'Původní výsledek zachovaný při přechodu na ročníky a verze. Nová pravidla jej zpětně nemění.' : 'Vygenerovaný kruh bez sebe-přiřazení, vzájemných dvojic a loňských přiřazení.'} {selected?.drawnAt ? 'Losováno: ' + new Date(selected.drawnAt).toLocaleString('cs-CZ') + '.' : 'Datum původního losování není známé.'}</p>
      {!isCurrent && <p className="notice">Prohlížíš starší verzi. SMS jsou dostupné jen pro aktuální výsledek.</p>}
      {repeats > 0 && <p className="notice">Tato verze obsahuje {repeats} přiřazení shodných s rokem {snapshot.previousDraw.year}. Původní výsledek se automaticky nepřepisuje; nové losování tato přiřazení zakáže.</p>}
      <button className="secondary" type="button" onClick={() => setRevealed(!revealed)}>{revealed ? 'Skrýt tajné výsledky' : 'Zobrazit tajné výsledky'}</button>
      {revealed && <><div className="history-table-wrap"><table className="history-table"><thead><tr><th scope="col">Kdo dává</th><th scope="col">Komu dává</th></tr></thead><tbody>{snapshot.assignments.map((entry, index) => <tr key={entry.giver_id || entry.giverPersonId || index}><td>{entry.giverName}</td><td>{entry.receiverName}</td></tr>)}</tbody></table></div>
        {snapshot.messages.length > 0 && <><h3 className="sms-heading">SMS k ručnímu odeslání · {snapshot.year}, verze {snapshot.currentVersion}</h3><p className="muted">Před rozesláním definitivně uzamkni aktuální výsledek níže. Kopírování ani otevření SMS neeviduje doručení; zprávu odešleš ručně. Delší text s diakritikou se může rozdělit do více SMS.</p><div className="sms-grid">{snapshot.messages.map((message) => <article className="sms-card" key={message.giverId}><p className="eyebrow">PRO: {snapshot.assignments.find((entry) => entry.giver_id === message.giverId)?.giverName}</p><strong>{message.phone}</strong><p className="sms-body">{message.text}</p><div className="sms-actions"><button className="secondary" onClick={() => copy(message)}>{copied === message.giverId ? 'Zkopírováno ✓' : 'Kopírovat text'}</button><a className="text-button" href={'sms:' + message.phone + '?body=' + encodeURIComponent(message.text)}>Otevřít SMS ↗</a></div></article>)}</div></>}
      </>}
      {isCurrent && !manual && (locked ? <p className="notice">Výsledek byl definitivně uzamčen pro rozeslání SMS. Další přelosování není možné.</p> : <form className="lock-draw" onSubmit={(event) => { event.preventDefault(); execute('admin-lock', { version: snapshot.currentVersion, confirmation: lockConfirmation }); }}><h3>Definitivně potvrdit výsledek</h3><p>Uzamčení zablokuje další přelosování. Použij ho před rozesláním SMS, případně hned po něm.</p><label htmlFor="lock-confirm">Pro potvrzení napiš UZAMKNOUT</label><div className="season-input-row"><input id="lock-confirm" autoComplete="off" disabled={busy} value={lockConfirmation} onChange={(event) => setLockConfirmation(event.target.value)} /><button className="secondary" disabled={busy || lockConfirmation !== 'UZAMKNOUT'}>Uzamknout výsledek</button></div></form>)}
    </section>}
    {!manual && isCurrent && !locked && !snapshot.historyReferenced && <section className="draw-panel"><p className="eyebrow">{reroll ? 'NOVÁ VERZE LOSOVÁNÍ' : 'AŽ BUDOU VŠICHNI NA PALUBĚ'}</p><h2>{reroll ? 'Přelosovat se zachováním historie' : 'Spustit tajné losování'}</h2><p>Každý jednou dává a jednou dostává. Vznikne jeden náhodný kruh přes alespoň 3 účastníky, bez sebe-přiřazení a vzájemných dvojic.</p><p>{snapshot.previousDraw ? 'Zakázaná jsou také přiřazení dárce → obdarovaný z roku ' + snapshot.previousDraw.year + ', aktuální verze ' + snapshot.previousDraw.version + '.' : 'Pro předchozí kalendářní rok není uložený los; historická omezení se nepoužijí.'}</p>
      {unmapped && <p className="notice">Nejdřív potvrď totožnost všech účastníků v seznamu výše.</p>}{historyMissing && <p className="notice">Historie {snapshot.previousDraw.year} zatím není načtená. Nejdřív spusť připravený soukromý SQL import historie.</p>}{historyUnmapped && <p className="notice">V historii {snapshot.previousDraw.year} chybí potvrzené totožnosti. Přepni se na tento rok a doplň je; jinak nelze spolehlivě zakázat loňské dvojice.</p>}
      <p><strong>{reroll ? 'Nová verze nahradí aktuální SMS texty. Starší verze zůstane v archivu a přihlášky zůstanou uzavřené.' : 'První losování uzavře přihlášky a úpravy seznamu pro tento rok.'}</strong></p><form onSubmit={generate}><label className="confirmation"><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} required /><span>Zkontroloval/a jsem účastníky, totožnosti i možné duplicity.</span></label>{reroll && <label className="confirmation"><input type="checkbox" checked={confirmUnsent} disabled={busy} onChange={(event) => setConfirmUnsent(event.target.checked)} required /><span>Potvrzuji, že SMS s dosavadním výsledkem ještě nebyly odeslány. Pokud už odešly, nepřelosovávat.</span></label>}<label htmlFor="draw-confirm">Pro potvrzení napiš {expectedText}</label><div className="draw-input-row"><input id="draw-confirm" value={confirmation} disabled={busy} autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} /><button className="primary" disabled={busy || snapshot.participants.length < 3 || unmapped || historyMissing || historyUnmapped || !reviewed || reroll && !confirmUnsent || confirmation !== expectedText}>{busy ? 'Losuji…' : reroll ? 'Vytvořit verzi ' + (snapshot.currentVersion + 1) : 'Losovat verzi 1'} <span aria-hidden="true">✧</span></button></div></form>
    </section>}
    {snapshot.historyReferenced && !manual && <p className="notice">Na tento ročník už navazuje losování dalšího roku. Výsledky a propojení s osobami jsou uzamčené.</p>}
  </>;
}
