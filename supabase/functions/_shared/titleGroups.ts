// Shared title groups — used by the scrape-emails edge function (Deno) and the frontend (Vite).
// Single source of truth so the scraper's target-role matching and the export filter never drift.

export interface TitleGroup {
  id: string;
  label: string;
  re: RegExp;
}

// Preset title groups; case-insensitive matching against the raw role_title
// (values are messy free text like "Partner, Corporate Finance" or "CEO/VD").
export const TITLE_GROUPS: TitleGroup[] = [
  { id: "ceo", label: "CEO / VD / Managing Director", re: /\b(ceo|c\.e\.o|vd|verkst[äa]llande\s+direkt[öo]r|managing\s+director|md|president)\b/i },
  { id: "cfo", label: "CFO / Ekonomichef", re: /\b(cfo|chief\s+financial\s+officer|ekonomichef|ekonomidirekt[öo]r|finance\s+director|head\s+of\s+finance)\b/i },
  { id: "clevel", label: "COO / CTO / CMO & other C-level", re: /\b(coo|cto|cmo|cio|cro|cco|chief\s+\w+\s+officer)\b/i },
  { id: "founder", label: "Founder / Grundare", re: /\b(founder|co[-\s]?founder|grundare)\b/i },
  { id: "owner", label: "Owner / Ägare / Delägare", re: /\b(owner|co[-\s]?owner|[äa]gare|del[äa]gare)\b/i },
  { id: "partner", label: "Partner", re: /\bpartner\b/i },
  { id: "chair", label: "Chairman / Styrelseordförande", re: /\b(chairman|chairwoman|styrelseordf[öo]rande)\b/i },
  { id: "head", label: "Head of / Director / VP", re: /\b(head\s+of|director|vp|vice\s+president)\b/i },
];

export function titleGroupsByIds(ids: string[]): TitleGroup[] {
  return TITLE_GROUPS.filter((g) => ids.includes(g.id));
}

/** True when `role` matches at least one of the selected groups. Empty `ids` matches nothing. */
export function matchesTitleGroups(role: string | null | undefined, ids: string[]): boolean {
  if (!role || ids.length === 0) return false;
  return titleGroupsByIds(ids).some((g) => g.re.test(role));
}
