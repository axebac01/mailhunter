# Skrapning som fortsätter utan att fliken är öppen

## Läget idag

Själva skrapningen körs redan på servern: när ett jobb startar anropas bakgrundsarbetaren, som betar av en våg företag och sedan kallar på sig själv igen. Så länge den kedjan lever fortsätter jobbet även med stängd webbläsare.

Problemet är att kedjan kan brytas — arbetaren kraschar, tiden tar slut mitt i en våg, eller Firecrawl svarar med fel. Idag finns ingen som startar om den. Det enda som räddar jobbet är att du har appen öppen: webbsidan pollar var fjärde sekund och knuffar igång arbetaren igen. Är fliken stängd står jobbet stilla tills du går in igen.

## Vad som byggs

En vakthund på servern som var minut tittar efter jobb med status "körs" som inte gjort något på ett tag, och startar om dem automatiskt.

1. **Schemalagd körning varje minut** i backend (databasens egen schemaläggare) som anropar en ny funktion `job-watchdog`.
2. **`job-watchdog`** hämtar alla jobb med status `running` och kollar hjärtslaget som arbetaren redan skriver i jobbets metadata:
   - Hjärtslag färskare än ~3 min → rör inte jobbet.
   - Hjärtslag äldre än ~3 min eller saknas → logga "vakthund startade om arbetaren" och anropa `scrape-emails-batch` för jobbet (och `resolve-domains-batch` om företag fortfarande saknar domän).
   - Jobb som pausats av dig eller pausats på grund av slut på Firecrawl-credits rörs aldrig.
   - Skydd mot loop: max ett antal omstarter per jobb och timme, annars pausas jobbet med tydlig orsak i loggen.
3. **Firecrawl-credits**: om arbetaren får slut-på-credits-svar sätts jobbet till pausat med orsak i stället för att tyst mala vidare — då vet vakthunden att låta det vara och du ser varför i jobbvyn.
4. **Webbläsarens pollning blir kosmetisk**: den får fortsätta uppdatera siffrorna på skärmen, men den är inte längre det som håller jobbet vid liv.

## Teknisk detalj

- Ny edge-funktion `supabase/functions/job-watchdog/index.ts`, servicerollsdriven, ingen JWT-verifiering (kallas bara av schemaläggaren).
- Migration som aktiverar `pg_cron` + `pg_net` och lägger ett jobb varje minut som postar till funktionen.
- Använder befintliga fält `meta_json.worker_id` / `worker_heartbeat` som `scrape-emails-batch` redan skriver, samt befintlig singleton-spärr så att två arbetare aldrig kör samtidigt.
- Loggar varje omstart till `crawl_logs` så att du kan se i jobbvyn att vakthunden gick in.
