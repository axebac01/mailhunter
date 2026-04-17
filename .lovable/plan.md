
User wants a new collection option for "personal public emails" on Create Job. Currently the form has 6 collection toggles and explicitly excludes person-tied emails (via `isPersonalEmail` filter in jobSimulator). Need to add a 7th option that, when enabled, allows person-tied emails (e.g. firstname.lastname@company.com) to be stored — but still only public ones found on company sites.

Need to check: api types, db column, simulator behavior.

The crawl_jobs table has columns like `include_generic_emails`, `include_phones`, etc. — I'd need a new `include_person_emails` column. Also the contacts `contact_type` enum needs a `person_email` value (or reuse generic_email but flagged differently). And jobSimulator needs to optionally generate person emails when toggled on.

## Plan: Add "Collect personal public emails" option

### Scope
A new opt-in collection toggle that allows the crawler to store publicly-listed person-tied emails (e.g. `anna.lindqvist@company.com`) found on team/contact pages. Off by default. When off, behavior is unchanged (person-tied emails are discarded).

### Database
Add one column to `crawl_jobs`:
- `include_person_emails boolean NOT NULL DEFAULT false`

Add one value to the `contact_type` enum:
- `person_email`

(Migration via the database tool.)

### Code changes

**`src/lib/api.ts`**
- Add `collectPersonEmails` to the Job type and the `createJob` payload mapping.
- Map the new column in `mapJob`.

**`src/pages/CreateJob.tsx`**
- Add `collectPersonEmails: false` to form state.
- Add a 7th item in `collectionOptions` with label "Collect personal public emails" and a hint that warns this includes name-based emails and should only be used where lawful (e.g. legitimate B2B outreach with a clear lawful basis).
- Pass it into `api.createJob`.

**`src/lib/jobSimulator.ts`**
- When `job.collectPersonEmails` is true and a person row is generated, also insert a `person_email` contact like `firstname.lastname@domain` linked to that person's company. Keep the existing `isPersonalEmail` discard rule only for the generic-email branch.

**`src/pages/JobDetail.tsx`** (light touch)
- If it renders the collection scope summary, add the new flag. (Will verify when implementing.)

### UX note
The option will be styled identically to the others but with a short hint making clear: "Public name-based emails (e.g. firstname.lastname@company). Off by default — enable only for lawful B2B use cases."

### Out of scope
No retroactive change to existing jobs. No new export columns (existing emails export already includes all `contact_type` values).
