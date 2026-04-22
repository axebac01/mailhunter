import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { CrawlLogRow } from "@/lib/api";

export type PendingAction = { kind: "pausing" | "stopping"; startedAt: number; estimatedWaveMs: number };

const PENDING_KEY = (jobId: string) => `jobDetail:pendingAction:${jobId}`;

export function estimateWaveMsFromLogs(logs: CrawlLogRow[] | undefined): number {
  const samples: number[] = [];
  for (const r of logs ?? []) {
    const meta = r.metaJson;
    if (meta?.event === "company_finished" && typeof meta.duration_ms === "number") {
      samples.push(meta.duration_ms);
      if (samples.length >= 20) break;
    }
  }
  if (samples.length === 0) return 45000;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
  const p90 = sorted[idx];
  return Math.min(60000, Math.max(5000, p90 + 3000));
}

export function usePendingAction(jobId: string) {
  const qc = useQueryClient();

  const [pendingAction, setPendingActionState] = useState<PendingAction | null>(() => {
    if (typeof window === "undefined" || !jobId) return null;
    try {
      const raw = sessionStorage.getItem(PENDING_KEY(jobId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PendingAction;
      if (Date.now() - parsed.startedAt > 90_000) {
        sessionStorage.removeItem(PENDING_KEY(jobId));
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  const setPendingAction = (next: PendingAction | null) => {
    setPendingActionState(next);
    if (typeof window === "undefined" || !jobId) return;
    try {
      if (next) sessionStorage.setItem(PENDING_KEY(jobId), JSON.stringify(next));
      else sessionStorage.removeItem(PENDING_KEY(jobId));
    } catch {/* ignore */}
  };

  const [, setTick] = useState(0);

  // Smooth countdown via rAF, throttled to ~250ms.
  useEffect(() => {
    if (!pendingAction) return;
    let rafId = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= 250) {
        last = now;
        setTick((t) => (t + 1) % 1_000_000);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [pendingAction]);

  // Lightweight poll for the latest log row while a pause/stop is pending
  const latestLog = useQuery({
    queryKey: ["latestLog", jobId, pendingAction?.startedAt],
    queryFn: async () => {
      const { data } = await supabase
        .from("crawl_logs")
        .select("message, created_at")
        .eq("crawl_job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
    refetchInterval: pendingAction ? 3000 : false,
    enabled: !!pendingAction,
  });

  // Detect worker exit: matching log line newer than click, or 60s safety timeout
  useEffect(() => {
    if (!pendingAction) return;
    const needle = pendingAction.kind === "pausing" ? "paused by user" : "stopped by user";
    const rows = latestLog.data ?? [];
    const exited = rows.some((r) => {
      const ts = new Date(r.created_at).getTime();
      return ts >= pendingAction.startedAt - 1000 && typeof r.message === "string" && r.message.toLowerCase().includes(needle);
    });
    if (exited) {
      setPendingAction(null);
      return;
    }
    const elapsed = Date.now() - pendingAction.startedAt;
    const remaining = 60000 - elapsed;
    if (remaining <= 0) {
      (async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["job", jobId] }),
          qc.invalidateQueries({ queryKey: ["logs", jobId] }),
          latestLog.refetch(),
        ]);
        const fresh = latestLog.data ?? [];
        const justExited = fresh.some((r) => {
          const ts = new Date(r.created_at).getTime();
          return ts >= pendingAction.startedAt - 1000 && typeof r.message === "string" && r.message.toLowerCase().includes(needle);
        });
        setPendingAction(null);
        if (!justExited) {
          toast("Worker is taking longer than expected. The status is correct — refresh logs to confirm.", {
            action: { label: "Refresh logs", onClick: () => qc.invalidateQueries({ queryKey: ["logs", jobId] }) },
          });
        }
      })();
      return;
    }
    const t = setTimeout(() => setPendingAction(null), remaining);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction, latestLog.data]);

  return { pendingAction, setPendingAction };
}
