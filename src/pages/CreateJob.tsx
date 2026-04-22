import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Globe2, Upload, Loader2 } from "lucide-react";
import { api, type Weekday } from "@/lib/api";
import { autoMap, parseFile, runImport } from "@/lib/importPipeline";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAYS: { key: Weekday; label: string; weekend?: boolean }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat", weekend: true },
  { key: "sun", label: "Sun", weekend: true },
];

function summarizeWeekdays(days: Weekday[]): string {
  if (days.length === 0) return "No days selected";
  if (days.length === 7) return "Every day selected (7 days)";
  const weekdayKeys: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
  const isWeekdays = days.length === 5 && weekdayKeys.every((d) => days.includes(d));
  if (isWeekdays) return "Mon–Fri selected (5 days)";
  const ordered = WEEKDAYS.filter((w) => days.includes(w.key)).map((w) => w.label);
  return `${ordered.join(", ")} (${days.length} day${days.length === 1 ? "" : "s"})`;
}

const INDUSTRIES = ["Software","Manufacturing","Finance","Healthcare","Logistics","Food & Beverage","Biotech","Aerospace","Real Estate","Media","Pharmaceuticals","Energy"];
const COUNTRIES = ["United States","Germany","United Kingdom","France","Netherlands","Spain","Sweden","Italy","Japan","Norway","Denmark","Finland","Switzerland","Austria","Belgium","Portugal","Ireland"];

type SourceMode = "industry_country" | "uploaded";

export default function CreateJob() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sourceMode, setSourceMode] = useState<SourceMode>("industry_country");
  const [importId, setImportId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<{ p: number; t: number } | null>(null);

  const uploadMut = useMutation({
    mutationFn: async (f: File) => {
      const parsed = await parseFile(f);
      const headers = parsed.kind === "buffered" ? parsed.parsed.headers : parsed.headers;
      if (headers.length === 0) {
        throw new Error("File appears to be empty.");
      }
      const mapping = autoMap(headers);
      // Fallback: if auto-detection fails, treat the first column as the company name.
      if (!Object.values(mapping).includes("company_name")) {
        mapping[headers[0]] = "company_name";
        toast.message(`Using "${headers[0]}" as the company name column`);
      }
      return runImport({
        file: f,
        parsed,
        mapping,
        options: { attachJobId: null, ignoreDuplicates: true, overwriteEmpty: false, autoStart: false, defaultCountry: form.country || null },
        onProgress: (p, t) => setUploadProgress({ p, t }),
      });
    },
    onSuccess: async (newImportId) => {
      await qc.invalidateQueries({ queryKey: ["imports"] });
      setImportId(newImportId);
      setUploadProgress(null);
      toast.success("File imported");
    },
    onError: (e: any) => {
      setUploadProgress(null);
      toast.error(e?.message ?? "Import failed");
    },
  });

  const handleFile = (f: File) => {
    if (!/\.(csv|xls|xlsx)$/i.test(f.name)) {
      toast.error("Unsupported file type — please choose a CSV, XLS, or XLSX file");
      return;
    }
    uploadMut.mutate(f);
  };

  const [form, setForm] = useState({
    name: "", industry: "", country: "", maxCompanies: 100,
    weekdays: ["mon","tue","wed","thu","fri"] as Weekday[],
    startTime: "09:00", endTime: "18:00",
    collectGenericEmails: true, collectPersonEmails: true, collectPhones: true, collectContactForms: true,
    collectPersonNames: true, collectPersonRoles: true, collectDepartments: false,
    deduplicate: true, notes: "",
  });
  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const importsQ = useQuery({ queryKey: ["imports"], queryFn: () => api.listImports() });
  const importRowsQ = useQuery({
    queryKey: ["importRows", importId],
    queryFn: () => api.listImportRows(importId),
    enabled: sourceMode === "uploaded" && !!importId,
  });

  const matchedRows = useMemo(
    () => (importRowsQ.data ?? []).filter((r) => r.matchedCompanyId && (r.status === "matched" || r.status === "duplicate")),
    [importRowsQ.data]
  );
  const selectedImport = importsQ.data?.find((i) => i.id === importId);

  // Auto-fill defaults from import when chosen
  useEffect(() => {
    if (sourceMode !== "uploaded" || !selectedImport || matchedRows.length === 0) return;
    const mode = (arr: (string | null)[]): string => {
      const counts = new Map<string, number>();
      for (const v of arr) { if (!v) continue; counts.set(v, (counts.get(v) ?? 0) + 1); }
      let best = ""; let bestN = 0;
      counts.forEach((n, k) => { if (n > bestN) { bestN = n; best = k; } });
      return best;
    };
    setForm((f) => ({
      ...f,
      name: f.name || `Crawl: ${selectedImport.fileName}`,
      industry: f.industry || mode(matchedRows.map((m) => m.industry)),
      country: f.country || mode(matchedRows.map((m) => m.country)),
      maxCompanies: Math.min(matchedRows.length, 1000),
    }));
  }, [sourceMode, selectedImport, matchedRows]);

  const validate = () => {
    if (!form.name.trim()) return "Job name is required.";
    if (sourceMode === "uploaded") {
      if (!importId) return "Select an import file.";
      if (matchedRows.length === 0) return "Selected import has no matched companies to crawl.";
    } else {
      if (!form.industry || !form.country) return "Industry and country are required.";
    }
    if (form.maxCompanies <= 0) return "Max companies must be greater than 0.";
    if (form.endTime <= form.startTime) return "End time must be after start time.";
    const any = form.collectGenericEmails || form.collectPersonEmails || form.collectPhones || form.collectContactForms || form.collectPersonNames || form.collectPersonRoles || form.collectDepartments;
    if (!any) return "Select at least one collection option.";
    return null;
  };

  const create = useMutation({
    mutationFn: async (status: "draft" | "scheduled") => {
      const job = await api.createJob({
        name: form.name,
        industry: form.industry || null,
        country: form.country || null,
        max_companies: form.maxCompanies,
        allowed_start_time: form.startTime, allowed_end_time: form.endTime,
        allowed_days: form.weekdays,
        include_generic_emails: form.collectGenericEmails,
        include_person_emails: form.collectPersonEmails,
        include_phones: form.collectPhones,
        include_contact_forms: form.collectContactForms,
        include_contact_person_names: form.collectPersonNames,
        include_contact_person_roles: form.collectPersonRoles,
        include_departments: form.collectDepartments,
        deduplicate: form.deduplicate,
        notes: form.notes || null,
        status,
        source_type: sourceMode,
      });
      if (sourceMode === "uploaded" && importId) {
        await api.updateImport(importId, { crawl_job_id: job.id });
        // Fire-and-forget: resolve domains for unresolved companies linked to this import.
        const { supabase } = await import("@/integrations/supabase/client");
        supabase.functions.invoke("resolve-domains-batch", {
          body: { importId, jobId: job.id },
        }).catch(() => {});
      }
      return job;
    },
    onSuccess: (j, status) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
      qc.invalidateQueries({ queryKey: ["imports"] });
      if (importId) qc.invalidateQueries({ queryKey: ["import", importId] });
      toast.success(status === "draft" ? "Saved as draft" : "Job scheduled");
      navigate(`/jobs/${j.id}`);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create job"),
  });

  const submit = (status: "draft" | "scheduled") => {
    const err = validate();
    if (err) return toast.error(err);
    create.mutate(status);
  };

  const collectionOptions = [
    ["collectGenericEmails","Collect generic public emails","info@, sales@, contact@, hello@, support@, office@"],
    ["collectPersonEmails","Collect personal public emails","Public name-based emails (e.g. firstname.lastname@company). Off by default — enable only for lawful B2B use cases."],
    ["collectPhones","Collect phone numbers","Public company phone numbers"],
    ["collectContactForms","Collect contact forms","URLs of public contact pages"],
    ["collectPersonNames","Collect contact person names","Public names only"],
    ["collectPersonRoles","Collect contact person roles","Public role titles"],
    
  ] as const;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Create job"
        description="Configure a research job to discover public company contact data."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => submit("draft")} disabled={create.isPending}>Save as draft</Button>
            <Button size="sm" onClick={() => submit("scheduled")} disabled={create.isPending}>Schedule job</Button>
          </>
        }
      />

      <div className="space-y-6">
        <SectionCard title="Job name" description="Give this job a recognizable name">
          <Label htmlFor="name" className="sr-only">Job name</Label>
          <Input
            id="name"
            placeholder="e.g. SaaS outreach — Germany Q2"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </SectionCard>

        <SectionCard title="Source" description="Choose where the list of companies comes from">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSourceMode("industry_country")}
              className={`text-left flex items-start gap-3 p-3 rounded-md border transition-colors ${sourceMode === "industry_country" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
            >
              <Globe2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Industry + country</p>
                <p className="text-xs text-muted-foreground">Discover new companies by industry and location.</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode("uploaded")}
              className={`text-left flex items-start gap-3 p-3 rounded-md border transition-colors ${sourceMode === "uploaded" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
            >
              <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">From an import file</p>
                <p className="text-xs text-muted-foreground">Crawl matched companies from a previously uploaded list.</p>
              </div>
            </button>
          </div>

          {sourceMode === "uploaded" && (
            <div className="mt-4 space-y-3">
              <div>
                <Label>Upload a file from your computer</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
                <div className="mt-1.5 flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMut.isPending}
                  >
                    {uploadMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploadMut.isPending ? "Importing…" : "Upload new file"}
                  </Button>
                  {uploadProgress && (
                    <span className="text-xs text-muted-foreground">
                      {uploadProgress.p} / {uploadProgress.t} rows
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">CSV, XLS or XLSX — browse any folder</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Or choose an existing import</Label>
                <Select value={importId} onValueChange={setImportId}>
                  <SelectTrigger><SelectValue placeholder={importsQ.isLoading ? "Loading…" : "Select an import"} /></SelectTrigger>
                  <SelectContent>
                    {(importsQ.data ?? []).length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground">No imports yet — upload a file above.</div>
                    ) : (
                      importsQ.data!.map((imp) => (
                        <SelectItem key={imp.id} value={imp.id}>
                          {imp.fileName} · {imp.matchedRows} matched · {fmtRelative(imp.createdAt)}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {importId && (
                  <p className="text-xs text-muted-foreground">
                    {importRowsQ.isLoading
                      ? "Loading rows…"
                      : `${matchedRows.length} matched companies will seed this job.`}
                  </p>
                )}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Basics" description="Identify the job">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <Label>Industry {sourceMode === "industry_country" ? "*" : <span className="text-muted-foreground font-normal">(optional)</span>}</Label>
              <Select value={form.industry} onValueChange={(v) => update("industry", v)}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select industry" /></SelectTrigger>
                <SelectContent>{INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Country {sourceMode === "industry_country" ? "*" : <span className="text-muted-foreground font-normal">(optional)</span>}</Label>
              <Select value={form.country} onValueChange={(v) => update("country", v)}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select country" /></SelectTrigger>
                <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="max">Max companies *</Label>
              <Input id="max" type="number" min={1} className="mt-1.5" value={form.maxCompanies} onChange={(e) => update("maxCompanies", parseInt(e.target.value) || 0)} />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Schedule" description="When the scraper is allowed to run">
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <Label className="block">Allowed weekdays</Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => update("weekdays", ["mon","tue","wed","thu","fri"] as Weekday[])}
                  >
                    Weekdays
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => update("weekdays", ["mon","tue","wed","thu","fri","sat","sun"] as Weekday[])}
                  >
                    Every day
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Allowed weekdays">
                {WEEKDAYS.map(({ key, label, weekend }) => {
                  const selected = form.weekdays.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        update(
                          "weekdays",
                          (selected
                            ? form.weekdays.filter((d) => d !== key)
                            : [...form.weekdays, key]) as Weekday[],
                        )
                      }
                      className={cn(
                        "h-11 w-11 rounded-full text-xs font-semibold transition-all",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selected
                          ? "bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30 scale-105"
                          : weekend
                            ? "bg-muted/50 text-muted-foreground hover:bg-muted"
                            : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p
                className={cn(
                  "text-xs mt-2",
                  form.weekdays.length === 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {summarizeWeekdays(form.weekdays)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label htmlFor="start">Start time</Label>
                <Input id="start" type="time" className="mt-1.5" value={form.startTime} onChange={(e) => update("startTime", e.target.value)} /></div>
              <div><Label htmlFor="end">End time</Label>
                <Input id="end" type="time" className="mt-1.5" value={form.endTime} onChange={(e) => update("endTime", e.target.value)} /></div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Collection scope" description="Only public contact data is collected. Personal emails are stored only when this option is enabled.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {collectionOptions.map(([key, label, hint]) => (
              <label key={key} className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-muted/40 cursor-pointer">
                <Checkbox checked={form[key]} onCheckedChange={(v) => update(key, !!v)} className="mt-0.5" />
                <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{hint}</p></div>
              </label>
            ))}
            <label className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-muted/40 cursor-pointer md:col-span-2">
              <Checkbox checked={form.deduplicate} onCheckedChange={(v) => update("deduplicate", !!v)} className="mt-0.5" />
              <div><p className="text-sm font-medium">Deduplicate results</p><p className="text-xs text-muted-foreground">Skip rows already present in the database.</p></div>
            </label>
          </div>
        </SectionCard>

        <SectionCard title="Notes" description="Optional internal context">
          <Textarea rows={4} placeholder="Anything operators should know about this job..." value={form.notes} onChange={(e) => update("notes", e.target.value)} />
        </SectionCard>
      </div>
    </div>
  );
}
