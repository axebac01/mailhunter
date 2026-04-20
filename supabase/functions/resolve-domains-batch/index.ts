// Batch domain resolution: takes { companyIds: [] } (or { importId } / { jobId }),
// resolves them in parallel with bounded concurrency, and updates companies in place.
// Runs server-side so the user can close the tab.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const CONCURRENCY = 5;

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

function tokens(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 &&
      !["the","and","group","ltd","inc","llc","ab","oy","gmbh","sa","spa","plc","co","corp","company","holding","holdings"].includes(w));
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
function scoreCandidate(host: string, nameTokens: string[], country?: string | null): number {
  if (isBlocked(host)) return -1;
  const stripped = host.split(".").slice(0, -1).join(".");
  let score = 0;
  for (const t of nameTokens) {
    if (stripped.includes(t)) score += 2;
    else if (host.includes(t)) score += 1;
  }
  if (host.split(".").length <= 2) score += 1;
  if (country) {
    const expected = COUNTRY_TLDS[country.toLowerCase().trim()];
    if (expected) {
      const hostTld = tldOf(host);
      if (expected.includes(hostTld)) score += 2;
    }
  }
  return score;
}

async function searchFirecrawl(query: string, apiKey: string): Promise<any[]> {
  const res = await fetch(`${FIRECRAWL_V2}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 10 }),
  });
  const json = await res.json();
  if (!res.ok) {
    if (res.status === 402) throw new Error("FIRECRAWL_PAYMENT_REQUIRED");
    return [];
  }
  return Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.web) ? json.data.web : [];
}

// Verify candidate by scraping homepage and checking name appears in title/og.
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
    const haystack = `${titleMatch?.[1] ?? ""} ${ogMatch?.[1] ?? ""}`.toLowerCase();
    return nameTokens.some((t) => haystack.includes(t));
  } catch { return false; }
}

async function resolveOne(
  company: { id: string; name: string; country: string | null },
  apiKey: string,
  supabase: any,
): Promise<{ id: string; status: "resolved" | "failed"; domain?: string }> {
  const { id, name, country } = company;
  const query = country ? `${name} ${country} official website` : `${name} official website`;
  let results: any[] = [];
  try { results = await searchFirecrawl(query, apiKey); }
  catch (e: any) {
    if (e?.message === "FIRECRAWL_PAYMENT_REQUIRED") throw e;
  }

  const nameTokens = tokens(name);
  type Cand = { host: string; url: string; score: number };
  const seen = new Map<string, Cand>();
  for (const r of results) {
    const url = r.url ?? r.link;
    const host = url ? hostFromUrl(url) : null;
    if (!host) continue;
    const score = scoreCandidate(host, nameTokens, country);
    if (score < 0) continue;
    const prev = seen.get(host);
    if (!prev || score > prev.score) seen.set(host, { host, url, score });
  }
  const ranked = Array.from(seen.values()).sort((a, b) => b.score - a.score);
  let best = ranked[0];

  // Verify top candidate when score is borderline
  if (best && best.score < 4) {
    const ok = await verifyHomepage(best.host, nameTokens, apiKey);
    if (!ok && ranked[1]) {
      const ok2 = await verifyHomepage(ranked[1].host, nameTokens, apiKey);
      if (ok2) best = ranked[1];
      else if (best.score < 2) best = undefined as any;
    }
  }

  if (best) {
    await supabase.from("companies").update({
      domain: best.host,
      website: `https://${best.host}`,
      source_url: best.url,
      domain_status: "resolved",
    }).eq("id", id);
    return { id, status: "resolved", domain: best.host };
  }
  await supabase.from("companies").update({ domain_status: "failed" }).eq("id", id);
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
    const { companyIds, importId, jobId } = body ?? {};

    // Resolve target company list
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
    }
    ids = Array.from(new Set(ids.filter(Boolean)));

    if (ids.length === 0) {
      return new Response(JSON.stringify({ resolved: 0, failed: 0, total: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only process companies still without a domain
    const { data: companies } = await supabase.from("companies")
      .select("id, name, country, domain").in("id", ids);
    const todo = (companies ?? []).filter((c: any) => !c.domain);

    if (jobId) await supabase.from("crawl_logs").insert({
      crawl_job_id: jobId, level: "info",
      message: `Resolving domains for ${todo.length} companies (concurrency ${CONCURRENCY})…`,
    });

    let resolved = 0, failed = 0, paymentErr = false;
    const results = await runPool(todo, async (c: any) => {
      try { return await resolveOne(c, apiKey, supabase); }
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
