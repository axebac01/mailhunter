// audit-contacts — one-shot data-integrity cleanup for contacts & contact_people.
//
// Applies the data contract retroactively to every row ever scraped:
//
//   contact_people
//     • email_confidence "matched_high"/"matched_low"  → fabricated name OR guessed
//       address. The address itself was published, so it is moved to a nameless
//       company-level contact (contact_type person_email) and the fabricated
//       person row is deleted.
//     • placeholder names ([Name of CFO], "Name Surname", N/A, …) → row deleted,
//       any email moved to a nameless contact.
//     • emails failing format / junk-domain / MX checks → cleared from the row.
//     • surviving emails get email_type (role|personal) + email_status
//       (verified = published + MX-ok, else unverified).
//
//   contacts
//     • rows failing format / junk-domain / MX checks are deleted.
//     • placeholders are deleted.
//
// Idempotent: safe to re-run. Processes in batches to stay within CPU limits.
// POST { batch?: number, offset?: number } → { done, stats, next_offset }

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  EMAIL_FORMAT_RE,
  isRoleAddress,
  emailHost,
  hasMxRecord,
} from "../_shared/emailIntegrity.ts";

const JUNK_DOMAINS = [
  "example.com", "example.org", "example.net", "domain.com", "company.com",
  "test.com", "localhost", "email.com", "yourcompany.com", "sentry.io",
  "wixpress.com", "squarespace.com", "wordpress.com", "godaddy.com",
];

const PLACEHOLDER_NAME_RE =
  /([\[\]{}<>]|\b(name\s+surname|first\s+last|fornamn\s+efternamn|full\s*name|cfo\s+name|ceo\s+name|name\s+of\s+\w+|n\/a|okänd|okand|unknown|tba|tbd)\b)/i;

interface Stats {
  people_rows_deleted: number;
  people_emails_cleared: number;
  people_verified: number;
  people_unverified: number;
  nameless_contacts_created: number;
  contacts_deleted: number;
  mx_lookups: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const batch = Math.min(Math.max(Number(body.batch) || 500, 1), 1000);
    const offset = Math.max(Number(body.offset) || 0, 0);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const stats: Stats = {
      people_rows_deleted: 0,
      people_emails_cleared: 0,
      people_verified: 0,
      people_unverified: 0,
      nameless_contacts_created: 0,
      contacts_deleted: 0,
      mx_lookups: 0,
    };

    // Per-run cache so we only hit the DB/DNS once per domain.
    const mxCache = new Map<string, boolean>();
    const mxOk = async (host: string): Promise<boolean> => {
      if (mxCache.has(host)) return mxCache.get(host)!;
      const ok = await hasMxRecord(host, supabase);
      mxCache.set(host, ok);
      stats.mx_lookups++;
      return ok;
    };

    const emailIsValid = async (email: string): Promise<boolean> => {
      if (!EMAIL_FORMAT_RE.test(email)) return false;
      const host = emailHost(email);
      if (!host) return false;
      if (JUNK_DOMAINS.some((j) => host === j || host.endsWith("." + j))) return false;
      return await mxOk(host);
    };

    // Ensure the moved address exists as a nameless person_email contact.
    const ensureNamelessContact = async (
      companyId: string, email: string, sourceUrl: string | null, jobId: string | null,
    ) => {
      const { error } = await supabase.from("contacts").insert({
        company_id: companyId,
        crawl_job_id: jobId ?? null,
        contact_type: "person_email",
        value: email,
        source_url: sourceUrl ?? "",
      });
      // Unique-violation (already there) is fine — idempotent.
      if (!error) stats.nameless_contacts_created++;
    };

    // ── contact_people ──
    const { data: people, error: pErr } = await supabase
      .from("contact_people")
      .select("id, company_id, crawl_job_id, full_name, email, email_confidence, source_url")
      .order("id")
      .range(offset, offset + batch - 1);
    if (pErr) return json({ error: `read contact_people failed: ${pErr.message}` }, 500);

    for (const p of people ?? []) {
      const fabricated =
        p.email_confidence === "matched_high" || p.email_confidence === "matched_low";
      const placeholder = PLACEHOLDER_NAME_RE.test(p.full_name ?? "");

      if (fabricated || placeholder) {
        // The address (if any) was published — keep it as a nameless contact,
        // then remove the fabricated person row.
        if (p.email && (await emailIsValid(p.email))) {
          await ensureNamelessContact(p.company_id, p.email, p.source_url, p.crawl_job_id);
        }
        await supabase.from("contact_people").delete().eq("id", p.id);
        stats.people_rows_deleted++;
        continue;
      }

      if (p.email) {
        if (!(await emailIsValid(p.email))) {
          await supabase.from("contact_people").update({
            email: null, email_confidence: null, email_type: null, email_status: null,
          }).eq("id", p.id);
          stats.people_emails_cleared++;
          continue;
        }
        const type = isRoleAddress(p.email) ? "role" : "personal";
        // "extracted" = address was verbatim on the company's own site.
        const status = p.email_confidence === "extracted" ? "verified" : "unverified";
        if (status === "verified") stats.people_verified++;
        else stats.people_unverified++;
        await supabase.from("contact_people").update({
          email_type: type, email_status: status,
        }).eq("id", p.id);
      }
    }

    // ── contacts ──
    const { data: contacts, error: cErr } = await supabase
      .from("contacts")
      .select("id, contact_type, value")
      .in("contact_type", ["generic_email", "person_email"])
      .order("id")
      .range(offset, offset + batch - 1);
    if (cErr) return json({ error: `read contacts failed: ${cErr.message}` }, 500);

    for (const c of contacts ?? []) {
      const v = (c.value ?? "").toLowerCase().trim();
      if (!(await emailIsValid(v))) {
        await supabase.from("contacts").delete().eq("id", c.id);
        stats.contacts_deleted++;
      }
    }

    const processed = (people?.length ?? 0);
    const done = processed < batch;
    return json({
      done,
      processed_people: processed,
      processed_contacts: contacts?.length ?? 0,
      next_offset: done ? null : offset + batch,
      stats,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
