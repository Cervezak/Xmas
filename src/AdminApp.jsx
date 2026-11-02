import { useCallback,useState } from 'react';
import { api, Header, Footer } from './common.jsx';
import SeasonControls from './SeasonControls.jsx';
import AdminTabs from './AdminTabs.jsx';
import { gamesApi } from '../shared/games.js';

export default function AdminApp() {
  const [password, setPassword] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestGame = useCallback(async(action,data)=>{
    try { return await gamesApi(action,data,password); }
    catch(failure) {
      if(failure.status===401){setSnapshot(null);setPassword('');}
      throw failure;
    }
  },[password]);
  const execute = async (action, data = {}) => {
    setBusy(true); setError('');
    try {
      const result = await api(action, { ...(snapshot ? { year: snapshot.year, revision: snapshot.revision } : {}), ...data }, password);
      setSnapshot(result);
      return true;
    } catch (failure) {
      setError(failure.message);
      if (failure.status === 401) { setSnapshot(null); setPassword(''); }
      return false;
    } finally { setBusy(false); }
  };
  const duplicateIds = new Set((snapshot?.participants ?? []).filter((participant) => snapshot.participants.some((other) => other.id !== participant.id && (other.nameKey === participant.nameKey || other.phone === participant.phone))).map((participant) => participant.id));
  return <div className="site-shell admin-shell"><Header><span className="season">POUZE PRO ORGANIZÁTORA</span></Header><main className="admin-main">
    {!snapshot ? <section className="admin-login"><p className="eyebrow">ZA DVEŘMI SANTOVY DÍLNY</p><h1>Vstup pro <em>vrchního elfa.</em></h1><p>Účastníci, ročníky, historie a tajné zprávy na jednom místě.</p><form onSubmit={(event) => { event.preventDefault(); execute('admin-list'); }}><label htmlFor="admin-password">Heslo do dílny</label><input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Otevírám…' : 'Odemknout dílnu'} <span aria-hidden="true">→</span></button></form></section> : <>
      <div className="admin-title"><div><p className="eyebrow">VELÍN TAJNÉHO NADĚLOVÁNÍ</p><h1>Ahoj, vrchní elfe.</h1></div><button className="secondary" disabled={busy} onClick={() => { setSnapshot(null); setPassword(''); setError(''); }}>Odhlásit</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      <SeasonControls snapshot={snapshot} busy={busy} execute={execute} />
      <div className="admin-stats"><div><strong>{snapshot.participants.length}</strong><span>účastníků · {snapshot.year}</span></div><div><strong>{duplicateIds.size}</strong><span>přihlášek k prověření</span></div><div><strong className="state-word">{snapshot.currentVersion ? 'Verze ' + snapshot.currentVersion : 'Otevřeno'}</strong><span>{snapshot.registrationOpen ? 'přihlášky pro tento rok jsou otevřené' : 'přihlášky pro tento rok jsou uzavřené'}</span></div></div>
      <AdminTabs key={snapshot.year} snapshot={snapshot} busy={busy} execute={execute} onError={setError} requestGame={requestGame} />
    </>}
  </main><Footer /></div>;
}
