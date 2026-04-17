import { formatDistanceToNow, format } from "date-fns";

export const fmtDate = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy") : "—");
export const fmtDateTime = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy HH:mm") : "—");
export const fmtRelative = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—");
export const fmtNum = (n: number) => new Intl.NumberFormat().format(n);
