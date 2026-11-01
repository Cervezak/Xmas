import { randomInt } from 'node:crypto';

export function drawCircle(participantIds, options = {}) {
  if (participantIds.length < 3) throw new Error('K losování jsou potřeba alespoň 3 účastníci.');
  if (new Set(participantIds).size !== participantIds.length) throw new Error('Seznam účastníků obsahuje duplicity.');
  const { chooseIndex = randomInt, forbiddenPairs = [], avoidPairs = [], searchLimit = 1000000 } = typeof options === 'function' ? { chooseIndex: options } : options;
  const blocked = new Set(forbiddenPairs.map(([giver, receiver]) => `${giver}:${receiver}`));
  const previous = new Set(avoidPairs.map(([giver, receiver]) => `${giver}:${receiver}`));
  const shuffle = (values) => {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const target = chooseIndex(index + 1);
      [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    return shuffled;
  };
  const allowed = (circle) => {
    let changed = previous.size === 0;
    for (let index = 0; index < circle.length; index += 1) {
      const edge = `${circle[index]}:${circle[(index + 1) % circle.length]}`;
      if (blocked.has(edge)) return false;
      if (!previous.has(edge)) changed = true;
    }
    return changed;
  };
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const candidate = shuffle(participantIds);
    if (allowed(candidate)) return candidate;
  }
  const anchor = participantIds[0];
  const path = [anchor];
  let searched = 0;
  const search = (remaining) => {
    searched += 1;
    if (searched > searchLimit) {
      const error = new Error('Hledání narazilo na bezpečnostní limit. Zkus to znovu nebo zkontroluj omezení; nemožnost řešení nebyla prokázána.');
      error.code = 'SANTA_SEARCH_LIMIT';
      throw error;
    }
    if (remaining.length === 0) return allowed(path) ? [...path] : null;
    for (const next of shuffle(remaining)) {
      if (blocked.has(`${path[path.length - 1]}:${next}`)) continue;
      if (remaining.length === 1 && blocked.has(`${next}:${anchor}`)) continue;
      path.push(next);
      const result = search(remaining.filter((person) => person !== next));
      if (result) return result;
      path.pop();
    }
    return null;
  };
  const result = search(participantIds.slice(1));
  if (result) return result;
  const error = new Error(previous.size ? 'Žádný další odlišný kruh při těchto pravidlech neexistuje. Původní los zůstává zachovaný.' : 'S těmito účastníky a loňskými přiřazeními nelze vytvořit platný kruh.');
  error.code = 'SANTA_NO_SOLUTION';
  throw error;
}
