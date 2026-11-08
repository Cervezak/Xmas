# Santova dílna · Secret Santa

Česká responzivní React/Vite SPA s ročníky, verzemi losování a neveřejnou administrací. Veřejný formulář vždy patří jedinému aktivnímu roku. Tajná přiřazení jsou dostupná pouze správci, SMS se posílají ručně. Výsledky rodinných her jsou součástí veřejné herní části.

## Přehlednější veřejná herní stránka

Po uzavření přihlášek a u již uloženého potvrzení jsou **Vánoční záhady** hned pod hlavičkou. Oznámení **Santa už rozdal úkoly** nebo vlastní potvrzení přihlášky následuje pod hrami. Při novém odeslání se potvrzení stále přístupně zaměří; samotné načtení již uloženého potvrzení návštěvníka neposouvá od her dolů. Otevřený nový ročník nadále začíná formulářem.

Herní panel má menší mezery, nižší karty jmen, stručnější označení vyřešených her a kompaktní nadpis. Na dostatečně širokém počítači se 12 jmen vejde do dvou řad, na mobilu zůstávají dvě karty vedle sebe. Výběr archivu je na počítači vedle informace o hráči, na mobilu pod ní. Základní velikost písma zůstává 20 px.

Termíny se popisují podle skutečného stavu: **Probíhá od… · konec zatím není naplánovaný**, případně s konkrétním koncem; archiv **Hrálo se… –…**; budoucí hra **Začne…**. Stejné popisy používá administrace. Stačí commit/push a deployment, bez nového SQL.

## Sbalovací editor her

Tato úprava potřebuje jen aktuální kód a nový Vercel deployment, bez dalšího SQL. Editor se objeví až po **Nová hra**, **Otevřít** nebo **Prohlédnout**. Záhlaví s názvem hry slouží k rozbalení a sbalení, uvnitř je také **Sbalit editor**. Po úspěšném uložení konceptu či naplánování se automaticky sbalí, potvrzení uložení zůstává viditelné nad seznamem.

Ruční sbalení nevymaže rozepsané změny; v záhlaví zůstane upozornění na neuložené změny. Při odchodu do jiné administrátorské záložky se editor sbalí a obsah zůstane zachovaný. Změna ročníku nadále vyčistí místní formuláře. Otevření jiné hry nebo vytvoření nové stále vyžaduje potvrzení opuštění neuložených úprav.

## Více uznávaných odpovědí u hádanek

Pokud už máš předchozí aktualizaci hádanek, spusť v Supabase SQL Editoru pouze nový soubor `supabase/migrations/202611080002_riddle_variants.sql`. Pokud ještě hádanky nemáš, spusť nejprve `202611080001_riddles.sql` a potom tuto aktualizaci. Již aplikované starší migrace znovu nespouštěj. Nakonec odešli aktuální kód přes GitHub Desktop a počkej na úspěšný deployment Vercelu.

V editoru hádanky napiš **každou uznávanou odpověď na samostatný řádek**, například:

~~~text
zvon
zvonek
zvoneček
~~~

Stačí shoda s kteroukoli variantou. Každá otázka může mít 1–20 variant, každou do 160 znaků. Velikost písmen, diakritika a mezery navíc stále nerozhodují. Odděluj novým řádkem; lomítko může být běžnou součástí odpovědi. Prázdné řádky editor při uložení vynechá. Za otázku se počítá nejvýše jeden správný bod bez ohledu na počet variant.

Po vyřešení nebo v archivu se zobrazí uznávaná znění oddělená lomítkem. Předem se žádná varianta veřejně nevydává. Starší hádanky s jediným zněním fungují dál a uložené odpovědi, výsledky i zámky se nepřepisují. Varianty můžeš doplňovat jen do dosud neuzamčené hry; první pokus i ukončení řešení uzamknou jako dosud.

## Hádanka s otevřenou odpovědí

Pokud už máš rozšíření pro herní hosty a originální fotografii, spusť v Supabase → SQL Editor pouze nový soubor `supabase/migrations/202611080001_riddles.sql`. Starší migrace ani soukromé importy znovu nespouštěj. Pak odešli kód přes GitHub Desktop a počkej na úspěšný Vercel deployment. Nové klíče nejsou potřeba. Aktualizace zachová existující hry, výsledky, ročníky, losování i SMS.

V administraci vyber **Easter eggy → Nová hra → Hádanka – otevřená odpověď**. Napiš text hádanky, otázku a její správnou odpověď (nejvýše 160 znaků). Výchozí je jedna otázka, případně lze mít až tři samostatné odpovědi. Pro každou se zadává 1–20 uznávaných znění, každé na samostatný řádek. Koncept, náhled, pointa i plánování fungují stejně jako u ostatních her.

Hráč odpověď napíše do pole. Server ignoruje velká/malá písmena, diakritiku i mezery navíc: například **Děda Mirek**, **DEDA MIREK** a **deda   mirek** se shodují. Překlepy, jiné pořadí slov, přezdívky nebo doplněná interpunkce se uznají jen tehdy, když je organizátor přidá mezi varianty. Uložení prázdné odpovědi není dovoleno.

Řešení není předem v nabídce ani ve veřejných datech. Zobrazí se až po úplném vyřešení pro vybrané jméno nebo v archivu. Chybný pokus dovolí opravu; správné odpovědi se uloží v původně napsaném znění a uzamknou i po obnovení stránky. Počty pokusů a nejlepší počet správných odpovědí zůstávají jen v administraci. Starší hry se výběrem možností fungují beze změny.

## Aktualizace existující instalace z října 2026

**Původní migraci znovu nespouštěj.** Všechny existující formuláře zůstanou v roce 2026. Dosavadní los se zachová jako verze 1, včetně původního času a všech přiřazení. Migrace sama neprovádí přelosování.

1. Před změnou si stáhni export současných účastníků a přiřazení ze Supabase.
2. V Supabase SQL Editoru spusť celý soubor `supabase/migrations/202611010001_seasons_and_versions.sql`. Je to jednorázová transakční migrace.
3. Potom spusť soukromý soubor `supabase/private/2025-history.sql`, případně stažený `2025-historie-soukrome.sql`. Obsahuje deset ručně dodaných dvojic z roku 2025. Je mimo Git díky `.gitignore`, aby se historické výsledky nezveřejnily se zdrojovým kódem.
4. Spusť také nový soubor `supabase/migrations/202611010002_sms_rules.sql`. Spusť také `supabase/migrations/202611020001_easter_games.sql`. Spusť také `supabase/migrations/202611040001_game_guests_and_reveals.sql`. Spusť také `supabase/migrations/202611080001_riddles.sql`. Spusť také `supabase/migrations/202611080002_riddle_variants.sql`. Potom nahraj nový kód na produkční větev a nech Vercel dokončit nový deployment. SQL a nový kód patří k sobě; během přechodu může stará verze API odeslání odmítat.
5. V `/admin` vyber rok 2026. U každé přihlášky zvol skutečnou osobu z historie a klikni na **Potvrdit totožnost**. Při účasti nového člověka zvol **Nová osoba**. Shoda jména je jen nápověda, nic se automaticky nehádá.
6. Dosavadní los uvidíš jako **2026, verze 1**. Jestli potřebuješ nový výsledek a **SMS ještě neodešly**, vytvoř další verzi. Výsledek před rozesláním definitivně uzamkni.

Pokud už byly SMS rozeslané, nepotvrzuj prohlášení, že odeslané nejsou. Stávající výsledek uzamkni; aplikace neumí odvolat zprávy nebo informovat příjemce o změně.

Soukromý import 2025 nemění letošní výsledek, aktivní ročník ani registrace. Datum skutečného losování v roce 2025 nebylo dodané, proto zůstává neznámé. Historie přesně zachovává i reciproční dvojice a více kruhů, které platily tehdy. Nová pravidla se uplatňují pouze na nově generované losy.

Neúplná či nenačtená historie 2025 zablokuje nové losování 2026. Import je jednorázový; při druhém spuštění se zastaví a nic nepřepíše. Pokud po neúspěšném běhu SQL Editor uvádí otevřenou chybnou transakci, proveď `ROLLBACK` před dalším pokusem.

## Aktualizace SMS, pokud už máš ročníky a historii

V Supabase SQL Editoru spusť pouze nový soubor `supabase/migrations/202611010002_sms_rules.sql`, potom odešli změny kódu přes GitHub Desktop. Starší migrace ani import 2025 znovu nespouštěj. Nová migrace zachová všechna přiřazení, verze i zámky a přidá pravidla pro SMS. Pro 2026 předvyplní: **Připrav 2–3 dárky v celkové hodnotě nejvýše 3 000 Kč.**

V administraci vyber ročník a najdi **Pravidla nadělování**. Klikni na **Upravit pravidla**, napiš text a stiskni **Potvrdit a vložit do SMS**. Do potvrzení se texty zpráv nemění. Zrušením úprav zahodíš rozepsaný text. Každý rok má vlastní pravidla; nově založený rok začíná s prázdným polem.

SMS obsahuje původní oslovení, uložený elfí titul adresáta z jeho přihlášky, obdarovaného, potvrzená pravidla a rozloučení. Prázdná pravidla tento blok vynechají. Více řádků se zachová, limit je 2 000 znaků; delší text s diakritikou se může rozdělit do více SMS.

Pravidla lze upravit i po definitivním uzamčení losu: aktualizují se pouze připravené texty, nikoli dvojice, verze nebo již odeslané zprávy. Pravidla patří celému ročníku; nejsou archivem přesného znění dříve poslaných SMS. Ručně vložená historie 2025 zůstává jen ke čtení.

## Easter eggy: přidání do již fungující instalace

Pokud už máš ročníky i pravidla SMS, v Supabase SQL Editoru spusť jednou celý soubor `supabase/migrations/202611020001_easter_games.sql`. Původní migrace ani historii 2025 znovu nespouštěj. Potom odešli nový kód přes GitHub Desktop a počkej na úspěšný deployment. Žádné nové klíče nebo služby nejsou potřeba. Hry nepřepisují účastníky, přiřazení, SMS ani zámek losování.

V administraci vyber ročník → **Easter eggy** → **Nová hra**. Zvol **Historku**, **Rozpoznání obrázku** nebo **Hádanku – otevřená odpověď**, napiš zadání a nastav 1–3 otázky. Historka a obrázek mají u každé otázky 2–10 možností a jednu označenou správnou odpověď. Hádanka má volné textové pole a správné znění zadává organizátor. Můžeš doplnit pointu, která se ukáže až po úplném vyřešení nebo v archivu.

- **Uložit koncept** uchová vyplněnou hru bez zveřejnění. Koncept musí mít platné zadání a řešení.
- **Náhled hry** ukáže obsah i správné řešení pouze organizátorovi.
- **Potvrdit a naplánovat** zveřejní hru v nastaveném budoucím čase. Pro rychlé spuštění vyber čas za několik minut.
- Termíny se zadávají pro **Europe/Prague**, včetně letního času. Neexistující nebo dvojznačné časy při změně času se odmítnou.
- Každá zveřejněná hra v ročníku musí mít odlišný čas začátku. Aktivní je poslední již spuštěná hra, která poběží do začátku další. Poslední hra bez následníka nemá automatický konec.
- Budoucí hru lze upravit nebo vrátit do konceptů. Již spuštěné hře nelze změnit termín nebo ji stáhnout. Po prvním platném pokusu nebo po ukončení nelze upravovat ani obsah a řešení.

Obrázky JPG/PNG/WebP do 10 MB prohlížeč zmenší (nejdelší strana nejvýše 1 400 px) a připraví pro uložení do 500 KiB. Ukládají se do soukromé tabulky v Supabase; není třeba zakládat Storage bucket. Budoucí obrázky, zadání a pointy veřejné API nevydává. Pro tuto rodinnou akci je objem malý; velké galerie nejsou účelem této verze.

Na hlavní stránce je část **Vánoční záhady** i při uzavřených přihláškách nebo u vlastního potvrzení. Seznam obsahuje jména z aktuální verze losování aktivního ročníku a samostatné herní hosty. Bez losování mohou hrát pouze přidaní herní hosté. Jméno není přihlášení: kdokoli ho může vybrat a všichni pod stejným jménem sdílejí jeden postup i na různých zařízeních.

Jeden úplný výběr odpovědí a kliknutí na **Ověřit odpovědi** je jeden pokus. Chybný pokus dovolí další hraní. Ukládá se nejlepší počet správných odpovědí dané hry, nikoli součet za opakované pokusy. Úplně správné řešení uloží konkrétní výběr a další změny pro toto jméno zablokuje. Opakované načtení ani opakované doručení stejného požadavku pokus nepřidá.

U jmen se veřejně zobrazuje pouze počet vyřešených her celého ročníku. Počty pokusů a správných odpovědí jsou dostupné jen v administraci u jednotlivých her; veřejné API je nevydává. V **archivu** jsou termíny od–do, zadání, řešení, vlastní uložené odpovědi a jména řešitelů se stavem vyřešení. Ukončenou hru už nelze řešit. Archiv na hlavní stránce patří aktivnímu ročníku, starší ročníky zůstávají v administraci.

Rozhoduje čas serveru, ne telefonu. Veřejná stránka obnovuje stav při návratu do okna a přibližně každých 30 sekund; na hranici termínu může být obrázek ještě chvíli z minulé hry, ale server už další pokus nepřijme. Tlačítko **Obnovit hry** načte aktuální stav hned. Není potřeba cron nebo nové nasazení ke každé hře.

Nový endpoint `/api/games` používá stejné serverové proměnné jako Santa. Role anon/authenticated nemají přímý přístup k herním tabulkám ani funkcím. Ověření odpovědí probíhá na serveru; řešení se vydává až při úspěchu nebo po skončení hry. Limity na IP za 15 minut jsou 3 000 herních čtení a 200 pokusů, odděleně od registrací a administrace.


## Obrázek odhalení, mazání her a samostatní hráči

Pro instalaci, která už má Easter eggy, spusť pouze novou migraci `supabase/migrations/202611040001_game_guests_and_reveals.sql`. Potom můžeš jednorázově spustit soukromý soubor `supabase/private/2026-game-guests.sql` se dvěma dohodnutými jmény. Soukromý soubor je mimo Git a mimo zdrojový ZIP; další hráče lze přidávat přímo v administraci. Nakonec odešli nový kód přes GitHub Desktop.

### Originální fotografie v pointě
U typu **Rozpoznání obrázku** zůstává hlavní obrázek hádankou, například karikaturou. Druhé pole **Originální fotka do pointy** slouží pro skutečnou fotografii. Zobrazí se až po úplně správném vyřešení pro zvolené jméno nebo po skončení hry v archivu. Funguje i bez textové pointy. Pro oba obrázky platí původní omezení velikosti a zmenšení v prohlížeči. Veřejné API před vyřešením či ukončením originál nevydává. Historka se používá stejně jako dosud.

### Smazání a zrušení
V editoru uložené hry je **Smazat koncept**, **Smazat hru** nebo **Zrušit hru**. Odstranění se potvrzuje napsáním **ODSTRANIT**. Koncept a dosud nespouštěná hra bez výsledků se smažou včetně obrázků. Již spuštěná hra se stáhne z veřejné nabídky a její výsledky zůstanou v administraci jako zrušené. Zrušená hra se nezapočítává do veřejného počtu vyřešených her.

Zrušení spuštěné hry nikdy znovu neotevře jejího předchůdce. Bez další naplánované hry může být hlavní stránka dočasně bez aktivní hry; ostatní ukončené hry zůstávají v archivu. Zrušenou hru nelze znovu upravit nebo aktivovat; opravené zadání založ jako novou hru.

### Hráči mimo losování
V záložce **Easter eggy** rozbal **Hráči pouze pro easter eggy** a přidej jméno. Hráč patří ke skutečnému ročníku, má stejné hry a statistiky jako ostatní, ale nevstupuje do losování ani do SMS. Falešný ročník není potřeba.

Po výběru takového jména na hlavní stránce je k dispozici dobrovolný dotazník se stejnými vánočními výroky a načasováním jako původní formulář, bez telefonu. Udělí elfí titul, odpovědi se po potvrzení uzamknou a nepřihlásí člověka k dárkům. Při návratu stačí znovu vybrat jméno. Detailní odpovědi vidí organizátor u herních hostů, veřejně se pro vybrané jméno zobrazuje pouze titul a stav dokončení.

Herní hráči mají samostatnou tabulku `santa_game_players`. Existující výsledky i ID původních hráčů migrace zachová. Nové přihlášky pro losování se do herního seznamu synchronizují, ale stanou se veřejnými až podle aktuálního losu. Herní hosté mohou hrát i před losováním. Každý ročník má vlastní hosty; automaticky se mezi roky nepřenášejí.


## Nová instalace

Potřebuješ Node.js **22.12 nebo novější**, npm, Vercel a Supabase. Samostatný Render backend není potřeba.

~~~sh
npm ci
~~~

Zkopíruj `.env.example` do `.env` a doplň:

| Proměnná | Význam |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Serverový Supabase secret key nebo legacy service_role klíč |
| `ADMIN_PASSWORD` | Náhodné administrátorské heslo, nejméně 24 znaků |
| `RATE_LIMIT_SALT` | Jiné náhodné tajemství, nejméně 32 znaků |

Dvě různá náhodná tajemství lze vytvořit tímto příkazem, pokaždé samostatně:

~~~sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
~~~

V Supabase SQL Editoru spusť v tomto pořadí:

1. `supabase/migrations/202610260001_santa.sql`
2. `supabase/migrations/202611010001_seasons_and_versions.sql`
3. `supabase/migrations/202611010002_sms_rules.sql`
4. `supabase/migrations/202611020001_easter_games.sql`
5. `supabase/migrations/202611040001_game_guests_and_reveals.sql`
6. `supabase/migrations/202611080001_riddles.sql`
7. `supabase/migrations/202611080002_riddle_variants.sql`
8. Soukromý import historie 2025, pokud jde o tuto konkrétní rodinnou akci.

Prvních sedm migrací je obecná struktura, nikoli veřejný archiv rodinných výsledků. Soukromý import je třeba uschovat samostatně, protože se nepřenáší přes Git. Bez něj bude připravený záznam historie 2025 prázdný a nové losování 2026 se zablokuje.

~~~sh
npm run dev
~~~

Na Windows můžeš použít **START.bat**. `npm run preview` kontroluje pouze statický build, neobsluhuje API. Po změně `.env` vývojový server restartuj.

Bez správné konfigurace nebo migrace se veřejná stránka nepokusí hádat rok a nepředstírá úspěšné uložení. Zobrazí informaci, že se nepodařilo načíst dílnu.

## Ročníky a veřejný formulář

- V administraci vyber rok v **Prohlížet ročník**. Samotné prohlížení historie veřejný web nemění.
- **Založit nový ročník** vytvoří prázdný seznam a připraví otevřené registrace. Nepřenáší staré účastníky ani losování.
- Pro skutečné přepnutí webu napiš například **AKTIVOVAT 2027** a potvrď aktivaci.
- Veřejný web pak načítá nový rok ze serveru. Staré otevřené panely jej znovu ověří při návratu na stránku nebo nejpozději přibližně za minutu, pokud je panel viditelný.
- Požadavek rozpracovaný pro jiný rok se nepřesune automaticky do nového roku. Server jej odmítne. Opakování již úspěšně uloženého stejného požadavku vrátí původní potvrzení bez nového záznamu.
- Potvrzení a rozepsané volby v prohlížeči jsou oddělené podle roku. Starý formát z roku 2026 se čte pouze pro rok 2026; do 2027 nezasáhne. Telefon zůstává jen v paměti otevřené stránky.
- Uzavřený ročník zobrazuje zprávu **Santa už rozdal úkoly**, ne formulář pro nové přihlášky. Vlastní dříve uložené potvrzení lze stále vidět.
- Starší ročník lze znovu vybrat k prohlížení. Samotné vynulování času losování není podporovaný způsob založení nové akce.

## Totožnost účastníků

Přihláška a osoba jsou dvě různé věci. Přezdívky se mohou změnit a více lidí může sdílet telefon.

Každá přihláška dostane ročník a vlastní ID. Správce ji před novým losováním přiřadí ke stabilní osobě z tabulky `santa_people`. Shodné normalizované jméno je pouze nápověda. Připojení se musí potvrdit.

Jedna osoba nemůže mít dvě potvrzené přihlášky ve stejném roce. Nejdřív odstraň skutečnou duplicitu. Pokud jde opravdu o různé lidi se stejným jménem, založ pro ně různé osoby. Vedle jména je pro rozlišení krátká část jejich ID.

Totožnost lze upravovat před prvním novým losem nebo doplnit u původního losu zachovaného z říjnové verze. Po novém generovaném losování je přiřazení osob uzamčené. Stejně tak se nesmí měnit ročník, na který už navazuje pozdější losování.

## Losování, verze a archiv

1. Projdi účastníky a případné duplicity. Zkontroluj propojení všech osob.
2. Generátor zakáže stejné **směrované** přiřazení dárce → obdarovaný z aktuální verze předchozího kalendářního roku. Obrácený směr je jiné přiřazení. Pokud pro předchozí kalendářní rok není evidovaný los, tato historická omezení se neuplatní.
3. Každý nově generovaný výsledek tvoří jeden kruh přes všechny účastníky. Každý právě jednou dává a dostává, nikdo sobě a žádné reciproční dvojice. Minimum jsou 3 lidé.
4. Po kontrole napiš **LOSOVAT** a vytvoř verzi 1. První los uzavře přihlášky a odstranění účastníků.
5. Před rozesláním SMS můžeš vytvořit další verzi: potvrď, že SMS ještě nebyly odeslané, a napiš **PRELOSOVAT**. Předchozí výsledek se nemaže. Další los se musí alespoň v jednom přiřazení lišit od dosavadního výsledku; nemusí se změnit každý příjemce.
6. Výběrem verze si prohlédneš přesný archiv. Starší verze jsou pouze ke čtení. SMS se připravují jen pro aktuální verzi.
7. Před rozesláním napiš **UZAMKNOUT** a potvrď definitivní výsledek. Poté se další přelosování odmítne. Zámek sám o sobě nedokazuje odeslání ani doručení zpráv.
8. Pokud na ročník už navazuje losování následujícího roku, jeho historii nelze měnit ani přelosovat.

Server používá kryptografické náhodné promíchání, kontroly omezení a při obtížnější kombinaci náhodně řazené prohledávání možností. Pokud platný kruh neexistuje, vrátí chybu. Pokud narazí na bezpečnostní limit hledání, výslovně řekne, že nemožnost řešení nebyla prokázána. Pravidla se nikdy tiše neuvolňují.

Databáze znovu kontroluje kompletní seznam, totožnosti, historická omezení, verzi předchozího roku a aktuální revizi dat. Nová verze i všechna přiřazení se uloží společně v jedné transakci. Neúspěšný či souběžný zastaralý pokus nemění dosavadní los.

## Databázové tabulky

| Tabulka | Účel |
|---|---|
| `santa_settings` | Jeden řádek s aktivním veřejným rokem |
| `santa_event` | Jeden řádek na ročník, stav přihlášek, aktuální verze a revize dat |
| `santa_people` | Stabilní totožnosti napříč roky |
| `santa_participants` | Formuláře oddělené podle roku |
| `santa_draws` | Verze losování, zdroj, čas, použitá loňská verze a definitivní zámek |
| `santa_draw_entries` | Snapshot přesných přiřazení každé verze |
| `santa_legacy_assignments` | Původní tabulka zachovaná při migraci, pro API pouze ke čtení |
| `santa_rate_limits` | Sdílené limity požadavků |

Původní řádek `santa_event.id = 1` zůstane zachovaný jako rok 2026. Identifikátor řádku není rok: rozhodující je sloupec `year`. `drawn_at` obsahuje čas aktuálního losu; u ruční historie může být neznámý. Pro existenci losování je rozhodující `current_version`.

## Ochrana dat a limity

Tabulky mají zapnuté RLS a odebraná oprávnění pro `anon`, `authenticated` a `PUBLIC`. Také RPC funkce smí spouštět pouze serverová role. Prohlížeč dostává veřejně jen aktivní rok, stav přihlášek a po odeslání vlastní jméno s titulem. Výsledky, historie a telefony vyžadují administrátorské heslo.

Heslo je pouze v paměti otevřené administrace, neposílá se do cookies nebo browser storage. API odpovědi mají `Cache-Control: no-store`. Supabase klíč patří jen serveru; nikdy nepoužívej předponu `VITE_`.

Zůstávají limity na IP a 15minutové okno: 20 pokusů o platné odeslání, 10 chybných administrátorských hesel a 300 autorizovaných operací. Při společné Wi-Fi se veřejný limit sdílí. Tělo požadavku má nejvýše 8 KB. Formulář obsahuje jednoduché pole proti botům; CAPTCHA ani globální počet účastníků nejsou součástí této verze.

Jména, telefony a historie jsou osobní údaje v databázi organizátora. Soukromý historický import nepublikuj v otevřeném repozitáři. Historické SMS v archivu nejsou určeny k opětovnému rozesílání.

## Vercel

Do serverových Environment Variables nastav stejné čtyři proměnné z `.env.example`. Framework **Vite**, build **npm run build**, output **dist**, Node.js **22.x nebo novější**.

Preview připojuj k samostatnému testovacímu Supabase projektu. Stejné klíče v Preview by zapisovaly do stejné databáze jako produkce. SQL migrace nejsou při běžném Vercel deploymentu aplikovány automaticky.

Po schválení nasazení odešli commit a push do produkční větve. `vercel.json` obsluhuje `/admin`, bezpečnostní hlavičky a samostatnou serverovou funkci `/api/santa`. Tato implementace sama neprovádí commit, push, migraci produkce ani deployment.

## Záložky administrace

Výběr ročníku a přehled počtů jsou společné pro všechny záložky:

- **Účastníci 2026** (název se mění podle zvoleného roku): přihlášky, hledání, totožnosti a kontrola duplicit.
- **Pravidla a SMS**: úprava společných pravidel a zobrazení/kopírování zpráv aktuální verze. Z tohoto místa lze přejít k uzamčení výsledku.
- **Losování**: historie verzí, zobrazení dvojic, nové losování, přelosování a definitivní zámek.
- **Easter eggy**: zadání, obrázky, otázky, plánování a výsledky her.

Přepnutí záložky zachová rozepsaná pravidla, ale skryje odhalené SMS a výsledky. Přepnutí ročníku otevře Účastníky a vyčistí místní rozepsané formuláře. Z archivu se při přechodu na SMS načte aktuální verze; starší SMS se nenabízejí.

Záložky lze ovládat také šipkami vlevo/vpravo a klávesami Home/End. Na užším displeji se tlačítka zalomí. Tato změna vyžaduje pouze commit/push a deployment, bez dalšího SQL.

## Oprava opakujícího se seznamu v administraci

Seznam účastníků a box s pravidly mají odlišné React klíče podle sekce a roku. Obnovení dat ani potvrzení pravidel tak nevytváří další kopie seznamu. Při přepnutí roku se rozepsané úpravy stále oddělují.

Tato oprava vyžaduje jen commit/push a nový deployment, žádné další SQL nebo přelosování. Po dokončení deploymentu obnov administraci pomocí Ctrl+F5. Test opakovaných aktualizací je součástí npm test; používá jsdom a smyšlené API odpovědi.

## Úpravy textů a ověření

Dotazník a tituly: `shared/questionnaire.js` (`title`, `suffix`, funkce `elfTitle`). První vybraný výrok a načasování tvoří 27 kombinací. Změna textů nemění zpětně už uložené tituly.

~~~sh
npm test
npm run build
~~~

Testy používají skutečný PostgreSQL engine v paměti přes PGlite, všech sedm migrací a HTTP požadavky proti stejné API funkci. Testovací historie je smyšlená; soukromý import 2025 není potřeba pro běžné testy a neukládá se do Git. Podrobný rozsah a omezení ověření jsou v `VALIDATION.md`.

- [Vite na Vercelu](https://vercel.com/docs/frameworks/frontend/vite)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Oprávnění databázových funkcí](https://supabase.com/docs/guides/database/functions)
