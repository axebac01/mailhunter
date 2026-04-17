// Scrape a company's domain via Firecrawl, extract real public contact data,
// and insert rows into contacts / contact_people. Falls back to a `not_found`
// crawl_log entry when nothing public is discovered.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const PERSONAL_RE = /^[a-z]+[._-][a-z]+@/i;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

const JUNK_DOMAINS = ["example.com","sentry.io","wixpress.com","wix.com","squarespace.com","godaddy.com","cloudflare.com","gstatic.com","sentry-next.wixpress.com","yourdomain.com","domain.com","email.com"];

function rootDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  // crude eTLD+1: keep last 2 unless it looks like a country code SLD
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const ccTwoLevel = ["co.uk","com.au","co.nz","com.br","co.jp","com.mx","co.za"];
  const lastTwo = `${sld}.${tld}`;
  if (ccTwoLevel.includes(lastTwo) && parts.length >= 3) return `${parts[parts.length - 3]}.${lastTwo}`;
  return lastTwo;
}

function emailHost(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

async function firecrawlMap(domain: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${FIRECRAWL_V2}/map`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: `https://${domain}`, limit: 50 }),
  });
  const j = await res.json();
  if (!res.ok) return [];
  const links: string[] = Array.isArray(j?.links) ? j.links : Array.isArray(j?.data?.links) ? j.data.links : [];
  return links;
}

async function firecrawlScrape(url: string, apiKey: string): Promise<{ markdown?: string; html?: string }> {
  const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "html"], onlyMainContent: false }),
  });
  const j = await res.json();
  if (!res.ok) return {};
  return {
    markdown: j?.markdown ?? j?.data?.markdown,
    html: j?.html ?? j?.data?.html,
  };
}

function pickContactPages(domain: string, links: string[]): string[] {
  const want = ["contact","kontakt","about","over-ons","team","people","impressum","kontakta","om-oss"];
  const root = rootDomain(domain);
  const inDomain = links.filter((l) => {
    try { return rootDomain(new URL(l).hostname) === root; } catch { return false; }
  });
  const matched = inDomain.filter((l) => {
    const p = l.toLowerCase();
    return want.some((w) => p.includes(`/${w}`));
  });
  // Always include homepage
  const homepage = `https://${domain}`;
  const set = new Set<string>([homepage, ...matched.slice(0, 6)]);
  return Array.from(set);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { companyId, domain, jobId, options } = await req.json();
    if (!companyId || !domain) {
      return new Response(JSON.stringify({ error: "companyId and domain required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const opt = {
      genericEmails: options?.genericEmails ?? true,
      personEmails: options?.personEmails ?? false,
      phones: options?.phones ?? true,
      contactForms: options?.contactForms ?? true,
    };

    const log = (level: string, message: string) => {
      if (jobId) supabase.from("crawl_logs").insert({ crawl_job_id: jobId, level, message }).then(() => {});
    };

    const links = await firecrawlMap(domain, apiKey);
    const pages = pickContactPages(domain, links);
    log("info", `Mapped ${links.length} URLs on ${domain}, scraping ${pages.length} contact pages`);

    const root = rootDomain(domain);
    const foundEmails = new Set<string>();
    const foundPhones = new Set<string>();
    const foundForms = new Set<string>();
    const emailSources = new Map<string, string>();

    for (const pageUrl of pages) {
      const { markdown, html } = await firecrawlScrape(pageUrl, apiKey);
      const blob = `${markdown ?? ""}\n${html ?? ""}`;

      // Emails
      const emails = blob.match(EMAIL_RE) ?? [];
      for (const raw of emails) {
        const e = raw.toLowerCase();
        const host = emailHost(e);
        if (!host) continue;
        if (JUNK_DOMAINS.some((j) => host === j || host.endsWith("." + j))) continue;
        if (rootDomain(host) !== root) continue; // strict: must match company domain
        if (e.includes("..") || e.length > 80) continue;
        foundEmails.add(e);
        if (!emailSources.has(e)) emailSources.set(e, pageUrl);
      }

      // Phones
      const phones = blob.match(PHONE_RE) ?? [];
      for (const raw of phones) {
        const cleaned = raw.replace(/[^\d+]/g, "");
        if (cleaned.length >= 8 && cleaned.length <= 16) foundPhones.add(raw.trim());
      }

      // Contact form heuristic: page that looks like a contact page with a <form>
      if (/\/(contact|kontakt|kontakta)/i.test(pageUrl) && /<form[\s>]/i.test(html ?? "")) {
        foundForms.add(pageUrl);
      }

      // Source page record
      await supabase.from("source_pages").insert({
        company_id: companyId, crawl_job_id: jobId ?? null, url: pageUrl,
        page_type: /contact|kontakt/.test(pageUrl) ? "contact" : /about|om-/.test(pageUrl) ? "about" : /team|people/.test(pageUrl) ? "team" : "homepage",
        status_code: 200,
        extracted_summary: `${emails.length} email candidates, ${phones.length} phone candidates`,
      });
    }

    let inserted = { contacts: 0, people: 0 };

    // Generic emails
    if (opt.genericEmails) {
      for (const e of foundEmails) {
        if (PERSONAL_RE.test(e)) continue;
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "generic_email", value: e, source_url: emailSources.get(e) ?? `https://${domain}`,
        });
        if (!error) inserted.contacts++;
      }
    }
    // Person emails
    if (opt.personEmails) {
      for (const e of foundEmails) {
        if (!PERSONAL_RE.test(e)) continue;
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "person_email", value: e, source_url: emailSources.get(e) ?? `https://${domain}`,
        });
        if (!error) inserted.contacts++;
      }
    }
    // Phones
    if (opt.phones) {
      for (const p of foundPhones) {
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "phone", value: p, source_url: `https://${domain}`,
        });
        if (!error) inserted.contacts++;
      }
    }
    // Contact forms
    if (opt.contactForms) {
      for (const u of foundForms) {
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "contact_form", value: u, source_url: u,
        });
        if (!error) inserted.contacts++;
      }
    }

    if (inserted.contacts === 0) {
      log("warn", `No public emails found for ${domain}`);
    } else {
      log("success", `Extracted ${inserted.contacts} real contacts from ${domain}`);
    }

    return new Response(JSON.stringify({
      domain, pagesScraped: pages.length,
      emails: Array.from(foundEmails), phones: Array.from(foundPhones), forms: Array.from(foundForms),
      inserted,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
