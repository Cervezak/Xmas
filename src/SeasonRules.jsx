import { useState } from 'react';

export default function SeasonRules({ snapshot, busy, execute }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const manual = snapshot.draws.some((draw) => draw.source === 'manual');
  if (manual) return null;
  return <section className="admin-section season-rules" aria-labelledby="season-rules-heading">
    <div className="section-toolbar"><div><p className="eyebrow">SPOLEČNĚ PRO VŠECHNY SMS</p><h2 id="season-rules-heading">Pravidla nadělování · {snapshot.year}</h2></div>
      {!editing && <button className="secondary" type="button" disabled={busy} onClick={() => { setDraft(snapshot.rules ?? ''); setSaved(false); setEditing(true); }}>Upravit pravidla</button>}</div>
    <p className="muted">Potvrzený text se vloží do všech připravených SMS tohoto ročníku před rozloučení. Úprava pravidel nemění losování ani již odeslané zprávy.</p>
    {editing ? <form onSubmit={async (event) => {
      event.preventDefault();
      if (await execute('admin-rules', { rules: draft })) { setEditing(false); setSaved(true); }
    }}>
      <label htmlFor="season-rules-text">Text pravidel do SMS</label>
      <textarea id="season-rules-text" rows={5} maxLength={2000} disabled={busy} value={draft} aria-describedby="season-rules-help" onChange={(event) => setDraft(event.target.value)} />
      <p id="season-rules-help" className="muted">{draft.length} / 2 000 znaků. Prázdný text blok pravidel ze zpráv odstraní. Do potvrzení zůstávají SMS beze změny.</p>
      <div className="sms-actions"><button className="primary" disabled={busy}>{busy ? 'Ukládám…' : 'Potvrdit a vložit do SMS'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(false); setDraft(''); }}>Zrušit úpravy</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => execute('admin-list')}>Obnovit uložená data</button></div>
    </form> : <p className="rules-preview">{snapshot.rules || 'Pravidla zatím nejsou vyplněná. Do SMS se nepřidají.'}</p>}
    {saved && <p className="muted" role="status">Pravidla byla uložena a připravené SMS aktualizovány.</p>}
  </section>;
}
