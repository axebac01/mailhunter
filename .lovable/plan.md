

## mailhunter.ai — Internal Admin Dashboard

A polished, desktop-first B2B admin app for researching **public company contact data only** (generic emails like info@/sales@, phones, contact forms, public people metadata). No personal emails, ever. No auth in MVP. Seeded with realistic mock data so every screen feels production-ready.

### Design system
- Modern enterprise SaaS look: clean white surfaces, deep slate text, single accent (indigo/violet), subtle shadows, rounded-xl cards, sharp typography (Inter).
- HSL tokens in `index.css` + Tailwind config: background, foreground, primary (accent), muted, border, success, warning, destructive, plus status colors for job/import states.
- Reusable primitives: `StatusBadge`, `KpiCard`, `DataTable` (sticky header, sort, pagination, bulk select), `FilterBar`, `EmptyState`, `PageHeader`, `SectionCard`, `ConfirmDialog`, `ProgressBar`, loading skeletons, toasts (sonner).

### Layout
- `AppLayout` with collapsible left sidebar (mailhunter.ai logo on top, nav items with lucide icons) + top header (page title, breadcrumbs, primary action button).
- Sidebar nav: Dashboard, Jobs, Create Job, Imports, Contacts, People, Companies, Settings.

### Mock data layer
- `src/mocks/` with realistic seed data: ~12 jobs (varied statuses), ~40 companies, ~120 contact records (only generic_email / phone / contact_form), ~60 people (name + role + department, no emails), ~8 imports, activity log entries.
- Lightweight in-memory store (Zustand) so actions like start/pause/stop/duplicate/delete, filters, bulk export, and imports actually mutate the UI live. Export buttons generate real CSV/XLSX downloads from current rows.

### Pages

1. **Dashboard** — 7 KPI cards (total/active jobs, companies, contacts, people, imports, completed exports), Recent Jobs, Recent Imports, Latest Contacts, Latest People, System Activity feed, Quick Actions row (Create Job, Import Companies, View Contacts, View Companies, Export Results).

2. **Create Job** — sectioned form (Basics → Targeting → Schedule → Collection scope → Notes). Toggleable checkboxes for each allowed collection type, weekday multi-select, time range, validation per spec, "Save as draft" + "Schedule job" actions.

3. **Jobs** — filterable data table with all listed columns, status badges, row action menu (view, start, pause, stop, duplicate, delete with confirm), filter bar (status, country, industry, created/last-run date ranges), empty state.

4. **Job Details** (`/jobs/:id`) — header with status badge + action buttons (start/pause/stop/duplicate, export CSV, export XLSX), summary + configuration cards, animated progress bar, metrics grid, tabs for Companies / Contacts / People / Source pages crawled / Logs (live-feeling log feed).

5. **Imports** — drag-and-drop zone (CSV/XLS/XLSX), file preview, column mapping UI (map source columns → company_name/country/website/industry/notes), import options (create new job / attach to existing / ignore duplicates / overwrite empty / auto-start), summary screen, import history table with per-row statuses, import detail page.

6. **Contacts** — global table restricted to `generic_email | phone | contact_form`. Search, multi-filter bar, sortable columns, sticky header, pagination, bulk select, three export modes (visible / filtered / selected), clear filters.

7. **People** — public metadata only (name, role, department, company, etc.). Same table UX as Contacts. Hard rule enforced in mock layer: any person-tied email is discarded before storage.

8. **Companies** — companies table + Company Detail (`/companies/:id`) with profile, source info, related jobs/contacts/people tabs, crawled source pages, notes.

9. **Settings** — sectioned screen: default export settings, scheduler defaults, deduplication defaults, import defaults, mock scraper settings, system status panel, seed/demo data management (reset / reseed buttons with confirm).

### UX polish
- Sticky table headers, skeleton loaders on first render, toast feedback on every action, confirm modals for delete/stop, realistic progress animations on running jobs, fast client-side navigation, polished empty states with the exact copy from the brief.

### Guardrails baked in
- Contact type union limited to allowed values at the type level.
- People records have no email field at all.
- Mock generators explicitly skip person-tied emails.
- Copy throughout positions the product as a **public company contact research tool**.

