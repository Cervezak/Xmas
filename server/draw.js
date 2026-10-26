import { randomInt } from 'node:crypto';

export function drawCircle(participantIds, chooseIndex = randomInt) {
  if (participantIds.length < 3) throw new Error('K losování jsou potřeba alespoň 3 účastníci.');
  if (new Set(participantIds).size !== participantIds.length) throw new Error('Seznam účastníků obsahuje duplicity.');
  const circle = [...participantIds];
  for (let index = circle.length - 1; index > 0; index -= 1) {
    const target = chooseIndex(index + 1);
    [circle[index], circle[target]] = [circle[target], circle[index]];
  }
  return circle;
}
