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

## Sourcing registry counter (`settings/sourcingRegistry`)

The Deal Pipeline page shows a small **"In Sourcing Registry"** tracker in the
top-left. It reflects the *full* de-dupe registry — every technology/company the
daily scan has ever seen — of which only a curated subset is promoted into
`pipeline_companies`. The page reads this number live; it cannot compute it,
because the registry lives outside Firestore (the scan's local seen-list).

Write it to the admin-only doc `settings/sourcingRegistry`:

| Field | Type | Notes |
|---|---|---|
| `seenCount` | number | Total distinct technologies/companies in the sourcing registry to date (the full de-dupe list, not just what's in the pipeline). |
| `updatedAt` | timestamp | Firestore server timestamp of the last update. |

Update it once per scan, **after** de-duplicating: set `seenCount` to the new
registry size (e.g. the line count of the seen-companies list) and `updatedAt`
to the server timestamp. If the doc doesn't exist yet, create it. The page shows
`– syncs on next sourcing scan` until the first write lands.

## Full sourcing registry (`sourcing_registry`)

Backs the **Sourcing Registry** page (`registry.html`), a read-only record of
**every company the scan evaluates — including the ones rejected below a 2/6
BUV Six score.** Only strong-fit companies are promoted into
`pipeline_companies`; this collection keeps the rest so they can be reviewed
later. The registry number on the Deal Pipeline page links into it (defaulting
to the rejected view).

Write **one doc per evaluated company** to `sourcing_registry` (admin-only):

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **yes** | Company name. Used for de-duplication (case-insensitive compare on the fetched list). |
| `description` | string | recommended | One-line description of the technology / what they do. Shown in the Description column. (`technology` is accepted as a fallback.) |
| `buvScore` | string | recommended | Compact score only, e.g. `"1/6"`. Parsed as `N/6` (bare number assumed out of 6). Anything `< 2/6` counts as rejected. |
| `verdict` | string | **yes** | One of: `"rejected"` (scored `< 2/6`, not pursued), `"watch"` (borderline — monitor), `"promoted"` (also added to `pipeline_companies`). If omitted, the page derives it from `buvScore` (`< 2/6` → rejected, else `logged`). |
| `source` | string | recommended | Which scan/channel surfaced it, e.g. `"Daily sourcing scan"`. |
| `link` | string | optional | Full URL incl. `https://`. Makes the company name a link. |
| `seenDate` | timestamp | **yes** | Firestore server timestamp of when it was first evaluated. Powers the "Seen" column and date sort. |
| `promotedId` | string | optional | If promoted, the `pipeline_companies` doc id, for cross-reference. |

Rules for the daily program:

1. **Log every evaluated company here**, whatever the score — this is the full
   record. Promote only strong-fit ones into `pipeline_companies` as well (set
   `verdict: "promoted"` and, if handy, `promotedId`).
2. **De-duplicate before adding** by `name` (case-insensitive). If it already
   exists, update the existing doc (e.g. a better score / new `verdict`) instead
   of creating a duplicate.
3. Keep `seenCount` in `settings/sourcingRegistry` equal to the number of docs in
   this collection.

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
>
> For **every** company you evaluate — not just the ones good enough for the
> pipeline — also write one doc to the Firestore collection `sourcing_registry`
> with: `name`, `description` (one line), `buvScore` (compact, e.g. "1/6"),
> `verdict` (one of `rejected` for `< 2/6`, `watch` for borderline, `promoted`
> if you also added it to `pipeline_companies`), `source`, `link`, and
> `seenDate` as a Firestore server timestamp. De-duplicate by `name`
> (case-insensitive): if it already exists, update that doc rather than adding a
> duplicate. This is the full record behind the Sourcing Registry page, so
> rejects can be reviewed later.
>
> Also, once per run after de-duplicating, update the doc
> `settings/sourcingRegistry` in the same project: set `seenCount` to the total
> number of docs in `sourcing_registry` (the full de-dupe list of everything
> seen to date), and `updatedAt` to a Firestore server timestamp. Create the doc
> if it doesn't exist. This drives the "In Sourcing Registry" tracker on the
> pipeline page.
