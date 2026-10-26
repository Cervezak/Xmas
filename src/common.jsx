import React from 'react';

export async function api(action, data = {}, password) {
  const response = await fetch('/api/santa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}) },
    body: JSON.stringify({ action, ...data }),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Dílna se neozvala. Zkus to prosím za chvíli.'); }
  if (!response.ok) {
    const error = new Error(result.error || 'Něco se zadrhlo. Zkus to prosím znovu.');
    error.status = response.status;
    throw error;
  }
  return result;
}

export function readSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); }
  catch { return null; }
}

export function saveSession(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function Header({ children }) {
  return <header className="header"><a className="brand" href="/" aria-label="Santova dílna – úvod"><svg viewBox="0 0 32 38" fill="none" aria-hidden="true"><path d="m16 2 8 12h-5l9 13H4l9-13H8L16 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M16 27v9M11 36h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg><span>santova dílna<small>TOVÁRNA NA MALÁ TAJEMSTVÍ</small></span></a>{children || <span className="season"><span className="status-dot" /> Vánoce {new Date().getFullYear()}</span>}</header>;
}

export function Footer() {
  return <footer className="footer"><span>Malé tajemství dělá velkou radost.</span><span>Upečeno s láskou a špetkou skořice <span aria-hidden="true">✧</span></span></footer>;
}

export class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="site-shell"><Header /><main className="admin-login"><h1>Elfové zamotali stuhy.</h1><p>Obnov stránku a zkus to prosím znovu.</p><a className="primary" href="/">Zpátky do dílny →</a></main></div> : this.props.children;
  }
}
