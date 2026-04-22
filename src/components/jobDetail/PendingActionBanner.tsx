import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PendingAction } from "@/hooks/usePendingAction";

export function CountdownRing({ progress, className }: { progress: number; className?: string }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className={className} aria-hidden="true">
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <circle
        cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped)}
        transform="rotate(-90 7 7)" style={{ transition: "stroke-dashoffset 250ms linear" }}
      />
    </svg>
  );
}

export function PendingActionPill({ pendingAction }: { pendingAction: PendingAction }) {
  const elapsed = Date.now() - pendingAction.startedAt;
  const remainingMs = Math.max(0, pendingAction.estimatedWaveMs - elapsed);
  const secs = Math.max(1, Math.ceil(remainingMs / 1000));
  const progress = pendingAction.estimatedWaveMs > 0 ? Math.min(1, elapsed / pendingAction.estimatedWaveMs) : 1;
  const label = pendingAction.kind === "pausing" ? "Pausing" : "Stopping";
  const tail = remainingMs > 0 ? `~${secs}s left` : "finishing up…";
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`${label}, ${remainingMs > 0 ? `about ${secs} seconds left` : "finishing up"}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium min-w-[160px]",
        pendingAction.kind === "pausing" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
      )}
    >
      {remainingMs > 0 ? <CountdownRing progress={progress} /> : <Loader2 className="h-3 w-3 animate-spin" />}
      <span aria-hidden="true">{label}…</span>
      <span className="ml-auto tabular-nums opacity-80" aria-hidden="true">{tail}</span>
    </span>
  );
}

export function PendingActionBanner({ pendingAction }: { pendingAction: PendingAction }) {
  const elapsed = Date.now() - pendingAction.startedAt;
  const remainingMs = Math.max(0, pendingAction.estimatedWaveMs - elapsed);
  const secs = Math.max(1, Math.ceil(remainingMs / 1000));
  const progress = pendingAction.estimatedWaveMs > 0 ? Math.min(1, elapsed / pendingAction.estimatedWaveMs) : 1;
  const tail = remainingMs > 0 ? `current batch finishing (~${secs}s left)…` : "current batch finishing up…";
  const lead = pendingAction.kind === "pausing" ? "Pausing scraper" : "Stopping scraper";
  const tone = pendingAction.kind === "pausing" ? "text-warning" : "text-muted-foreground";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mb-3 rounded-md border px-4 py-3 text-sm flex items-center gap-2",
        pendingAction.kind === "pausing" ? "border-warning/40 bg-warning/10" : "border-border bg-muted"
      )}
    >
      {remainingMs > 0 ? <CountdownRing progress={progress} className={tone} /> : <Loader2 className={cn("h-4 w-4 animate-spin", tone)} />}
      <span className="tabular-nums">{`${lead} — ${tail}`}</span>
    </div>
  );
}
