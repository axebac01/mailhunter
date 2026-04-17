import { Link } from "react-router-dom";
import { Briefcase, PlayCircle, Building2, Mail, Users, Upload, Download, Plus, ArrowRight, Activity } from "lucide-react";
import { useStore } from "@/store/useStore";
import { PageHeader } from "@/components/app/PageHeader";
import { KpiCard } from "@/components/app/KpiCard";
import { SectionCard } from "@/components/app/SectionCard";
import { JobStatusBadge, ContactTypeBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { fmtNum, fmtRelative } from "@/lib/format";

export default function Dashboard() {
  const { jobs, companies, contacts, people, imports, exportsCompleted, activity } = useStore();
  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "scheduled" || j.status === "paused").length;

  const recentJobs = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const recentImports = [...imports].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, 5);
  const latestContacts = [...contacts].sort((a, b) => b.foundAt.localeCompare(a.foundAt)).slice(0, 5);
  const latestPeople = [...people].sort((a, b) => b.foundAt.localeCompare(a.foundAt)).slice(0, 5);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Dashboard"
        description="Discover, organize, and export publicly available company contact data."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/imports"><Upload className="h-4 w-4" /> Import companies</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/jobs/new"><Plus className="h-4 w-4" /> Create job</Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
        <KpiCard label="Total jobs" value={fmtNum(jobs.length)} icon={<Briefcase className="h-4 w-4" />} />
        <KpiCard label="Active jobs" value={fmtNum(activeJobs)} icon={<PlayCircle className="h-4 w-4" />} hint="Running, scheduled or paused" />
        <KpiCard label="Companies" value={fmtNum(companies.length)} icon={<Building2 className="h-4 w-4" />} />
        <KpiCard label="Contact records" value={fmtNum(contacts.length)} icon={<Mail className="h-4 w-4" />} hint="Generic only" />
        <KpiCard label="People records" value={fmtNum(people.length)} icon={<Users className="h-4 w-4" />} hint="Public metadata" />
        <KpiCard label="Imports" value={fmtNum(imports.length)} icon={<Upload className="h-4 w-4" />} />
        <KpiCard label="Exports" value={fmtNum(exportsCompleted)} icon={<Download className="h-4 w-4" />} hint="Completed" />
      </div>

      <SectionCard title="Quick actions" className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { to: "/jobs/new", icon: Plus, label: "Create Job" },
            { to: "/imports", icon: Upload, label: "Import Companies" },
            { to: "/contacts", icon: Mail, label: "View Contacts" },
            { to: "/companies", icon: Building2, label: "View Companies" },
            { to: "/contacts", icon: Download, label: "Export Results" },
          ].map((q) => (
            <Button key={q.label} asChild variant="outline" className="h-auto py-4 flex-col gap-2">
              <Link to={q.to}>
                <q.icon className="h-5 w-5 text-primary" />
                <span className="text-sm">{q.label}</span>
              </Link>
            </Button>
          ))}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <SectionCard
          title="Recent jobs"
          action={<Button asChild variant="ghost" size="sm"><Link to="/jobs">View all <ArrowRight className="h-3 w-3" /></Link></Button>}
          noPadding
        >
          <div className="divide-y divide-border">
            {recentJobs.map((j) => (
              <Link key={j.id} to={`/jobs/${j.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-muted/40 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{j.name}</p>
                  <p className="text-xs text-muted-foreground">{j.industry} · {j.country} · {fmtRelative(j.createdAt)}</p>
                </div>
                <JobStatusBadge status={j.status} />
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Recent imports"
          action={<Button asChild variant="ghost" size="sm"><Link to="/imports">View all <ArrowRight className="h-3 w-3" /></Link></Button>}
          noPadding
        >
          <div className="divide-y divide-border">
            {recentImports.map((i) => (
              <div key={i.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{i.fileName}</p>
                  <p className="text-xs text-muted-foreground">{i.totalRows} rows · {i.matched} matched · {fmtRelative(i.uploadedAt)}</p>
                </div>
                <span className="text-xs text-muted-foreground">{i.jobName ?? "—"}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SectionCard title="Latest contacts" noPadding action={<Button asChild variant="ghost" size="sm"><Link to="/contacts">All <ArrowRight className="h-3 w-3" /></Link></Button>}>
          <div className="divide-y divide-border">
            {latestContacts.map((c) => (
              <div key={c.id} className="px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium truncate">{c.contactValue}</p>
                  <ContactTypeBadge type={c.contactType} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.companyName} · {fmtRelative(c.foundAt)}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Latest people" noPadding action={<Button asChild variant="ghost" size="sm"><Link to="/people">All <ArrowRight className="h-3 w-3" /></Link></Button>}>
          <div className="divide-y divide-border">
            {latestPeople.map((p) => (
              <div key={p.id} className="px-5 py-3">
                <p className="text-sm font-medium">{p.fullName}</p>
                <p className="text-xs text-muted-foreground">{p.roleTitle} · {p.companyName}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="System activity" noPadding>
          <div className="divide-y divide-border max-h-80 overflow-auto scrollbar-thin">
            {activity.slice(0, 12).map((a) => (
              <div key={a.id} className="px-5 py-3 flex items-start gap-3">
                <Activity className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{a.message}</p>
                  <p className="text-xs text-muted-foreground">{fmtRelative(a.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
