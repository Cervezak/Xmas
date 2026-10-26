export const STATEMENTS = [
  { id: 'lights', icon: '✧', label: 'Světýlek není nikdy dost.', detail: 'Klidně i na pokojovce.', title: 'Vrchní rozsvěcovač vánoční nálady' },
  { id: 'cookies', icon: '♡', label: 'Cukroví se počítá na patra.', detail: 'Ochutnávání je důležitá práce.', title: 'Čestný ochutnávač tajných zásob' },
  { id: 'fairytales', icon: '✦', label: 'Ještě jednu pohádku. A pak další.', detail: 'Repliky už umím nazpaměť.', title: 'Strážce pohádkového ovladače' },
  { id: 'cozy', icon: '☕', label: 'Deka, čaj a nikam nemusím.', detail: 'Tohle je můj vánoční program.', title: 'Velmistr zachumlání do deky' },
  { id: 'family', icon: '⌂', label: 'Nejlepší je být spolu.', detail: 'I když každý ujídá z mého talíře.', title: 'Svolávač sváteční smečky' },
  { id: 'snow', icon: '❄', label: 'Bez procházky by to nebylo ono.', detail: 'Ať mrzne, hlavně že jsme venku.', title: 'Průzkumník zasněžených stezek' },
  { id: 'wrapping', icon: '◇', label: 'Balení dárků je moje disciplína.', detail: 'Stuha musí ladit. Samozřejmě.', title: 'Mistr stuh a ztracené izolepy' },
  { id: 'music', icon: '♪', label: 'Koledy? Přidat hlasitost!', detail: 'Sousedé se určitě rádi přidají.', title: 'Dirigent sobího pěveckého sboru' },
  { id: 'food', icon: '☆', label: 'Na salát si místo vždycky najdu.', detail: 'A na druhé kolo taky.', title: 'Nejvyšší komisař bramborového salátu' },
];

export const TIMINGS = [
  { id: 'early', icon: '↗', label: 'Mám náskok', detail: 'Dárky řeším dlouho dopředu.', suffix: 's náskokem před soby' },
  { id: 'gradual', icon: '◷', label: 'Všechno má svůj čas', detail: 'Postupně, v klidu a bez paniky.', suffix: 'v režimu vánoční pohody' },
  { id: 'last-minute', icon: 'ϟ', label: 'Pod tlakem zářím', detail: 'Na poslední chvíli je to sport.', suffix: 'z jednotky poslední chvíle' },
];

export function elfTitle(statements, timing) {
  const statement = STATEMENTS.find((item) => item.id === statements[0]);
  const selectedTiming = TIMINGS.find((item) => item.id === timing);
  return `${statement.title} ${selectedTiming.suffix}`;
}

export function normalizeName(name) {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('cs').replace(/\s+/g, ' ').trim();
}

export function normalizePhone(phone) {
  const compact = phone.replace(/[\s().-]/g, '').replace(/^00/, '+');
  return /^\d{9}$/.test(compact) ? `+420${compact}` : compact;
}

export function validateSubmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Formulář nemá správný formát.');
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 2 || name.length > 60 || /[\p{Cc}\p{Cf}<>]/u.test(name)) throw new Error('Jméno musí mít 2 až 60 znaků.');
  const phone = normalizePhone(typeof input.phone === 'string' ? input.phone : '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Zadej platný telefon, například +420 777 123 456.');
  if (!Array.isArray(input.statements) || input.statements.length < 1 || input.statements.length > 3 || new Set(input.statements).size !== input.statements.length || input.statements.some((id) => !STATEMENTS.some((item) => item.id === id))) throw new Error('Vyber 1 až 3 vánoční výroky.');
  if (!TIMINGS.some((item) => item.id === input.timing)) throw new Error('Vyber, kdy nakupuješ dárky.');
  if (input.confirmed !== true) throw new Error('Potvrď prosím definitivní odeslání.');
  if (typeof input.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) throw new Error('Obnov stránku a zkus odeslání znovu.');
  if (input.website) throw new Error('Formulář se nepodařilo ověřit.');
  return { name, phone, statements: input.statements, timing: input.timing, idempotencyKey: input.idempotencyKey, nameKey: normalizeName(name), elfTitle: elfTitle(input.statements, input.timing) };
}

export function smsText(giver, receiver) {
  const wishes = receiver.statements.map((id) => STATEMENTS.find((item) => item.id === id)?.label).filter(Boolean).join(' ');
  return `Ahoj ${giver.name}! Tady Santova dílna. Letos tajně obdaruješ: ${receiver.name}. Malá nápověda pro radost: ${wishes} Pšššt, nech si to pro sebe. Veselé Vánoce!`;
}
