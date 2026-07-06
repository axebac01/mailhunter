## Vad som faktiskt händer

Jobbet är kört (`status=running`, worker-heartbeat 12:46:42, `last_resolver_kick_at` uppdateras). Resolvern loggar 60–80 `Resolved …` per minut. **Men noll av jobbets företag uppdateras i DB** — kollade slumpmässiga rader från de senaste "Resolved"-loggarna, alla har fortfarande `domain=NULL, domain_status='unresolved'`, `updated_at` från 11:08.

## Root cause: UNIQUE-constraint på `companies.domain`

```
companies_domain_key UNIQUE (domain)
```

Resolvern hittar samma directory-domän för hundratals olika bolag i den här branschen:

| host | antal "Resolved"-loggar (60 min) |
|---|---|
| krafman.se | 457 |
| bytredovisning.se | 288 |
| redovisning.ai | 143 |
| boolag.se | 71 |
| 118100.se | 38 |

Första företaget får domänen. De **övriga 400+ per host** träffar en unique-collision i `UPDATE companies SET domain=…`. Felet slukas (ingen try/catch runt update:en), men success-loggen skrivs ändå → loggen ljuger. Företagen står kvar som `unresolved`, plockas upp av nästa våg, och samma sak händer igen. Det är därför counters inte rör sig.

## Fix

Tre delar i `supabase/functions/resolve-domains-batch/index.ts` — inga schemaändringar:

**1. Hantera unique-collision explicit i `resolveOne`** (kring rad 416–422)

```
const { error: updErr } = await supabase.from("companies").update({...}).eq("id", id);
if (updErr?.code === "23505") {
  // Domain redan tagen av annat bolag — matchen är sannolikt en directory-sajt.
  // Blockera hosten globalt så vi slipper prova den igen, markera företaget failed.
  await supabase.from("domain_blocklist").insert({ host: best.host }).select();
  await supabase.from("companies").update({
    domain_status: "no_domain_found", updated_at: new Date().toISOString(),
  }).eq("id", id);
  // Logga warn istället för success så det syns i loggen.
  if (jobId) await supabase.from("crawl_logs").insert({
    crawl_job_id: jobId, level: "warn",
    message: `Skipped "${name}" — ${best.host} already assigned to another company (added to blocklist).`,
    meta_json: { companyId: id, host: best.host, event: "domain_collision" },
  });
  return { id, status: "failed" };
}
```

**2. Efter varje våg, ta bort blocklistade hostar från kandidaterna framåt**

Läs in `blocklistGlobal` (redan gjort på rad 517–518) före varje våg istället för bara en gång per invocation, så nyligen tillagda directory-hostar hoppas över resten av körningen.

Alternativt enklare: efter en collision, pusha hosten till in-memory `blocklistGlobal` (`blocklistGlobal.add(best.host)`) så efterföljande `resolveOne`-anrop i samma invocation redan filtrerar bort den innan verifikation.

**3. Retroaktivt: rensa upp nuvarande jobb**

Kör en engångs-SQL (via migration eller `supabase--read_query` med `UPDATE` via edge — vi använder migration här):

- Skapa `domain_blocklist`-rader för `krafman.se`, `bytredovisning.se`, `redovisning.ai`, `boolag.se`, `118100.se`, `allabolag.se`, `hitta.se`, `eniro.se`, `merinfo.se`, `ratsit.se`, `birthday.se`, `bolagsfakta.se` — kända directory/aggregator-sajter.
- För jobbets 5369 `unresolved` företag som inte har någon egen `domain` men där resolvern har försökt (log-events): lämna orörda; nästa resolver-anrop får försöka igen utan directory-matcher.

## Vad som händer efter deployen

- Nästa resolver-våg försöker inte längre matcha mot directory-domäner (blocklist).
- När den ändå hittar en kollision, markeras företaget som `no_domain_found` istället för att fastna i loop.
- Counter av `unresolved` börjar sjunka på riktigt. Scrapern får domäner att jobba på och `contacts_found` / `people_found` börjar öka.

## Filer som ändras

- `supabase/functions/resolve-domains-batch/index.ts` — collision-handling + in-memory blocklist-update efter collision.
- En ny migration som seedar `domain_blocklist` med de kända directory-hostarna listade ovan.

Ingen UI-ändring.
