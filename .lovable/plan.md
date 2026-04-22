

## Goal

Two small UX improvements on the **Create job** page (`src/pages/CreateJob.tsx`):

1. Move the **Job name** field out of the "Basics" section and place it directly under the "Create job" page header.
2. Redesign the **Allowed weekdays** picker so selected days are clearly distinguishable.

## Changes

### 1. Job name — surface at the top

- Remove the `Job name` input from the "Basics" `SectionCard` (lines 292–295).
- Add a new dedicated `SectionCard` titled **"Job name"** (description: *"Give this job a recognizable name"*) placed **above** the "Source" section, right under the `PageHeader`.
- Keep the same `Input`, validation hookup, and asterisk indicator.
- "Basics" then contains only Industry / Country / Max companies in a 3-column grid (or 2-col on smaller screens) — drop the `md:col-span-2` wrapper.

### 2. Weekday picker redesign

Replace the small uppercase `ToggleGroupItem` row with a more visually obvious selector:

- 7 evenly spaced **circular day pills** (~44×44 px) showing 3-letter day labels (Mon, Tue, …).
- **Selected**: filled `bg-primary` background, `text-primary-foreground`, subtle ring/shadow, slight scale.
- **Unselected**: `bg-muted`, muted foreground text, hover lightens.
- Weekend days (Sat / Sun) get a subtle accent in the unselected state (lighter muted tone) to distinguish them from weekdays at a glance.
- Below the row: small helper text showing the current selection summary, e.g. *"Mon–Fri selected (5 days)"* or *"No days selected"* in destructive color when empty.
- Add two quick-action text buttons next to the label: **Weekdays** (Mon–Fri) and **Every day** for fast presets.
- Keep the underlying state shape (`form.weekdays: Weekday[]`) and `update("weekdays", …)` unchanged — implement as plain buttons toggling array membership instead of `ToggleGroup`, for full styling control.

Keep all logic, validation, and submission identical. No backend or schema changes.

## Files to change

- `src/pages/CreateJob.tsx` — restructure sections (new top "Job name" card, slimmer "Basics"), and rewrite the weekday picker block in the Schedule section.

## Success criteria

- "Job name" input appears in its own card directly under the page title, before "Source".
- "Basics" no longer contains the name field.
- Selected weekdays are immediately, unmistakably visible (filled colored pills vs muted ones).
- Quick presets (**Weekdays**, **Every day**) work and update the selection.
- Selection summary text reflects the current state.

