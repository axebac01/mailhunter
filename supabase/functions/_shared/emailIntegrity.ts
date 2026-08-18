// Shared email-integrity helpers — used by scrape-emails (Deno), audit-contacts (Deno)
// and the frontend exporters (Vite). Keep this file free of Deno-only APIs so the
// browser bundle can import it.

// Strict address format per data contract: ^[^\s@]+@[^\s@]+\.[a-z]{2,}$
export const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// Role-based / non-personal local parts. Addresses with these prefixes are
// company-level ("role") addresses, never personal ones.
export const ROLE_PREFIXES = new Set([
  "info","sales","contact","hello","support","office","admin","help","service","services",
  "team","mail","email","press","media","marketing","pr","jobs","careers","career","hr",
  "recruiting","recruitment","kontakt","kundtjanst","kundservice","post","booking","reception",
  "noreply","no-reply","do-not-reply","donotreply","newsletter","billing","invoice","invoices",
  "accounts","accounting","finance","legal","privacy","gdpr","dpo","security","abuse",
  "webmaster","postmaster","hostmaster","enquiries","enquiry","inquiry","inquiries","general",
  "welcome","feedback","orders","order","shop","store","customerservice","customer-service",
  "vd","ceo","cfo","styrelse","ledning","board",
]);

/** True when the address local-part marks a role/function mailbox (info@, vd@, …). */
export function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (!local) return false;
  const base = local.split("+")[0];
  if (ROLE_PREFIXES.has(base)) return true;
  const head = base.split(/[._-]/)[0];
  return ROLE_PREFIXES.has(head);
}

export function emailHost(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export function rootDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const ccTwoLevel = ["co.uk","com.au","co.nz","com.br","co.jp","com.mx","co.za"];
  const lastTwo = `${sld}.${tld}`;
  if (ccTwoLevel.includes(lastTwo) && parts.length >= 3) return `${parts[parts.length - 3]}.${lastTwo}`;
  return lastTwo;
}

/**
 * MX-record check with a shared cache table (domain_mx_cache) so each domain is
 * only looked up once across all jobs and audits. Uses DNS-over-HTTPS because
 * edge functions cannot open raw DNS sockets.
 *
 * Returns true on transient lookup failure (benefit of the doubt — the audit
 * pass re-checks later) and does NOT cache that outcome.
 */
export async function hasMxRecord(domain: string, supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("domain_mx_cache")
      .select("has_mx")
      .eq("host", domain)
      .maybeSingle();
    if (data) return data.has_mx === true;
  } catch { /* cache unavailable — fall through to lookup */ }

  let ok: boolean;
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`);
    const j = await res.json().catch(() => null);
    ok = Array.isArray(j?.Answer) && j.Answer.length > 0;
  } catch {
    return true; // transient DNS failure — do not punish the company, do not cache
  }

  try {
    await supabase
      .from("domain_mx_cache")
      .upsert({ host: domain, has_mx: ok, checked_at: new Date().toISOString() });
  } catch { /* cache write is best-effort */ }
  return ok;
}
