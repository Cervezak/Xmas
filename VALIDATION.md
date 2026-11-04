# Ověření ročníků a verzí losování

Plná sada ověřena 2. 11. 2026, poslední cílená kontrola 4. 11. 2026 lokálně. Žádná živá databáze, její stávající losování ani hosting nebyly změněny.

- Plná sada 2. 11.: **43 prošlo, 0 selhalo**.
- Kontrola 4. 11.: všech 12 herních testů a produkční build prošly. Veřejné rozhraní ukazuje jen počet vyřešených her; podrobné počty pokusů a správných odpovědí nevydává ani veřejné API. Ověřeno u seznamu jmen, průběhu hry, odpovědi na pokus, obnovení stránky a archivu. Administrátorské API i tabulka výsledků nadále obsahují skutečné počty pokusů a nejlepší počet správných odpovědí.
- Dvanáct nových serverových a interakčních testů ověřuje hry: administrátorské oprávnění, zamezení úniku konceptů a budoucích obrázků, skryté řešení aktivní hry, český čas a přechody letního času, ochranu zastaralých úprav, uzamčení po prvním pokusu, nejlepší skóre bez opakovaného sčítání, souběžné opakované požadavky, trvalé správné odpovědi po obnovení a odmítnutí pozdních pokusů.
- Interakční herní testy používají skutečnou API funkci s dočasnou PostgreSQL databází a smyšlenými jmény. Ověřují výběr jména, chybný i správný pokus, obnovení stránky, přepnutí aktivní hry při návratu do okna, archiv s termíny a řešiteli a editor obrázkové hry od konceptu po zveřejnění. jsdom nedekóduje obrázky a nekreslí canvas, proto jsou v testu nahrazené tyto dvě browserové operace; ukládání výsledného obrázku a validace přes API jsou skutečné. Vizuální kvalita komprese není tímto ověřena.
- Rozšířený interakční test administrace ověřuje jediný viditelný panel, přepínání záložek kliknutím i klávesnicí, trvale dostupný výběr ročníku, zachování rozepsaných pravidel mezi záložkami, jejich oddělení při změně roku a skrytí tajných SMS i výsledků při odchodu. Ověřuje také přelosování, uzamčení a načtení aktuálních SMS při přechodu z archivu.
- Nový interakční test celé administrace přes React DOM a jsdom zopakoval chybu duplicitního seznamu účastníků před opravou a po opravě prošel. Kontroluje jeden seznam, jeden box pravidel a správný počet SMS při opakovaném načítání, ukládání a rušení pravidel, chybové odpovědi i přepínání roků. Test používá smyšlená data a nahrazené API; nepřipojuje se k produkci.
- Produkční build React/Vite: úspěšný.
- Testy spouštějí všechny čtyři SQL migrace v PostgreSQL enginu PGlite. HTTP požadavky používají stejnou API funkci jako produkce, s testovací databází a testovacími přihlašovacími údaji.
- Ověřeno ukládání pravidel podle ročníku, prázdná pravidla nového roku, původní oslovení a uložený titul dárce v SMS, víceřádková pravidla před rozloučením a jejich vynechání při prázdném textu.
- Ověřena oprávnění nové RPC, validace, zastaralé souběžné úpravy, zachování dvojic/verzí/zámku při změně pravidel i po uzamčení a stejné SMS po opětovném načtení. Šestý test vykreslení kontroluje bezpečné zobrazení pravidel bez interpretace HTML a nepřítomnost editoru u ruční historie.
- Ověřeno zachování původních formulářů a přiřazení jako 2026/verze 1, včetně původního času a funkčního opakování již uloženého požadavku.
- Ověřen přesný archiv starších verzí, přelosování s potvrzením neodeslaných SMS, nemožnost totožného nového výsledku a definitivní zámek před rozesláním.
- Ověřen zákaz opakování předchozího kalendářního roku. Generátor zachovává jeden kruh bez sebe-přiřazení nebo recipročních dvojic. Testuje i nemožné zadání a limit hledání bez tichého uvolnění pravidel.
- Ověřeny totožnosti osob napříč roky, blokace duplicitní osoby, ruční potvrzení bez automatického odhadování a zmrazení historie používané dalším rokem.
- Ověřeno vytvoření a explicitní aktivace 2027, oddělení nových přihlášek, odmítnutí zastaralého roku, idempotence napříč roky a uchování starých dat.
- Ověřena ochrana všech tabulek a RPC před rolemi anon/authenticated, neveřejnost historie a SMS, validace vstupů a sdílené databázové limity.
- Ověřeny souběžné požadavky o první losování, zastaralá revize/verze a obranná validace tvaru UUID polí v databázi. PGlite používá jeden engine; nejde o zátěžový test více produkčních spojení. Produkční serializaci zajišťuje společný řádkový zámek.
- Pět serverových testů vykreslení Reactu ověřuje nový formulář přes staré potvrzení 2026, uzavřený ročník, vlastní potvrzení, ovládání ročníků a pouze čtecí ruční historii. Nejde o vizuální či interakční test v prohlížeči.
- Soukromý skutečný import 2025 byl zvlášť ověřen v dočasné databázi: všech deset dodaných dvojic zůstalo přesně zachováno a následný testovací los deseti účastníků neměl žádné opakování. Tyto reálné dvojice nejsou v běžných testech nebo veřejném klientském kódu.
- Soukromý import je v ignorované složce supabase/private a předává se samostatně. Strukturální migrace neobsahuje skutečná rodinná přiřazení.

Vizuální kontrola v připojeném prohlížeči zůstává neověřená; lokální náhled v tomto prostředí při předchozích pokusech nebyl dostupný. Ověřené je sestavení, serverové vykreslení důležitých stavů i interakce administrace v jsdom, nikoli konkrétní obrazové rozložení.

Před ostrým provozem je třeba provést strukturální migraci, soukromý import a deployment podle README. Žádná migrace ani přelosování produkce se tímto lokálním ověřením neprovádí. U dříve rozeslaných SMS se nesmí potvrzovat, že ještě odeslané nebyly.
