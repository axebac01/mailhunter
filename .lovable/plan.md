
## Add `/contact` and `/contacts` to crawled contact pages

### What changes
In `src/lib/jobSimulator.ts`, the simulator currently always builds `https://www.{domain}/contact` for contact-page visits, and hardcodes `/contact-us` for contact-form URLs. I'll expand both to use realistic variants so source pages reflect the common paths real sites use.

### Specifics
- Add `CONTACT_PATHS = ["contact", "contacts", "contact-us"]`.
- When `pageType === "contact"`, randomly pick from `["contact", "contacts"]` for the source URL (DB `page_type` enum stays `"contact"` — unchanged).
- For contact-form contacts, randomly pick from `CONTACT_PATHS` for the form URL value.
- Update the log message to reflect the actual path crawled (e.g. "Crawled /contacts page on acme.com").

### Files touched
- `src/lib/jobSimulator.ts` only. No DB, API, or enum changes.
