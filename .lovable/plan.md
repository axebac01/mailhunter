

## Goal

Dramatically increase the number of **person emails** (and the people behind them) extracted per company by going beyond the current "map → scrape 6 pages → regex emails" pipeline. Today the scraper:

- Picks at most ~6 pages and never visits team/staff sub-pages, blog author pages, or PDFs.
- Misses obfuscated emails (`name [at] company [dot] se`, `&#64;`, JS-rendered, image-only).
- Never deduces emails from names + corporate pattern (e.g., `firstname.lastname@`).
- Never links a found email to a person record (so `contact_people` stays sparse and we never learn `firstname.lastname@domain` patterns).
- Concurrency is just 3, so large jobs feel slow and we under-use Firecrawl.

## Approach

### 1. Smarter page discovery (per company)

In `scrape-emails/index.ts`, replace `pickContactPages` with a 3-tier discovery:

1. **Mapped links** with broader keyword set: `contact|kontakt|kontakta|about|om-oss|impressum|team|people|staff|medarbetare|personal|ledning|management|board|styrelse|advisors|leadership|press|media|imprint|legal`.
2. **Always-include canonical guesses**: `/`, `/contact`, `/kontakt`, `/about`, `/om-oss`, `/team`, `/medarbetare`, `/impressum` — try them even if `map` didn't return them (HEAD-check; cheap).
3. **Sub-team pages**: after scraping a team page, follow up to 8 more in-domain links from it that look like person profiles (`/team/`, `/people/`, `/medarbetare/`, names with hyphens). One extra hop only.

Bump per-company page budget from 6 → up to 15 (still bounded). Use `Promise.all` for the page scrapes to cut wall time.

### 2. De-obfuscation before regex

Before running `EMAIL_RE`, normalize the blob:

- HTML entity decode (`&#64;`, `&#46;`, `&commat;`).
- Replace ` [at] `, ` (at) `, ` {at} `, ` AT `, ` snabel-a ` → `@` (and same for dot variants).
- Strip Cloudflare email-protection tokens by scanning for `data-cfemail="..."` and decoding (XOR with first byte).
- Pull `mailto:` hrefs explicitly from raw HTML — many sites only expose the address via `mailto:`.

Add a Firecrawl scrape variant: when a page has fewer than 1 email after normalization but contains the word "email"/"e-post"/"kontakt", re-scrape with `formats: ["markdown","html","links"], onlyMainContent: false, waitFor: 1500` to capture JS-rendered addresses.

### 3. Person extraction + email association

When scraping a team/about page, run a lightweight extractor:

- Use Firecrawl's structured `formats: [{ type: "json", prompt: "..." }]` on team/about pages to pull `[{ full_name, role_title, department, email }]`. One LLM-backed call per team page is cheap and dramatically improves recall on image-heavy sites where regex fails.
- Insert each into `contact_people` (gated by `include_contact_person_names`). When `email` is present and ends in the company root domain, also insert a `person_email` row in `contacts` linking to that person.

### 4. Pattern-based email synthesis (gated)

After a company is scraped, if we have ≥ 1 verified `firstname.lastname@root-domain` example AND additional `contact_people` without emails, synthesize candidates using the same pattern (`firstname.lastname`, `f.lastname`, `firstname`) and store them with a new `is_publicly_listed = false` flag (column already exists). Never synthesize without ≥ 1 confirmed example for that domain — avoids spam-grade guesses.

Also detect MX provider (`google` vs `microsoft` vs other) via a one-shot DNS-over-HTTPS lookup to Cloudflare (`https://cloudflare-dns.com/dns-query?name=<domain>&type=MX`) and log it on the company — useful future signal, no behavior change yet.

### 5. Stricter generic vs person classification

Current `isPersonEmail` already handles `sales.uk@` → generic. Add:

- Treat `firstname` only (no separator, no digits) as **person** only if it matches a known first name list (top 200 Nordic + EN names bundled inline) — otherwise downgrade to generic. Stops `team@`, `office@` look-alikes when local part happens to be a real word.
- Recognise `firstname.lastname` and `f.lastname` as high-confidence person.
- Tag each contact row's classification confidence into `crawl_logs` `meta_json` for later debugging.

### 6. Throughput & resilience

In `scrape-emails-batch/index.ts`:

- Bump `CONCURRENCY` 3 → 6 (Firecrawl tolerates this; per-company we already parallelize page scrapes).
- Add a per-company hard timeout (45 s) using `AbortController` so one slow site can't block a worker.
- After every 10 companies (instead of every 2), call `refreshCounters()` — fewer redundant queries; UI already gets realtime updates from the previous improvement.
- Log a structured per-company summary into `crawl_logs.meta_json`: `{ pages, emails_found, person_emails, people_extracted, synthesized }`.

### 7. UI: show progress for emails specifically

Tiny addition on `JobDetail.tsx`: in the existing KPI strip add a "Person emails" KPI (count of `contacts` rows where `contact_type = 'person_email'` for this job). Helps users see this improvement land.

## Files to change

- `supabase/functions/scrape-emails/index.ts` — broader page discovery, de-obfuscation, JSON-mode person extraction, pattern synthesis, MX lookup, confidence logging
- `supabase/functions/scrape-emails-batch/index.ts` — concurrency 3→6, per-company timeout, structured per-company summary log
- `src/pages/JobDetail.tsx` — add "Person emails" KPI tile

No DB migration required (`is_publicly_listed`, `meta_json`, `contact_people` already exist).

## Success criteria

- On the current Behandlingshem job, total `contact_people` rows and `contacts` rows where `contact_type = 'person_email'` increase by **3–5×** vs. today (target measured after re-running on the resolved companies).
- Each company that has a public team page yields ≥ 1 person record with role + (when available) email.
- No regression in scrape latency p50; p95 capped at 45 s/company by the timeout.
- Synthesized emails are clearly distinguishable (`is_publicly_listed = false`) and never created without a confirmed pattern example.

