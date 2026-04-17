import { useState, useRef } from "react";
import { Upload, FileText, X, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store/useStore";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { EmptyState } from "@/components/app/EmptyState";
import { ImportStatusBadge } from "@/components/app/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum, fmtRelative } from "@/lib/format";
import type { ImportRecord, ImportRow, ImportStatus } from "@/types";
import { cn } from "@/lib/utils";

const TARGET_FIELDS = ["company_name", "country", "website", "industry", "notes"] as const;
type Target = (typeof TARGET_FIELDS)[number];

export default function Imports() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { imports, jobs, addImport, deleteImport } = useStore();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, Target | "ignore">>({});
  const [opts, setOpts] = useState({ ignoreDuplicates: true, overwriteEmpty: false, autoStart: false, attachJob: "none" });

  const handleFile = async (f: File) => {
    setFile(f);
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 11);
    const split = lines.map((l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, "")));
    if (split.length === 0) return;
    setHeaders(split[0]);
    setPreview(split.slice(1));
    const m: Record<string, Target | "ignore"> = {};
    split[0].forEach((h) => {
      const lo = h.toLowerCase();
      const match = TARGET_FIELDS.find((t) => lo.includes(t.replace("_", "")) || lo.includes(t));
      m[h] = match ?? "ignore";
    });
    setMapping(m);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const runImport = () => {
    if (!file || !headers.length) return toast.error("Upload a file first");
    const companyCol = Object.entries(mapping).find(([, v]) => v === "company_name")?.[0];
    if (!companyCol) return toast.error("Map a column to company_name");
    const countryCol = Object.entries(mapping).find(([, v]) => v === "country")?.[0];
    const websiteCol = Object.entries(mapping).find(([, v]) => v === "website")?.[0];
    const industryCol = Object.entries(mapping).find(([, v]) => v === "industry")?.[0];

    const rows: ImportRow[] = preview.map((r, i) => {
      const idx = (col?: string) => (col ? headers.indexOf(col) : -1);
      const status: ImportStatus = ["matched", "matched", "matched", "partial_match", "duplicate", "not_found"][i % 6] as ImportStatus;
      return {
        id: `ir_${i}_${Math.random().toString(36).slice(2, 6)}`,
        companyName: r[idx(companyCol)] ?? "",
        country: countryCol ? r[idx(countryCol)] : undefined,
        website: websiteCol ? r[idx(websiteCol)] : undefined,
        industry: industryCol ? r[idx(industryCol)] : undefined,
        status,
      };
    });
    const total = rows.length;
    const job = opts.attachJob !== "none" ? jobs.find((j) => j.id === opts.attachJob) : null;
    const record: ImportRecord = {
      id: `imp_${Math.random().toString(36).slice(2, 8)}`,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      totalRows: total,
      matched: rows.filter((r) => r.status === "matched").length,
      partial: rows.filter((r) => r.status === "partial_match").length,
      notFound: rows.filter((r) => r.status === "not_found").length,
      duplicates: rows.filter((r) => r.status === "duplicate").length,
      failed: rows.filter((r) => r.status === "failed").length,
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      rows,
    };
    addImport(record);
    toast.success(`Imported ${total} rows from ${file.name}`);
    setFile(null);
    setHeaders([]);
    setPreview([]);
    setMapping({});
  };

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
            <p className="text-xs text-muted-foreground mt-3">Supported columns: company_name (required), country, website, industry, notes</p>
            <input ref={fileRef} type="file" hidden accept=".csv,.xls,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {file && (
            <div className="mt-4 flex items-center justify-between p-3 rounded-md bg-accent">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">{preview.length} preview rows</span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setFile(null); setHeaders([]); setPreview([]); }}><X className="h-4 w-4" /></Button>
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
                  {jobs.slice(0, 10).map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2"><Checkbox checked={opts.ignoreDuplicates} onCheckedChange={(v) => setOpts({ ...opts, ignoreDuplicates: !!v })} /><span className="text-sm">Ignore duplicates</span></label>
            <label className="flex items-center gap-2"><Checkbox checked={opts.overwriteEmpty} onCheckedChange={(v) => setOpts({ ...opts, overwriteEmpty: !!v })} /><span className="text-sm">Overwrite empty company fields</span></label>
            <label className="flex items-center gap-2"><Checkbox checked={opts.autoStart} onCheckedChange={(v) => setOpts({ ...opts, autoStart: !!v })} /><span className="text-sm">Auto-start after import</span></label>
          </div>
        </SectionCard>
      </div>

      {headers.length > 0 && (
        <>
          <SectionCard title="Column mapping" description="Map source columns to target fields" className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-3 p-3 rounded-md border border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">Source column</p>
                    <p className="font-mono text-sm truncate">{h}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Select value={mapping[h] ?? "ignore"} onValueChange={(v) => setMapping({ ...mapping, [h]: v as Target | "ignore" })}>
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
              <Button variant="outline" onClick={() => { setFile(null); setHeaders([]); setPreview([]); }}>Cancel</Button>
              <Button onClick={runImport}><CheckCircle2 className="h-4 w-4" /> Run import</Button>
            </div>
          </SectionCard>

          <SectionCard title="Preview" description="First 10 rows" noPadding className="mb-6">
            <Table>
              <TableHeader><TableRow>{headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {preview.map((r, i) => (
                  <TableRow key={i}>
                    {r.map((c, j) => <TableCell key={j} className="text-sm">{c}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </>
      )}

      <SectionCard title="Import history" noPadding>
        {imports.length === 0 ? (
          <EmptyState
            icon={<Upload className="h-5 w-5" />}
            description="No imports yet. Upload a CSV or Excel file with company names to get started."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead><TableHead>Uploaded</TableHead><TableHead>Job</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Matched</TableHead>
                <TableHead className="text-right">Partial</TableHead><TableHead className="text-right">Not found</TableHead>
                <TableHead className="text-right">Duplicates</TableHead><TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.fileName}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{fmtRelative(i.uploadedAt)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{i.jobName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(i.totalRows)}</TableCell>
                  <TableCell className="text-right tabular-nums text-success">{i.matched}</TableCell>
                  <TableCell className="text-right tabular-nums text-info">{i.partial}</TableCell>
                  <TableCell className="text-right tabular-nums text-warning">{i.notFound}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{i.duplicates}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { deleteImport(i.id); toast.success("Import deleted"); }}><X className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
