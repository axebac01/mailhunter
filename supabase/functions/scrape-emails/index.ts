// Tiered, credit-frugal email + decision-maker extraction for a single company.
// People-first model: every person row (contact_people) holds name + role + email + phone
// together. Generic info@/sales@ + phone stay in contacts as company-level fallback.
//
// DATA-INTEGRITY RULES (never violate):
//   • Never guess or construct addresses (no fornamn.efternamn@domain synthesis).
//   • A person's email is only saved when the address appears verbatim on the page.
//   • A person's name must appear verbatim in the page text (LLM output cross-checked).
//   • Person addresses with no name on the page → nameless person_email contacts,
//     never fabricated person rows.
//   • Every address is validated: format, company-domain ownership, MX record.
//
// Pipeline:
//   0. Domain-cache: copy generic contacts from sibling with same domain (0 credits)
//   1. Tier 1: scrape canonical /kontakt page (1 credit). Regex emails/phones/forms.
//   2. Tier 2 (always when personNames): up to 2 leadership pages with JSON-extract.
//      Server-side filter keeps only decision-maker roles.
//   3. Tier 3 (only if 0 emails AND 0 people): map(limit 30) + scrape best link.
// Hard cap: 6 Firecrawl calls + 2 LLM-extracts per company.
// People cap: max 5 ranked people per company.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { TITLE_GROUPS, matchesTitleGroups } from "../_shared/titleGroups.ts";
import { EMAIL_FORMAT_RE, ROLE_PREFIXES, isRoleAddress, hasMxRecord } from "../_shared/emailIntegrity.ts";

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

// ─────────────────────────── classification helpers ──────────────────────────

// Role/function mailbox prefixes (info@, vd@, …) — single source of truth in _shared.
const GENERIC_PREFIXES = ROLE_PREFIXES;

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

type Counter = { calls: number; llmCalls: number; paymentRequired?: boolean };

// Firecrawl signals an exhausted credit balance with 402 (and sometimes 429 +
// an "insufficient credits" body). Flag it so the caller can pause the job
// instead of silently grinding through the whole queue saving nothing.
function flagPayment(counter: Counter, status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  if (status === 402 || /insufficient credits|payment required|out of credits/i.test(text)) {
    counter.paymentRequired = true;
  }
}

async function firecrawlMap(domain: string, apiKey: string, counter: Counter): Promise<string[]> {
  counter.calls++;
  const res = await fetch(`${FIRECRAWL_V2}/map`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: `https://${domain}`, limit: 30 }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { flagPayment(counter, res.status, j); return []; }
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
  if (!res.ok) { flagPayment(counter, res.status, j); return {}; }

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
    if (!EMAIL_FORMAT_RE.test(e)) continue; // strict format: ^[^\s@]+@[^\s@]+\.[a-z]{2,}$
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
    // Never store placeholders/templates ([Name of CFO], "Name Surname", N/A, …).
    if (PLACEHOLDER_NAME_RE.test(name)) continue;
    // Never store a name that is not actually on the page (LLM hallucination guard).
    if (!nameAppearsInText(name, page.markdown, cleanHtml)) continue;
    // An LLM-returned email is only accepted when the exact address was found on
    // the page by the verbatim extractors above — never trust the LLM alone.
    const llmEmail = p?.email && String(p.email).includes("@") ? String(p.email).toLowerCase().trim() : undefined;
    const verifiedEmail = llmEmail && out.emails.has(llmEmail) ? llmEmail : undefined;
    out.people.push({
      full_name: name,
      role_title: p?.role_title ? String(p.role_title).slice(0, 120) : undefined,
      department: p?.department ? String(p.department).slice(0, 80) : undefined,
      email: verifiedEmail,
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

// ─────────────────────────── name<->email matching ───────────────────────────

// ─────────────────────────── person-name integrity guards ────────────────────

// Placeholder / template patterns that must never be stored as a person name.
const PLACEHOLDER_NAME_RE = /([\[\]{}<>]|\b(name\s+surname|first\s+last|fornamn\s+efternamn|full\s*name|cfo\s+name|ceo\s+name|name\s+of\s+\w+|n\/a|okänd|okand|unknown|tba|tbd)\b)/i;

// A name is only accepted when it appears verbatim in the page text the LLM read.
// This kills hallucinated executives that were never on the page.
function nameAppearsInText(fullName: string, ...texts: (string | undefined)[]): boolean {
  const clean = (s: string) => s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
  const haystack = clean(texts.filter(Boolean).join("\n"));
  const needle = clean(fullName).trim();
  return needle.length >= 3 && haystack.includes(needle);
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
      targetRoles: (Array.isArray(options?.targetRoles) ? options.targetRoles : []) as string[],
      onePersonPerCompany: options?.onePersonPerCompany === true,
    };
    // Target-role matching: strict group match when roles are selected, else any decision-maker.
    const satisfiedBy = (role?: string | null): boolean =>
      opt.targetRoles.length > 0 ? matchesTitleGroups(role, opt.targetRoles) : isDecisionMaker(role);
    // Extraction filter: decision-makers plus selected target groups (fallback people survive).
    const keepPerson = (role?: string | null): boolean =>
      isDecisionMaker(role) || matchesTitleGroups(role, opt.targetRoles);

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
          // Target-role / one-per-company jobs: also copy the best matching person from siblings.
          if (opt.targetRoles.length > 0 || opt.onePersonPerCompany) {
            try {
              const { data: sibPeople } = await supabase
                .from("contact_people")
                .select("full_name, role_title, department, email, email_confidence, email_type, email_status, is_decision_maker, source_url")
                .in("company_id", siblingIds)
                .limit(200);
              // Legacy fabricated rows (name guessed from the address) are never copied.
              const list = ((sibPeople ?? []) as any[])
                .filter((p) => p.email_confidence !== "matched_high" && p.email_confidence !== "matched_low");
              if (list.length > 0) {
                const confRank = (c: string | null) => c === "extracted" ? 1 : 0;
                list.sort((a, b) => {
                  const t = (satisfiedBy(b.role_title) ? 1 : 0) - (satisfiedBy(a.role_title) ? 1 : 0);
                  if (t) return t;
                  const d = (b.is_decision_maker ? 1 : 0) - (a.is_decision_maker ? 1 : 0);
                  if (d) return d;
                  const e = (b.email ? 1 : 0) - (a.email ? 1 : 0);
                  if (e) return e;
                  return confRank(b.email_confidence) - confRank(a.email_confidence);
                });
                const best = list[0];
                const { error } = await supabase.from("contact_people").insert({
                  company_id: companyId, crawl_job_id: jobId ?? null,
                  full_name: best.full_name, role_title: best.role_title ?? null,
                  department: best.department ?? null, source_url: best.source_url,
                  is_decision_maker: best.is_decision_maker ?? false,
                  email: best.email ?? null, email_confidence: best.email_confidence ?? null,
                  email_type: best.email_type ?? null, email_status: best.email_status ?? null,
                });
                if (!error) log("info", `Copied person ${best.full_name} from domain cache`, {
                  event: "person_cache_copy", company_id: companyId, host: domain,
                  person: best.full_name, role: best.role_title ?? null,
                });
              }
            } catch { /* non-fatal */ }
          }
          return new Response(JSON.stringify({
            domain, pages: 0, emails_found: 0, person_emails: 0, people_extracted: 0,
            cached: true, copied, firecrawl_calls: 0,
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

    const HARD_CAP = 6;
    const remaining = () => HARD_CAP - counter.calls;

    // Early-stop check: a target-role person with a page-verified email found?
    // (emails on people are only set when the address appears verbatim on the page)
    const hasTargetWithEmail = (): boolean => {
      const seenNames = new Set<string>();
      for (const p of acc.people) {
        const k = p.full_name.toLowerCase();
        if (seenNames.has(k)) continue;
        seenNames.add(k);
        if (!satisfiedBy(p.role_title)) continue;
        if (p.email) return true;
      }
      return false;
    };

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

    // ──── Tier 2: leadership/team pages with JSON-extract (always when personNames) ────
    // Run on every company that opted in to personNames — this is how we get names + roles.
    // Cap: up to 2 distinct leadership pages per company (e.g. /ledning + /styrelse).
    if ((opt.personNames || opt.targetRoles.length > 0) && remaining() > 0 && counter.llmCalls < 2) {
      const leadershipCandidates = LEADERSHIP_PATHS.map((p) => `https://${domain}${p}`);
      const probes = await Promise.all(leadershipCandidates.map(async (u) => ({ u, ok: await headOk(u) })));
      const reachable = probes.filter((p) => p.ok).map((p) => p.u);
      // Dedupe by pathname; pick at most 2 distinct pages
      const picked: string[] = [];
      const seenPaths = new Set<string>();
      for (const u of reachable) {
        try {
          const path = new URL(u).pathname.toLowerCase().replace(/\/$/, "");
          if (seenPaths.has(path)) continue;
          seenPaths.add(path);
          picked.push(u);
          if (picked.length >= 2) break;
        } catch { /* ignore */ }
      }

      const teamPromptBase = "Extract ONLY senior executives and board members from this page (CEO/VD, CFO, COO, CTO, CMO, CIO, CRO, CCO, President, Managing Director, Chairman/Ordförande, Founder/Grundare, Owner/Ägare, Partner, Head of <department>, Director, VP). Skip junior staff, sales reps, support, developers, consultants without titles. Return JSON: { people: [{ full_name, role_title, department, email }] }. Only include real people whose role_title clearly matches a leadership / C-level / board position.";
      // Target-role jobs: steer the LLM towards the selected roles first.
      const teamPrompt = opt.targetRoles.length > 0
        ? `${teamPromptBase} PRIORITY: we specifically want people in these roles: ${TITLE_GROUPS.filter((g) => opt.targetRoles.includes(g.id)).map((g) => g.label).join(", ")}. Extract every person holding such a title first.`
        : teamPromptBase;

      for (const url of picked) {
        if (remaining() <= 0 || counter.llmCalls >= 2) break;
        const r = await firecrawlScrape(url, apiKey, counter, { jsonPrompt: teamPrompt });
        const ex = extractFromPage({ url, ...r }, root);
        // Server-side filter: keep decision-makers plus people in the job's target roles.
        ex.people = ex.people.filter((p) => keepPerson(p.role_title));
        mergeExtract(acc, ex);
        await recordPage(url, ex);
        // Early stop: once a target-role person has an email, skip remaining pages (saves credits).
        if ((opt.onePersonPerCompany || opt.targetRoles.length > 0) && hasTargetWithEmail()) {
          log("success", `Early stop for ${domain}: target person with email found — skipping remaining pages`, {
            event: "early_stop_target", company_id: companyId, host: domain, firecrawl_calls: counter.calls,
          });
          break;
        }
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
    // People-first model (strict integrity):
    //   • generic emails + phones + forms  → contacts (company-level fallback)
    //   • contact_people rows              → name + role + verbatim-verified email only
    //   • nameless person-pattern emails   → contacts (contact_type person_email)
    // No fabricated names. No guessed addresses. No placeholders.
    let inserted = { contacts: 0, people: 0, person_emails: 0 };

    // MX-record gate: a domain that cannot receive mail invalidates every
    // address on it. Cached per domain across all jobs via domain_mx_cache.
    const domainAcceptsMail = acc.emails.size > 0 ? await hasMxRecord(domain, supabase) : false;
    if (acc.emails.size > 0 && !domainAcceptsMail) {
      log("warn", `Dropped ${acc.emails.size} address(es) on ${domain} — domain has no MX record`, {
        event: "mx_failed", company_id: companyId, host: domain, dropped: acc.emails.size,
      });
    }
    const keepEmail = (_e: string) => domainAcceptsMail;

    // Generic emails → contacts
    if (opt.genericEmails) {
      for (const e of acc.emails) {
        if (classifyEmail(e) !== "generic") continue;
        if (!keepEmail(e)) continue;
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "generic_email",
          value: e, source_url: acc.emailSources.get(e) ?? `https://${domain}`,
        });
        if (!error) inserted.contacts++;
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
    // Cap persisted people per company — large team pages otherwise flood a
    // company with dozens of rows. Ranked: decision-makers first, email first.
    // Hard cap is 3 (user rule: "helst 1, max 3 per bolag").
    // onePersonPerCompany: the final pick happens below, keep everyone until then.
    const MAX_PEOPLE_PER_COMPANY = 3;
    let ranked = opt.onePersonPerCompany ? rankPeople(dedup) : rankPeople(dedup).slice(0, MAX_PEOPLE_PER_COMPANY);

    // NO name→email guessing pass. A person keeps only the email that the
    // verbatim extractor already confirmed on the page (see extractFromPage).

    // Final selection for target-role / one-person-per-company jobs.
    if (opt.onePersonPerCompany && ranked.length > 1) {
      const confVal = (p: (typeof ranked)[number]): number => (p.email ? 3 : 0);
      ranked = [...ranked].sort((a, b) => {
        const t = (satisfiedBy(b.role_title) ? 1 : 0) - (satisfiedBy(a.role_title) ? 1 : 0);
        if (t) return t;
        const d = (isDecisionMaker(b.role_title) ? 1 : 0) - (isDecisionMaker(a.role_title) ? 1 : 0);
        if (d) return d;
        const e = (b.email ? 1 : 0) - (a.email ? 1 : 0);
        if (e) return e;
        return confVal(b) - confVal(a);
      }).slice(0, 1);
    } else if (opt.targetRoles.length > 0) {
      // Prefer people in the selected roles; keep best decision-makers as fallback when none match.
      const matches = ranked.filter((p) => matchesTitleGroups(p.role_title, opt.targetRoles));
      if (matches.length > 0) ranked = matches;
    }

    if (opt.personNames) {
      for (const p of ranked) {
        const decision = isDecisionMaker(p.role_title);
        const email = p.email && keepEmail(p.email) ? p.email : null;
        const { error } = await supabase.from("contact_people").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          full_name: p.full_name, role_title: p.role_title ?? null, department: p.department ?? null,
          source_url: p.source_url, is_decision_maker: decision,
          email,
          email_confidence: email ? "extracted" : null,
          email_type: email ? (isRoleAddress(email) ? "role" : "personal") : null,
          // Found verbatim on the company's own website + domain MX-checked.
          email_status: email ? "verified" : null,
        });
        if (!error) {
          inserted.people++;
          if (email) inserted.person_emails++;
        }
      }
    }

    // Person-pattern emails found verbatim on the page but with NO name on the
    // page are kept as nameless company-level contacts — never turned into
    // fabricated person rows.
    if (opt.genericEmails) {
      for (const e of acc.emails) {
        const c = classifyEmail(e);
        if (c !== "person_high" && c !== "person_low") continue;
        if (!keepEmail(e)) continue;
        // Skip addresses already stored on a person row (verbatim-linked).
        if (ranked.some((p) => p.email === e)) continue;
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "person_email",
          value: e, source_url: acc.emailSources.get(e) ?? `https://${domain}`,
        });
        if (!error) { inserted.contacts++; inserted.person_emails++; }
      }
    }



    // Update job-level credit counter atomically (avoids parallel races)
    if (jobId && counter.calls > 0) {
      await supabase.rpc("increment_firecrawl_calls", { job_id: jobId, delta: counter.calls });
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
