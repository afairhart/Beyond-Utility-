# Sourcing Registry sync

Pushes the "BUV daily sourcing scan" registry into the website's
`sourcing_registry` Firestore collection, which backs the **Sourcing
Registry** page (`registry.html`). Covers both the **one-time backfill** of
already-rejected companies and the **per-run updates** going forward.

The script is `scripts/sync-registry.mjs`. It upserts one doc per company
(de-duplicated by name), preserves each company's original `seenDate`, and
keeps `settings/sourcingRegistry.seenCount` correct.

## One-time setup: Firestore write access

The registry is admin-only, so the task needs credentials. Use a **service
account** (standard for automation — no human password involved):

1. Firebase Console → project **beyond-utility-ventures** → Project settings →
   **Service accounts** → **Generate new private key**. Save the JSON.
2. In the environment where the scan runs, make it available and install the
   one dependency:
   ```bash
   npm i firebase-admin
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   ```

The Admin SDK bypasses security rules, so no sign-in step is needed.

## Usage

Build a JSON array of companies, then run:

```bash
node scripts/sync-registry.mjs companies.json
```

Each company object (only `name` is required):

```json
[
  {
    "name": "AquaPoro",
    "description": "Membrane dehumidification for atmospheric water generation",
    "buvScore": "1/6",
    "verdict": "rejected",
    "source": "Daily sourcing scan",
    "link": "https://example.com",
    "seenDate": "2026-03-14"
  }
]
```

- `verdict`: `rejected` (scored `< 2/6`), `watch` (borderline), or `promoted`
  (also in `pipeline_companies`). If omitted, it's derived from `buvScore`
  (`< 2/6` → `rejected`).
- `seenDate`: ISO date; used only on first insert, then preserved.
- Re-running is safe — the doc id is a slug of the name, so companies update
  in place instead of duplicating.

## Backfill (run once)

To load everything already rejected, build `companies.json` from the scan's
history and run the script once:

1. Read `~/Claude/BUV-Sourcing/seen-companies.txt` (every company ever seen)
   and the daily logs `~/Claude/BUV-Sourcing/*.md`.
2. For each unique company, pull a one-line `description`, the `buvScore` if
   one was assigned, and `source`/`link` from the daily log; set `verdict`
   (`promoted` if it's already in `pipeline_companies`, else `rejected` for
   `< 2/6`, else `watch`); use the log date as `seenDate`.
3. Write them all to `companies.json` and run
   `node scripts/sync-registry.mjs companies.json`.

After it finishes, `registry.html` shows the full set and the pipeline-page
tracker reflects the real count.
