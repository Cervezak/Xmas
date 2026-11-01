# Ověření ročníků a verzí losování

Ověřováno 1. 11. 2026 lokálně. Žádná živá databáze, její stávající losování ani hosting nebyly změněny.

- Automatické testy: **25 prošlo, 0 selhalo**.
- Produkční build React/Vite: úspěšný.
- Testy spouštějí obě SQL migrace v PostgreSQL enginu PGlite. HTTP požadavky používají stejnou API funkci jako produkce, s testovací databází a testovacími přihlašovacími údaji.
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

Vizuální kontrola v připojeném prohlížeči zůstává neověřená; lokální náhled v tomto prostředí při předchozích pokusech nebyl dostupný. Ověřené je sestavení a serverové vykreslení důležitých stavů, nikoli konkrétní obrazové rozložení.

Před ostrým provozem je třeba provést strukturální migraci, soukromý import a deployment podle README. Žádná migrace ani přelosování produkce se tímto lokálním ověřením neprovádí. U dříve rozeslaných SMS se nesmí potvrzovat, že ještě odeslané nebyly.
