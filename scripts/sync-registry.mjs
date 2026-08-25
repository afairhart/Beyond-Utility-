#!/usr/bin/env node
/*
 * sync-registry.mjs — push sourcing-registry companies into Firestore.
 *
 * Used by the "BUV daily sourcing scan" task to keep the website's
 * Sourcing Registry page (registry.html) in sync with the scan's local
 * registry. Handles both the one-time backfill of already-rejected
 * companies and the per-run updates going forward.
 *
 * WHAT IT DOES
 *   - Upserts one doc per company into the `sourcing_registry` collection,
 *     de-duplicated by company name (the doc id is a slug of the name, so
 *     re-running never creates duplicates — it updates in place).
 *   - Preserves each company's original `seenDate` on later runs.
 *   - Recomputes `settings/sourcingRegistry.seenCount` so the tracker on the
 *     Deal Pipeline page stays correct.
 *
 * INPUT  (argv[2]): path to a JSON file — an array of company objects:
 *   {
 *     "name":        "AquaPoro",                       // required
 *     "description": "Membrane dehumidification for AWG", // one line
 *     "buvScore":    "1/6",                            // compact "N/6"
 *     "verdict":     "rejected",                       // rejected|watch|promoted (optional; derived from score if absent)
 *     "source":      "Daily sourcing scan",
 *     "link":        "https://…",
 *     "seenDate":    "2026-03-14"                      // ISO date/datetime (optional; defaults to now on first insert)
 *   }
 *
 * AUTH: uses the Firebase Admin SDK (bypasses security rules). Point
 *   GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON for the
 *   `beyond-utility-ventures` project. See scripts/README-registry-sync.md.
 *
 * USAGE:
 *   npm i firebase-admin
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/sync-registry.mjs companies.json
 */

import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

const PROJECT_ID = 'beyond-utility-ventures';
const COLLECTION = 'sourcing_registry';
const REJECT_THRESHOLD = 2 / 6; // "< 2/6" — matches the scan's reject cutoff

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

const inputPath = process.argv[2];
if (!inputPath) die('Usage: node scripts/sync-registry.mjs <companies.json>');

let companies;
try {
  companies = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (e) { die('Could not read/parse ' + inputPath + ': ' + e.message); }
if (!Array.isArray(companies)) die('Input JSON must be an array of company objects.');

// Parse "N/D" (or a bare number, assumed out of 6) into a 0–1 fraction.
function scoreFraction(s) {
  if (s === null || s === undefined || s === '') return -1;
  const m = String(s).match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?/);
  if (!m) return -1;
  const num = parseFloat(m[1]);
  const den = m[2] ? parseFloat(m[2]) : 6;
  return den ? num / den : num;
}

function deriveVerdict(c) {
  if (c.verdict && ['rejected', 'watch', 'promoted', 'logged'].includes(c.verdict)) return c.verdict;
  const frac = scoreFraction(c.buvScore);
  if (frac >= 0 && frac < REJECT_THRESHOLD) return 'rejected';
  return 'logged';
}

// Stable doc id from the company name → idempotent upserts (dedupe by name).
function slugId(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'unnamed';
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

function toTimestamp(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

async function run() {
  let created = 0, updated = 0, skipped = 0;

  for (const c of companies) {
    if (!c || !c.name || !String(c.name).trim()) { skipped++; continue; }
    const ref = db.collection(COLLECTION).doc(slugId(c.name));
    const snap = await ref.get();

    const data = {
      name: String(c.name).trim(),
      description: c.description ? String(c.description) : '',
      buvScore: c.buvScore ? String(c.buvScore) : '',
      verdict: deriveVerdict(c),
      source: c.source ? String(c.source) : '',
      link: c.link ? String(c.link) : '',
      lastSyncedAt: FieldValue.serverTimestamp(),
    };

    // Preserve the original seenDate; only set it on first insert.
    if (!snap.exists) {
      data.seenDate = toTimestamp(c.seenDate) || FieldValue.serverTimestamp();
      await ref.set(data);
      created++;
    } else {
      const providedTs = toTimestamp(c.seenDate);
      if (providedTs && !snap.get('seenDate')) data.seenDate = providedTs;
      await ref.set(data, { merge: true });
      updated++;
    }
  }

  // Keep the pipeline-page tracker in sync with the true collection size.
  const all = await db.collection(COLLECTION).get();
  await db.collection('settings').doc('sourcingRegistry').set(
    { seenCount: all.size, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  console.log(`✓ Registry synced — created ${created}, updated ${updated}, skipped ${skipped}. seenCount = ${all.size}.`);
}

run().catch((e) => die(e.message));
