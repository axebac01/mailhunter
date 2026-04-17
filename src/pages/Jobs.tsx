import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Play, Pause, Square, Copy, Trash2, Eye, MoreHorizontal, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store/useStore";
import { PageHeader } from "@/components/app/PageHeader";
import { JobStatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { fmtDate, fmtRelative, fmtNum } from "@/lib/format";
import type { JobStatus } from "@/types";

export default function Jobs() {
  const navigate = useNavigate();
  const { jobs, updateJobStatus, duplicateJob, deleteJob } = useStore();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");
  const [industry, setIndustry] = useState<string>("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const countries = useMemo(() => Array.from(new Set(jobs.map((j) => j.country))).sort(), [jobs]);
  const industries = useMemo(() => Array.from(new Set(jobs.map((j) => j.industry))).sort(), [jobs]);

  const filtered = jobs.filter((j) =>
    (status === "all" || j.status === status) &&
    (country === "all" || j.country === country) &&
    (industry === "all" || j.industry === industry) &&
    (search === "" || j.name.toLowerCase().includes(search.toLowerCase())),
  );

  const handleAction = (id: string, action: JobStatus | "duplicate" | "delete" | "view") => {
    if (action === "view") return navigate(`/jobs/${id}`);
    if (action === "duplicate") {
      const newId = duplicateJob(id);
      toast.success("Job duplicated");
      if (newId) navigate(`/jobs/${newId}`);
      return;
    }
    if (action === "delete") return setConfirmDelete(id);
    updateJobStatus(id, action);
    toast.success(`Job ${action}`);
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Jobs"
        description="Manage research jobs that discover public company contact data."
        actions={
          <Button asChild size="sm"><Link to="/jobs/new"><Plus className="h-4 w-4" /> Create job</Link></Button>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by job name..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(["draft", "scheduled", "running", "paused", "completed", "failed", "stopped"] as JobStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Country" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Industry" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All industries</SelectItem>
              {industries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          {(status !== "all" || country !== "all" || industry !== "all" || search) && (
            <Button variant="ghost" size="sm" onClick={() => { setStatus("all"); setCountry("all"); setIndustry("all"); setSearch(""); }}>
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="h-5 w-5" />}
            title="No jobs"
            description="No jobs yet. Create your first research job to begin discovering public company contacts."
            action={<Button asChild><Link to="/jobs/new"><Plus className="h-4 w-4" /> Create job</Link></Button>}
          />
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Job name</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead className="text-right">Companies</TableHead>
                  <TableHead className="text-right">Contacts</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((j) => (
                  <TableRow key={j.id} className="cursor-pointer" onClick={() => navigate(`/jobs/${j.id}`)}>
                    <TableCell className="font-medium">{j.name}</TableCell>
                    <TableCell className="text-muted-foreground">{j.industry}</TableCell>
                    <TableCell className="text-muted-foreground">{j.country}</TableCell>
                    <TableCell><JobStatusBadge status={j.status} /></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{fmtDate(j.createdAt)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{fmtRelative(j.lastRunAt)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{j.startTime}–{j.endTime}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(j.companiesFound)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(j.contactsFound)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleAction(j.id, "view")}><Eye className="h-4 w-4" /> View</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction(j.id, "running")}><Play className="h-4 w-4" /> Start</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction(j.id, "paused")}><Pause className="h-4 w-4" /> Pause</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction(j.id, "stopped")}><Square className="h-4 w-4" /> Stop</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleAction(j.id, "duplicate")}><Copy className="h-4 w-4" /> Duplicate</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => handleAction(j.id, "delete")}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The job and its run history will be removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmDelete) { deleteJob(confirmDelete); toast.success("Job deleted"); setConfirmDelete(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
