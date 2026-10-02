#!/usr/bin/env node
/*
 * sourcing-scan.mjs — storage helper for the BUV daily sourcing scan.
 *
 * The scan used to keep its registry and daily logs in a folder on Alex's Mac
 * and sync the website through a logged-in Chrome tab. It now runs as a cloud
 * routine, so everything lives in the website's admin-only Firestore instead:
 *
 *   sourcing_registry/{slug}      every company the scan has ever evaluated
 *   sourcing_daily_logs/{date}    one markdown log per day ({ date, markdown })
 *   pipeline_companies/{id}       the Deal Pipeline (see PIPELINE_DATA_SPEC.md)
 *   settings/sourcingRegistry     the "In Sourcing Registry" counter
 *
 * COMMANDS
 *   check                          verify credentials; print collection sizes
 *   registry-dump <out.md>         write the registry as pipe-separated lines
 *                                  (name | first seen | score, verdict, event)
 *   registry-upsert <file.json>    add/update registry entries, then resync the
 *                                  counter. Array of { name, description,
 *                                  buvScore, verdict, source, link, seenDate,
 *                                  lastEvent }. Empty fields never overwrite.
 *   registry-import <registry.md>  one-time backfill from the old Mac file
 *   pipeline-list                  print names already on the Deal Pipeline
 *   pipeline-add <file.json>       add companies to the Deal Pipeline per
 *                                  PIPELINE_DATA_SPEC.md; existing names get a
 *                                  `research` activity entry instead
 *   log-get [n]                    print the n most recent daily logs (default 2)
 *   log-append <YYYY-MM-DD> <file> append a markdown file to that day's log
 *   seen-dump <out.txt>            write investor-portfolio names already reviewed
 *   seen-add <names.txt>           mark portfolio names (one per line) as reviewed
 *   sbir <keyword…>                search sbir.gov awards, newest first
 *
 * AUTH: set FIREBASE_PRIVATE_KEY to the "private_key" value from the service-account
 *   key file (one line, \n escapes kept), or FIREBASE_SERVICE_ACCOUNT_JSON to the whole JSON (raw
 *   or base64) for the `beyond-utility-ventures` project, or point
 *   GOOGLE_APPLICATION_CREDENTIALS at the key file. `sbir` needs no auth.
 *
 * USAGE:  cd scripts && npm install && node sourcing-scan.mjs check
 */

import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

const PROJECT_ID = 'beyond-utility-ventures';
const REGISTRY = 'sourcing_registry';
const PIPELINE = 'pipeline_companies';
const LOGS = 'sourcing_daily_logs';
const SEEN = 'sourcing_portfolio_seen';
const REJECT_THRESHOLD = 2 / 6;
const RAISING = ['Yes', 'Likely soon', 'No', 'Unknown'];

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

let db, FieldValue, Timestamp;
function initDb() {
  if (db) return db;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const pk = process.env.FIREBASE_PRIVATE_KEY;
  if (pk) {
    // Just the "private_key" value from the key file, copied as one line. Tolerate
    // the surrounding quotes / trailing comma, and turn literal \n back into newlines.
    const privateKey = pk.trim().replace(/,$/, '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
    if (!privateKey.includes('BEGIN PRIVATE KEY')) die('FIREBASE_PRIVATE_KEY does not look like a private key (missing BEGIN PRIVATE KEY).');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL || `firebase-adminsdk-fbsvc@${PROJECT_ID}.iam.gserviceaccount.com`,
        privateKey,
      }),
      projectId: PROJECT_ID,
    });
  } else if (raw) {
    let json = raw.trim();
    if (!json.startsWith('{')) json = Buffer.from(json, 'base64').toString('utf8');
    let key;
    try { key = JSON.parse(json); } catch (e) { die('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ' + e.message); }
    admin.initializeApp({ credential: admin.credential.cert(key), projectId: PROJECT_ID });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: PROJECT_ID });
  } else {
    die('No Firebase credentials. Set FIREBASE_PRIVATE_KEY (or FIREBASE_SERVICE_ACCOUNT_JSON) in the cloud environment settings.');
  }
  db = admin.firestore();
  ({ FieldValue, Timestamp } = admin.firestore);
  return db;
}

function readJsonArray(path) {
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die('Could not read/parse ' + path + ': ' + e.message); }
  if (!Array.isArray(data)) die(path + ' must contain a JSON array.');
  return data;
}

// Same slug as sync-registry.mjs, so both scripts address the same docs.
function slugId(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'unnamed';
}

function scoreFraction(s) {
  const m = String(s ?? '').match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?/);
  if (!m) return -1;
  const den = m[2] ? parseFloat(m[2]) : 6;
  return den ? parseFloat(m[1]) / den : -1;
}

function deriveVerdict(c) {
  if (['rejected', 'watch', 'promoted', 'logged'].includes(c.verdict)) return c.verdict;
  const frac = scoreFraction(c.buvScore);
  return frac >= 0 && frac < REJECT_THRESHOLD ? 'rejected' : 'logged';
}

function toTimestamp(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

function isoDate(ts) {
  if (!ts) return '';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

async function syncCount() {
  const all = await db.collection(REGISTRY).count().get();
  const n = all.data().count;
  const ref = db.collection('settings').doc('sourcingRegistry');
  const shown = (await ref.get()).get('seenCount') || 0;
  // The counter was once set by hand from the Mac registry. Until that registry
  // is imported (registry-import), never let the headline number go backwards.
  if (shown > n) {
    console.error(`⚠️ REGISTRY NOT BACKFILLED: collection has ${n} docs but the site shows ${shown}. ` +
      'Counter left unchanged — run registry-import with the old registry.md.');
    await ref.set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return n;
  }
  await ref.set({ seenCount: n, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return n;
}

// ---- registry ---------------------------------------------------------------

async function registryUpsert(companies, { quiet = false } = {}) {
  initDb();
  const before = (await db.collection(REGISTRY).count().get()).data().count;
  let created = 0, updated = 0, skipped = 0;
  for (const c of companies) {
    if (!c || !c.name || !String(c.name).trim()) { skipped++; continue; }
    const ref = db.collection(REGISTRY).doc(slugId(c.name));
    const snap = await ref.get();
    const data = { name: String(c.name).trim(), lastSyncedAt: FieldValue.serverTimestamp() };
    for (const f of ['description', 'buvScore', 'source', 'link', 'lastEvent', 'promotedId']) {
      if (c[f]) data[f] = String(c[f]);
    }
    if (c.lastEvent) data.lastEventDate = toTimestamp(c.lastEventDate) || FieldValue.serverTimestamp();
    if (c.verdict || c.buvScore || !snap.exists) data.verdict = deriveVerdict(c);
    if (!snap.exists) {
      data.seenDate = toTimestamp(c.seenDate) || FieldValue.serverTimestamp();
      await ref.set(data);
      created++;
    } else {
      if (!snap.get('seenDate')) data.seenDate = toTimestamp(c.seenDate) || FieldValue.serverTimestamp();
      await ref.set(data, { merge: true });
      updated++;
    }
  }
  const n = await syncCount();
  if (n < before) console.error(`⚠️ Registry count DROPPED from ${before} to ${n} — investigate.`);
  if (!quiet) console.log(`✓ Registry: created ${created}, updated ${updated}, skipped ${skipped}. Count ${before} → ${n}.`);
  return { created, updated, skipped, count: n };
}

async function registryDump(outPath) {
  initDb();
  const [reg, pipe] = await Promise.all([db.collection(REGISTRY).get(), db.collection(PIPELINE).get()]);
  const onSite = new Set(pipe.docs.map((d) => String(d.get('name') || '').toLowerCase().trim()));
  const lines = reg.docs
    .map((d) => d.data())
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((c) => {
      const name = String(c.name).toLowerCase().trim();
      const event = String(c.lastEvent || c.description || '').replace(/\s*\(on site\)\s*$/i, '');
      const bits = [c.buvScore, c.verdict, event].filter(Boolean).join(' · ');
      return `${name} | ${isoDate(c.seenDate)} | ${bits}${onSite.has(name) ? ' (on site)' : ''}`;
    });
  const header = `company name | first seen | score · verdict · last known material event\n` +
    `# ${lines.length} registry entries, ${onSite.size} on the Deal Pipeline. Exported ${new Date().toISOString()}\n`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, header + lines.join('\n') + '\n');
  console.log(`✓ Wrote ${lines.length} registry lines to ${outPath} (${onSite.size} on site).`);
}

// Parse the old Mac registry.md: "name | YYYY-MM-DD | event text…"
async function registryImport(path) {
  const text = readFileSync(path, 'utf8');
  const byName = new Map();
  for (const line of text.split('\n')) {
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const name = parts[0].trim();
    const date = parts[1].trim();
    if (!name || /^company name/i.test(name) || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue;
    const event = parts.slice(2).join('|').trim();
    // A rescore reads "1/6 -> 2/6"; take the score after the arrow, else the first one.
    const rescored = event.match(/\b[0-6]\s*\/\s*6\s*(?:->|→|⇒|to)\s*([0-6])\s*\/\s*6\b/);
    const score = rescored ? `${rescored[1]}/6` : ((event.match(/\b([0-6])\s*\/\s*6\b/) || [])[0] || '').replace(/\s/g, '');
    const key = name.toLowerCase();
    const prev = byName.get(key);
    // Keep the earliest first-seen date, the latest score, and the FULL history
    // (oldest → newest) so later scans can see every recorded event.
    const history = prev ? `${prev.lastEvent} ⏩ [${date}] ${event}` : `[${date}] ${event}`;
    byName.set(key, {
      name,
      seenDate: prev && prev.seenDate < date ? prev.seenDate : date,
      lastEvent: history.length > 6000 ? '…' + history.slice(-6000) : history,
      buvScore: score || (prev ? prev.buvScore : ''),
      verdict: /\(on site\)|APPROVED/i.test(event) || (prev && prev.verdict === 'promoted') ? 'promoted' : undefined,
      source: 'Daily sourcing scan',
    });
  }
  const list = [...byName.values()];
  console.log(`Parsed ${list.length} unique names from ${path}.`);
  await registryUpsert(list);
}

// ---- pipeline ---------------------------------------------------------------

async function pipelineNames() {
  initDb();
  const snap = await db.collection(PIPELINE).get();
  return new Map(snap.docs.map((d) => [String(d.get('name') || '').toLowerCase().trim(), d]));
}

async function pipelineAdd(companies) {
  const existing = await pipelineNames();
  const added = [], updatedNames = [];
  for (const c of companies) {
    if (!c || !c.name) continue;
    const key = String(c.name).toLowerCase().trim();
    const text = c.activityText || `Added by daily sourcing scan — surfaced via ${c.source || 'daily scan'}. ${c.fitNotes || ''}`.trim();
    const hit = existing.get(key);
    if (hit) {
      // Never overwrite GP-owned fields; log the new information instead.
      await hit.ref.collection('activity').add({ type: 'research', text, createdAt: FieldValue.serverTimestamp() });
      await hit.ref.update({ lastUpdated: FieldValue.serverTimestamp(), isNew: true });
      updatedNames.push(c.name);
      continue;
    }
    const raising = RAISING.includes(c.raisingStatus) ? c.raisingStatus : 'Unknown';
    const doc = {
      name: String(c.name).trim(),
      technology: c.technology || '',
      stageAmount: c.stageAmount || '',
      raisingStatus: raising,
      buvScore: (String(c.buvScore || '').match(/\d+\s*\/\s*\d+/) || [''])[0].replace(/\s/g, ''),
      fitNotes: c.fitNotes || '',
      source: c.source || 'Daily sourcing scan',
      link: c.link || '',
      notes: '',
      nextStep: c.nextStep || '',
      status: 'new',
      isNew: true,
      addedDate: FieldValue.serverTimestamp(),
      lastUpdated: FieldValue.serverTimestamp(),
    };
    const ref = await db.collection(PIPELINE).add(doc);
    await ref.collection('activity').add({ type: 'system', text, createdAt: FieldValue.serverTimestamp() });
    existing.set(key, ref);
    added.push({ name: doc.name, id: ref.id, buvScore: doc.buvScore, link: doc.link, description: doc.technology });
  }
  if (added.length) {
    await registryUpsert(added.map((a) => ({ ...a, verdict: 'promoted', promotedId: a.id })), { quiet: true });
  }
  console.log(`✓ Pipeline: added ${added.length} (${added.map((a) => a.name).join(', ') || '—'}); ` +
    `activity-logged ${updatedNames.length} existing (${updatedNames.join(', ') || '—'}). Total on pipeline: ${existing.size}.`);
}

// ---- daily logs -------------------------------------------------------------

async function logGet(n) {
  initDb();
  const snap = await db.collection(LOGS).orderBy('date', 'desc').limit(n).get();
  if (snap.empty) { console.log('(no daily logs stored yet)'); return; }
  for (const d of snap.docs) console.log(`\n==================== ${d.id} ====================\n${d.get('markdown')}`);
}

async function logAppend(date, path) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) die('Date must be YYYY-MM-DD.');
  const md = readFileSync(path, 'utf8');
  initDb();
  const ref = db.collection(LOGS).doc(date);
  // Transaction = safe read-modify-write if another task writes the same day.
  const size = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.get('markdown') || '' : '';
    const next = prev ? prev + '\n\n---\n\n' + md : md;
    tx.set(ref, { date, markdown: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next.length;
  });
  console.log(`✓ Saved daily log ${date} (${size} chars).`);
}

// ---- reviewed investor-portfolio names ---------------------------------------
// Kept apart from the registry so non-water portfolio companies don't inflate it,
// but stop reappearing in the daily portfolio watch once triaged.
async function seenDump(outPath) {
  initDb();
  const snap = await db.collection(SEEN).get();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, snap.docs.map((d) => d.get('name')).join('\n') + '\n');
  console.log(`✓ Wrote ${snap.size} reviewed portfolio names to ${outPath}.`);
}

async function seenAdd(path) {
  const names = [...new Set(readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean))];
  initDb();
  for (let i = 0; i < names.length; i += 400) {
    const batch = db.batch();
    for (const n of names.slice(i, i + 400)) batch.set(db.collection(SEEN).doc(slugId(n)), { name: n, reviewedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
  }
  console.log(`✓ Marked ${names.length} portfolio names as reviewed.`);
}

// ---- sbir -------------------------------------------------------------------

async function sbir(keyword) {
  const url = `https://www.sbir.gov/awards?keywords=${encodeURIComponent(keyword)}&sort_by=award_date&sort_order=desc`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (BUV sourcing scan)' } });
  if (!res.ok) die(`sbir.gov returned HTTP ${res.status}`);
  const text = (await res.text())
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const i = text.indexOf('Showing');
  if (i < 0) die('No "Showing" marker — sbir.gov layout may have changed.');
  console.log(url + '\n' + text.substring(i, i + 3500));
}

// ---- main -------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  async check() {
    initDb();
    const [r, p, l] = await Promise.all([REGISTRY, PIPELINE, LOGS].map((c) => db.collection(c).count().get()));
    const s = await db.collection('settings').doc('sourcingRegistry').get();
    console.log(`✓ Connected to ${PROJECT_ID}. registry=${r.data().count} pipeline=${p.data().count} ` +
      `daily_logs=${l.data().count} counter=${s.exists ? s.get('seenCount') : '(not set)'}`);
  },
  'registry-dump': () => registryDump(args[0] || 'registry.md'),
  'registry-upsert': () => registryUpsert(readJsonArray(args[0] || die('Need a JSON file.'))),
  'registry-import': () => registryImport(args[0] || die('Need the old registry.md path.')),
  async 'pipeline-list'() { console.log([...(await pipelineNames()).keys()].sort().join('\n')); },
  'pipeline-add': () => pipelineAdd(readJsonArray(args[0] || die('Need a JSON file.'))),
  'log-get': () => logGet(parseInt(args[0] || '2', 10)),
  'log-append': () => logAppend(args[0], args[1] || die('Need a markdown file.')),
  'seen-dump': () => seenDump(args[0] || 'reviewed.txt'),
  'seen-add': () => seenAdd(args[0] || die('Need a names file.')),
  sbir: () => sbir(args.join(' ') || die('Need a keyword.')),
};
if (!commands[cmd]) die('Unknown command. One of: ' + Object.keys(commands).join(', '));
commands[cmd]().then(() => process.exit(0)).catch((e) => die(e.stack || e.message));
