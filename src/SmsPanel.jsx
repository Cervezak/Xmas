import { useEffect, useState } from 'react';

export default function SmsPanel({ snapshot, busy, active, execute, onError, onDraw }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(null);
  useEffect(() => { if (!active) setRevealed(false); }, [active]);
  const currentDraw = snapshot.draws.find((draw) => draw.version === snapshot.currentVersion);
  const copy = async (message) => {
    try { await navigator.clipboard.writeText(message.text); setCopied({ giverId: message.giverId, text: message.text }); }
    catch { onError('Kopírování prohlížeč nepovolil. Označ a zkopíruj text SMS ručně.'); }
  };
  return <section className="admin-section sms-section" aria-labelledby="sms-heading">
    <div className="section-toolbar"><div><p className="eyebrow">ZPRÁVY K RUČNÍMU ODESLÁNÍ</p><h2 id="sms-heading">SMS · {snapshot.year}{snapshot.currentVersion ? ', verze ' + snapshot.currentVersion : ''}</h2></div>
      <button type="button" className="secondary" disabled={busy} onClick={onDraw}>{currentDraw?.smsLockedAt ? 'Zobrazit losování' : 'Přejít k losování a uzamčení'}</button></div>
    {!currentDraw ? <p className="empty-state">SMS budou připravené po prvním losování na záložce Losování.</p>
      : currentDraw.source === 'manual' ? <p className="notice">Ručně vložená historie slouží pouze k prohlížení. SMS se k ní nevytvářejí.</p>
      : snapshot.selectedVersion !== snapshot.currentVersion ? <div className="notice"><p>SMS se připravují pouze pro aktuální verzi losování.</p><button type="button" className="secondary" disabled={busy} onClick={() => execute('admin-list')}>{busy ? 'Načítám aktuální SMS…' : 'Načíst aktuální SMS'}</button></div>
      : <>
        <p className="muted">{currentDraw.smsLockedAt ? 'Výsledek je definitivně uzamčený pro rozeslání.' : 'Před rozesláním definitivně uzamkni výsledek na záložce Losování.'} Kopírování ani otevření SMS neeviduje doručení; zprávu odešleš ručně. Delší text s diakritikou se může rozdělit do více SMS.</p>
        {snapshot.messages.length > 0 ? <><button className="secondary" type="button" disabled={busy} onClick={() => setRevealed(!revealed)}>{revealed ? 'Skrýt SMS' : 'Zobrazit SMS'}</button>
          {revealed && <div className="sms-grid">{snapshot.messages.map((message) => <article className="sms-card" key={message.giverId}>
            <p className="eyebrow">PRO: {snapshot.assignments.find((entry) => entry.giver_id === message.giverId)?.giverName}</p>
            <strong>{message.phone}</strong><p className="sms-body">{message.text}</p>
            <div className="sms-actions"><button className="secondary" disabled={busy} onClick={() => copy(message)}>{copied?.giverId === message.giverId && copied.text === message.text ? 'Zkopírováno ✓' : 'Kopírovat text'}</button><a className="text-button" href={'sms:' + message.phone + '?body=' + encodeURIComponent(message.text)}>Otevřít SMS ↗</a></div>
          </article>)}</div>}
        </> : <p className="empty-state">Pro tento výsledek nejsou dostupné SMS s telefonními čísly.</p>}
      </>}
  </section>;
}
