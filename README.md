# Santova dílna · Secret Santa

Česká responzivní SPA v Reactu a Vite. Jméno → 1–3 vánoční výroky → načasování nákupu dárků → telefon → kontrola → definitivní odeslání → osobní elfí titul. Jméno je do odeslání upravitelné v záhlaví. Informaci o obdarovaném dostane účastník později SMS od organizátora.

## Architektura

- **React + Vite** pro veřejnou stránku a administraci `/admin`.
- **Vercel Node.js Function** `api/santa.js` přijímá JSON, validuje údaje a zajišťuje přístup do databáze.
- **Supabase PostgreSQL** uchovává přihlášky, jediné losování a sdílené limity požadavků.
- Render ani samostatný trvale běžící backend nejsou potřeba. SMS se odesílají ručně; žádná SMS brána se nevolá.

## 1. Lokální spuštění

Potřebuješ Node.js **22.12 nebo novější** a npm. Ve složce projektu:

```sh
npm ci
```

Zkopíruj `.env.example` do `.env`, doplň čtyři skutečné hodnoty podle další kapitoly a spusť:

```sh
npm run dev
```

Otevři adresu vypsanou terminálem, obvykle `http://127.0.0.1:5173`. Na Windows lze použít také **START.bat** dvojklikem. Místní vývojový server obsluhuje stejnou API funkci jako Vercel. Po úpravě `.env` server restartuj.

Bez nastavené databáze funguje vzhled a vyplňování; při odeslání nebo přihlášení do administrace se zobrazí zpráva o nepřipojené dílně. Aplikace v takovém případě nic neuloží ani nepředstírá úspěch. `npm run preview` slouží pouze ke kontrole statického buildu a neobsluhuje API.

## 2. Supabase

1. Vytvoř nový samostatný Supabase projekt pro tuto akci.
2. V **SQL Editoru** spusť celý soubor `supabase/migrations/202610260001_santa.sql`. Migrace vytvoří tabulky a funkce v jedné transakci. Je určena pro první spuštění, ne pro opakované přepisování existujících dat.
3. Z nastavení projektu zkopíruj **Project URL** do `SUPABASE_URL`.
4. Ze sekce **API Keys** vezmi serverový **secret key** nebo legacy **service_role** klíč a nastav jej jako `SUPABASE_SERVICE_ROLE_KEY`. Nepoužívej publishable/anon klíč.
5. Vygeneruj dvě různá náhodná tajemství:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

První dej do `ADMIN_PASSWORD` (alespoň 24 znaků), druhé do `RATE_LIMIT_SALT` (alespoň 32 znaků). Hodnoty z `.env.example` jsou pouze zástupné; nahraď je vlastními. Všechna čtyři nastavení patří pouze serveru. **Nepoužívej předponu `VITE_`** a nevkládej tajemství do Reactu. `.env` je v `.gitignore`.

Tabulky mají zapnuté RLS a odebraná oprávnění rolím `anon`, `authenticated` i `PUBLIC`. Žádné veřejné politiky je neotevírají. Také všechny RPC funkce smí spouštět pouze `service_role`; jsou `SECURITY INVOKER` s prázdným `search_path`. Prohlížeč komunikuje pouze se stejnou doménou přes `/api/santa`, nikoli přímo se Supabase. Supabase Auth není pro tento malý soukromý projekt potřeba.

## 3. Vercel – až po schválení nasazení

Projekt je připravený k nasazení, ale samotná implementace nic nezveřejňuje.

1. Nahraj repozitář na svůj Git hosting a importuj jej do Vercelu, případně použij Vercel CLI až po rozhodnutí nasadit.
2. Vyber framework **Vite**, kořenovou složku tohoto projektu, build příkaz `npm run build`, output `dist` a runtime Node.js **22.x nebo novější**.
3. Do **Environment Variables** nastav `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD` a `RATE_LIMIT_SALT`. Nastav je pro cílové prostředí ještě před deploymentem.
4. Preview připojuj k oddělenému testovacímu Supabase projektu. Pokud proměnné pro Preview vynecháš, bude tam dostupný pouze formulář bez ukládání. Preview se skutečnými produkčními klíči by zapisovalo do stejné databáze jako ostrá akce.
5. Po schválení proveď deployment. `vercel.json` nastavuje SPA cestu `/admin` a bezpečnostní hlavičky. `/api/santa` zůstává serverovou funkcí, nepřepisuje se na HTML.
6. Na testovacím prostředí projdi přihlášku a administraci. Na produkci používej jen skutečné účastníky a losuj až po jejich kontrole.

Přístup do administrace chrání silné `ADMIN_PASSWORD`. Heslo se posílá v autorizační hlavičce přes HTTPS a zůstává jen v paměti otevřené stránky; není uložené do browser storage ani cookies. Obnovení stránky vyžaduje nové přihlášení. Změna hesla ve Vercelu vyžaduje nový deployment.

## 4. Administrace a losování

1. Otevři `/admin` a zadej nastavené heslo.
2. Projdi účastníky, telefony a odpovědi. **Prověřit duplicitu** znamená stejné normalizované jméno (bez diakritiky, bez rozlišení velikosti písmen a nadbytečných mezer) nebo stejný normalizovaný telefon. Sdílené číslo může být legitimní. Aplikace nevybírá automaticky vítězný záznam.
3. Přebytečný záznam odeber přes **Odebrat → Potvrdit odebrání**. Jde o trvalé odstranění; správný záznam si nejprve ověř.
4. Obnov seznam a po kontrole všech přihlášek zaškrtni potvrzení, napiš **LOSOVAT** a spusť losování. Minimum jsou **3 účastníci**: u dvou lidí nelze zabránit reciproční dvojici.
5. Na serveru proběhne Fisher–Yates promíchání s `crypto.randomInt`. Každý v pořadí obdaruje následujícího a poslední prvního. Vzniká jeden náhodný kruh přes všechny účastníky, každý přesně jednou dává i dostává, nikdo sobě a žádné vzájemné dvojice.
6. Databáze ověří celý aktuální seznam a uloží všechna přiřazení i uzavření akce atomicky. Změní-li se seznam od kontroly, losování skončí chybou a musíš jej znovu zkontrolovat. Zápisy, mazání a losování sdílejí transakční zámek jednoho řádku akce. Souběžná losování nemohou přepsat výsledek.
7. Po losování se uzavřou nové přihlášky, mazání i další losování. Tlačítko na přelosování záměrně neexistuje. Další ročník spusť v novém Supabase projektu nebo po samostatně připravené migraci; nemanipuluj s rozeslaným losováním.
8. Otevři **Zobrazit tajné zprávy**. U každého odesílatele uvidíš jeho číslo a samostatný text se jménem obdarovaného a jeho vánočními výroky. **Kopírovat text** přenese jednu zprávu do schránky. **Otevřít SMS** na podporovaném telefonu jen otevře aplikaci zpráv; samotné odeslání provádíš ručně. Obsah schránky může synchronizovat tvůj operační systém. Aplikace neeviduje doručení ani odeslání.

Výsledky nejsou dostupné přes veřejné API. Veřejné odeslání vrací pouze vlastní jméno a elfí titul. Administrátorské odpovědi mají `Cache-Control: no-store`; tajné zprávy jsou v rozhraní nejdřív schované a vracejí se až po autentizaci správce.

## Opakované odeslání a limity

- Jedna přihláška má náhodný idempotentní klíč. Opakování stejného požadavku po síťové chybě nevyrobí druhý záznam a funguje i po uzavření losování. Změna již uloženého požadavku pod stejným klíčem se odmítne.
- Nová samostatná přihláška stejného člověka se uloží: duplicity řeší organizátor. Neprobíhá ověření vlastnictví telefonního čísla.
- Rozpracované jméno, volby a klíč jsou v `sessionStorage` aktuálního panelu; telefon se do něj neukládá. Po úspěchu zůstává pouze vlastní jméno a titul. Browser potvrzení není důkazem zápisu; rozhodující je seznam v administraci.
- Sdílený databázový limit je 20 platných pokusů o přihlášku, 10 neúspěšných přihlášení správce a 300 autorizovaných operací správce na IP a 15minutové okno. Úspěšné ověření hesla nepodléhá vyčerpanému limitu chybných hesel. U společné Wi-Fi se veřejný limit sdílí.
- Na Vercelu se používá systémová hlavička `x-vercel-forwarded-for`; lokálně adresa spojení. V databázi je jen HMAC IP adresy s tajnou solí, záznamy starší než den se čistí při dalších požadavcích. Formulář má také skryté pole proti jednoduchým botům. Pokud web začne dostávat spam, lze později přidat CAPTCHA nebo vstupní kód.
- Tato verze je jedna akce pro menší skupinu, s jedním sdíleným administrátorským heslem. Jména, telefony a odpovědi uchovává organizátor v Supabase; po skončení akce je odstraň podle vlastní potřebné doby uchování.

## Úpravy dotazníku

Výroky, texty načasování a elfí tituly jsou v `shared/questionnaire.js`. Původní konverzace neobsahovala čitelné definitivní znění výroků, takže je připravena upravitelná sada devíti textů. Titul vzniká z prvního zvoleného výroku a načasování nákupu. Změna textu při zachování ID nevyžaduje zásah do databáze. Přidání/změna ID vyžaduje odpovídající novou SQL migraci pro omezení tabulky, ne opakované spuštění počátečního schématu.

Vzhled je v `src/styles.css` a `src/responsive.css`, vlastní vektorová ilustrace v `src/Illustration.jsx`. Nepoužívají se externí fonty, obrázky, analytika ani sledovací služby.

## Ověření

```sh
npm test
npm run build
```

Testy používají skutečný PostgreSQL engine v paměti přes PGlite, stejnou SQL migraci a HTTP požadavky proti stejné API funkci. Nepřipojují se k živému Supabase. Ověřují validaci, bezpečnost databázových rolí a RPC, autentizaci, idempotenci, odstranění duplicit, ochranu zastaralého seznamu, jediné losování, uzavření akce, soukromí výsledků, SMS i databázové limity. Algoritmus se kontroluje při 600 losováních pro různé velikosti skupiny.

Před ostrým provozem je potřeba ještě ověřit připojení skutečného Supabase a funkci v prostředí Vercelu s vlastními klíči. Žádná živá databáze ani hosting nebyly v rámci přípravy vytvořeny nebo změněny.

## Dokumentace služeb

- [Vite na Vercelu](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Oprávnění databázových funkcí](https://supabase.com/docs/guides/database/functions)
