import { useState } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";
import { autoMap, parseFile, runImport } from "@/lib/importPipeline";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { Button } from "@/components/ui/button";

import itKonsulter from "@/assets/crmdata-bulk/IT-konsulter.xlsx.asset.json";
import itSakerhet from "@/assets/crmdata-bulk/IT-säkerhet.xlsx.asset.json";
import larm from "@/assets/crmdata-bulk/Larm_Säkerhet_&_Bevakning.xlsx.asset.json";
import ledarskap from "@/assets/crmdata-bulk/Ledarskapsutveckling.xlsx.asset.json";
import lyft from "@/assets/crmdata-bulk/Lyft_Gods_&_Materialhantering.xlsx.asset.json";
import mat from "@/assets/crmdata-bulk/Mät_Styr_&_Reglerteknik.xlsx.asset.json";
import org from "@/assets/crmdata-bulk/Organisationskonsulter.xlsx.asset.json";
import pr from "@/assets/crmdata-bulk/PR-byråer.xlsx.asset.json";
import profilLev from "@/assets/crmdata-bulk/Profil_&_Reklam_-_leverantörer.xlsx.asset.json";
import profilAter from "@/assets/crmdata-bulk/Profil_&_Reklam_-_återförsäljare.xlsx.asset.json";
import programvara from "@/assets/crmdata-bulk/Programvaruleverantörer.xlsx.asset.json";
import reklamMedia from "@/assets/crmdata-bulk/Reklam_&_Media.xlsx.asset.json";
import revisorer from "@/assets/crmdata-bulk/Revisorer.xlsx.asset.json";
import skyltar from "@/assets/crmdata-bulk/Skyltar.xlsx.asset.json";
import stodFinans from "@/assets/crmdata-bulk/Stödverksamhet_finans.xlsx.asset.json";
import tekniska from "@/assets/crmdata-bulk/Tekniska_konsulter.xlsx.asset.json";
import telemarketing from "@/assets/crmdata-bulk/Telemarketing_&_Callcenter.xlsx.asset.json";
import ror from "@/assets/crmdata-bulk/Tillverkning_av_rör_&_ledningar.xlsx.asset.json";
import transport from "@/assets/crmdata-bulk/Transportservice.xlsx.asset.json";
import utbildning from "@/assets/crmdata-bulk/Utbildningsföretag.xlsx.asset.json";

type Asset = { url: string; original_filename: string; content_type: string };

const FILES: { asset: Asset; jobName: string }[] = [
  { asset: itKonsulter as Asset, jobName: "CRMdata: IT-konsulter" },
  { asset: itSakerhet as Asset, jobName: "CRMdata: IT-säkerhet" },
  { asset: larm as Asset, jobName: "CRMdata: Larm, Säkerhet & Bevakning" },
  { asset: ledarskap as Asset, jobName: "CRMdata: Ledarskapsutveckling" },
  { asset: lyft as Asset, jobName: "CRMdata: Lyft, Gods & Materialhantering" },
  { asset: mat as Asset, jobName: "CRMdata: Mät, Styr & Reglerteknik" },
  { asset: org as Asset, jobName: "CRMdata: Organisationskonsulter" },
  { asset: pr as Asset, jobName: "CRMdata: PR-byråer" },
  { asset: profilLev as Asset, jobName: "CRMdata: Profil & Reklam - leverantörer" },
  { asset: profilAter as Asset, jobName: "CRMdata: Profil & Reklam - återförsäljare" },
  { asset: programvara as Asset, jobName: "CRMdata: Programvaruleverantörer" },
  { asset: reklamMedia as Asset, jobName: "CRMdata: Reklam & Media" },
  { asset: revisorer as Asset, jobName: "CRMdata: Revisorer" },
  { asset: skyltar as Asset, jobName: "CRMdata: Skyltar" },
  { asset: stodFinans as Asset, jobName: "CRMdata: Stödverksamhet finans" },
  { asset: tekniska as Asset, jobName: "CRMdata: Tekniska konsulter" },
  { asset: telemarketing as Asset, jobName: "CRMdata: Telemarketing & Callcenter" },
  { asset: ror as Asset, jobName: "CRMdata: Tillverkning av rör & ledningar" },
  { asset: transport as Asset, jobName: "CRMdata: Transportservice" },
  { asset: utbildning as Asset, jobName: "CRMdata: Utbildningsföretag" },
];

type Status = "pending" | "running" | "done" | "error";
type Row = {
  jobName: string;
  status: Status;
  message: string;
  jobId?: string;
};

export default function BulkCreateCrmdata() {
  const [rows, setRows] = useState<Row[]>(
    FILES.map((f) => ({ jobName: f.jobName, status: "pending", message: "Väntar…" }))
  );
  const [running, setRunning] = useState(false);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const runAll = async () => {
    setRunning(true);
    for (let i = 0; i < FILES.length; i++) {
      const { asset, jobName } = FILES[i];
      try {
        update(i, { status: "running", message: "Hämtar fil…" });
        const res = await fetch(asset.url);
        if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], asset.original_filename, {
          type: asset.content_type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

        update(i, { message: "Parsar…" });
        const parsed = await parseFile(file);
        const headers = parsed.kind === "buffered" ? parsed.parsed.headers : parsed.headers;
        if (headers.length === 0) throw new Error("Tom fil");
        const mapping = autoMap(headers);
        if (!Object.values(mapping).includes("company_name")) {
          mapping[headers[0]] = "company_name";
        }

        update(i, { message: "Importerar rader…" });
        const importId = await runImport({
          file,
          parsed,
          mapping,
          options: {
            attachJobId: null,
            ignoreDuplicates: true,
            overwriteEmpty: false,
            autoStart: false,
            defaultCountry: "Sweden",
          },
          onProgress: (p, t) => update(i, { message: `Importerar ${p}/${t}…` }),
        });

        update(i, { message: "Räknar matchade…" });
        const importRows = await api.listImportRows(importId);
        const matched = importRows.filter(
          (r) => r.matchedCompanyId && (r.status === "matched" || r.status === "duplicate")
        );

        update(i, { message: "Skapar jobb…" });
        const job = await api.createJob({
          name: jobName,
          industry: null,
          country: "Sweden",
          max_companies: matched.length,
          allowed_start_time: "09:00",
          allowed_end_time: "18:00",
          allowed_days: ["mon", "tue", "wed", "thu", "fri"],
          include_generic_emails: true,
          include_person_emails: true,
          include_phones: true,
          include_contact_forms: false,
          include_contact_person_names: true,
          include_contact_person_roles: true,
          include_departments: true,
          deduplicate: true,
          notes: null,
          status: "draft",
          source_type: "uploaded",
        });

        await api.updateImport(importId, { crawl_job_id: job.id });
        supabase.functions
          .invoke("resolve-domains-batch", { body: { importId, jobId: job.id } })
          .catch(() => {});

        update(i, {
          status: "done",
          message: `${matched.length} matchade företag · jobb skapat`,
          jobId: job.id,
        });
      } catch (e: any) {
        update(i, { status: "error", message: e?.message ?? "Misslyckades" });
        toast.error(`${jobName}: ${e?.message ?? "fel"}`);
      }
    }
    setRunning(false);
    toast.success("Klart");
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Bulk-skapa CRMdata-jobb"
        description="Importerar 10 xlsx-filer och skapar ett draft-jobb per fil."
        actions={
          <Button size="sm" onClick={runAll} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {running ? "Kör…" : "Skapa alla jobb"}
          </Button>
        }
      />

      <SectionCard title="Status" description="En rad per fil. Körs sekventiellt.">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 p-3 rounded-md border border-border"
            >
              <div className="flex items-center gap-3 min-w-0">
                {r.status === "pending" && (
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
                )}
                {r.status === "running" && (
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                )}
                {r.status === "done" && (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                )}
                {r.status === "error" && (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.jobName}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.message}</p>
                </div>
              </div>
              {r.jobId && (
                <a
                  href={`/jobs/${r.jobId}`}
                  className="text-xs text-primary hover:underline shrink-0"
                >
                  Öppna jobb
                </a>
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
