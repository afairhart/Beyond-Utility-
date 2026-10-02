#!/usr/bin/env node
/*
 * sourcing-sweep.mjs — bulk discovery sweep for the BUV daily sourcing scan.
 *
 * Pulls every source listed in sourcing-sources.json in one go and writes a
 * single de-duplicated candidate list for the scan to triage:
 *   - Google News RSS: every query, in every listed language/region
 *   - Trade / startup RSS feeds (non-water feeds filtered by waterRegex)
 *   - sbir.gov award search: every keyword, first two pages, recent years only
 *   - NSF awards API: SBIR/STTR (small-business) awards only
 *   - SEC EDGAR Form D filings whose issuer name matches a water term
 *     (a Form D is filed when a private company raises — often before any
 *     press release, so these are pre-announcement raise signals)
 *
 * No credentials needed.
 *
 * USAGE:
 *   node sourcing-sweep.mjs --days 2 --out candidates.md [--registry registry.md]
 *        [--only news,feeds,sbir,nsf,formd]
 *   --registry tags headlines that mention a company already in the registry dump
 *   (from `sourcing-scan.mjs registry-dump`) with [KNOWN: name].
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'sourcing-sources.json'), 'utf8'));
const UA = 'Mozilla/5.0 (compatible; BUV sourcing sweep; afairhart@gmail.com)';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const days = Math.max(1, parseInt(arg('days', '2'), 10));
const outPath = arg('out', 'candidates.md');
const only = new Set((arg('only', 'news,feeds,sbir,nsf,formd')).split(','));
const since = new Date(Date.now() - days * 86400e3);
const thisYear = new Date().getFullYear();
const waterRe = new RegExp(cfg.waterRegex, 'i');
const noiseRe = new RegExp(cfg.noiseRegex, 'i');
const signalRe = new RegExp(cfg.signalRegex, 'i');

// Registry names for [KNOWN] tagging (first pipe field, 5+ chars to avoid noise).
let known = [];
const regPath = arg('registry');
if (regPath) {
  let reg = '';
  try { reg = readFileSync(regPath, 'utf8'); } catch { console.error(`⚠️ Registry file ${regPath} not found — [KNOWN] tagging skipped.`); }
  known = reg.split('\n')
    .map((l) => l.split('|')[0].trim().toLowerCase())
    .filter((n) => n.length >= 5 && !n.startsWith('#') && n !== 'company name');
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const knownRes = known.map((n) => [n, new RegExp('\\b' + esc(n) + '\\b', 'i')]);
const tagKnown = (text) => {
  const hits = knownRes.filter(([, re]) => re.test(text)).map(([n]) => n);
  return hits.length ? ` [KNOWN: ${hits.slice(0, 3).join(', ')}]` : '';
};

const decode = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&#8211;|&#8212;/g, '-').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };
const ymd = (d) => (isNaN(d) ? '????-??-??' : d.toISOString().slice(0, 10));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.text();
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(1500 * (i + 1)); }
  }
  return null;
}

// Run tasks with limited concurrency.
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const seen = new Set();
const norm = (t) => t.toLowerCase().replace(/\s+-\s+[^-]+$/, '').replace(/[^a-z0-9À-￿]+/g, ' ').trim();
const stats = { failed: [] };

// ---- Google News -----------------------------------------------------------
const LOCALES = {
  'en-US': 'hl=en-US&gl=US&ceid=US:en', 'en-GB': 'hl=en-GB&gl=GB&ceid=GB:en', 'en-IN': 'hl=en-IN&gl=IN&ceid=IN:en',
  'en-SG': 'hl=en-SG&gl=SG&ceid=SG:en', 'en-IL': 'hl=en-IL&gl=IL&ceid=IL:en', 'en-AU': 'hl=en-AU&gl=AU&ceid=AU:en',
  de: 'hl=de&gl=DE&ceid=DE:de', fr: 'hl=fr&gl=FR&ceid=FR:fr', es: 'hl=es&gl=ES&ceid=ES:es', 'pt-BR': 'hl=pt-BR&gl=BR&ceid=BR:pt-419',
  nl: 'hl=nl&gl=NL&ceid=NL:nl', ja: 'hl=ja&gl=JP&ceid=JP:ja', ko: 'hl=ko&gl=KR&ceid=KR:ko', 'zh-CN': 'hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
  he: 'hl=he&gl=IL&ceid=IL:he',
};

async function sweepNews() {
  const jobs = [];
  for (const [loc, qs] of Object.entries(cfg.news)) for (const q of qs) jobs.push({ loc, q, keep: (t) => waterRe.test(t) });
  for (const { q, must } of cfg.newsNames || []) {
    const re = new RegExp('\\b' + esc(must) + '\\b', 'i');
    jobs.push({ loc: 'en-US', q, keep: (t) => re.test(t) });
  }
  let dropped = 0;
  const perQuery = [];
  const rows = (await pool(jobs, 4, async ({ loc, q, keep }) => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:' + days + 'd')}&${LOCALES[loc] || LOCALES['en-US']}`;
    const xml = await get(url);
    if (xml === null) { stats.failed.push(`news[${loc}] ${q}`); return []; }
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    const got = [];
    for (const it of items) {
      const d = new Date(tag(it, 'pubDate'));
      if (!isNaN(d) && d < since) continue;
      const title = tag(it, 'title');
      const headline = title.replace(/\s+-\s+[^-]+$/, '');
      if (!keep(headline) || noiseRe.test(headline)) { dropped++; continue; }
      const key = norm(title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const src = (it.match(/<source url="([^"]+)"/) || [])[1] || '';
      got.push({ d, sig: signalRe.test(headline), line: `- ${signalRe.test(headline) ? '⭐ ' : ''}${ymd(d)} · ${title} · ${src} · ${tag(it, 'link')}${tagKnown(title)}  _(q: ${q}${loc === 'en-US' ? '' : ' · ' + loc})_` });
    }
    perQuery.push(`${loc === 'en-US' ? '' : loc + ': '}${q} → ${items.length}`);
    return got;
  })).flat();
  rows.sort((a, b) => (b.sig - a.sig) || (b.d - a.d));
  return { title: `Google News — ⭐ deal-signal headlines first (${jobs.length} queries across ${Object.keys(cfg.news).length} locales)`, lines: rows.map((r) => r.line), note: `${rows.filter((r) => r.sig).length} ⭐ deal-signal headlines; ${perQuery.filter((s) => s.endsWith('→ 0')).length} queries returned nothing; ${dropped} off-topic or noise headlines filtered out` };
}

// ---- RSS feeds -------------------------------------------------------------
async function sweepFeeds() {
  const lines = [];
  await pool(cfg.feeds, 4, async (f) => {
    const xml = await get(f.url);
    if (xml === null) { stats.failed.push(`feed ${f.name}`); return; }
    for (const m of xml.matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/g)) {
      const it = m[2];
      const d = new Date(tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated') || tag(it, 'dc:date'));
      if (!isNaN(d) && d < since) continue;
      const title = tag(it, 'title');
      const desc = tag(it, 'description').slice(0, 400);
      if ((f.filter && !waterRe.test(title + ' ' + desc)) || noiseRe.test(title)) continue;
      const key = norm(title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const link = tag(it, 'link') || (it.match(/<link[^>]+href="([^"]+)"/) || [])[1] || '';
      lines.push(`- ${ymd(d)} · ${title} · ${f.name} · ${link}${tagKnown(title + ' ' + desc)}`);
    }
  });
  return { title: `Trade & startup RSS feeds (${cfg.feeds.length})`, lines: lines.sort().reverse() };
}

// ---- sbir.gov --------------------------------------------------------------
async function sweepSbir() {
  const lines = [], counts = [];
  const byCo = new Map();
  await pool(cfg.sbir, 3, async (kw) => {
    for (const page of [0, 1]) {
      const html = await get(`https://www.sbir.gov/awards?keywords=${encodeURIComponent(kw)}&sort_by=award_date&sort_order=desc&page=${page}`);
      if (html === null) { stats.failed.push(`sbir ${kw}`); return; }
      const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''));
      const i = text.indexOf('Showing');
      if (i < 0) { if (page === 0) counts.push(`${kw} → 0`); return; }
      if (page === 0) counts.push(`${kw} → ${(text.slice(i, i + 40).match(/of ([\d,]+)/) || [])[1] || '?'}`);
      const body = text.slice(i);
      const re = /SBC:\s*(.+?)\s+Topic:\s*(\S*)\s+([\s\S]*?)Tagged as:\s*(SBIR|STTR)\s+(Phase\s+\w+)\s+(\d{4})\s+(\S+)/g;
      let last = body.indexOf('Results') + 7, m, old = 0;
      while ((m = re.exec(body))) {
        const title = body.slice(last, m.index).trim().slice(-200);
        last = re.lastIndex;
        const year = parseInt(m[6], 10);
        if (year < thisYear - 1) { old++; continue; }
        if (!waterRe.test(title + ' ' + m[3])) continue;
        const co = m[1].trim();
        const entry = byCo.get(co) || { co, year, agency: m[7], phase: m[5], title, abstract: m[3].trim().slice(0, 260), kws: new Set() };
        entry.kws.add(kw);
        byCo.set(co, entry);
      }
      if (old >= 8) break; // page is mostly older awards; skip page 2
    }
  });
  for (const e of [...byCo.values()].sort((a, b) => b.year - a.year || a.co.localeCompare(b.co))) {
    lines.push(`- ${e.year} ${e.agency} ${e.phase} · **${e.co}** · ${e.title} — ${e.abstract}…${tagKnown(e.co)}  _(kw: ${[...e.kws].join(', ')})_`);
  }
  return { title: `sbir.gov awards tagged ${thisYear - 1}–${thisYear} (${cfg.sbir.length} keywords; these are DISCOVERED companies, not same-week news)`, lines, note: 'Result counts: ' + counts.sort().join(' · ') };
}

// ---- NSF awards API (SBIR/STTR only) ---------------------------------------
async function sweepNsf() {
  const start = new Date(Date.now() - Math.max(days, 60) * 86400e3);
  const ds = `${String(start.getMonth() + 1).padStart(2, '0')}/${String(start.getDate()).padStart(2, '0')}/${start.getFullYear()}`;
  const byId = new Map();
  await pool(cfg.nsf, 3, async (kw) => {
    const url = `https://api.nsf.gov/services/v1/awards.json?keyword=${encodeURIComponent(kw)}&dateStart=${ds}&rpp=200` +
      '&printFields=id,title,awardeeName,awardeeCity,awardeeStateCode,date,fundsObligatedAmt,fundProgramName,program,abstractText';
    const txt = await get(url);
    if (txt === null) { stats.failed.push(`nsf ${kw}`); return; }
    let awards = [];
    try { awards = JSON.parse(txt).response.award || []; } catch { stats.failed.push(`nsf ${kw} (bad JSON)`); return; }
    for (const a of awards) {
      if (!/SBIR|STTR|small business/i.test(`${a.fundProgramName} ${a.program}`)) continue;
      if (!waterRe.test(`${a.title} ${(a.abstractText || '').slice(0, 1500)}`)) continue;
      const e = byId.get(a.id) || { ...a, kws: new Set() };
      e.kws.add(kw); byId.set(a.id, e);
    }
  });
  const lines = [...byId.values()].sort((a, b) => new Date(b.date) - new Date(a.date)).map((a) =>
    `- ${a.date} · **${a.awardeeName}** (${a.awardeeCity}, ${a.awardeeStateCode}) · $${Number(a.fundsObligatedAmt || 0).toLocaleString()} ${a.fundProgramName} · ${a.title} — ${(a.abstractText || '').slice(0, 220)}… · https://www.nsf.gov/awardsearch/showAward?AWD_ID=${a.id}${tagKnown(a.awardeeName)}  _(kw: ${[...a.kws].join(', ')})_`);
  return { title: `NSF SBIR/STTR awards since ${ds} (${cfg.nsf.length} keywords)`, lines };
}

// ---- SEC EDGAR Form D ------------------------------------------------------
async function sweepFormD() {
  const startdt = ymd(new Date(Date.now() - Math.max(days, 7) * 86400e3));
  const enddt = ymd(new Date());
  const byName = new Map();
  await pool(cfg.formd, 2, async (term) => {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"' + term + '"')}&forms=D&dateRange=custom&startdt=${startdt}&enddt=${enddt}`;
    const txt = await get(url);
    if (txt === null) { stats.failed.push(`formd ${term}`); return; }
    let hits = [];
    try { hits = JSON.parse(txt).hits.hits; } catch { return; }
    const re = new RegExp(esc(term), 'i');
    for (const h of hits) {
      const s = h._source;
      for (const raw of s.display_names || []) {
        const name = raw.replace(/\s*\(CIK.*$/, '').trim();
        if (!re.test(name) || /fund|capital|partners|investors|\bLP\b|holdings|trust|REIT|realty|properties|apartments|\bDST\b/i.test(name)) continue;
        const cik = (raw.match(/CIK (\d+)/) || [])[1];
        byName.set(name, `- ${s.file_date} · **${name}** · ${(s.biz_states || []).join('/') || '?'} · https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=D${tagKnown(name)}  _(term: ${term})_`);
      }
    }
    await sleep(300);
  });
  return { title: `SEC Form D filings since ${startdt} — issuer name matches a water term (pre-announcement raise signals; funds/LPs excluded)`, lines: [...byName.values()].sort().reverse() };
}

// ---- main ------------------------------------------------------------------
const runners = { news: sweepNews, feeds: sweepFeeds, sbir: sweepSbir, nsf: sweepNsf, formd: sweepFormD };
const t0 = Date.now();
const sections = [];
for (const k of ['feeds', 'news', 'sbir', 'nsf', 'formd']) {
  if (!only.has(k)) continue;
  const s = await runners[k]();
  sections.push(s);
  console.log(`  ${k}: ${s.lines.length} items`);
}
const total = sections.reduce((n, s) => n + s.lines.length, 0);
const knownCount = sections.reduce((n, s) => n + s.lines.filter((l) => l.includes('[KNOWN:')).length, 0);
const md = [
  `# Sourcing sweep — ${ymd(new Date())} — window ${days} day(s) (since ${ymd(since)})`,
  `${total} unique items (${knownCount} mention a registry company). Took ${Math.round((Date.now() - t0) / 1000)}s.` +
    (stats.failed.length ? ` ⚠️ ${stats.failed.length} source(s) failed: ${stats.failed.join('; ')}` : ' All sources answered.'),
  'Google News links are redirects — search the headline (or publisher + title) to get the real article URL before citing it.',
  ...sections.map((s) => `\n## ${s.title} — ${s.lines.length}\n${s.note ? '_' + s.note + '_\n' : ''}${s.lines.join('\n') || '_(nothing in window)_'}`),
].join('\n');
writeFileSync(outPath, md + '\n');
console.log(`✓ Sweep wrote ${total} items to ${outPath}` + (stats.failed.length ? ` (⚠️ ${stats.failed.length} failed sources)` : ''));
