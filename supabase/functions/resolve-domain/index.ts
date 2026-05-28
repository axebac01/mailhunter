// Single-shot domain resolution — same upgrades as the batch version:
// search + slug probes + map fallback + LLM tiebreaker + looser verification.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const BLOCKED_HOSTS = new Set([
  "linkedin.com","facebook.com","instagram.com","twitter.com","x.com","youtube.com",
  "wikipedia.org","wikidata.org","crunchbase.com","glassdoor.com","indeed.com",
  "bloomberg.com","reuters.com","yelp.com","tripadvisor.com","trustpilot.com",
  "amazon.com","ebay.com","apple.com","play.google.com","github.com","medium.com",
  "pitchbook.com","zoominfo.com","rocketreach.co","apollo.io","owler.com",
  "dnb.com","companieshouse.gov.uk","allabolag.se","proff.se","bizzdb.com",
  "yellowpages.com","gulesider.no","krak.dk","fonecta.fi","hitta.se","eniro.se",
  "merinfo.se","ratsit.se",
]);

const COUNTRY_TLDS: Record<string, string[]> = {
  sweden: ["se"], sverige: ["se"], se: ["se"],
  norway: ["no"], norge: ["no"], no: ["no"],
  denmark: ["dk"], danmark: ["dk"], dk: ["dk"],
  finland: ["fi"], suomi: ["fi"], fi: ["fi"],
  germany: ["de"], deutschland: ["de"], de: ["de"],
  france: ["fr"], fr: ["fr"],
  netherlands: ["nl"], nederland: ["nl"], nl: ["nl"],
  uk: ["co.uk","uk"], "united kingdom": ["co.uk","uk"], britain: ["co.uk","uk"], gb: ["co.uk","uk"],
  ireland: ["ie"], ie: ["ie"],
  spain: ["es"], españa: ["es"], es: ["es"],
  italy: ["it"], italia: ["it"], it: ["it"],
};

const COUNTRY_HINTS: Record<string, { country: string; lang: string; contactWord: string; siteWord: string }> = {
  sweden:  { country: "se", lang: "sv", contactWord: "kontakt", siteWord: "hemsida" },
  sverige: { country: "se", lang: "sv", contactWord: "kontakt", siteWord: "hemsida" },
  se:      { country: "se", lang: "sv", contactWord: "kontakt", siteWord: "hemsida" },
  norway:  { country: "no", lang: "no", contactWord: "kontakt", siteWord: "nettside" },
  norge:   { country: "no", lang: "no", contactWord: "kontakt", siteWord: "nettside" },
  no:      { country: "no", lang: "no", contactWord: "kontakt", siteWord: "nettside" },
  denmark: { country: "dk", lang: "da", contactWord: "kontakt", siteWord: "hjemmeside" },
  danmark: { country: "dk", lang: "da", contactWord: "kontakt", siteWord: "hjemmeside" },
  dk:      { country: "dk", lang: "da", contactWord: "kontakt", siteWord: "hjemmeside" },
  finland: { country: "fi", lang: "fi", contactWord: "yhteystiedot", siteWord: "kotisivu" },
  suomi:   { country: "fi", lang: "fi", contactWord: "yhteystiedot", siteWord: "kotisivu" },
  fi:      { country: "fi", lang: "fi", contactWord: "yhteystiedot", siteWord: "kotisivu" },
  germany: { country: "de", lang: "de", contactWord: "kontakt", siteWord: "webseite" },
  deutschland: { country: "de", lang: "de", contactWord: "kontakt", siteWord: "webseite" },
  de:      { country: "de", lang: "de", contactWord: "kontakt", siteWord: "webseite" },
  france:  { country: "fr", lang: "fr", contactWord: "contact", siteWord: "site" },
  fr:      { country: "fr", lang: "fr", contactWord: "contact", siteWord: "site" },
  netherlands: { country: "nl", lang: "nl", contactWord: "contact", siteWord: "website" },
  nederland: { country: "nl", lang: "nl", contactWord: "contact", siteWord: "website" },
  nl:      { country: "nl", lang: "nl", contactWord: "contact", siteWord: "website" },
  uk: { country: "gb", lang: "en", contactWord: "contact", siteWord: "website" },
  "united kingdom": { country: "gb", lang: "en", contactWord: "contact", siteWord: "website" },
  ireland: { country: "ie", lang: "en", contactWord: "contact", siteWord: "website" },
  spain:   { country: "es", lang: "es", contactWord: "contacto", siteWord: "sitio web" },
  españa:  { country: "es", lang: "es", contactWord: "contacto", siteWord: "sitio web" },
  es:      { country: "es", lang: "es", contactWord: "contacto", siteWord: "sitio web" },
  italy:   { country: "it", lang: "it", contactWord: "contatti", siteWord: "sito web" },
  italia:  { country: "it", lang: "it", contactWord: "contatti", siteWord: "sito web" },
  it:      { country: "it", lang: "it", contactWord: "contatti", siteWord: "sito web" },
};

const LEGAL_SUFFIXES_RE = /\b(ab|aktiebolag|oy|oyj|gmbh|mbh|ltd|limited|inc|incorporated|llc|l\.l\.c|sa|s\.a|spa|s\.p\.a|plc|bv|b\.v|as|a\/s|aps|a\.p\.s|sarl|s\.a\.r\.l|kg|ag|nv|n\.v|holding|holdings|group|the|co|corp|corporation|company)\b\.?/gi;

function foldAscii(s: string): string { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
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
  if (!res.ok) return [];
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
    return Array.isArray(j?.links) ? j.links : Array.isArray(j?.data?.links) ? j.data.links : [];
  } catch { return []; }
}

async function headProbe(host: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    let res = await fetch(`https://${host}`, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
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

function rankFromResults(results: any[], nameTokens: string[], country?: string | null): Cand[] {
  const seen = new Map<string, Cand>();
  for (const r of results) {
    const url = r.url ?? r.link;
    const host = url ? hostFromUrl(url) : null;
    if (!host) continue;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");

    const { companyName, country } = await req.json();
    if (!companyName || typeof companyName !== "string") {
      return new Response(JSON.stringify({ error: "companyName required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanName = cleanCompanyName(companyName) || companyName;
    const cleanAscii = foldAscii(cleanName);
    const nameTokens = Array.from(new Set([...tokens(companyName), ...tokens(cleanName), ...tokens(cleanAscii)]));
    const hints = country ? COUNTRY_HINTS[String(country).toLowerCase().trim()] : undefined;
    const fcHints = hints ? { country: hints.country, lang: hints.lang } : undefined;
    const tlds = country ? (COUNTRY_TLDS[String(country).toLowerCase().trim()] ?? []) : [];
    const primaryTld = tlds[0];

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
    let lastRanked: Cand[] = [];
    for (const q of queries) {
      const results = await searchFirecrawl(q, apiKey, fcHints);
      const ranked = rankFromResults(results, nameTokens, country);
      if (ranked.length) lastRanked = ranked;
      const top = ranked[0];
      if (top && (!bestSearch || top.score > bestSearch.score)) bestSearch = top;
      if (bestSearch && bestSearch.score >= 5) break;
    }

    // Slug probes
    const slugCandidates: Cand[] = [];
    const { slug, hyphenated, acronym } = buildSlug(cleanName);
    const tldsToTry = Array.from(new Set([...tlds, "com"]));
    const guesses: string[] = [];
    for (const tld of tldsToTry) {
      if (slug && slug.length >= 3) guesses.push(`${slug}.${tld}`);
      if (hyphenated && hyphenated !== slug) guesses.push(`${hyphenated}.${tld}`);
      if (acronym && acronym.length >= 3) guesses.push(`${acronym}.${tld}`);
    }
    const uniqGuesses = Array.from(new Set(guesses)).filter((h) => !isBlocked(h)).slice(0, 8);
    const probes = await Promise.all(uniqGuesses.map(async (h) => ({ host: h, ok: await headProbe(h) })));
    for (const { host, ok } of probes) {
      if (!ok) continue;
      const score = scoreCandidate(host, nameTokens, country);
      if (score < 0) continue;
      slugCandidates.push({ host, url: `https://${host}`, score, source: "slug" });
    }

    const merged = new Map<string, Cand>();
    for (const c of [...lastRanked, ...slugCandidates]) {
      const prev = merged.get(c.host);
      if (!prev || c.score > prev.score) merged.set(c.host, c);
    }
    let allRanked = Array.from(merged.values()).sort((a, b) => b.score - a.score);
    let best: Cand | undefined = allRanked[0];

    // Map fallback removed (cost vs. nytta). Verify directly when uncertain.

    if (best) {
      const stem = hostStem(best.host);
      const exactStem = nameTokens.some((t) => stem === t);
      const isCountrySlug = best.source === "slug" && primaryTld && tldOf(best.host) === primaryTld && exactStem;
      if (!exactStem && !isCountrySlug && best.score < 4) {
        const ok = await verifyHomepage(best.host, nameTokens, apiKey);
        if (!ok && best.score < 2) best = undefined;
      }
    }

    if (best && best.score < 3 && allRanked.length >= 2 && (allRanked[0].score - allRanked[1].score) <= 1) {
      const pick = await llmTiebreaker(companyName, country ?? null, allRanked.slice(0, 5));
      if (pick) {
        const found = allRanked.find((c) => c.host === pick);
        if (found) best = found;
      }
    }

    let confidence: "high" | "low" | "none" = "none";
    if (best) {
      if (best.score >= 4) confidence = "high";
      else if (best.score >= 1) confidence = "low";
    }

    return new Response(JSON.stringify({
      domain: best?.host ?? null,
      website: best ? `https://${best.host}` : null,
      confidence,
      evidenceUrl: best?.url ?? null,
      candidates: allRanked.slice(0, 5),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
