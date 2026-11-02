export const GAME_STATES = { draft: 'Rozpracovaná', scheduled: 'Naplánovaná', active: 'Aktivní', archived: 'Ukončená' };

export function formatGameDate(value) {
  return value ? new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'do spuštění další hry';
}

export function pragueInput(value) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day') + 'T' + get('hour') + ':' + get('minute');
}

export function pragueToUtc(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Vyber datum a čas spuštění.');
  const utc = Date.parse(value + ':00Z');
  if (!Number.isFinite(utc)) throw new Error('Datum není platné.');
  const matches = [60, 120].map((offset) => new Date(utc - offset * 60000)).filter((date) => pragueInput(date) === value);
  if (matches.length !== 1) throw new Error('Tento čas při změně letního času neexistuje nebo je nejednoznačný. Vyber jiný čas.');
  return matches[0].toISOString();
}

export async function gamesApi(action, data = {}, password) {
  const response = await fetch('/api/games', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: 'Bearer ' + password } : {}) },
    body: JSON.stringify({ action, ...data }),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('Hry se neozvaly. Zkus to znovu.'); }
  if (!response.ok) { const error = new Error(result.error || 'Hry jsou právě nedostupné.'); error.status = response.status; throw error; }
  return result;
}
