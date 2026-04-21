// Resolve a company name (+ optional country) to a website domain via Firecrawl Search.
// Uses cleaned query, ASCII-folded name variant, country/lang hints, fallback queries
// and a looser homepage verifier.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

const BLOCKED_HOSTS = new Set([
  "linkedin.com","facebook.com","instagram.com","twitter.com","x.com","youtube.com",
  "wikipedia.org","wikidata.org","crunchbase.com","glassdoor.com","indeed.com",
  "bloomberg.com","reuters.com","yelp.com","tripadvisor.com","trustpilot.com",
  "amazon.com","ebay.com","apple.com","play.google.com","github.com","medium.com",
  "pitchbook.com","zoominfo.com","rocketreach.co","apollo.io","owler.com",
  "dnb.com","companieshouse.gov.uk","allabolag.se","proff.se","bizzdb.com",
  "yellowpages.com","gulesider.no","krak.dk","fonecta.fi","hitta.se","eniro.se",
]);

const COUNTRY_TLDS: Record<string, string[]> = {
  sweden: ["se"], sverige: ["se"], se: ["se"],
  norway: ["no"], norge: ["no"], no: ["no"],
  denmark: ["dk"], danmark: ["dk"], dk: ["dk"],
  finland: ["fi"], suomi: ["fi"], fi: ["fi"],
  germany: ["de"], deutschland: ["de"], de: ["de"],
  france: ["fr"], fr: ["fr"],
  netherlands: ["nl"], nederland: ["nl"], nl: ["nl"],
  uk: ["uk","co.uk"], "united kingdom": ["uk","co.uk"], britain: ["uk","co.uk"],
  ireland: ["ie"], ie: ["ie"],
  spain: ["es"], españa: ["es"], es: ["es"],
  italy: ["it"], italia: ["it"], it: ["it"],
};

const COUNTRY_HINTS: Record<string, { country: string; lang: string; contactWord: string; siteWord: string }> = {
  sweden:  { country: "se", lang: "sv", contactWord: "kontakt", siteWord: "hemsida" },
  sverige: { country: "se", lang: "sv", contactWord: "kontakt", siteWord: "hemsida" },
  norway:  { country: "no", lang: "no", contactWord: "kontakt", siteWord: "nettside" },
  norge:   { country: "no", lang: "no", contactWord: "kontakt", siteWord: "nettside" },
  denmark: { country: "dk", lang: "da", contactWord: "kontakt", siteWord: "hjemmeside" },
  danmark: { country: "dk", lang: "da", contactWord: "kontakt", siteWord: "hjemmeside" },
  finland: { country: "fi", lang: "fi", contactWord: "yhteystiedot", siteWord: "kotisivu" },
  suomi:   { country: "fi", lang: "fi", contactWord: "yhteystiedot", siteWord: "kotisivu" },
  germany: { country: "de", lang: "de", contactWord: "kontakt", siteWord: "webseite" },
  deutschland: { country: "de", lang: "de", contactWord: "kontakt", siteWord: "webseite" },
  france:  { country: "fr", lang: "fr", contactWord: "contact", siteWord: "site" },
  netherlands: { country: "nl", lang: "nl", contactWord: "contact", siteWord: "website" },
  nederland: { country: "nl", lang: "nl", contactWord: "contact", siteWord: "website" },
  uk: { country: "gb", lang: "en", contactWord: "contact", siteWord: "website" },
  "united kingdom": { country: "gb", lang: "en", contactWord: "contact", siteWord: "website" },
  ireland: { country: "ie", lang: "en", contactWord: "contact", siteWord: "website" },
  spain:   { country: "es", lang: "es", contactWord: "contacto", siteWord: "sitio web" },
  españa:  { country: "es", lang: "es", contactWord: "contacto", siteWord: "sitio web" },
  italy:   { country: "it", lang: "it", contactWord: "contatti", siteWord: "sito web" },
  italia:  { country: "it", lang: "it", contactWord: "contatti", siteWord: "sito web" },
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

async function searchFirecrawl(query: string, apiKey: string, hints?: { country?: string; lang?: string }): Promise<any[]> {
  const body: Record<string, unknown> = { query, limit: 10 };
  if (hints?.country) body.country = hints.country;
  if (hints?.lang) body.lang = hints.lang;
  const res = await fetch(`${FIRECRAWL_V2}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    return [];
  }
  return Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.web) ? json.data.web : [];
}

async function verifyHomepage(host: string, nameTokens: string[], apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://${host}`, formats: ["html"], onlyMainContent: false }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    const html: string = (j?.html ?? j?.data?.html ?? "").toLowerCase();
    if (!html) return false;
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
    const ogMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/);
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const haystack = foldAscii(`${titleMatch?.[1] ?? ""} ${ogMatch?.[1] ?? ""} ${descMatch?.[1] ?? ""} ${h1Match?.[1] ?? ""}`.toLowerCase());
    return nameTokens.some((t) => haystack.includes(t));
  } catch { return false; }
}

type Cand = { host: string; url: string; score: number; title?: string };

function rankFromResults(results: any[], nameTokens: string[], country?: string | null): Cand[] {
  const seen = new Map<string, Cand>();
  for (const r of results) {
    const url = r.url ?? r.link;
    const host = url ? hostFromUrl(url) : null;
    if (!host) continue;
    const score = scoreCandidate(host, nameTokens, country);
    if (score < 0) continue;
    const prev = seen.get(host);
    if (!prev || score > prev.score) seen.set(host, { host, url, score, title: r.title });
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score);
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

    const queries: string[] = [];
    if (country) {
      queries.push(`"${cleanName}" ${country} ${hints?.contactWord ?? "contact"}`);
      queries.push(`${cleanName} ${country}`);
    } else {
      queries.push(`"${cleanName}" official website`);
    }
    if (cleanAscii.toLowerCase() !== cleanName.toLowerCase()) {
      queries.push(`"${cleanAscii}" ${country ?? ""}`.trim());
    }
    queries.push(`${cleanName} ${hints?.siteWord ?? "website"}`);

    let bestOverall: Cand | undefined;
    let lastRanked: Cand[] = [];
    for (const q of queries) {
      const results = await searchFirecrawl(q, apiKey, fcHints);
      const ranked = rankFromResults(results, nameTokens, country);
      if (ranked.length) lastRanked = ranked;
      const top = ranked[0];
      if (top && (!bestOverall || top.score > bestOverall.score)) bestOverall = top;
      if (bestOverall && bestOverall.score >= 5) break;
    }

    let best = bestOverall;
    if (best && best.score < 4) {
      const stem = hostStem(best.host);
      const exactStem = nameTokens.some((t) => stem === t);
      if (!exactStem) {
        const ok = await verifyHomepage(best.host, nameTokens, apiKey);
        if (!ok && best.score < 2) best = undefined;
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
      candidates: lastRanked.slice(0, 5),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
