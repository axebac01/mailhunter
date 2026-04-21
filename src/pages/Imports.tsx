import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, X, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { autoMap, parseFile, runImport, checkLargeXlsx, type Mapping, type ParseResult } from "@/lib/importPipeline";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { EmptyState } from "@/components/app/EmptyState";
import { ImportStatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const TARGET_FIELDS = ["company_name","country","website","industry","notes"] as const;

// Module-level registry: keeps imports running across mount/unmount.
type ActiveImport = { phase: string; p: number; t: number; startedAt: number };
const activeImports: Map<string, ActiveImport> = (window as any).__activeImports ??= new Map();

export default function Imports() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { data: imports = [] } = useQuery({ queryKey: ["imports"], queryFn: () => api.listImports(), refetchInterval: 3000 });
  const { data: jobs = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });

  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [opts, setOpts] = useState({ ignoreDuplicates: true, overwriteEmpty: false, autoStart: false, attachJob: "none" });
  const [progress, setProgress] = useState<{ p: number; t: number; phase?: string; startedAt?: number } | null>(null);

  useEffect(() => {
    if (activeImports.size === 0) return;
    const id = setInterval(() => qc.invalidateQueries({ queryKey: ["imports"] }), 2000);
    return () => clearInterval(id);
  }, [qc]);

  const handleFile = async (f: File) => {
    if (!/\.(csv|xls|xlsx)$/i.test(f.name)) {
      toast.error("Unsupported file type — please choose a CSV, XLS, or XLSX file");
      return;
    }
    const warn = checkLargeXlsx(f);
    if (warn.warn) toast.warning(warn.reason ?? "Large file");
    setFile(f);
    setProgress({ p: 0, t: 0, phase: "reading", startedAt: Date.now() });
    try {
      const p = await parseFile(f);
      const hdrs = p.kind === "buffered" ? p.parsed.headers : p.headers;
      const preview = p.kind === "buffered" ? p.parsed.rows.slice(0, 10) : p.previewRows;
      setParsed(p);
      setHeaders(hdrs);
      setPreviewRows(preview);
      setMapping(autoMap(hdrs));
      setProgress(null);
    } catch (e: any) {
      setProgress(null);
      toast.error(`Failed to parse: ${e.message ?? e}`);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  };

  const importMut = useMutation({
    mutationFn: () => runImport({
      file: file!, parsed: parsed!,
      mapping,
      options: {
        attachJobId: opts.attachJob === "none" ? null : opts.attachJob,
        ignoreDuplicates: opts.ignoreDuplicates,
        overwriteEmpty: opts.overwriteEmpty,
        autoStart: opts.autoStart,
      },
      onProgress: (p, t, phase) => setProgress((prev) => {
        const next = { p, t, phase: phase ?? prev?.phase ?? "saving", startedAt: prev?.startedAt ?? Date.now() };
        if (file) activeImports.set(file.name, { phase: next.phase!, p, t, startedAt: next.startedAt! });
        return next;
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["imports"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
      const elapsed = progress?.startedAt ? ((Date.now() - progress.startedAt) / 1000).toFixed(1) : null;
      toast.success(`Imported ${file?.name}${elapsed ? ` in ${elapsed}s` : ""}`);
      if (file) activeImports.delete(file.name);
      setFile(null); setParsed(null); setHeaders([]); setPreviewRows([]); setMapping({}); setProgress(null);
    },
    onError: (e: any) => {
      if (file) activeImports.delete(file.name);
      toast.error(e.message ?? "Import failed");
      setProgress(null);
    },
  });

  useEffect(() => {
    if (importMut.isPending && progress && progress.t > 50_000) {
      toast.message("Large import — running in batches. You can leave this page; it'll keep going.", { id: "large-import-hint" });
    }
  }, [importMut.isPending, progress]);

  const del = useMutation({
    mutationFn: (id: string) => api.deleteImport(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["imports"] }); qc.invalidateQueries({ queryKey: ["kpis"] }); toast.success("Import deleted"); },
  });
  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Imports"
        description="Upload company lists in CSV, XLS, or XLSX. Map your columns and create or attach to a research job."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <SectionCard title="Upload" className="lg:col-span-2">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer",
              dragOver ? "border-primary bg-accent" : "border-border hover:bg-muted/40",
            )}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">Drop a CSV, XLS, or XLSX file here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
            <p className="text-xs text-muted-foreground mt-3">Browse any folder on your computer — pick a CSV, XLS, or XLSX file. Supported columns: company_name (required), country, website, industry, notes</p>
            <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {file && (
            <div className="mt-4 flex items-center justify-between p-3 rounded-md bg-accent">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">{parsed?.rows.length ?? 0} rows</span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setFile(null); setParsed(null); setMapping({}); }}><X className="h-4 w-4" /></Button>
            </div>
          )}

          {progress && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium capitalize text-foreground">{progress.phase ?? "saving"}</span>
                  {progress.t > 0 && <> — {progress.p} / {progress.t}</>}
                </p>
                {progress.startedAt && progress.p > 0 && progress.t > progress.p && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    ~{Math.max(1, Math.round(((Date.now() - progress.startedAt) / progress.p) * (progress.t - progress.p) / 1000))}s left
                  </p>
                )}
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress.t > 0 ? (progress.p / progress.t) * 100 : 0}%` }} />
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Import options">
          <div className="space-y-3">
            <div>
              <Label>Attach to job</Label>
              <Select value={opts.attachJob} onValueChange={(v) => setOpts({ ...opts, attachJob: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Create new job from import</SelectItem>
                  {jobs.slice(0, 20).map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2"><Checkbox checked={opts.ignoreDuplicates} onCheckedChange={(v) => setOpts({ ...opts, ignoreDuplicates: !!v })} /><span className="text-sm">Ignore duplicates</span></label>
            <label className="flex items-center gap-2"><Checkbox checked={opts.overwriteEmpty} onCheckedChange={(v) => setOpts({ ...opts, overwriteEmpty: !!v })} /><span className="text-sm">Overwrite empty company fields</span></label>
            <label className="flex items-center gap-2"><Checkbox checked={opts.autoStart} onCheckedChange={(v) => setOpts({ ...opts, autoStart: !!v })} /><span className="text-sm">Auto-start after import</span></label>
          </div>
        </SectionCard>
      </div>

      {parsed && parsed.headers.length > 0 && (
        <>
          <SectionCard title="Column mapping" description="Map source columns to target fields" className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {parsed.headers.map((h) => (
                <div key={h} className="flex items-center gap-3 p-3 rounded-md border border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">Source column</p>
                    <p className="font-mono text-sm truncate">{h}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Select value={mapping[h] ?? "ignore"} onValueChange={(v) => setMapping({ ...mapping, [h]: v as Mapping[string] })}>
                    <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ignore">Ignore</SelectItem>
                      {TARGET_FIELDS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4 gap-2">
              <Button variant="outline" onClick={() => { setFile(null); setParsed(null); setMapping({}); }}>Cancel</Button>
              <Button onClick={() => importMut.mutate()} disabled={importMut.isPending}>
                <CheckCircle2 className="h-4 w-4" /> {importMut.isPending ? "Running…" : "Run import"}
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Preview" description="First 10 rows" noPadding className="mb-6">
            <div className="overflow-auto">
              <Table>
                <TableHeader><TableRow>{parsed.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {parsed.rows.slice(0, 10).map((r, i) => (
                    <TableRow key={i}>{r.map((cell, j) => <TableCell key={j} className="text-sm">{cell}</TableCell>)}</TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        </>
      )}

      <SectionCard title="Import history" noPadding>
        {imports.length === 0 ? (
          <EmptyState icon={<Upload className="h-5 w-5" />} description="No imports yet. Upload a CSV or Excel file with company names to get started." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead><TableHead>Uploaded</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Processed</TableHead>
                <TableHead className="text-right">Matched</TableHead><TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Contacts</TableHead><TableHead className="text-right">People</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((i) => (
                <TableRow key={i.id} className="cursor-pointer" onClick={() => navigate(`/imports/${i.id}`)}>
                  <TableCell className="font-medium">{i.fileName}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{fmtRelative(i.createdAt)}</TableCell>
                  <TableCell><ImportStatusBadge status={i.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(i.totalRows)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(i.processedRows)}</TableCell>
                  <TableCell className="text-right tabular-nums text-success">{fmtNum(i.matchedRows)}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{fmtNum(i.failedRows)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(i.contactsFound)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(i.peopleFound)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => del.mutate(i.id)}><X className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

    </div>
  );
}
