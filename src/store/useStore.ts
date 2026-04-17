import { create } from "zustand";
import { seed } from "@/mocks/data";
import type { ActivityEntry, Company, ContactRecord, ImportRecord, Job, JobLog, JobStatus, PersonRecord } from "@/types";

interface State {
  jobs: Job[];
  companies: Company[];
  contacts: ContactRecord[];
  people: PersonRecord[];
  imports: ImportRecord[];
  activity: ActivityEntry[];
  logs: JobLog[];
  exportsCompleted: number;

  addJob: (job: Job) => void;
  updateJobStatus: (id: string, status: JobStatus) => void;
  duplicateJob: (id: string) => string | null;
  deleteJob: (id: string) => void;
  addImport: (record: ImportRecord) => void;
  deleteImport: (id: string) => void;
  logActivity: (entry: Omit<ActivityEntry, "id" | "timestamp">) => void;
  incExports: () => void;
  reseed: () => void;
  clearAll: () => void;
}

const stamp = () => new Date().toISOString();
const rid = () => Math.random().toString(36).slice(2, 10);

export const useStore = create<State>((set, get) => ({
  ...seed,
  exportsCompleted: 14,

  addJob: (job) => {
    set((s) => ({ jobs: [job, ...s.jobs] }));
    get().logActivity({ type: "job", message: `Job created: ${job.name}` });
  },

  updateJobStatus: (id, status) => {
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id
          ? { ...j, status, lastRunAt: status === "running" ? stamp() : j.lastRunAt, progress: status === "completed" ? 100 : j.progress }
          : j,
      ),
    }));
    const job = get().jobs.find((j) => j.id === id);
    if (job) get().logActivity({ type: "job", message: `${job.name} → ${status}` });
  },

  duplicateJob: (id) => {
    const original = get().jobs.find((j) => j.id === id);
    if (!original) return null;
    const newId = `job_${rid()}`;
    const copy: Job = {
      ...original,
      id: newId,
      name: `${original.name} (copy)`,
      status: "draft",
      createdAt: stamp(),
      lastRunAt: null,
      companiesFound: 0,
      contactsFound: 0,
      peopleFound: 0,
      pagesCrawled: 0,
      progress: 0,
    };
    set((s) => ({ jobs: [copy, ...s.jobs] }));
    get().logActivity({ type: "job", message: `Duplicated: ${original.name}` });
    return newId;
  },

  deleteJob: (id) => {
    const j = get().jobs.find((x) => x.id === id);
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    if (j) get().logActivity({ type: "job", message: `Deleted: ${j.name}` });
  },

  addImport: (record) => {
    set((s) => ({ imports: [record, ...s.imports] }));
    get().logActivity({ type: "import", message: `Imported ${record.fileName} (${record.totalRows} rows)` });
  },

  deleteImport: (id) => set((s) => ({ imports: s.imports.filter((i) => i.id !== id) })),

  logActivity: (entry) =>
    set((s) => ({
      activity: [{ id: `act_${rid()}`, timestamp: stamp(), ...entry }, ...s.activity].slice(0, 100),
    })),

  incExports: () => {
    set((s) => ({ exportsCompleted: s.exportsCompleted + 1 }));
    get().logActivity({ type: "export", message: "Export generated" });
  },

  reseed: () => {
    const fresh = seed;
    set({ ...fresh, exportsCompleted: 14 });
  },

  clearAll: () =>
    set({
      jobs: [],
      companies: [],
      contacts: [],
      people: [],
      imports: [],
      activity: [{ id: `act_${rid()}`, timestamp: stamp(), type: "system", message: "All data cleared" }],
      logs: [],
      exportsCompleted: 0,
    }),
}));
