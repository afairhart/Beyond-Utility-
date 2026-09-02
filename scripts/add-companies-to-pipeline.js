#!/usr/bin/env node
/**
 * One-time task: add a specific set of companies to the BUV Deal Pipeline.
 *
 * The pipeline lives in the Firestore collection `pipeline_companies` in the
 * `beyond-utility-ventures` project — NOT in this repo's HTML. This script
 * writes to that collection following the contract documented on the live site
 * at PIPELINE_DATA_SPEC.md, matching exactly what the pipeline.html "Add
 * Company" form writes (fields, `activity` subcollection, server timestamps).
 *
 * Key safety rules (from PIPELINE_DATA_SPEC.md):
 *   1. De-duplicate by name (case-insensitive). If a company already exists,
 *      DON'T create a duplicate — just append a research activity entry,
 *      bump `lastUpdated`, and set `isNew: true`.
 *   2. Protect GP-owned fields: never overwrite `notes`, `status`, `nextStep`,
 *      or `addedDate` on an existing record.
 *   3. Create a system/research activity entry documenting the source.
 *
 * This script is DRY-RUN by default. It only writes when you pass --commit.
 *
 * ── How to run ────────────────────────────────────────────────────────────
 *   1. Get a service-account key JSON for the `beyond-utility-ventures`
 *      project (Firebase console → Project settings → Service accounts →
 *      "Generate new private key"). Save it somewhere private.
 *   2. Point Google's credentials env var at it:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   3. Install deps and preview (dry run — writes nothing):
 *        cd scripts && npm install && node add-companies-to-pipeline.js
 *   4. When the preview looks right, actually write:
 *        node add-companies-to-pipeline.js --commit
 *
 * Re-running is safe: companies already present are skipped (a note is logged),
 * so nothing gets duplicated.
 *
 * NOTE: this does not touch the sourcing-registry count (settings/sourcingRegistry).
 * That total is maintained by the daily sourcing scan and shouldn't be nudged
 * by a manual one-off add.
 */

const admin = require("firebase-admin");

const COLLECTION = "pipeline_companies";
const PROJECT_ID = "beyond-utility-ventures";

// A shared, human-readable source label so these all trace back to this task.
const SOURCE = "GP referral — one-time manual add (2026-09-02)";

/**
 * The companies to add. Fields mirror the pipeline.html form / PIPELINE_DATA_SPEC:
 *   name, technology, stageAmount, raisingStatus, buvScore, fitNotes,
 *   source, link, notes, nextStep, status.
 * `buvScore` is intentionally left blank — a real BUV Six score needs
 * per-criterion reasoning, so scoring is left for the GP rather than guessed.
 * `raisingStatus` is "Unknown" where a live round isn't confirmed.
 */
const COMPANIES = [
  {
    name: "Deep Earth",
    technology:
      "Stealth — public site is waitlist-only; subsurface/earth-data theme, specifics not yet disclosed.",
    stageAmount: "",
    raisingStatus: "Unknown",
    buvScore: "",
    fitNotes:
      "GP referral. Stealth-stage; water/thesis relevance not yet confirmed — verify a possible subsurface / groundwater / geothermal angle before advancing.",
    link: "https://deepearth.tech",
    nextStep: "Verify what the company actually does (site is waitlist-only).",
  },
  {
    name: "TOVA",
    technology:
      "AI-native water-risk intelligence — RiverCloud (physics-informed basin model) + Pisces (AI agent) for water utilities and water-intensive industries, including data centers.",
    stageAmount: "Techstars-backed",
    raisingStatus: "Unknown",
    buvScore: "",
    fitNotes:
      "Strong thesis fit — Digital & Software / water intelligence. CEO Alexa Bruce (alexa@tova.earth), water-resources engineer (ex-Arup). Data-center water-risk angle per GP. Complementary to the compliance/intelligence thesis.",
    link: "https://tova.earth",
    nextStep: "Intro call with Alexa Bruce (alexa@tova.earth).",
  },
  {
    name: "TerraByte",
    technology:
      "'Earth search engine' — natural-language querying of live satellite imagery for infrastructure and environmental monitoring (~15M events/day).",
    stageAmount: "",
    raisingStatus: "Unknown",
    buvScore: "",
    fitNotes:
      "Adjacent — geospatial / Earth-observation, not core water treatment or water software. Possible water-monitoring / land-use applications; confirm water relevance and thesis fit before advancing.",
    link: "https://terrabyte.ai",
    nextStep: "Assess whether the geospatial platform has a real water use-case.",
  },
  {
    name: "Nafura",
    technology:
      "Plasma A.R.C. reactor for chemical-free industrial wastewater treatment; ~1000x smaller footprint than conventional systems.",
    stageAmount: "~$337K raised (Deep Science Ventures, The Water Council)",
    raisingStatus: "Unknown",
    buvScore: "",
    fitNotes:
      "Strong thesis fit — Treatment technology (industrial process water, contaminant destruction, modular/decentralized). Water Council Tech Challenge spring-2025 winner (organic-contaminant removal). Founded 2025, Guildford UK — per BUV international rule, track as a future US entrant (trigger: US entity / US pilot / US-directed raise).",
    link: "https://nafura.co.uk",
    nextStep: "Track as future US entrant; watch for a US pilot or US-directed raise.",
  },
  {
    name: "Iterating",
    technology:
      "Water-distribution modeling software — 'Mastering Water Models' and epanet-js (EPANET simulation in the browser) for modeling water networks.",
    stageAmount: "",
    raisingStatus: "Unknown",
    buvScore: "",
    fitNotes:
      "Strong thesis fit — Digital & Software / water intelligence & modeling. Canada-based (per international rule, track as future US entrant). Founded 2025 by Luke & Sam (founders@iterating.ca); early / likely pre-raise — engage early per the pre-raise doctrine.",
    link: "https://iterating.ca",
    nextStep: "Reach out to founders@iterating.ca (pre-raise — engage early).",
  },
];

// ── Wiring ──────────────────────────────────────────────────────────────────

const COMMIT = process.argv.includes("--commit");

function initFirestore() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "\n✖ GOOGLE_APPLICATION_CREDENTIALS is not set.\n" +
        "  Point it at a service-account key JSON for the " +
        PROJECT_ID +
        " project, e.g.\n" +
        "    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json\n"
    );
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
  });
  return admin.firestore();
}

async function run() {
  const db = initFirestore();
  const { FieldValue } = admin.firestore;

  console.log(
    `\nBUV pipeline one-time add — ${
      COMMIT ? "COMMIT (writing to Firestore)" : "DRY RUN (no writes)"
    }\n` + "─".repeat(60)
  );

  // Load existing names once so we can de-dupe case-insensitively.
  const snapshot = await db.collection(COLLECTION).get();
  const existingByLowerName = new Map();
  snapshot.forEach((doc) => {
    const nm = (doc.data().name || "").trim().toLowerCase();
    if (nm) existingByLowerName.set(nm, doc);
  });
  console.log(`Existing companies in pipeline: ${existingByLowerName.size}\n`);

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const c of COMPANIES) {
    const key = c.name.trim().toLowerCase();
    const existing = existingByLowerName.get(key);

    if (existing) {
      // Rule 1 + 2: don't duplicate, don't overwrite GP-owned fields. Just log
      // a research activity entry and mark it freshly touched.
      console.log(`• ${c.name}: already in pipeline — appending activity note only.`);
      updated++;
      skipped++;
      if (COMMIT) {
        await existing.ref.update({
          isNew: true,
          lastUpdated: FieldValue.serverTimestamp(),
        });
        await existing.ref.collection("activity").add({
          type: "research",
          text: `Re-surfaced via ${SOURCE}.`,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      continue;
    }

    console.log(`• ${c.name}: NEW → will add.`);
    console.log(`    tech:  ${c.technology}`);
    console.log(`    link:  ${c.link}`);
    added++;

    if (COMMIT) {
      const docRef = await db.collection(COLLECTION).add({
        name: c.name,
        technology: c.technology || "",
        stageAmount: c.stageAmount || "",
        raisingStatus: c.raisingStatus || "Unknown",
        buvScore: c.buvScore || "",
        fitNotes: c.fitNotes || "",
        source: SOURCE,
        link: c.link || "",
        notes: "",
        nextStep: c.nextStep || "",
        status: "new",
        isNew: true,
        addedDate: FieldValue.serverTimestamp(),
        lastUpdated: FieldValue.serverTimestamp(),
      });
      await docRef.collection("activity").add({
        type: "system",
        text: `Added to pipeline via one-time script. Source: ${SOURCE}.`,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(
    `Summary: ${added} new, ${updated} already present (activity noted), ` +
      `${COMPANIES.length} total considered.`
  );
  if (!COMMIT) {
    console.log("\nThis was a DRY RUN — nothing was written.");
    console.log("Re-run with --commit to actually add them:");
    console.log("  node add-companies-to-pipeline.js --commit\n");
  } else {
    console.log("\n✓ Done. Check the Deal Pipeline page to confirm.\n");
  }
}

run().catch((err) => {
  console.error("\n✖ Failed:", err.message);
  process.exit(1);
});
