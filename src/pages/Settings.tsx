import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { OutreachSettingsCard } from "@/components/outreach/OutreachSettingsCard";

export default function SettingsPage() {
  const qc = useQueryClient();
  const kpis = useQuery({ queryKey: ["kpis"], queryFn: () => api.kpis() });
  const [exportFmt, setExportFmt] = useState("csv");
  const [dedupe, setDedupe] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [scraperOn, setScraperOn] = useState(true);
  const [personEmails, setPersonEmails] = useState(false);

  const clear = useMutation({
    mutationFn: () => api.clearAll(),
    onSuccess: () => { qc.invalidateQueries(); toast.success("All data cleared"); },
    onError: (e: any) => toast.error(e.message ?? "Failed to clear"),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader title="Settings" description="System defaults and demo data management for mailhunter.ai." />

      <div className="space-y-6">
        <OutreachSettingsCard />

        <SectionCard title="Default export settings">
          <div className="flex items-center justify-between">
            <div><Label>Default export format</Label><p className="text-xs text-muted-foreground">Used by quick exports across the app</p></div>
            <Select value={exportFmt} onValueChange={setExportFmt}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="csv">CSV</SelectItem><SelectItem value="xlsx">XLSX</SelectItem></SelectContent>
            </Select>
          </div>
        </SectionCard>

        <SectionCard title="Scheduler defaults">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Default start time</Label><Input type="time" defaultValue="09:00" className="mt-1.5" /></div>
            <div><Label>Default end time</Label><Input type="time" defaultValue="18:00" className="mt-1.5" /></div>
          </div>
        </SectionCard>

        <SectionCard title="Deduplication">
          <div className="flex items-center justify-between">
            <div><Label>Deduplicate results by default</Label><p className="text-xs text-muted-foreground">Skip rows already in the database</p></div>
            <Switch checked={dedupe} onCheckedChange={setDedupe} />
          </div>
        </SectionCard>

        <SectionCard title="Import defaults">
          <div className="flex items-center justify-between">
            <div><Label>Auto-start jobs after import</Label><p className="text-xs text-muted-foreground">Begin processing as soon as upload completes</p></div>
            <Switch checked={autoStart} onCheckedChange={setAutoStart} />
          </div>
        </SectionCard>

        <SectionCard title="Personal emails" description="Default for the 'Collect personal public emails' toggle on new jobs.">
          <div className="flex items-center justify-between">
            <div>
              <Label>Collect personal public emails by default</Label>
              <p className="text-xs text-muted-foreground">Public name-based emails (e.g. firstname.lastname@company). Off by default — enable only for lawful B2B use cases.</p>
            </div>
            <Switch checked={personEmails} onCheckedChange={setPersonEmails} />
          </div>
        </SectionCard>

        <SectionCard title="Mock scraper settings">
          <div className="flex items-center justify-between">
            <div><Label>Mock scraper enabled</Label><p className="text-xs text-muted-foreground">Generates simulated discoveries for running jobs</p></div>
            <Switch checked={scraperOn} onCheckedChange={setScraperOn} />
          </div>
        </SectionCard>

        <SectionCard title="System status">
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Backend</span><span className="text-success font-medium">● Connected (Lovable Cloud)</span></li>
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Mock scraper</span><span className="text-success font-medium">● {scraperOn ? "Running" : "Paused"}</span></li>
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Total jobs</span><span>{kpis.data?.totalJobs ?? "—"}</span></li>
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Companies</span><span>{kpis.data?.companies ?? "—"}</span></li>
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Contact records</span><span>{kpis.data?.contacts ?? "—"}</span></li>
            <li className="flex items-center justify-between"><span className="text-muted-foreground">People records</span><span>{kpis.data?.people ?? "—"}</span></li>
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Build</span><span className="text-muted-foreground">v0.2.0-internal</span></li>
          </ul>
        </SectionCard>

        <SectionCard title="Demo data management" description="Clear the database. Reseeding requires re-running the seed migration.">
          <div className="flex gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="destructive">Clear all data</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all data?</AlertDialogTitle>
                  <AlertDialogDescription>This wipes all jobs, imports, contacts, people, companies, and logs from the database. This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => clear.mutate()}>Clear all</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Note: this is an internal MVP without authentication. Database access is currently open for demo purposes — tighten RLS before any external exposure.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
