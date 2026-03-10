#!/usr/bin/env node
/**
 * One-time script to upload LinkedIn CSV data to Firestore.
 * Mirrors the parsing logic in network.html exactly.
 *
 * Usage: node upload-linkedin-data.js
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Initialize with default credentials (uses GOOGLE_APPLICATION_CREDENTIALS or ADC)
admin.initializeApp();
const db = admin.firestore();

// ── Category definitions (matches network.html) ────────────────────────────
const CATEGORIES = {
  'Water': ['water','wastewater','utility','utilities','municipal','treatment','desalination','irrigation','aquifer','groundwater','stormwater','sanitation','hydro','awwa','potable','sewer','watershed'],
  'Venture Capital': ['venture','capital','investor','fund','vc ','seed','series a','series b','angel','equity','portfolio','gp','limited partner','lp ','general partner','exits','startup fund'],
  'Government': ['government','city of','county','state ','federal','epa','department','agency','bureau','district','authority','public works','municipality','mayor','commissioner','senator','representative','policy'],
  'Consulting': ['consult','advisor','advisory','strategy','principal','mckinsey','bain','bcg','deloitte','kpmg','pwc','accenture','jacobs','aecom','stantec','arcadis','black & veatch','hazen'],
  'Technology': ['software','tech','saas','digital','platform','ai ','data','iot','cloud','developer','cto','engineering','startup','app','sensor','analytics'],
  'Finance': ['bank','financial','finance','private equity','credit','debt','asset','wealth','cfo','treasurer','accounting','audit','tax','lending','impact investing','infrastructure finance'],
  'Environment': ['environment','sustainability','esg','climate','clean','green','renewable','carbon','ecology','conservation','circular economy','impact','nature-based','resilience'],
  'Academia': ['university','research','professor','phd','institute','lab','scientist','academic','postdoc','faculty','scholar','national lab','fellow','graduate'],
};

function categorize(company, position) {
  const text = `${company} ${position}`.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some(kw => text.includes(kw))) return cat;
  }
  return 'Other';
}

// ── CSV parsing (matches network.html parseCSVRow) ──────────────────────────
function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function findHeaderIdx(lines, ...keywords) {
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const l = lines[i].toLowerCase();
    if (keywords.some(kw => l.includes(kw))) return i;
  }
  return -1;
}

function makeColFn(headers) {
  return function col(row, ...names) {
    for (const n of names) {
      const idx = headers.indexOf(n);
      if (idx >= 0 && row[idx]) return row[idx].trim();
    }
    return '';
  };
}

// ── Parsers ─────────────────────────────────────────────────────────────────
function parseConnections(text) {
  const lines = text.split(/\r?\n/);
  const headerIdx = findHeaderIdx(lines, 'first name', 'firstname', 'name');
  if (headerIdx === -1) throw new Error('No header row found in Connections.csv');
  const headers = parseCSVRow(lines[headerIdx]).map(h => h.toLowerCase().trim().replace(/"/g, ''));
  const col = makeColFn(headers);

  const results = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVRow(lines[i]);
    const firstName = col(row, 'first name', 'firstname');
    const lastName = col(row, 'last name', 'lastname');
    const name = firstName || lastName ? `${firstName} ${lastName}`.trim() : col(row, 'name', 'full name');
    if (!name) continue;
    const company = col(row, 'company', 'organization', 'employer');
    const position = col(row, 'position', 'title', 'job title', 'role');
    const email = col(row, 'email address', 'email');
    const url = col(row, 'url', 'linkedin url', 'profile url');
    const connectedOn = col(row, 'connected on', 'connection date', 'date connected');
    const category = categorize(company, position);
    results.push({ name, firstName, lastName, company, position, email, url, connectedOn, category, notes: '', importedAt: new Date().toISOString() });
  }
  return results;
}

function parseMessages(text) {
  const lines = text.split(/\r?\n/);
  const headerIdx = findHeaderIdx(lines, 'conversation id', 'from');
  if (headerIdx === -1) return [];
  const headers = parseCSVRow(lines[headerIdx]).map(h => h.toLowerCase().trim().replace(/"/g, ''));
  const col = makeColFn(headers);

  const results = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVRow(lines[i]);
    const content = col(row, 'content');
    if (!content) continue;
    results.push({
      conversationId: col(row, 'conversation id'),
      conversationTitle: col(row, 'conversation title'),
      from: col(row, 'from'),
      senderUrl: col(row, 'sender profile url'),
      to: col(row, 'to'),
      recipientUrls: col(row, 'recipient profile urls'),
      date: col(row, 'date'),
      subject: col(row, 'subject'),
      content,
      folder: col(row, 'folder'),
      importedAt: new Date().toISOString()
    });
  }
  return results;
}

function parseInvitations(text) {
  const lines = text.split(/\r?\n/);
  const headerIdx = findHeaderIdx(lines, 'direction');
  if (headerIdx === -1) return [];
  const headers = parseCSVRow(lines[headerIdx]).map(h => h.toLowerCase().trim().replace(/"/g, ''));
  const col = makeColFn(headers);

  const results = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVRow(lines[i]);
    const from = col(row, 'from');
    const to = col(row, 'to');
    if (!from && !to) continue;
    results.push({
      from, to,
      sentAt: col(row, 'sent at'),
      message: col(row, 'message'),
      direction: col(row, 'direction'),
      inviterUrl: col(row, 'inviterprofileurl'),
      inviteeUrl: col(row, 'inviteeprofileurl'),
      importedAt: new Date().toISOString()
    });
  }
  return results;
}

function parseCompanyFollows(text) {
  const lines = text.split(/\r?\n/);
  const headerIdx = findHeaderIdx(lines, 'organization', 'followed');
  if (headerIdx === -1) return [];
  const headers = parseCSVRow(lines[headerIdx]).map(h => h.toLowerCase().trim().replace(/"/g, ''));
  const col = makeColFn(headers);

  const results = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVRow(lines[i]);
    const org = col(row, 'organization');
    if (!org) continue;
    results.push({
      organization: org,
      followedOn: col(row, 'followed on'),
      importedAt: new Date().toISOString()
    });
  }
  return results;
}

// ── Batch upload to Firestore ───────────────────────────────────────────────
async function batchUpload(collectionName, docs) {
  const BATCH_SIZE = 400;
  let uploaded = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const doc of chunk) {
      batch.set(db.collection(collectionName).doc(), doc);
    }
    await batch.commit();
    uploaded += chunk.length;
    console.log(`  ${collectionName}: ${uploaded}/${docs.length}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const dir = __dirname;

  const files = {
    connections: path.join(dir, 'Connections.csv'),
    messages: path.join(dir, 'messages.csv'),
    invitations: path.join(dir, 'Invitations.csv'),
    companyFollows: path.join(dir, 'Company Follows.csv'),
  };

  // Parse all CSVs
  console.log('Parsing CSV files...');
  const connections = parseConnections(fs.readFileSync(files.connections, 'utf8'));
  console.log(`  Connections: ${connections.length} records`);

  const messages = parseMessages(fs.readFileSync(files.messages, 'utf8'));
  console.log(`  Messages: ${messages.length} records`);

  const invitations = parseInvitations(fs.readFileSync(files.invitations, 'utf8'));
  console.log(`  Invitations: ${invitations.length} records`);

  const companyFollows = parseCompanyFollows(fs.readFileSync(files.companyFollows, 'utf8'));
  console.log(`  Company Follows: ${companyFollows.length} records`);

  // Upload to Firestore
  console.log('\nUploading to Firestore...');

  await batchUpload('linkedinConnections', connections);
  await batchUpload('linkedinMessages', messages);
  await batchUpload('linkedinInvitations', invitations);
  await batchUpload('linkedinCompanyFollows', companyFollows);

  console.log('\nDone! All data uploaded to Firestore.');
}

main().catch(err => {
  console.error('Upload failed:', err);
  process.exit(1);
});
