// Resolve a company name (+ optional country) to a website domain via Firecrawl Search.
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

function tokens(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 &&
      !["the","and","group","ltd","inc","llc","ab","oy","gmbh","sa","spa","plc","co","corp","company","holding","holdings"].includes(w));
}

function hostFromUrl(u: string): string | null {
  try {
    const url = new URL(u.startsWith("http") ? u : `https://${u}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

function isBlocked(host: string): boolean {
  for (const b of BLOCKED_HOSTS) if (host === b || host.endsWith("." + b)) return true;
  return false;
}

function scoreCandidate(host: string, nameTokens: string[]): number {
  if (isBlocked(host)) return -1;
  const stripped = host.split(".").slice(0, -1).join(".");
  let score = 0;
  for (const t of nameTokens) {
    if (stripped.includes(t)) score += 2;
    else if (host.includes(t)) score += 1;
  }
  // Prefer shorter, root-ish domains
  if (host.split(".").length <= 2) score += 1;
  return score;
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

    const query = country ? `${companyName} ${country} official website` : `${companyName} official website`;

    const res = await fetch(`${FIRECRAWL_V2}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 10 }),
    });
    const json = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: json?.error ?? `Firecrawl ${res.status}`, raw: json }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // v2 search results may be under data.web or data
    const results: any[] = Array.isArray(json?.data) ? json.data
      : Array.isArray(json?.data?.web) ? json.data.web
      : [];

    const nameTokens = tokens(companyName);
    type Cand = { host: string; url: string; score: number; title?: string };
    const seen = new Map<string, Cand>();
    for (const r of results) {
      const url = r.url ?? r.link;
      const host = url ? hostFromUrl(url) : null;
      if (!host) continue;
      const score = scoreCandidate(host, nameTokens);
      if (score < 0) continue;
      const prev = seen.get(host);
      if (!prev || score > prev.score) seen.set(host, { host, url, score, title: r.title });
    }
    const ranked = Array.from(seen.values()).sort((a, b) => b.score - a.score);
    const best = ranked[0];

    let confidence: "high" | "low" | "none" = "none";
    if (best) {
      if (best.score >= 3) confidence = "high";
      else if (best.score >= 1) confidence = "low";
    }

    return new Response(JSON.stringify({
      domain: best?.host ?? null,
      website: best ? `https://${best.host}` : null,
      confidence,
      evidenceUrl: best?.url ?? null,
      candidates: ranked.slice(0, 5),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
