# scripts/

One-off maintenance scripts for Beyond Utility Water Ventures.

## add-companies-to-pipeline.js

A **one-time task** that adds a fixed list of companies to the Deal Pipeline.

### Why a script (and not just an edit in this repo)

The Deal Pipeline is **not** stored as a file in this repository. It lives in a
Firestore database (collection `pipeline_companies` in the `beyond-utility-ventures`
project). The live `pipeline.html` page reads and writes that collection directly
from the admin's browser. So the only two ways to add companies are:

1. The **"Add Company" form** on the live pipeline page, while logged in as admin, or
2. A program using **admin credentials** — which is what this script is.

This script writes exactly the same fields the form writes (see the write contract
at `PIPELINE_DATA_SPEC.md` on the live site) and is **safe to re-run**: it
de-duplicates by company name, so it never creates duplicates.

### Companies this adds

- **Deep Earth** — deepearth.tech (stealth; relevance to verify)
- **TOVA** — tova.earth (AI water-risk intelligence; CEO Alexa Bruce)
- **TerraByte** — terrabyte.ai (satellite "Earth search engine"; adjacent)
- **Nafura** — nafura.co.uk (plasma industrial wastewater treatment; UK)
- **Iterating** — iterating.ca (water-network modeling software; Canada)

### How to run

1. Get a service-account key JSON for the `beyond-utility-ventures` project:
   Firebase console → **Project settings → Service accounts → Generate new
   private key**. Save it somewhere private (do **not** commit it).

2. Tell Google's SDK where the key is:

   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
   ```

3. Install dependencies and **preview** (this is a dry run — it writes nothing):

   ```bash
   cd scripts
   npm install
   node add-companies-to-pipeline.js
   ```

4. When the preview looks right, **actually write** to the pipeline:

   ```bash
   node add-companies-to-pipeline.js --commit
   ```

5. Open the Deal Pipeline page to confirm the companies appear.

### Notes

- **Dry run by default.** Nothing is written unless you pass `--commit`.
- **No duplicates.** A company already in the pipeline is skipped (a short
  activity note is added instead).
- **GP-owned fields are protected.** For companies that already exist, the
  script never overwrites `notes`, `status`, `nextStep`, or `addedDate`.
- The sourcing-registry count (`settings/sourcingRegistry`) is **not** changed —
  that total is maintained by the daily sourcing scan.

### Prefer to do it by hand?

If you'd rather not run a script, add each company through the **"Add Company"**
form on the live pipeline page. The `fitNotes`, `technology`, and `link` values
in `add-companies-to-pipeline.js` are written out per company and can be copied
straight into the form.
