import { useState } from 'react';
import { STATEMENTS, TIMINGS, normalizeName } from '../shared/questionnaire.js';

function IdentityControl({ participant, snapshot, busy, execute }) {
  const [selection, setSelection] = useState(participant.personId || '');
  const candidates = snapshot.people.filter((person) => person.nameKey === participant.nameKey);
  const linked = snapshot.people.find((person) => person.id === participant.personId);
  if (!snapshot.identityEditable) return <p className="identity-summary">Osoba v historii: <strong>{linked?.name || 'Nepotvrzeno'}</strong></p>;
  return <form className="identity-control" onSubmit={(event) => { event.preventDefault(); execute('admin-person', { id: participant.id, personId: selection }); }}><label htmlFor={'person-' + participant.id}>Propojení s osobou napříč roky</label><div className="season-input-row"><select id={'person-' + participant.id} value={selection} disabled={busy} onChange={(event) => setSelection(event.target.value)}><option value="">Nepotvrzeno</option>{snapshot.people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.id.slice(0, 6)}</option>)}<option value="new">Nová osoba — dosud není v historii</option></select><button className="secondary" disabled={busy || selection === (participant.personId || '')}>Potvrdit totožnost</button></div>{!participant.personId && candidates.length === 1 && <small className="identity-hint">Shodné jméno v historii: {candidates[0].name}. Totožnost prosím vyber a potvrď; jméno samo o sobě ji neověřuje.</small>}</form>;
}

export default function ParticipantList({ snapshot, busy, execute }) {
  const [filter, setFilter] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const participants = snapshot.participants;
  const duplicateIds = new Set(participants.filter((participant) => participants.some((other) => other.id !== participant.id && (other.nameKey === participant.nameKey || other.phone === participant.phone))).map((participant) => participant.id));
  const filtered = participants.filter((participant) => normalizeName(participant.name + ' ' + participant.phone).includes(normalizeName(filter)));
  return <section className="admin-section"><div className="section-toolbar"><h2>Účastníci {snapshot.year}</h2><button className="secondary" disabled={busy} onClick={() => execute('admin-list')}>Obnovit seznam ↻</button></div>
    {duplicateIds.size > 0 && <p className="notice">Označené přihlášky mají stejné jméno nebo telefon. Případné duplicity odeber před losováním. Sdílené číslo může být v pořádku.</p>}
    {snapshot.identityEditable && participants.some((participant) => !participant.personId) && <p className="notice">Před novým losováním potvrď u každé přihlášky, ke které osobě z historie patří. Pokud se člověk účastní poprvé, vyber „Nová osoba“. Loňské dvojice se porovnávají podle této totožnosti, ne podle přezdívky nebo sdíleného telefonu.</p>}
    <label htmlFor="participant-filter" className="sr-only">Hledat účastníka</label><input className="filter-input" id="participant-filter" type="search" placeholder="Hledat podle jména nebo telefonu…" value={filter} onChange={(event) => setFilter(event.target.value)} />
    <div className="participant-list">{filtered.map((participant) => <article className="participant-row" key={participant.id}><div className="participant-info"><div className="participant-name"><strong>{participant.name}</strong>{duplicateIds.has(participant.id) && <span className="duplicate-tag">Prověřit duplicitu</span>}</div><p>{participant.phone} · {new Date(participant.createdAt).toLocaleString('cs-CZ')}</p><div className="answer-chips">{participant.statements.map((id) => <span key={id}>{STATEMENTS.find((item) => item.id === id)?.label || id}</span>)}<span>{TIMINGS.find((item) => item.id === participant.timing)?.label}</span></div><small className="muted">{participant.elfTitle}</small><IdentityControl key={participant.id + ':' + participant.personId} participant={participant} snapshot={snapshot} busy={busy} execute={execute} /></div>
      {!snapshot.currentVersion && <div className="delete-controls">{deleteId === participant.id ? <><span>Opravdu odebrat?</span><button className="danger" disabled={busy} onClick={async () => { if (await execute('admin-delete', { id: participant.id })) setDeleteId(null); }}>Potvrdit odebrání</button><button className="text-button" disabled={busy} onClick={() => setDeleteId(null)}>Zrušit</button></> : <button className="text-button danger-text" disabled={busy} onClick={() => setDeleteId(participant.id)}>Odebrat</button>}</div>}
    </article>)}</div>
    {!filtered.length && <p className="empty-state">{participants.length ? 'Tomuhle hledání neodpovídá žádný elf.' : 'V tomto ročníku zatím nejsou žádné formuláře. Ručně importované historické losování najdeš níže.'}</p>}
  </section>;
}
