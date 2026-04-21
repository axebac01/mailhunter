// Batch domain resolution — world-class edition.
// Sources candidates from Firecrawl /search, slug-based homepage probes (HEAD),
// and Firecrawl /map fallback. Verifies via title/h1/meta/markdown checks.
// LLM tiebreaker (Lovable AI) for ambiguous cases. Honors per-company blocklist.
// Inputs: { companyIds[] } | { importId } | { jobId, retryFailed?, reresolveAll? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const CONCURRENCY = 12;
const PER_COMPANY_TIMEOUT_MS = 30_000;

const BLOCKED_HOSTS = new Set([
  "linkedin.com","facebook.com","instagram.com","twitter.com","x.com","youtube.com",
  "wikipedia.org","wikidata.org","crunchbase.com","glassdoor.com","indeed.com",
  "bloomberg.com","reuters.com","yelp.com","tripadvisor.com","trustpilot.com",
  "amazon.com","ebay.com","apple.com","play.google.com","github.com","medium.com",
  "pitchbook.com","zoominfo.com","rocketreach.co","apollo.io","owler.com",
  "dnb.com","companieshouse.gov.uk","allabolag.se","proff.se","bizzdb.com",
  "yellowpages.com","gulesider.no","krak.dk","fonecta.fi","hitta.se","eniro.se",
  "merinfo.se","ratsit.se","largestcompanies.com","largestcompanies.se","bolagsfakta.se",
]);

const COUNTRY_TLDS: Record<string, string[]> = {
  sweden: ["se"], sverige: ["se"], se: ["se"], "🇸🇪": ["se"],
  norway: ["no"], norge: ["no"], no: ["no"], "🇳🇴": ["no"],
  denmark: ["dk"], danmark: ["dk"], dk: ["dk"], "🇩🇰": ["dk"],
  finland: ["fi"], suomi: ["fi"], fi: ["fi"], "🇫🇮": ["fi"],
  germany: ["de"], deutschland: ["de"], de: ["de"], "🇩🇪": ["de"],
  france: ["fr"], fr: ["fr"], "🇫🇷": ["fr"],
  netherlands: ["nl"], nederland: ["nl"], nl: ["nl"], "🇳🇱": ["nl"],
  uk: ["co.uk","uk"], "united kingdom": ["co.uk","uk"], britain: ["co.uk","uk"], gb: ["co.uk","uk"],
  ireland: ["ie"], ie: ["ie"],
  spain: ["es"], españa: ["es"], es: ["es"],
  italy: ["it"], italia: ["it"], it: ["it"],
};

const COUNTRY_HINTS: Record<string, { country: string; lang: string; contactWord: string; siteWord: string; canonical: string }> = {
  sweden:  { country: "se", lang: "sv", contactWord: "kontakt",   siteWord: "hemsida", canonical: "sweden" },
  sverige: { country: "se", lang: "sv", contactWord: "kontakt",   siteWord: "hemsida", canonical: "sweden" },
  se:      { country: "se", lang: "sv", contactWord: "kontakt",   siteWord: "hemsida", canonical: "sweden" },
  norway:  { country: "no", lang: "no", contactWord: "kontakt",   siteWord: "nettside", canonical: "norway" },
  norge:   { country: "no", lang: "no", contactWord: "kontakt",   siteWord: "nettside", canonical: "norway" },
  no:      { country: "no", lang: "no", contactWord: "kontakt",   siteWord: "nettside", canonical: "norway" },
  denmark: { country: "dk", lang: "da", contactWord: "kontakt",   siteWord: "hjemmeside", canonical: "denmark" },
  danmark: { country: "dk", lang: "da", contactWord: "kontakt",   siteWord: "hjemmeside", canonical: "denmark" },
  dk:      { country: "dk", lang: "da", contactWord: "kontakt",   siteWord: "hjemmeside", canonical: "denmark" },
  finland: { country: "fi", lang: "fi", contactWord: "yhteystiedot", siteWord: "kotisivu", canonical: "finland" },
  suomi:   { country: "fi", lang: "fi", contactWord: "yhteystiedot", siteWord: "kotisivu", canonical: "finland" },
  fi:      { country: "fi", lang: "fi", contactWord: "yhteystiedot", siteWord: "kotisivu", canonical: "finland" },
  germany: { country: "de", lang: "de", contactWord: "kontakt",   siteWord: "webseite", canonical: "germany" },
  deutschland: { country: "de", lang: "de", contactWord: "kontakt", siteWord: "webseite", canonical: "germany" },
  de:      { country: "de", lang: "de", contactWord: "kontakt",   siteWord: "webseite", canonical: "germany" },
  france:  { country: "fr", lang: "fr", contactWord: "contact",   siteWord: "site", canonical: "france" },
  fr:      { country: "fr", lang: "fr", contactWord: "contact",   siteWord: "site", canonical: "france" },
  netherlands: { country: "nl", lang: "nl", contactWord: "contact", siteWord: "website", canonical: "netherlands" },
  nederland: { country: "nl", lang: "nl", contactWord: "contact", siteWord: "website", canonical: "netherlands" },
  nl:      { country: "nl", lang: "nl", contactWord: "contact", siteWord: "website", canonical: "netherlands" },
  uk: { country: "gb", lang: "en", contactWord: "contact", siteWord: "website", canonical: "uk" },
  "united kingdom": { country: "gb", lang: "en", contactWord: "contact", siteWord: "website", canonical: "uk" },
  britain: { country: "gb", lang: "en", contactWord: "contact", siteWord: "website", canonical: "uk" },
  gb: { country: "gb", lang: "en", contactWord: "contact", siteWord: "website", canonical: "uk" },
  ireland: { country: "ie", lang: "en", contactWord: "contact", siteWord: "website", canonical: "ireland" },
  ie: { country: "ie", lang: "en", contactWord: "contact", siteWord: "website", canonical: "ireland" },
  spain:   { country: "es", lang: "es", contactWord: "contacto", siteWord: "sitio web", canonical: "spain" },
  españa:  { country: "es", lang: "es", contactWord: "contacto", siteWord: "sitio web", canonical: "spain" },
  es:      { country: "es", lang: "es", contactWord: "contacto", siteWord: "sitio web", canonical: "spain" },
  italy:   { country: "it", lang: "it", contactWord: "contatti", siteWord: "sito web", canonical: "italy" },
  italia:  { country: "it", lang: "it", contactWord: "contatti", siteWord: "sito web", canonical: "italy" },
  it:      { country: "it", lang: "it", contactWord: "contatti", siteWord: "sito web", canonical: "italy" },
};

function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = String(raw).toLowerCase().trim();
  return COUNTRY_HINTS[k]?.canonical ?? raw;
}

const LEGAL_SUFFIXES_RE = /\b(ab|aktiebolag|oy|oyj|gmbh|mbh|ltd|limited|inc|incorporated|llc|l\.l\.c|sa|s\.a|spa|s\.p\.a|plc|bv|b\.v|as|a\/s|aps|a\.p\.s|sarl|s\.a\.r\.l|kg|ag|nv|n\.v|holding|holdings|group|the|co|corp|corporation|company)\b\.?/gi;

function foldAscii(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function cleanCompanyName(raw: string): string {
  return raw.replace(/[,/&|]+/g, " ").replace(LEGAL_SUFFIXES_RE, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string): string[] {
  return foldAscii(s.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 &&
      !["the","and","group","ltd","inc","llc","oyj","gmbh","sarl","spa","plc","corp","company","holding","holdings"].includes(w));
}
function hostFromUrl(u: string): string | null {
  try { const url = new URL(u.startsWith("http") ? u : `https://${u}`); return url.hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return null; }
}
function isBlocked(host: string): boolean {
  for (const b of BLOCKED_HOSTS) if (host === b || host.endsWith("." + b)) return true;
  return false;
}
function tldOf(host: string): string {
  const parts = host.split(".");
  if (parts.length >= 3 && ["co","com"].includes(parts[parts.length - 2])) {
    return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1];
}
function hostStem(host: string): string {
  const tld = tldOf(host);
  return host.slice(0, host.length - tld.length - 1);
}
function scoreCandidate(host: string, nameTokens: string[], country?: string | null): number {
  if (isBlocked(host)) return -1;
  const stripped = hostStem(host);
  let score = 0;
  for (const t of nameTokens) {
    if (stripped === t) score += 4;
    else if (stripped.includes(t)) score += 2;
    else if (host.includes(t)) score += 1;
  }
  if (host.split(".").length <= 2) score += 1;
  if (country) {
    const expected = COUNTRY_TLDS[country.toLowerCase().trim()];
    if (expected && expected.includes(tldOf(host))) score += 2;
  }
  return score;
}

function buildSlug(cleanName: string): { slug: string; hyphenated: string; acronym: string } {
  const ascii = foldAscii(cleanName.toLowerCase()).replace(/[^a-z0-9\s-]/g, "");
  const words = ascii.split(/\s+/).filter(Boolean);
  return {
    slug: words.join(""),
    hyphenated: words.join("-"),
    acronym: words.length >= 3 ? words.map((w) => w[0]).join("") : "",
  };
}

async function searchFirecrawl(query: string, apiKey: string, hints?: { country?: string; lang?: string }): Promise<any[]> {
  const body: Record<string, unknown> = { query, limit: 10 };
  if (hints?.country) body.country = hints.country;
  if (hints?.lang) body.lang = hints.lang;
  const res = await fetch(`${FIRECRAWL_V2}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 402) throw new Error("FIRECRAWL_PAYMENT_REQUIRED");
    return [];
  }
  return Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.web) ? json.data.web : [];
}

async function mapFirecrawl(host: string, apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(`${FIRECRAWL_V2}/map`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://${host}`, limit: 50 }),
    });
    if (!res.ok) return [];
    const j = await res.json().catch(() => ({}));
    const links: string[] = Array.isArray(j?.links) ? j.links : Array.isArray(j?.data?.links) ? j.data.links : [];
    return links;
  } catch { return []; }
}

async function headProbe(host: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    let res = await fetch(`https://${host}`, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    // Some sites reject HEAD; fall back to GET range
    if (!res.ok || res.status >= 400) {
      res = await fetch(`https://${host}`, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { Range: "bytes=0-0" } });
    }
    return res.ok || (res.status >= 200 && res.status < 400);
  } catch { return false; }
  finally { clearTimeout(timer); }
}

async function verifyHomepage(host: string, nameTokens: string[], apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://${host}`, formats: ["html","markdown"], onlyMainContent: false }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    const html: string = String(j?.html ?? j?.data?.html ?? "").toLowerCase();
    const md: string = String(j?.markdown ?? j?.data?.markdown ?? "").toLowerCase();
    if (!html && !md) return false;
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
    const ogMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/);
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const haystack = foldAscii(`${titleMatch?.[1] ?? ""} ${ogMatch?.[1] ?? ""} ${descMatch?.[1] ?? ""} ${h1Match?.[1] ?? ""} ${md}`.toLowerCase());
    return nameTokens.some((t) => haystack.includes(t));
  } catch { return false; }
}

type Cand = { host: string; url: string; score: number; title?: string; snippet?: string; source: "search"|"slug"|"map" };

function rankFromResults(results: any[], nameTokens: string[], country?: string | null, blocklist?: Set<string>): Cand[] {
  const seen = new Map<string, Cand>();
  for (const r of results) {
    const url = r.url ?? r.link;
    const host = url ? hostFromUrl(url) : null;
    if (!host) continue;
    if (blocklist?.has(host)) continue;
    const score = scoreCandidate(host, nameTokens, country);
    if (score < 0) continue;
    const prev = seen.get(host);
    if (!prev || score > prev.score) seen.set(host, { host, url, score, title: r.title, snippet: r.description ?? r.snippet, source: "search" });
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score);
}

async function llmTiebreaker(name: string, country: string | null, candidates: Cand[]): Promise<string | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  try {
    const list = candidates.slice(0, 5).map((c, i) => `${i + 1}. ${c.host}${c.title ? ` — ${c.title}` : ""}${c.snippet ? ` — ${c.snippet.slice(0, 120)}` : ""}`).join("\n");
    const prompt = `Company: ${name}${country ? ` (country: ${country})` : ""}
Pick the most likely OFFICIAL company homepage from the list. Reply with ONLY the host (e.g. "example.se") or "none".

${list}`;
    const res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = String(j?.choices?.[0]?.message?.content ?? "").trim().toLowerCase().replace(/^["']|["']$/g, "");
    if (!text || text === "none") return null;
    const host = text.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    return candidates.find((c) => c.host === host)?.host ?? null;
  } catch { return null; }
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function resolveOne(
  company: { id: string; name: string; country: string | null },
  jobCountry: string | null,
  apiKey: string,
  supabase: any,
  jobId?: string,
  blocklistGlobal?: Set<string>,
): Promise<{ id: string; status: "resolved" | "failed"; domain?: string; queryUsed?: string; source?: string }> {
  const { id, name } = company;
  const rawCountry = company.country ?? jobCountry ?? null;
  const country = normalizeCountry(rawCountry);

  if (!company.country && jobCountry) {
    await supabase.from("companies").update({ country: jobCountry }).eq("id", id);
  }

  // Per-company blocklist
  const { data: bl } = await supabase.from("domain_blocklist").select("host").eq("company_id", id);
  const blocklist = new Set<string>([...(blocklistGlobal ?? []), ...((bl ?? []).map((r: any) => r.host))]);

  const cleanName = cleanCompanyName(name) || name;
  const cleanAscii = foldAscii(cleanName);
  const nameTokens = Array.from(new Set([...tokens(name), ...tokens(cleanName), ...tokens(cleanAscii)]));
  const hints = country ? COUNTRY_HINTS[country.toLowerCase().trim()] : undefined;
  const fcHints = hints ? { country: hints.country, lang: hints.lang } : undefined;
  const tlds = country ? (COUNTRY_TLDS[country.toLowerCase().trim()] ?? []) : [];
  const primaryTld = tlds[0];

  // 1) Search queries
  const queries: string[] = [];
  if (country) {
    queries.push(`"${cleanName}" ${country} ${hints?.contactWord ?? "contact"}`);
    queries.push(`${cleanName} ${country}`);
    if (primaryTld) queries.push(`site:.${primaryTld} "${cleanName}"`);
  } else {
    queries.push(`"${cleanName}" official website`);
  }
  if (cleanAscii.toLowerCase() !== cleanName.toLowerCase()) {
    queries.push(`"${cleanAscii}" ${country ?? ""}`.trim());
  }
  queries.push(`${cleanName} ${hints?.siteWord ?? "website"}`);

  let bestSearch: Cand | undefined;
  let bestQuery = "";
  const triedQueries: string[] = [];
  let lastRanked: Cand[] = [];

  for (const q of queries) {
    triedQueries.push(q);
    let results: any[] = [];
    try { results = await searchFirecrawl(q, apiKey, fcHints); }
    catch (e: any) { if (e?.message === "FIRECRAWL_PAYMENT_REQUIRED") throw e; }
    const ranked = rankFromResults(results, nameTokens, country, blocklist);
    if (ranked.length) lastRanked = ranked;
    const top = ranked[0];
    if (top && (!bestSearch || top.score > bestSearch.score)) {
      bestSearch = top;
      bestQuery = q;
    }
    if (bestSearch && bestSearch.score >= 5) break;
  }

  // 2) Slug-based homepage probes (in parallel)
  const slugCandidates: Cand[] = [];
  const { slug, hyphenated, acronym } = buildSlug(cleanName);
  const tldsToTry = Array.from(new Set([...tlds, "com"]));
  const hostGuesses: string[] = [];
  for (const tld of tldsToTry) {
    if (slug && slug.length >= 3) hostGuesses.push(`${slug}.${tld}`);
    if (hyphenated && hyphenated !== slug) hostGuesses.push(`${hyphenated}.${tld}`);
    if (acronym && acronym.length >= 3) hostGuesses.push(`${acronym}.${tld}`);
  }
  const uniqGuesses = Array.from(new Set(hostGuesses)).filter((h) => !blocklist.has(h) && !isBlocked(h)).slice(0, 8);
  const probeResults = await Promise.all(uniqGuesses.map(async (h) => ({ host: h, ok: await headProbe(h) })));
  for (const { host, ok } of probeResults) {
    if (!ok) continue;
    const score = scoreCandidate(host, nameTokens, country);
    if (score < 0) continue;
    slugCandidates.push({ host, url: `https://${host}`, score, source: "slug" });
  }

  // Merge candidates (search + slug)
  const merged = new Map<string, Cand>();
  for (const c of [...(lastRanked), ...slugCandidates]) {
    const prev = merged.get(c.host);
    if (!prev || c.score > prev.score) merged.set(c.host, c);
  }
  let allRanked = Array.from(merged.values()).sort((a, b) => b.score - a.score);
  let best: Cand | undefined = allRanked[0];

  // 3) Map fallback for borderline top search results
  if (best && best.source === "search" && best.score >= 3 && best.score <= 4) {
    const mapped = await mapFirecrawl(best.host, apiKey);
    for (const u of mapped.slice(0, 10)) {
      const h = hostFromUrl(u);
      if (!h || blocklist.has(h)) continue;
      const score = scoreCandidate(h, nameTokens, country);
      if (score > (merged.get(h)?.score ?? -1)) {
        merged.set(h, { host: h, url: u, score, source: "map" });
      }
    }
    allRanked = Array.from(merged.values()).sort((a, b) => b.score - a.score);
    best = allRanked[0];
  }

  // 4) Verification — accept slug-probed exact-stem auto. Otherwise verify borderline.
  let finalSource = best?.source ?? "search";
  if (best) {
    const stem = hostStem(best.host);
    const exactStem = nameTokens.some((t) => stem === t);
    const isCountrySlug = best.source === "slug" && primaryTld && tldOf(best.host) === primaryTld && exactStem;
    if (!exactStem && !isCountrySlug && best.score < 4) {
      const ok = await verifyHomepage(best.host, nameTokens, apiKey);
      if (!ok && best.score < 2) best = undefined;
    }
  }

  // 5) LLM tiebreaker — top two within 1 point, leader < 5
  if (best && best.score < 5 && allRanked.length >= 2 && (allRanked[0].score - allRanked[1].score) <= 1) {
    const pick = await llmTiebreaker(name, country, allRanked.slice(0, 5));
    if (pick) {
      const found = allRanked.find((c) => c.host === pick);
      if (found) { best = found; finalSource = "llm"; }
    }
  }

  if (best) {
    await supabase.from("companies").update({
      domain: best.host,
      website: `https://${best.host}`,
      source_url: best.url,
      domain_status: "resolved",
    }).eq("id", id);
    if (jobId) {
      await supabase.from("crawl_logs").insert({
        crawl_job_id: jobId,
        level: "success",
        message: `Resolved "${name}" → ${best.host} (${finalSource}, score ${best.score})`,
        meta_json: {
          companyId: id, country, source: finalSource, score: best.score,
          query: bestQuery, queriesTried: triedQueries,
          candidatesTop3: allRanked.slice(0, 3).map((c) => ({ host: c.host, score: c.score, source: c.source })),
        },
      });
    }
    return { id, status: "resolved", domain: best.host, queryUsed: bestQuery, source: finalSource };
  }

  await supabase.from("companies").update({ domain_status: "failed" }).eq("id", id);
  if (jobId) {
    await supabase.from("crawl_logs").insert({
      crawl_job_id: jobId,
      level: "warn",
      message: `No domain for "${name}" — tried ${triedQueries.length} quer${triedQueries.length === 1 ? "y" : "ies"}, ${slugCandidates.length} slug probes.`,
      meta_json: {
        companyId: id, country,
        queriesTried: triedQueries,
        candidatesTop3: allRanked.slice(0, 3).map((c) => ({ host: c.host, score: c.score, source: c.source })),
      },
    });
  }
  return { id, status: "failed" };
}

async function runPool<T, R>(items: T[], worker: (i: T) => Promise<R>, n: number): Promise<R[]> {
  const out: R[] = []; let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const my = idx++;
      try { out[my] = await worker(items[my]); }
      catch (e) { out[my] = e as any; }
    }
  });
  await Promise.all(runners);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    const { companyIds, importId, jobId, retryFailed, reresolveAll } = body ?? {};

    let ids: string[] = Array.isArray(companyIds) ? companyIds : [];
    if (importId) {
      const { data: rows } = await supabase.from("import_rows")
        .select("matched_company_id").eq("import_id", importId).not("matched_company_id", "is", null);
      ids = ids.concat((rows ?? []).map((r: any) => r.matched_company_id));
    }
    if (jobId) {
      const { data: imps } = await supabase.from("imports").select("id").eq("crawl_job_id", jobId);
      const impIds = (imps ?? []).map((i: any) => i.id);
      if (impIds.length) {
        const { data: rows } = await supabase.from("import_rows")
          .select("matched_company_id").in("import_id", impIds).not("matched_company_id", "is", null);
        ids = ids.concat((rows ?? []).map((r: any) => r.matched_company_id));
      }
      // Also include companies created directly by this job
      const { data: byJob } = await supabase.from("companies").select("id").eq("created_by_job_id", jobId);
      ids = ids.concat((byJob ?? []).map((c: any) => c.id));
    }
    ids = Array.from(new Set(ids.filter(Boolean)));

    if (ids.length === 0) {
      return new Response(JSON.stringify({ resolved: 0, failed: 0, total: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let jobCountry: string | null = null;
    if (jobId) {
      const { data: jr } = await supabase.from("crawl_jobs").select("country").eq("id", jobId).maybeSingle();
      jobCountry = jr?.country ?? null;
      // Backfill country for all matched companies of this job missing one
      if (jobCountry) {
        await supabase.from("companies").update({ country: jobCountry }).in("id", ids).is("country", null);
      }
    }

    // Global blocklist
    const { data: globalBl } = await supabase.from("domain_blocklist").select("host").is("company_id", null);
    const blocklistGlobal = new Set<string>((globalBl ?? []).map((r: any) => r.host));

    // Chunked fetch
    const CHUNK = 100;
    const allCompanies: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data: chunk, error } = await supabase.from("companies")
        .select("id, name, country, domain, domain_status").in("id", slice);
      if (error) {
        if (jobId) await supabase.from("crawl_logs").insert({
          crawl_job_id: jobId, level: "error",
          message: `Failed to load companies chunk ${i}-${i + slice.length}: ${error.message}`,
        });
        continue;
      }
      if (chunk) allCompanies.push(...chunk);
    }

    // Selection mode
    const todo = reresolveAll
      ? allCompanies
      : retryFailed
      ? allCompanies.filter((c: any) => !c.domain && c.domain_status === "failed")
      : allCompanies.filter((c: any) => !c.domain);

    if (jobId) await supabase.from("crawl_logs").insert({
      crawl_job_id: jobId, level: "info",
      message: `${reresolveAll ? "Re-resolving ALL" : retryFailed ? "Retrying failed" : "Resolving"} domains for ${todo.length} companies (concurrency ${CONCURRENCY}${jobCountry ? `, country: ${jobCountry}` : ""})…`,
    });

    let resolved = 0, failed = 0, paymentErr = false;
    const results = await runPool(todo, async (c: any) => {
      try {
        return await withTimeout(
          resolveOne(c, jobCountry, apiKey, supabase, jobId, blocklistGlobal),
          PER_COMPANY_TIMEOUT_MS,
          { id: c.id, status: "failed" as const },
        );
      }
      catch (e: any) { if (e?.message === "FIRECRAWL_PAYMENT_REQUIRED") paymentErr = true; return { id: c.id, status: "failed" as const }; }
    }, CONCURRENCY);
    for (const r of results) { if ((r as any)?.status === "resolved") resolved++; else failed++; }

    if (jobId) await supabase.from("crawl_logs").insert({
      crawl_job_id: jobId, level: paymentErr ? "error" : "success",
      message: paymentErr
        ? "Firecrawl returned 402 (insufficient credits) — top up to continue."
        : `Domain resolution complete: ${resolved} resolved, ${failed} failed.`,
    });

    return new Response(JSON.stringify({ resolved, failed, total: todo.length, paymentRequired: paymentErr }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
