# Deal Pipeline — Data Spec

Contract between the **daily sourcing program** (the Cowork routine that adds
companies) and the **Deal Pipeline page** (`pipeline.html`). Anything writing
into the pipeline must follow this so the CRM features — filters, sorting,
"added X days ago" insights, stale tracking, and the activity log — work.

## Firestore location

- Project: `beyond-utility-ventures`
- Collection: `pipeline_companies` (admin-only per `firestore.rules`)
- Activity log: subcollection `pipeline_companies/{docId}/activity` (admin-only)

## Company document fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **yes** | Company name. Also used for de-duplication (see below). |
| `technology` | string | recommended | One-line description of the technology. |
| `stageAmount` | string | optional | e.g. `"Seed, raising $2M"`. |
| `raisingStatus` | string | recommended | Exactly one of: `"Yes"`, `"Likely soon"`, `"No"`, `"Unknown"`. The page filters/sorts on these exact values. |
| `buvScore` | string | recommended | **Compact score only**, e.g. `"4/6"` — do not append the strong/weak rationale here; that belongs in `fitNotes`. The page parses `N/D` (or a bare number, assumed out of 6) for numeric sorting and shows only the leading `N/D` in the list column. |
| `fitNotes` | string | recommended | Why it fits (or doesn't fit) the BUV thesis. |
| `source` | string | **yes for automated adds** | Which scan/channel surfaced it, e.g. `"Daily sourcing scan"`, `"Imagine H2O cohort"`. The source filter is built dynamically from these values, so keep them consistent — same channel, same exact string. |
| `link` | string | optional | Full URL including `https://`. |
| `notes` | string | optional | Quick notes (freeform). Leave `""` for automated adds — this is the GP's field. |
| `nextStep` | string | optional | Suggested next action, e.g. `"Check raise timing with founder"`. |
| `status` | string | **yes** | Exactly one of: `"new"`, `"exploring"`, `"diligence"`, `"passed"`, `"invested"` (lowercase). `"exploring"` = GP has active interest and is gathering info, short of full diligence. Automated adds should always use `"new"`. |
| `isNew` | boolean | **yes for automated adds** | Drives the "New" pill in the list. Set `true` on every newly created company, and set it back to `true` on an existing company whenever the scan appends new findings to its activity log. The web UI flips it to `false` the first time the admin expands that row. |
| `addedDate` | timestamp | **yes** | Must be a **Firestore server timestamp** (`FieldValue.serverTimestamp()` / `SERVER_TIMESTAMP`), not a string. Powers the "Added" column, `Added ≤7d` insight, and date filters. |
| `lastUpdated` | timestamp | **yes** | Server timestamp; set equal to `addedDate` on create. Powers the `Stale 30d+` insight. |

Unknown/missing optional fields render as `—`; never write the literal string
`"Unknown"` except in `raisingStatus`.

## Activity log entries (`.../activity/{entryId}`)

Each entry documents one step of the process:

| Field | Type | Notes |
|---|---|---|
| `type` | string | One of: `"note"`, `"call"`, `"meeting"`, `"email"`, `"research"`, `"status"`, `"system"`. |
| `text` | string | What happened / what was learned. |
| `createdAt` | timestamp | Firestore server timestamp. Entries display newest-first. |

**The daily program should create one `system` entry when it adds a company**,
so every company's timeline starts with its provenance, e.g.:

```
type: "system"
text: "Added by daily sourcing scan — surfaced via <where it was found>. <1-2 sentence rationale>."
```

The web UI auto-logs status changes (`type: "status"`) and detail edits; the
GP logs notes/calls/meetings manually.

## Rules for the daily program

1. **De-duplicate before adding.** Query `pipeline_companies` for an existing
   doc with the same `name` (case-insensitive compare on the fetched list).
   If it exists, do **not** create a duplicate — append an `activity` entry
   (`type: "research"`) with the new information instead, and update
   `lastUpdated` and set `isNew: true` so the update surfaces in the UI.
2. **Never overwrite GP-owned fields** on an existing doc: `notes`, `status`,
   `nextStep`, and never touch `addedDate` after creation.
3. Use server timestamps for `addedDate`, `lastUpdated`, and `createdAt`.
4. Use the exact enumerated values for `status` and `raisingStatus` listed above.

## Paste-ready addendum for the Cowork daily routine prompt

> When adding a company to the pipeline, write to the Firestore collection
> `pipeline_companies` in project `beyond-utility-ventures` with exactly these
> fields: `name`, `technology`, `stageAmount`, `raisingStatus` (one of
> Yes / Likely soon / No / Unknown), `buvScore` (the compact score ONLY, like
> "4/6" — put the strong/weak rationale in `fitNotes` instead), `fitNotes`,
> `source` (use a consistent channel name), `link`, `nextStep` (suggested next
> action), `notes` set to "", `status` set to "new", `isNew` set to true, and
> `addedDate` + `lastUpdated` as Firestore server timestamps. Before adding,
> check whether a company with the same name already exists; if it does, add a
> `research` entry to its `activity` subcollection with the new findings and
> update `lastUpdated` and set `isNew: true` on the company doc instead of
> creating a duplicate. After creating a new company
> doc, add one entry to its `activity` subcollection with `type: "system"`,
> `createdAt` as a server timestamp, and `text` explaining where it was
> surfaced and why it fits the thesis.
