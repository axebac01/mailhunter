import type {
  ActivityEntry,
  Company,
  ContactRecord,
  ContactType,
  ImportRecord,
  ImportRow,
  ImportStatus,
  Job,
  JobLog,
  JobStatus,
  PersonRecord,
} from "@/types";

const INDUSTRIES = [
  "SaaS",
  "FinTech",
  "Healthcare",
  "Manufacturing",
  "Logistics",
  "Marketing Agency",
  "E-commerce",
  "Construction",
  "Consulting",
  "Real Estate",
  "Education",
  "Renewable Energy",
];

const COUNTRIES = ["United States", "Germany", "United Kingdom", "France", "Netherlands", "Spain", "Sweden", "Canada", "Australia", "Italy"];

const COMPANY_NAMES = [
  "Northwind Logistics", "Acme Industrial", "Brightline Health", "Vertex Marketing", "Helios Solar",
  "Atlas Construction", "Ironclad Manufacturing", "Quantum Consulting", "Pinnacle Real Estate", "Catalyst Education",
  "Lumen Analytics", "Fjord Mobility", "Halcyon Studios", "Meridian Robotics", "Ember & Co",
  "Polaris Capital", "Stratus Cloud", "Cinder Foods", "Riverbend Retail", "Kestrel Aviation",
  "Aldridge Pharma", "Brookline Tech", "Cobalt Networks", "Drift Outdoors", "Echelon Auto",
  "Foundry Labs", "Granite Holdings", "Harbour Logistics", "Indigo Insurance", "Junction Media",
  "Kindred Hospitality", "Lattice Energy", "Monolith Software", "Nimbus Telecom", "Onyx Semiconductors",
  "Plume Cosmetics", "Quartz Mining", "Raven Defense", "Sable Apparel", "Trellis Agritech",
];

const FIRST_NAMES = ["Anna", "Ben", "Clara", "David", "Elena", "Felix", "Gina", "Hugo", "Ines", "Jonas", "Karla", "Liam", "Maya", "Noah", "Olivia", "Paul", "Quinn", "Rita", "Sven", "Tara"];
const LAST_NAMES = ["Müller", "Smith", "Dubois", "Jensen", "Costa", "Novak", "Larsson", "Romero", "Bauer", "Kowalski", "O'Connor", "Tanaka", "Khan", "Petrov", "Williams"];
const ROLES = ["Head of Sales", "Marketing Director", "Operations Manager", "Procurement Lead", "VP People", "Customer Success Lead", "Business Development Manager", "CTO", "CFO", "Partnerships Lead", "Office Manager"];
const DEPARTMENTS = ["Sales", "Marketing", "Operations", "Procurement", "People & Culture", "Customer Success", "Engineering", "Finance", "Partnerships", "Administration"];

const GENERIC_PREFIXES = ["info", "sales", "contact", "hello", "support", "office", "press", "careers"];

let counter = 0;
const id = (prefix: string) => `${prefix}_${++counter}_${Math.random().toString(36).slice(2, 8)}`;
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(d.getHours() - Math.floor(Math.random() * 12));
  return d.toISOString();
};

export function generateMocks() {
  const companies: Company[] = [];
  const contacts: ContactRecord[] = [];
  const people: PersonRecord[] = [];
  const jobs: Job[] = [];
  const imports: ImportRecord[] = [];
  const activity: ActivityEntry[] = [];
  const logs: JobLog[] = [];

  // Jobs
  const statuses: JobStatus[] = ["running", "running", "completed", "completed", "completed", "scheduled", "paused", "draft", "failed", "stopped", "completed", "running"];
  statuses.forEach((status, i) => {
    const industry = pick(INDUSTRIES);
    const country = pick(COUNTRIES);
    const job: Job = {
      id: id("job"),
      name: `${industry} outreach — ${country} ${i + 1}`,
      industry,
      country,
      status,
      maxCompanies: 50 + Math.floor(Math.random() * 200),
      allowedWeekdays: ["mon", "tue", "wed", "thu", "fri"],
      startTime: "09:00",
      endTime: "18:00",
      collectGenericEmails: true,
      collectPhones: true,
      collectContactForms: Math.random() > 0.3,
      collectPersonNames: true,
      collectPersonRoles: true,
      collectDepartments: Math.random() > 0.4,
      deduplicate: true,
      notes: "",
      createdAt: daysAgo(20 - i),
      lastRunAt: status === "draft" || status === "scheduled" ? null : daysAgo(Math.max(0, 18 - i)),
      companiesFound: status === "draft" ? 0 : Math.floor(Math.random() * 80) + 10,
      contactsFound: status === "draft" ? 0 : Math.floor(Math.random() * 200) + 20,
      peopleFound: status === "draft" ? 0 : Math.floor(Math.random() * 90) + 5,
      pagesCrawled: status === "draft" ? 0 : Math.floor(Math.random() * 500) + 50,
      progress: status === "completed" ? 100 : status === "running" ? 30 + Math.floor(Math.random() * 50) : status === "paused" ? 45 : status === "failed" ? 22 : status === "stopped" ? 60 : 0,
    };
    jobs.push(job);
  });

  // Companies
  COMPANY_NAMES.forEach((name) => {
    const domain = `${slugify(name)}.com`;
    const country = pick(COUNTRIES);
    const industry = pick(INDUSTRIES);
    const job = pick(jobs);
    const company: Company = {
      id: id("co"),
      name,
      domain,
      website: `https://www.${domain}`,
      country,
      industry,
      sourceUrl: `https://www.${domain}/contact`,
      createdAt: daysAgo(Math.floor(Math.random() * 30)),
      updatedAt: daysAgo(Math.floor(Math.random() * 5)),
      contactsCount: 0,
      peopleCount: 0,
      jobIds: [job.id],
      pagesCrawled: Math.floor(Math.random() * 30) + 3,
    };
    companies.push(company);
  });

  // Contacts — strictly generic only
  companies.forEach((company) => {
    const numContacts = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numContacts; i++) {
      const type: ContactType = pick(["generic_email", "generic_email", "phone", "contact_form"]);
      let value = "";
      if (type === "generic_email") value = `${pick(GENERIC_PREFIXES)}@${company.domain}`;
      else if (type === "phone") value = `+${10 + Math.floor(Math.random() * 80)} ${Math.floor(Math.random() * 900) + 100} ${Math.floor(Math.random() * 9000) + 1000}`;
      else value = `${company.website}/contact`;

      // Guardrail: never store person-tied emails. (Generators above never produce them.)
      const job = company.jobIds[0] ? jobs.find((j) => j.id === company.jobIds[0]) ?? null : null;
      contacts.push({
        id: id("ct"),
        companyId: company.id,
        companyName: company.name,
        domain: company.domain,
        country: company.country,
        industry: company.industry,
        contactType: type,
        contactValue: value,
        sourceUrl: `${company.website}/contact`,
        foundAt: daysAgo(Math.floor(Math.random() * 14)),
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        importStatus: pick<ImportStatus>(["matched", "matched", "matched", "partial_match", "duplicate"]),
      });
      company.contactsCount++;
    }
  });

  // People — public metadata only, no email field
  companies.forEach((company) => {
    const numPeople = Math.floor(Math.random() * 3);
    for (let i = 0; i < numPeople; i++) {
      const job = company.jobIds[0] ? jobs.find((j) => j.id === company.jobIds[0]) ?? null : null;
      people.push({
        id: id("p"),
        fullName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        roleTitle: pick(ROLES),
        department: pick(DEPARTMENTS),
        companyId: company.id,
        companyName: company.name,
        domain: company.domain,
        country: company.country,
        industry: company.industry,
        sourceUrl: `${company.website}/about`,
        foundAt: daysAgo(Math.floor(Math.random() * 14)),
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        importStatus: pick<ImportStatus>(["matched", "matched", "partial_match"]),
      });
      company.peopleCount++;
    }
  });

  // Imports
  for (let i = 0; i < 8; i++) {
    const total = 20 + Math.floor(Math.random() * 80);
    const matched = Math.floor(total * 0.7);
    const partial = Math.floor(total * 0.15);
    const notFound = Math.floor(total * 0.08);
    const duplicates = Math.floor(total * 0.05);
    const failed = total - matched - partial - notFound - duplicates;
    const job = pick(jobs);
    const rows: ImportRow[] = [];
    for (let r = 0; r < Math.min(total, 25); r++) {
      const c = pick(companies);
      rows.push({
        id: id("ir"),
        companyName: c.name,
        country: c.country,
        website: c.website,
        industry: c.industry,
        status: pick<ImportStatus>(["matched", "matched", "matched", "partial_match", "not_found", "duplicate"]),
      });
    }
    imports.push({
      id: id("imp"),
      fileName: `companies_batch_${i + 1}.csv`,
      uploadedAt: daysAgo(i * 2),
      totalRows: total,
      matched,
      partial,
      notFound,
      duplicates,
      failed,
      jobId: job.id,
      jobName: job.name,
      rows,
    });
  }

  // Activity
  for (let i = 0; i < 20; i++) {
    const type = pick<ActivityEntry["type"]>(["job", "import", "export", "system"]);
    const messages: Record<typeof type, string[]> = {
      job: ["Job started", "Job completed", "Job paused by operator", "New companies discovered"],
      import: ["CSV uploaded", "Import completed", "Duplicates skipped"],
      export: ["CSV export generated", "XLSX export generated"],
      system: ["Scheduler tick", "Mock scraper restarted", "Cache refreshed"],
    };
    activity.push({
      id: id("act"),
      timestamp: daysAgo(Math.floor(i / 2)),
      type,
      message: pick(messages[type]),
    });
  }
  activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Logs for running jobs
  jobs.filter((j) => j.status === "running" || j.status === "completed" || j.status === "paused").forEach((j) => {
    for (let i = 0; i < 12; i++) {
      logs.push({
        id: id("log"),
        jobId: j.id,
        timestamp: daysAgo(0),
        level: pick<JobLog["level"]>(["info", "info", "info", "success", "warn"]),
        message: pick([
          `Crawled ${j.industry} listing page`,
          `Discovered ${Math.floor(Math.random() * 5) + 1} new companies`,
          `Extracted generic email from ${pick(companies).domain}`,
          `Found contact form on ${pick(companies).domain}`,
          `Skipped person-tied email (policy)`,
          `Rate limit cooldown 30s`,
        ]),
      });
    }
  });

  return { companies, contacts, people, jobs, imports, activity, logs };
}

export const seed = generateMocks();
