export function seasonStorageKey(kind, year) {
  return 'santa-' + kind + '-' + year;
}

export function readSeasonSession(kind, year, storage) {
  try {
    const session = storage ?? globalThis.sessionStorage;
    const scoped = session.getItem(seasonStorageKey(kind, year));
    const value = JSON.parse(scoped ?? (year === 2026 ? session.getItem('santa-' + kind) : null));
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.year !== undefined && value.year !== year) return null;
    return { ...value, year };
  } catch { return null; }
}

export function saveSeasonSession(kind, year, value, storage) {
  try {
    const session = storage ?? globalThis.sessionStorage;
    if (value === null) session.removeItem(seasonStorageKey(kind, year));
    else session.setItem(seasonStorageKey(kind, year), JSON.stringify({ ...value, year }));
    if (year === 2026) session.removeItem('santa-' + kind);
  } catch {}
}
