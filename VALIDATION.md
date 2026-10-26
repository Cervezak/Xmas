# Ověření projektu

Ověřováno 26. 10. 2026 lokálně, bez nasazení a bez přístupu ke skutečnému Supabase projektu.

- Produkční build React/Vite: úspěšný.
- Automatické testy: **8 prošlo, 0 selhalo**. Pokrývají validaci vstupů, 600 náhodných losování, databázová oprávnění pro anon/authenticated, HTTP autentizaci a chybné požadavky, idempotentní zápis, duplicity a odstranění, zastaralý seznam, atomické uložení kruhu a uzavření přihlášek, generování soukromých SMS, databázové limity, souběžné pokusy o losování a HTTP 429.
- SQL migrace se spouští ve skutečném PostgreSQL enginu PGlite, ve stejném znění jako pro Supabase. Testy nesimulují odpovědi databázových funkcí.
- Test souběhu ověřuje dva souběžné požadavky v jednom PGlite enginu; není to zátěžový test více produkčních databázových spojení. Produkční serializaci zajišťuje společný řádkový zámek v PostgreSQL.
- Audit produkčních závislostí: bez zjištěných zranitelností v okamžiku kontroly.
- Ověřena přítomnost všech požadovaných souborů, zachování původního `.gitattributes` a nepřítomnost serverových proměnných v klientském buildu. Původní Git historie se neměnila; změny nejsou commitnuté.
- Vizuální kontrola v prohlížeči zůstává neověřená: dostupné prohlížeče nedosáhly na spuštěné lokální servery a hlásily timeout. CSS obsahuje rozložení pro desktop, tablet i mobil; samotná vizuální správnost tím ale není potvrzena.
- Připojení k živému Supabase, nasazení Vercel, chování systémového odkazu SMS a skutečné doručení SMS se netestovalo. Vyžaduje vlastní konfiguraci a případné schválení nasazení.

Opakování kontrol: `npm test`, `npm run build`. Vzhled lze otevřít dvojklikem na `START.bat`; doplnění `.env` je nutné pro skutečné ukládání.
