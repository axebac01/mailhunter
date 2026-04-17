import { useState } from "react";
import { toast } from "sonner";
import { useStore } from "@/store/useStore";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function SettingsPage() {
  const { reseed, clearAll } = useStore();
  const [exportFmt, setExportFmt] = useState("csv");
  const [dedupe, setDedupe] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [scraperOn, setScraperOn] = useState(true);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader title="Settings" description="System defaults and demo data management for mailhunter.ai." />

      <div className="space-y-6">
        <SectionCard title="Default export settings">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div><Label>Default export format</Label><p className="text-xs text-muted-foreground">Used by quick exports across the app</p></div>
              <Select value={exportFmt} onValueChange={setExportFmt}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="csv">CSV</SelectItem><SelectItem value="xlsx">XLSX</SelectItem></SelectContent>
              </Select>
            </div>
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

        <SectionCard title="Mock scraper settings">
          <div className="flex items-center justify-between">
            <div><Label>Mock scraper enabled</Label><p className="text-xs text-muted-foreground">Generates simulated discoveries for running jobs</p></div>
            <Switch checked={scraperOn} onCheckedChange={setScraperOn} />
          </div>
        </SectionCard>

        <SectionCard title="System status">
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Scheduler</span><span className="text-success font-medium">● Online</span></li>
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Mock scraper</span><span className="text-success font-medium">● {scraperOn ? "Running" : "Paused"}</span></li>
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Storage</span><span className="text-success font-medium">● Healthy</span></li>
            <li className="flex items-center justify-between"><span className="text-muted-foreground">Build</span><span className="text-muted-foreground">v0.1.0-internal</span></li>
          </ul>
        </SectionCard>

        <SectionCard title="Demo data management" description="Reset or reseed the in-memory mock store">
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { reseed(); toast.success("Demo data reseeded"); }}>Reseed demo data</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="destructive">Clear all data</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all data?</AlertDialogTitle>
                  <AlertDialogDescription>This wipes all jobs, imports, contacts, people, and companies from the in-memory store. This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { clearAll(); toast.success("All data cleared"); }}>Clear all</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
