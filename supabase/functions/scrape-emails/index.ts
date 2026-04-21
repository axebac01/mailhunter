// World-class person-email extraction for a single company.
// Pipeline: discover (map + canonical guesses + sub-team hop) → scrape in parallel
// → normalize/de-obfuscate → regex + JSON-mode person extraction → classify →
// optional pattern-based synthesis → MX provider lookup → DB inserts.
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

// Top first names (Nordic + EN) to validate single-word locals like `anna@`.
const FIRST_NAMES = new Set([
  // Swedish
  "anna","maria","lena","karin","eva","sara","emma","linda","jenny","malin","sofia","johanna","kristin","camilla","julia","elin","ida","hanna","matilda","ebba","alice","alma","wilma","stella","ella","lisa","kim","therese","frida","klara","cecilia","annika","helena","marie","ann","monica","ulla","ingrid","gunilla","kerstin","birgitta","margareta","elisabeth",
  "erik","lars","karl","carl","anders","johan","mikael","mattias","andreas","per","peter","jonas","fredrik","henrik","gustav","oskar","oscar","alexander","viktor","filip","emil","lukas","hugo","nils","axel","liam","noah","william","leo","theo","elias","arvid","sebastian","daniel","magnus","björn","bjorn","tomas","thomas","martin","ola","stefan","bo","sven","hans","gunnar","rolf","per-olof","jan",
  // Norwegian/Danish/Finnish
  "ola","kari","ingrid","liv","mette","helle","aino","kaisa","mikko","jukka","jari","matti","timo","janne","ville","antti","tuomas",
  // English
  "james","john","robert","michael","william","david","richard","joseph","thomas","charles","christopher","daniel","matthew","anthony","mark","donald","steven","paul","andrew","joshua","kenneth","kevin","brian","george","edward","ronald","timothy","jason","jeffrey","ryan","jacob","gary","nicholas","eric","jonathan","stephen","larry","justin","scott","brandon","frank","benjamin","gregory","samuel","raymond","patrick","alexander","jack","dennis","jerry","tyler","aaron","henry","douglas","jose","peter","adam","nathan","zachary","walter","kyle","harold","carl","arthur","gerald","roger","keith","jeremy","lawrence","sean","christian","ethan","austin","joe",
  "mary","patricia","jennifer","linda","elizabeth","barbara","susan","jessica","sarah","karen","nancy","lisa","betty","helen","sandra","donna","carol","ruth","sharon","michelle","laura","sarah","kimberly","deborah","dorothy","amy","angela","ashley","brenda","emma","olivia","cynthia","marie","janet","catherine","frances","christine","samantha","debra","rachel","carolyn","janet","virginia","maria","heather","diane","julie","joyce","victoria","kelly","christina","joan","evelyn","lauren","judith","megan","cheryl","andrea","hannah","jacqueline","martha","gloria","teresa","ann","sara","madison","grace","julia","theresa","rose","janice","nicole","kathryn","jean","abigail","alice","julia","judy","sophia","beverly","denise","marilyn","amber","danielle","brittany","diana","natalie","sara",
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
  // firstname.lastname / f.lastname → high confidence person
  if (/^[a-z]+[._-][a-z]{2,}$/.test(base)) return "person_high";
  // single token: only person if it's a known first name
  if (/^[a-z]{2,}$/.test(base) && FIRST_NAMES.has(base)) return "person_high";
  // numbers in local → likely not a public business person email
  if (/\d/.test(base)) return "generic";
  return "person_low";
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

// ─────────────────────────── de-obfuscation ──────────────────────────────────

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(parseInt(n, 10)); } catch { return _; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
      try { return String.fromCharCode(parseInt(n, 16)); } catch { return _; }
    })
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&");
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

// Decode Cloudflare email-protection: hex string where byte 0 is the XOR key.
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

// ─────────────────────────── Firecrawl wrappers ──────────────────────────────

async function firecrawlMap(domain: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${FIRECRAWL_V2}/map`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: `https://${domain}`, limit: 200 }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  const links: string[] = Array.isArray(j?.links) ? j.links : Array.isArray(j?.data?.links) ? j.data.links : [];
  return links;
}

async function firecrawlScrape(url: string, apiKey: string, opts?: { wait?: boolean; jsonPrompt?: string }): Promise<{ markdown?: string; html?: string; json?: any }> {
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
    return res.ok || res.status === 405; // some sites disallow HEAD but the page exists
  } catch { return false; }
}

// ─────────────────────────── page discovery ──────────────────────────────────

const TEAM_KEYWORDS = ["contact","kontakt","kontakta","about","om-oss","over-ons","impressum","imprint","team","people","staff","medarbetare","personal","ledning","management","board","styrelse","advisors","leadership","press","media","legal"];
const CANONICAL_PATHS = ["/", "/contact", "/kontakt", "/kontakta", "/about", "/about-us", "/om-oss", "/team", "/medarbetare", "/people", "/staff", "/impressum"];

function classifyPage(url: string): "homepage"|"contact"|"about"|"team"|"people"|"other" {
  const p = url.toLowerCase();
  if (/\/(team|medarbetare|staff|people|personal|ledning|leadership|board|styrelse)\b/.test(p)) return "team";
  if (/\/(contact|kontakt|kontakta|impressum|imprint)\b/.test(p)) return "contact";
  if (/\/(about|om-oss|over-ons)\b/.test(p)) return "about";
  if (new URL(p, "https://x").pathname === "/") return "homepage";
  return "other";
}

async function discoverPages(domain: string, apiKey: string): Promise<string[]> {
  const root = rootDomain(domain);
  const links = await firecrawlMap(domain, apiKey);
  const inDomain = links.filter((l) => {
    try { return rootDomain(new URL(l).hostname) === root; } catch { return false; }
  });
  const matched = inDomain.filter((l) => {
    const p = l.toLowerCase();
    return TEAM_KEYWORDS.some((w) => p.includes(`/${w}`));
  });
  const set = new Set<string>([`https://${domain}`, ...matched.slice(0, 10)]);

  // Probe canonical guesses not already present.
  const guesses = CANONICAL_PATHS.map((p) => `https://${domain}${p}`).filter((u) => !set.has(u));
  const probes = await Promise.all(guesses.map(async (u) => ({ u, ok: await headOk(u) })));
  for (const { u, ok } of probes) if (ok) set.add(u);

  return Array.from(set).slice(0, 12);
}

function extractInDomainLinks(html: string, domain: string): string[] {
  const root = rootDomain(domain);
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let raw = m[1];
    if (raw.startsWith("/")) raw = `https://${domain}${raw}`;
    if (!/^https?:\/\//i.test(raw)) continue;
    try {
      const u = new URL(raw);
      if (rootDomain(u.hostname) !== root) continue;
      out.push(u.toString().split("#")[0]);
    } catch { /* skip */ }
  }
  return out;
}

// ─────────────────────────── MX provider ─────────────────────────────────────

async function detectMxProvider(domain: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=MX`, {
      headers: { accept: "application/dns-json" }, signal: ctrl.signal,
    });
    clearTimeout(t);
    const j = await r.json().catch(() => ({}));
    const answers: any[] = j?.Answer ?? [];
    const blob = answers.map((a) => String(a.data ?? "")).join(" ").toLowerCase();
    if (blob.includes("google") || blob.includes("googlemail")) return "google";
    if (blob.includes("outlook") || blob.includes("protection.outlook") || blob.includes("microsoft")) return "microsoft";
    if (blob.includes("zoho")) return "zoho";
    if (blob.includes("proton")) return "proton";
    return answers.length ? "other" : "none";
  } catch { return "unknown"; }
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

    const log = (level: string, message: string, meta?: any) => {
      if (jobId) supabase.from("crawl_logs").insert({ crawl_job_id: jobId, level, message, meta_json: meta ?? null }).then(() => {});
    };

    const root = rootDomain(domain);

    // 1) Discover pages
    let pages = await discoverPages(domain, apiKey);
    log("info", `Discovered ${pages.length} pages on ${domain}`);

    // 2) Scrape initial pages in parallel
    const teamPagePrompt = "Extract all named individuals (employees, founders, staff, board members) with their role and email if visible. Return JSON: { people: [{ full_name, role_title, department, email }] }. Only include real people, not testimonials.";

    const initialResults = await Promise.all(pages.map(async (url) => {
      const isTeam = ["team","contact","about"].includes(classifyPage(url));
      const r = await firecrawlScrape(url, apiKey, isTeam ? { jsonPrompt: teamPagePrompt } : undefined);
      return { url, ...r };
    }));

    // 3) Sub-team hop: from any team page, follow up to 8 internal profile-looking links
    const subLinks = new Set<string>();
    for (const r of initialResults) {
      if (classifyPage(r.url) !== "team" || !r.html) continue;
      for (const l of extractInDomainLinks(r.html, domain)) {
        if (subLinks.size >= 8) break;
        if (pages.includes(l)) continue;
        if (/\/(team|people|medarbetare|staff)\//i.test(l) || /\/[a-z]+-[a-z]+(-[a-z]+)?\/?$/i.test(l)) {
          subLinks.add(l);
        }
      }
    }
    const subResults = await Promise.all(Array.from(subLinks).slice(0, 8).map(async (url) => {
      const r = await firecrawlScrape(url, apiKey, { jsonPrompt: teamPagePrompt });
      return { url, ...r };
    }));

    const allResults = [...initialResults, ...subResults];
    pages = allResults.map((r) => r.url);

    // 4) Process each page: dedup, normalize, regex, mailto, cfemail; collect people
    const foundEmails = new Set<string>();
    const foundPhones = new Set<string>();
    const foundForms = new Set<string>();
    const emailSources = new Map<string, string>();
    const peopleAcc: { full_name: string; role_title?: string; department?: string; email?: string; source_url: string }[] = [];

    for (const r of allResults) {
      const rawHtml = r.html ?? "";
      const cleanHtml = stripNoise(rawHtml);
      const blob = deobfuscate(`${r.markdown ?? ""}\n${cleanHtml}`);

      const emails = new Set<string>();
      for (const m of blob.match(EMAIL_RE) ?? []) emails.add(m.toLowerCase());
      for (const e of extractMailtos(rawHtml)) emails.add(e.toLowerCase());
      for (const e of extractCfEmails(rawHtml)) emails.add(e.toLowerCase());

      // JS-rendered fallback if page mentions email but yielded nothing
      if (emails.size === 0 && /(email|e-?post|kontakt|contact)/i.test(blob)) {
        const r2 = await firecrawlScrape(r.url, apiKey, { wait: true });
        const blob2 = deobfuscate(`${r2.markdown ?? ""}\n${stripNoise(r2.html ?? "")}`);
        for (const m of blob2.match(EMAIL_RE) ?? []) emails.add(m.toLowerCase());
        for (const e of extractMailtos(r2.html ?? "")) emails.add(e.toLowerCase());
      }

      for (const e of emails) {
        const host = emailHost(e);
        if (!host) continue;
        if (JUNK_DOMAINS.some((j) => host === j || host.endsWith("." + j))) continue;
        if (rootDomain(host) !== root) continue;
        if (e.includes("..") || e.length > 80) continue;
        foundEmails.add(e);
        if (!emailSources.has(e)) emailSources.set(e, r.url);
      }

      // Phones
      const phoneCandidates: string[] = [];
      for (const m of blob.matchAll(PHONE_INTL_RE)) phoneCandidates.push(m[0]);
      for (const m of rawHtml.matchAll(TEL_HREF_RE)) phoneCandidates.push(m[1]);
      for (const raw of phoneCandidates) {
        const cleaned = raw.replace(/[^\d+]/g, "");
        const digits = cleaned.replace(/\D/g, "");
        if (digits.length >= 8 && digits.length <= 15) foundPhones.add(raw.trim());
      }

      if (/\/(contact|kontakt|kontakta)/i.test(r.url) && /<form[\s>]/i.test(rawHtml)) {
        foundForms.add(r.url);
      }

      // People from JSON-mode extraction
      const ppl: any[] = Array.isArray(r.json?.people) ? r.json.people : [];
      for (const p of ppl) {
        const name = String(p?.full_name ?? "").trim();
        if (!name || name.length > 100 || !/\s/.test(name)) continue;
        peopleAcc.push({
          full_name: name,
          role_title: p?.role_title ? String(p.role_title).slice(0, 120) : undefined,
          department: p?.department ? String(p.department).slice(0, 80) : undefined,
          email: p?.email && String(p.email).includes("@") ? String(p.email).toLowerCase() : undefined,
          source_url: r.url,
        });
      }

      // Source page record
      await supabase.from("source_pages").insert({
        company_id: companyId, crawl_job_id: jobId ?? null, url: r.url,
        page_type: classifyPage(r.url),
        status_code: 200,
        extracted_summary: `${emails.size} emails, ${phoneCandidates.length} phone candidates, ${ppl.length} people`,
      });
    }

    // 5) Deduplicate people by full_name (case-insensitive)
    const seen = new Set<string>();
    const dedupPeople = peopleAcc.filter((p) => {
      const k = p.full_name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // 6) Insert contacts
    let inserted = { contacts: 0, people: 0, person_emails: 0, synthesized: 0 };

    if (opt.genericEmails || opt.personEmails) {
      for (const e of foundEmails) {
        const cls = classifyEmail(e);
        const isPerson = cls === "person_high" || cls === "person_low";
        if (isPerson && !opt.personEmails) continue;
        if (!isPerson && !opt.genericEmails) continue;
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: isPerson ? "person_email" : "generic_email",
          value: e, source_url: emailSources.get(e) ?? `https://${domain}`,
        });
        if (!error) {
          inserted.contacts++;
          if (isPerson) inserted.person_emails++;
        }
      }
    }
    if (opt.phones) {
      for (const p of foundPhones) {
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "phone", value: p, source_url: `https://${domain}`,
        });
        if (!error) inserted.contacts++;
      }
    }
    if (opt.contactForms) {
      for (const u of foundForms) {
        const { error } = await supabase.from("contacts").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          contact_type: "contact_form", value: u, source_url: u,
        });
        if (!error) inserted.contacts++;
      }
    }

    // 7) Insert people; auto-add their company-domain emails as person_email contacts
    if (opt.personNames) {
      for (const p of dedupPeople) {
        const { error } = await supabase.from("contact_people").insert({
          company_id: companyId, crawl_job_id: jobId ?? null,
          full_name: p.full_name, role_title: p.role_title ?? null, department: p.department ?? null,
          source_url: p.source_url,
        });
        if (!error) inserted.people++;

        if (p.email && opt.personEmails) {
          const host = emailHost(p.email);
          if (host && rootDomain(host) === root && !foundEmails.has(p.email)) {
            const { error: e2 } = await supabase.from("contacts").insert({
              company_id: companyId, crawl_job_id: jobId ?? null,
              contact_type: "person_email", value: p.email, source_url: p.source_url,
              is_publicly_listed: true,
            });
            if (!e2) { inserted.contacts++; inserted.person_emails++; foundEmails.add(p.email); }
          }
        }
      }
    }

    // 8) Pattern-based synthesis (gated)
    if (opt.personEmails && opt.personNames && dedupPeople.length > 0) {
      // Look for a confirmed firstname.lastname@root pattern
      const sample = Array.from(foundEmails).find((e) => {
        const local = e.split("@")[0]?.toLowerCase() ?? "";
        return /^[a-z]+\.[a-z]+$/.test(local) && rootDomain(emailHost(e)) === root;
      });
      if (sample) {
        const pattern = "first.last"; // only synthesize the confirmed pattern
        const peopleNoEmail = dedupPeople.filter((p) => !p.email);
        for (const p of peopleNoEmail) {
          const tokens = p.full_name.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z\s-]/g, "").split(/\s+/).filter(Boolean);
          if (tokens.length < 2) continue;
          const first = tokens[0];
          const last = tokens[tokens.length - 1];
          if (first.length < 2 || last.length < 2) continue;
          const synth = `${first}.${last}@${root}`;
          if (foundEmails.has(synth)) continue;
          const { error } = await supabase.from("contacts").insert({
            company_id: companyId, crawl_job_id: jobId ?? null,
            contact_type: "person_email", value: synth, source_url: p.source_url,
            is_publicly_listed: false,
          });
          if (!error) { inserted.synthesized++; inserted.contacts++; foundEmails.add(synth); }
        }
        log("info", `Synthesized ${inserted.synthesized} emails using pattern "${pattern}" on ${root}`);
      }
    }

    // 9) MX provider (logged only)
    const mx = await detectMxProvider(root);

    const summary = {
      domain, pages: pages.length,
      emails_found: foundEmails.size,
      person_emails: inserted.person_emails,
      people_extracted: inserted.people,
      synthesized: inserted.synthesized,
      mx_provider: mx,
    };
    log(inserted.contacts === 0 ? "warn" : "success",
      inserted.contacts === 0 ? `No public contacts on ${domain}` : `Extracted ${inserted.contacts} contacts (${inserted.person_emails} person, ${inserted.people} people) from ${domain}`,
      summary);

    return new Response(JSON.stringify({
      ...summary, inserted,
      emails: Array.from(foundEmails), phones: Array.from(foundPhones), forms: Array.from(foundForms),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
