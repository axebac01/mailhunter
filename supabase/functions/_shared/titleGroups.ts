// Shared title groups — used by the scrape-emails edge function (Deno) and the frontend (Vite).
// Single source of truth so the scraper's target-role matching and the export filter never drift.

export interface TitleGroup {
  id: string;
  label: string;
  re: RegExp;
}

export const TITLE_GROUPS: TitleGroup[] = [
  { id: "ceo", label: "CEO / VD / Managing Director", re: /\b(ceo|chief executive officer|vd|verkställande direktör|managing director|md)\b/i },
  { id: "cfo", label: "CFO / Ekonomichef", re: /\b(cfo|chief financial officer|ekonomichef|finance director|financial director)\b/i },
  { id: "c_level", label: "Other C-level (COO, CTO, CMO…)", re: /\b(c[a-z]o|chief [a-z ]+ officer)\b/i },
  { id: "founder", label: "Founder / Grundare", re: /\b(founder|co-?founder|grundare|medgrundare|stiftare)\b/i },
  { id: "owner", label: "Owner / Ägare", re: /\b(ägare|delägare|owner|co-?owner|proprietor)\b/i },
  { id: "partner", label: "Partner", re: /\bpartner\b/i },
  { id: "chair", label: "Chairman / Styrelseordförande", re: /\b(chairman|chairwoman|chairperson|chair of( the)? board|styrelseordförande|ordförande)\b/i },
  { id: "head_director", label: "Head of / Director / VP", re: /\b(head of|chef för|director|vp\b|vice president|vice vd)\b/i },
];

export function titleGroupsByIds(ids: string[]): TitleGroup[] {
  return TITLE_GROUPS.filter((g) => ids.includes(g.id));
}

/** True when `role` matches at least one of the selected groups. Empty `ids` matches nothing. */
export function matchesTitleGroups(role: string | null | undefined, ids: string[]): boolean {
  if (!role || ids.length === 0) return false;
  return titleGroupsByIds(ids).some((g) => g.re.test(role));
}
