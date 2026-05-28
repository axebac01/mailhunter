// Tiered, credit-frugal email + decision-maker extraction for a single company.
// Goals: minimize Firecrawl spend, maximize % of companies where we reach SOMEONE.
// Pipeline:
//   0. Domain-cache: if another company with same root domain already has contacts → copy & exit (0 credits)
//   1. Tier 1: HEAD-probe canonical contact paths → scrape FIRST one that exists (1 credit). Regex emails/phones/forms.
//   2. Tier 2 (skip if Tier 1 found a generic@ or person mail): HEAD-probe leadership/team paths → scrape first hit with JSON-extract for people (≈5 credits, max 1 LLM/company). Rank decision-makers first.
//   3. Tier 3 (only if 0 emails AND 0 people): map(limit 30) + scrape homepage (≈2 credits).
// Hard cap: 5 Firecrawl calls + 1 LLM-extract per company. Count tracked on crawl_jobs.firecrawl_calls.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

// ─────────────────────────── classification helpers ──────────────────────────

const GENERIC_PREFIXES = new Set([
  "info","sales","contact","hello","support","office","admin","help","service","services",
  "team","mail","email","press","media","marketing","pr","jobs","careers","career","hr",
  "recruiting","recruitment","kontakt","kundtjanst","kundservice","post","booking","reception",
  "noreply","no-reply","do-not-reply","donotreply","newsletter","billing","invoice","invoices",
  "accounts","accounting","finance","legal","privacy","gdpr","dpo","security","abuse",
  "webmaster","postmaster","hostmaster","enquiries","enquiry","inquiry","inquiries","general",
  "welcome","feedback","orders","order","shop","store","customerservice","customer-service",
]);

const FIRST_NAMES = new Set([
  "anna","maria","lena","karin","eva","sara","emma","linda","jenny","malin","sofia","johanna","kristin","camilla","julia","elin","ida","hanna","matilda","ebba","alice","alma","wilma","stella","ella","lisa","kim","therese","frida","klara","cecilia","annika","helena","marie","ann","monica","ulla","ingrid","gunilla","kerstin","birgitta","margareta","elisabeth",
  "erik","lars","karl","carl","anders","johan","mikael","mattias","andreas","per","peter","jonas","fredrik","henrik","gustav","oskar","oscar","alexander","viktor","filip","emil","lukas","hugo","nils","axel","liam","noah","william","leo","theo","elias","arvid","sebastian","daniel","magnus","björn","bjorn","tomas","thomas","martin","ola","stefan","bo","sven","hans","gunnar","rolf","jan",
  "kari","liv","mette","helle","aino","kaisa","mikko","jukka","jari","matti","timo","janne","ville","antti","tuomas",
  "james","john","robert","michael","david","richard","joseph","charles","christopher","matthew","anthony","mark","donald","steven","paul","andrew","joshua","kenneth","kevin","brian","george","edward","ronald","timothy","jason","jeffrey","ryan","jacob","gary","nicholas","eric","jonathan","stephen","scott","brandon","frank","benjamin","gregory","samuel","raymond","patrick","jack","dennis","jerry","tyler","aaron","henry","douglas","jose","adam","nathan","zachary","walter","kyle","harold","arthur","gerald","roger","keith","jeremy","lawrence","sean","christian","ethan","austin","joe",
  "mary","patricia","jennifer","elizabeth","barbara","susan","jessica","karen","nancy","betty","helen","sandra","donna","carol","ruth","sharon","michelle","laura","kimberly","deborah","dorothy","amy","angela","ashley","brenda","olivia","cynthia","janet","catherine","frances","christine","samantha","debra","rachel","carolyn","virginia","heather","diane","joyce","victoria","kelly","christina","joan","evelyn","lauren","judith","megan","cheryl","andrea","hannah","jacqueline","martha","gloria","teresa","madison","grace","theresa","rose","janice","nicole","kathryn","jean","abigail","julia","judy","sophia","beverly","denise","marilyn","amber","danielle","brittany","diana","natalie",
]);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

type EmailClass = "generic" | "person_high" | "person_low";

function classifyEmail(email: string): EmailClass {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (!local || !/[a-z]/.test(local)) return "generic";
  const base = local.split("+")[0];
  if (GENERIC_PREFIXES.has(base)) return "generic";
  const head = base.split(/[._-]/)[0];
  if (GENERIC_PREFIXES.has(head)) return "generic";
  if (/^[a-z]+[._-][a-z]{2,}$/.test(base)) return "person_high";
  if (/^[a-z]{2,}$/.test(base) && FIRST_NAMES.has(base)) return "person_high";
  if (/\d/.test(base)) return "generic";
  return "person_low";
}

// Beslutsfattare-detektor (SV + EN)
const DECISION_MAKER_RE = /\b(vd|verkst[äa]llande\s+direkt[öo]r|ceo|c\.e\.o|grundare|founder|co[-\s]?founder|[äa]gare|owner|partner|styrelseordf[öo]rande|chairman|chairwoman|managing\s+director|\bmd\b|general\s+manager|head\s+of|chief\s+\w+\s+officer|cfo|coo|cto|cmo|cro|cio|president)\b/i;

function isDecisionMaker(role?: string | null): boolean {
  if (!role) return false;
  return DECISION_MAKER_RE.test(role);
}

const PHONE_INTL_RE = /\+\d[\d\s().-]{6,}\d/g;
const TEL_HREF_RE = /href\s*=\s*["']tel:([^"']+)["']/gi;
const MAILTO_RE = /href\s*=\s*["']mailto:([^"'?]+)/gi;

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch { return _; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n, 16)); } catch { return _; } })
    .replace(/&commat;/gi, "@").replace(/&period;/gi, ".").replace(/&amp;/gi, "&");
}

function deobfuscate(s: string): string {
  let t = decodeHtmlEntities(s);
  t = t.replace(/\s*[\[\(\{]\s*at\s*[\]\)\}]\s*/gi, "@");
  t = t.replace(/\s+at\s+/gi, "@");
  t = t.replace(/\s*snabel-?a\s*/gi, "@");
  t = t.replace(/\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*/gi, ".");
  t = t.replace(/\s+dot\s+/gi, ".");
  t = t.replace(/\s*\(punkt\)\s*/gi, ".");
  return t;
}

function decodeCfEmail(hex: string): string | null {
  try {
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    if (bytes.length < 2) return null;
    const key = bytes[0];
    let out = "";
    for (let i = 1; i < bytes.length; i++) out += String.fromCharCode(bytes[i] ^ key);
    return out;
  } catch { return null; }
}

function extractCfEmails(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-fA-F]+)["']/g)) {
    const dec = decodeCfEmail(m[1]);
    if (dec && dec.includes("@")) out.push(dec);
  }
  return out;
}

function extractMailtos(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(MAILTO_RE)) {
    const v = decodeURIComponent(m[1].trim());
    if (v.includes("@")) out.push(v);
  }
  return out;
}

const JUNK_DOMAINS = ["example.com","sentry.io","wixpress.com","wix.com","squarespace.com","godaddy.com","cloudflare.com","gstatic.com","sentry-next.wixpress.com","yourdomain.com","domain.com","email.com"];

function rootDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
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

// ─────────────────────────── Firecrawl wrappers (counted) ────────────────────

type Counter = { calls: number; llmCalls: number };

async function firecrawlMap(domain: string, apiKey: string, counter: Counter): Promise<string[]> {
  counter.calls++;
  const res = await fetch(`${FIRECRAWL_V2}/map`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: `https://${domain}`, limit: 30 }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  const links: string[] = Array.isArray(j?.links) ? j.links : Array.isArray(j?.data?.links) ? j.data.links : [];
  return links;
}

async function firecrawlScrape(url: string, apiKey: string, counter: Counter, opts?: { wait?: boolean; jsonPrompt?: string }): Promise<{ markdown?: string; html?: string; json?: any }> {
  counter.calls++;
  if (opts?.jsonPrompt) counter.llmCalls++;
  const formats: any[] = ["markdown", "html"];
  if (opts?.jsonPrompt) formats.push({ type: "json", prompt: opts.jsonPrompt });
  const body: any = { url, formats, onlyMainContent: false };
  if (opts?.wait) body.waitFor = 1500;
  const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return {};
  return {
    markdown: j?.markdown ?? j?.data?.markdown,
    html: j?.html ?? j?.data?.html,
    json: j?.json ?? j?.data?.json,
  };
}

async function headOk(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    return res.ok || res.status === 405;
  } catch { return false; }
}

async function firstReachable(urls: string[]): Promise<string | null> {
  const probes = await Promise.all(urls.map(async (u) => ({ u, ok: await headOk(u) })));
  for (const { u, ok } of probes) if (ok) return u;
  return null;
}

// ─────────────────────────── canonical path lists ────────────────────────────

// Ordered by hit-rate (Swedish SMB first)
const CONTACT_PATHS = ["/kontakt", "/kontakta-oss", "/contact", "/contact-us", "/kontakt-oss"];
const LEADERSHIP_PATHS = ["/ledning", "/om-oss/ledning", "/om-oss", "/about/team", "/team", "/medarbetare", "/personal", "/about-us", "/about", "/people", "/styrelse"];

function classifyPage(url: string): "homepage"|"contact"|"about"|"team"|"people"|"other" {
  const p = url.toLowerCase();
  if (/\/(team|medarbetare|staff|people|personal|ledning|leadership|board|styrelse)\b/.test(p)) return "team";
  if (/\/(contact|kontakt|kontakta|impressum|imprint)\b/.test(p)) return "contact";
  if (/\/(about|om-oss|over-ons)\b/.test(p)) return "about";
  try { if (new URL(p, "https://x").pathname === "/") return "homepage"; } catch { /* ignore */ }
  return "other";
}

// ─────────────────────────── extraction from page ────────────────────────────

type PageExtract = {
  emails: Set<string>;
  phones: Set<string>;
  forms: Set<string>;
  people: { full_name: string; role_title?: string; department?: string; email?: string; source_url: string }[];
  emailSources: Map<string, string>;
};

function extractFromPage(page: { url: string; markdown?: string; html?: string; json?: any }, root: string): PageExtract {
  const out: PageExtract = {
    emails: new Set(), phones: new Set(), forms: new Set(), people: [], emailSources: new Map(),
  };
  const rawHtml = page.html ?? "";
  const cleanHtml = stripNoise(rawHtml);
  const blob = deobfuscate(`${page.markdown ?? ""}\n${cleanHtml}`);

  const found = new Set<string>();
  for (const m of blob.match(EMAIL_RE) ?? []) found.add(m.toLowerCase());
  for (const e of extractMailtos(rawHtml)) found.add(e.toLowerCase());
  for (const e of extractCfEmails(rawHtml)) found.add(e.toLowerCase());

  for (const e of found) {
    const host = emailHost(e);
    if (!host) continue;
    if (JUNK_DOMAINS.some((j) => host === j || host.endsWith("." + j))) continue;
    if (rootDomain(host) !== root) continue;
    if (e.includes("..") || e.length > 80) continue;
    out.emails.add(e);
    if (!out.emailSources.has(e)) out.emailSources.set(e, page.url);
  }

  for (const m of blob.matchAll(PHONE_INTL_RE)) {
    const cleaned = m[0].replace(/[^\d+]/g, "");
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) out.phones.add(m[0].trim());
  }
  for (const m of rawHtml.matchAll(TEL_HREF_RE)) {
    const cleaned = m[1].replace(/[^\d+]/g, "");
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) out.phones.add(m[1].trim());
  }

  if (/\/(contact|kontakt|kontakta)/i.test(page.url) && /<form[\s>]/i.test(rawHtml)) {
    out.forms.add(page.url);
  }

  const ppl: any[] = Array.isArray(page.json?.people) ? page.json.people : [];
  for (const p of ppl) {
    const name = String(p?.full_name ?? "").trim();
    if (!name || name.length > 100 || !/\s/.test(name)) continue;
    out.people.push({
      full_name: name,
      role_title: p?.role_title ? String(p.role_title).slice(0, 120) : undefined,
      department: p?.department ? String(p.department).slice(0, 80) : undefined,
      email: p?.email && String(p.email).includes("@") ? String(p.email).toLowerCase() : undefined,
      source_url: page.url,
    });
  }
  return out;
}

function mergeExtract(a: PageExtract, b: PageExtract): PageExtract {
  for (const e of b.emails) a.emails.add(e);
  for (const [e, src] of b.emailSources) if (!a.emailSources.has(e)) a.emailSources.set(e, src);
  for (const p of b.phones) a.phones.add(p);
  for (const f of b.forms) a.forms.add(f);
  a.people.push(...b.people);
  return a;
}

// Sort decision-makers first
function rankPeople(people: PageExtract["people"]): PageExtract["people"] {
  return [...people].sort((a, b) => {
    const ad = isDecisionMaker(a.role_title) ? 1 : 0;
    const bd = isDecisionMaker(b.role_title) ? 1 : 0;
    if (ad !== bd) return bd - ad;
    // tie-break: with email first
    return (b.email ? 1 : 0) - (a.email ? 1 : 0);
  });
}

// ─────────────────────────── handler ─────────────────────────────────────────

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
      personNames: options?.personNames ?? true,
    };

    const counter: Counter = { calls: 0, llmCalls: 0 };
    const log = (level: string, message: string, meta?: any) => {
      if (jobId) supabase.from("crawl_logs").insert({ crawl_job_id: jobId, level, message, meta_json: meta ?? null }).then(() => {});
    };

    const { data: companyRow } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
    const companyName = companyRow?.name ?? domain;
    const root = rootDomain(domain);

    // ──── Tier 0: domain cache ────
    // If another company has same domain and we already scraped contacts/people, copy & exit (0 credits).
    const { data: siblings } = await supabase
      .from("companies")
      .select("id")
      .eq("domain", domain)
      .neq("id", companyId)
      .limit(20);
    const siblingIds = (siblings ?? []).map((s: any) => s.id);
    if (siblingIds.length) {
      const { data: cachedContacts } = await supabase
        .from("contacts")
        .select("value, contact_type, source_url")
        .in("company_id", siblingIds)
        .limit(50);
      const uniq = new Map<string, any>();
      for (const c of cachedContacts ?? []) {
        const key = `${c.contact_type}:${c.value}`;
        if (!uniq.has(key)) uniq.set(key, c);
      }
      if (uniq.size > 0) {
        // Only copy generic emails, phones, forms — not person-specific (different employees per legal entity)
        const safeTypes = new Set(["generic_email", "phone", "contact_form"]);
        let copied = 0;
        for (const c of uniq.values()) {
          if (!safeTypes.has(c.contact_type)) continue;
          // Respect option toggles
          if (c.contact_type === "generic_email" && !opt.genericEmails) continue;
          if (c.contact_type === "phone" && !opt.phones) continue;
          if (c.contact_type === "contact_form" && !opt.contactForms) continue;
          const { error } = await supabase.from("contacts").insert({
            company_id: companyId, crawl_job_id: jobId ?? null,
            contact_type: c.contact_type, value: c.value, source_url: c.source_url,
          });
          if (!error) copied++;
        }
        if (copied > 0) {
          log("success", `Cache-hit on ${domain} — copied ${copied} contacts from sibling (0 credits)`, {
            event: "cache_hit", company: companyName, company_id: companyId, host: domain, copied,
          });
          return new Response(JSON.stringify({
            domain, pages: 0, emails_found: 0, person_emails: 0, people_extracted: 0,
            synthesized: 0, cached: true, copied, firecrawl_calls: 0,
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    // ──── Setup accumulators ────
    const acc: PageExtract = { emails: new Set(), phones: new Set(), forms: new Set(), people: [], emailSources: new Map() };
    const scrapedUrls: string[] = [];

    const recordPage = async (url: string, ex: PageExtract) => {
      scrapedUrls.push(url);
      await supabase.from("source_pages").insert({
        company_id: companyId, crawl_job_id: jobId ?? null, url,
        page_type: classifyPage(url),
        status_code: 200,
        extracted_summary: `${ex.emails.size} emails, ${ex.phones.size} phones, ${ex.people.length} people`,
      });
      log("info", `Crawled ${url} — ${ex.emails.size} email${ex.emails.size === 1 ? "" : "s"}`, {
        event: "page_crawled", company: companyName, company_id: companyId, url,
        page_type: classifyPage(url), emails_on_page: ex.emails.size, people_on_page: ex.people.length,
      });
    };

    const HARD_CAP = 5;
    const remaining = () => HARD_CAP - counter.calls;

    // ──── Tier 1: contact page ────
    if (remaining() > 0) {
      const contactCandidates = CONTACT_PATHS.map((p) => `https://${domain}${p}`);
      const contactUrl = await firstReachable(contactCandidates) ?? `https://${domain}/`;
      const r = await firecrawlScrape(contactUrl, apiKey, counter);
      const ex = extractFromPage({ url: contactUrl, ...r }, root);
      mergeExtract(acc, ex);
      await recordPage(contactUrl, ex);

      // JS-rendered fallback only if page mentioned email but we got nothing — at most 1 retry
      if (ex.emails.size === 0 && /(email|e-?post|kontakt|contact)/i.test(`${r.markdown ?? ""}\n${r.html ?? ""}`) && remaining() > 0) {
        const r2 = await firecrawlScrape(contactUrl, apiKey, counter, { wait: true });
        const ex2 = extractFromPage({ url: contactUrl, ...r2 }, root);
        mergeExtract(acc, ex2);
      }
    }

    // Tier 1 success criteria: any generic@ OR any person mail → skip Tier 2/3
    const hasGeneric = Array.from(acc.emails).some((e) => classifyEmail(e) === "generic");
    const hasPersonMail = Array.from(acc.emails).some((e) => {
      const c = classifyEmail(e); return c === "person_high" || c === "person_low";
    });

    // ──── Tier 2: leadership/team page with JSON-extract (only if no person mail yet) ────
    // Skip if we already have a person mail. Run if only generic@ (we still want names).
    const needsTier2 = !hasPersonMail && opt.personNames;
    if (needsTier2 && remaining() > 0 && counter.llmCalls < 1) {
      const leadershipCandidates = LEADERSHIP_PATHS.map((p) => `https://${domain}${p}`);
      const leadershipUrl = await firstReachable(leadershipCandidates);
      if (leadershipUrl) {
        const teamPrompt = "Extract decision-makers (CEO/VD, founders, owners, partners, board chair, C-level, managing director) from this page. Return JSON: { people: [{ full_name, role_title, department, email }] }. Prioritize executives over junior staff. Only include real people with verifiable names.";
        const r = await firecrawlScrape(leadershipUrl, apiKey, counter, { jsonPrompt: teamPrompt });
        const ex = extractFromPage({ url: leadershipUrl, ...r }, root);
        mergeExtract(acc, ex);
        await recordPage(leadershipUrl, ex);
      }
    }

    // ──── Tier 3: homepage + map fallback (only if STILL no emails AND no people) ────
    if (acc.emails.size === 0 && acc.people.length === 0 && remaining() > 0) {
      const links = await firecrawlMap(domain, apiKey, counter);
      // Pick most promising in-domain link (not already scraped)
      const candidate = links.find((l) => {
        try {
          const u = new URL(l);
          if (rootDomain(u.hostname) !== root) return false;
          if (scrapedUrls.includes(l)) return false;
          return /\/(kontakt|contact|om-oss|about|ledning|team)/i.test(u.pathname);
        } catch { return false; }
      }) ?? `https://${domain}/`;
      if (remaining() > 0 && !scrapedUrls.includes(candidate)) {
        const r = await firecrawlScrape(candidate, apiKey, counter);
        const ex = extractFromPage({ url: candidate, ...r }, root);
        mergeExtract(acc, ex);
        await recordPage(candidate, ex);
      }
    }

    // ──── Persist ────
    let inserted = { contacts: 0, people: 0, person_emails: 0, synthesized: 0 };

    if (opt.genericEmails || opt.personEmails) {
      for (const e of acc.emails) {
        const cls = classifyEmail(e);
        const isPerson = cls === "person_high" || cls === "person_low";
        if (isPerson && !opt.personEmails) continue;
        if (!isPerson && !opt.genericEmails) continue;
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: isPerson ? "person_email" : "generic_email",
          value: e, source_url: acc.emailSources.get(e) ?? `https://${domain}`,
        });
        if (!error) {
          inserted.contacts++;
          if (isPerson) inserted.person_emails++;
        }
      }
    }
    if (opt.phones) {
      for (const p of acc.phones) {
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "phone", value: p, source_url: `https://${domain}`,
        });
        if (!error) inserted.contacts++;
      }
    }
    if (opt.contactForms) {
      for (const u of acc.forms) {
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "contact_form", value: u, source_url: u,
        });
        if (!error) inserted.contacts++;
      }
    }

    // People: dedupe + rank decision-makers first
    const seen = new Set<string>();
    const dedup = acc.people.filter((p) => {
      const k = p.full_name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    const ranked = rankPeople(dedup);

    if (opt.personNames) {
      for (const p of ranked) {
        const decision = isDecisionMaker(p.role_title);
        const { error } = await supabase.from("contact_people").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          full_name: p.full_name, role_title: p.role_title ?? null, department: p.department ?? null,
          source_url: p.source_url, is_decision_maker: decision,
        });
        if (!error) inserted.people++;

        if (p.email && opt.personEmails) {
          const host = emailHost(p.email);
          if (host && rootDomain(host) === root && !acc.emails.has(p.email)) {
            const { error: e2 } = await supabase.from("contacts").insert({
              company_id: companyId, crawl_job_id: jobId ?? null,
              contact_type: "person_email", value: p.email, source_url: p.source_url,
              is_publicly_listed: true,
            });
            if (!e2) { inserted.contacts++; inserted.person_emails++; acc.emails.add(p.email); }
          }
        }
      }
    }

    // Pattern-based synthesis: prioritize decision-makers
    if (opt.personEmails && opt.personNames && ranked.length > 0) {
      const sample = Array.from(acc.emails).find((e) => {
        const local = e.split("@")[0]?.toLowerCase() ?? "";
        return /^[a-z]+\.[a-z]+$/.test(local) && rootDomain(emailHost(e)) === root;
      });
      if (sample) {
        const peopleNoEmail = ranked.filter((p) => !p.email);
        for (const p of peopleNoEmail) {
          const tokens = p.full_name.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z\s-]/g, "").split(/\s+/).filter(Boolean);
          if (tokens.length < 2) continue;
          const first = tokens[0];
          const last = tokens[tokens.length - 1];
          if (first.length < 2 || last.length < 2) continue;
          const synth = `${first}.${last}@${root}`;
          if (acc.emails.has(synth)) continue;
          const { error } = await supabase.from("contacts").insert({
            company_id: companyId, crawl_job_id: jobId ?? null,
            contact_type: "person_email", value: synth, source_url: p.source_url,
            is_publicly_listed: false,
          });
          if (!error) { inserted.synthesized++; inserted.contacts++; acc.emails.add(synth); }
        }
      }
    }

    // Update job-level credit counter
    if (jobId && counter.calls > 0) {
      // Best-effort atomic increment via raw UPDATE
      await supabase.rpc("exec_sql" as any, {}).catch(() => {});
      // Fallback: read-modify-write
      const { data: jr } = await supabase.from("crawl_jobs").select("firecrawl_calls").eq("id", jobId).maybeSingle();
      const cur = (jr as any)?.firecrawl_calls ?? 0;
      await supabase.from("crawl_jobs").update({ firecrawl_calls: cur + counter.calls }).eq("id", jobId);
    }

    // Timeline
    if (inserted.contacts > 0) {
      const personSamples = Array.from(acc.emails).filter((e) => {
        const c = classifyEmail(e); return c === "person_high" || c === "person_low";
      }).slice(0, 3);
      const genericSamples = Array.from(acc.emails).filter((e) => classifyEmail(e) === "generic").slice(0, 3);
      log("success", `Found ${acc.emails.size} email${acc.emails.size === 1 ? "" : "s"} on ${domain} (${counter.calls} credits)`, {
        event: "emails_found", company: companyName, company_id: companyId, host: domain,
        person_emails: inserted.person_emails,
        generic_emails: inserted.contacts - inserted.person_emails - acc.phones.size - acc.forms.size,
        synthesized: inserted.synthesized,
        samples: [...personSamples, ...genericSamples].slice(0, 3),
        firecrawl_calls: counter.calls,
      });
    }
    if (inserted.people > 0) {
      const decisionCount = ranked.filter((p) => isDecisionMaker(p.role_title)).length;
      log("success", `Extracted ${inserted.people} ${inserted.people === 1 ? "person" : "people"} (${decisionCount} decision-makers) from ${companyName}`, {
        event: "people_extracted", company: companyName, company_id: companyId,
        count: inserted.people, decision_makers: decisionCount,
        samples: ranked.slice(0, 3).map((p) => ({ name: p.full_name, role: p.role_title ?? null, decision: isDecisionMaker(p.role_title) })),
      });
    }

    const summary = {
      domain, pages: scrapedUrls.length,
      emails_found: acc.emails.size,
      person_emails: inserted.person_emails,
      people_extracted: inserted.people,
      synthesized: inserted.synthesized,
      firecrawl_calls: counter.calls,
      llm_calls: counter.llmCalls,
    };
    log(inserted.contacts === 0 ? "warn" : "success",
      inserted.contacts === 0
        ? `No public contacts on ${domain} (${counter.calls} credits used)`
        : `Extracted ${inserted.contacts} contacts from ${domain} (${counter.calls} credits)`,
      summary);

    return new Response(JSON.stringify({
      ...summary, inserted,
      emails: Array.from(acc.emails), phones: Array.from(acc.phones), forms: Array.from(acc.forms),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
