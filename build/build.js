#!/usr/bin/env node
/* Structure Shift board build (runs on GitHub, .github/workflows/build.yml).
   usage: node build/build.js <market-data checkout> [--force]
   Reads closed candles from Market-Data (data/<source>/<SYMBOL>_<TF>.csv, time = candle open, unix s UTC),
   runs the board's own engine (public/ms.js) for every row in config/board.json and writes
   public/data.json (rows + status-change log) and public/freshness.json.
   - Coins: Binance 1H, 4H and 1D. 2H is built from 1H, 8H and 12H from 4H (coins only, 26 Nov 2026), 1W from 1D.
   - Gauges: TradingView 1H and 4H (1D and 1W resampled from 4H); USDT.D+USDC.D is the candle-by-candle sum, USDT.D alone is its own row; ETHBTC from Binance.
   - Skips the build when no input series changed since the last build (unless --force).
   - A row that cannot be built keeps its last good version and is listed in freshness.json "kept".
   BUILD_NOW=<unix s> overrides the clock (tests). */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MS = require(path.join(ROOT, 'public', 'ms.js'));
const MD = path.resolve(process.argv[2] || 'md');
const FORCE = process.argv.includes('--force');
const NOW = +process.env.BUILD_NOW || Math.floor(Date.now() / 1000);
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'board.json'), 'utf8'));
const OUT = path.join(ROOT, 'public', 'data.json'), FRESH = path.join(ROOT, 'public', 'freshness.json');
const PERIOD = { '1H': 3600, '4H': 14400, '1D': 86400 };
const LOG_MAX = 500;

const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const man = (readJSON(path.join(MD, 'manifest.json'), {}).series) || {};

// Market-Data CSV -> bars {t,o,h,l,c,v}, oldest first (closed candles only: the importer keeps no forming candle)
function readCsv(sid) {
  const [source, symbol, tf] = sid.split('/');
  const f = path.join(MD, 'data', source, `${symbol}_${tf}.csv`);
  if (!fs.existsSync(f)) return null;
  const B = { t: [], o: [], h: [], l: [], c: [], v: [] };
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i].split(',');
    if (r.length < 6) continue;
    B.t.push(+r[0]); B.o.push(+r[1]); B.h.push(+r[2]); B.l.push(+r[3]); B.c.push(+r[4]); B.v.push(+r[5] || 0);
  }
  return B.t.length ? B : null;
}
function sumBars(A, C) {
  const m = new Map(); C.t.forEach((t, i) => m.set(t, i));
  const o = { t: [], o: [], h: [], l: [], c: [], v: [] };
  A.t.forEach((t, i) => { const j = m.get(t); if (j == null) return; o.t.push(t); for (const k of 'ohlc') o[k].push(A[k][i] + C[k][j]); o.v.push(0); });
  return o;
}
function scale(B, k) { if (!B || k === 1) return B; const o = { t: B.t, v: B.v }; for (const x of 'ohlc') o[x] = B[x].map(y => y * k); return o; }
function load(prefixes, tf) {
  const B = (Array.isArray(prefixes) ? prefixes : [prefixes]).map(p => readCsv(p + '/' + tf));
  if (B.some(b => !b)) return null;
  return B.length > 1 ? sumBars(B[0], B[1]) : B[0];
}

// ---------- inputs fingerprint (skip when nothing changed) ----------
const rows = CFG.coins.map(c => ({ ...c, kind: 'coin' })).concat(CFG.gauges.map(g => ({ ...g, kind: 'gauge' })));
const used = [];
for (const r of rows) for (const p of [].concat(r.series)) for (const tf of r.tfs) used.push(p + '/' + tf);
const finger = used.map(sid => sid + ':' + ((man[sid] && man[sid].last_open) || 0)).join('|');
const prev = readJSON(OUT, null);
if (!FORCE && prev && prev.meta && prev.meta.inputs === finger && (readJSON(FRESH, {}).series || []).every(x => x.built_from !== undefined)) {
  console.log('Inputs unchanged since the last build; nothing to do (use --force to rebuild).');
  process.exit(0);
}

// ---------- fake-out tags (claude/mstruct/fakeout_backtest.md), coins only, flips younger than 60 candles ----------
// Settled flips: worked -> no tag; fake (closed 1 ATR back past the level before running 2 ATR) -> Fake-out (shown while the leg lasts).
// 4H: Failed (next candle closed back inside the level) / Strong (EMA200 side + RVOL >= 2) / Weak (against EMA200 + RVOL < 1.5) / Normal.
// 1D: Waiting (no next candle yet) / Confirmed (next candle held) / Failed; btc = BTC 1D structure pointed the same way when it flipped.
const btcD = (() => { const b = CFG.coins.find(c => c.sym === 'BTC'); const B = b && load(b.series, '1D'); if (!B) return null;
  const C = MS.closedOnly(B, '1D', NOW); return { t: C.t, ev: MS.structure(C, '1D').events }; })();
function btcDirAt(T) { if (!btcD) return null; let d = 0; for (const e of btcD.ev) { if (btcD.t[e.i] + 86400 <= T) d = e.dir; else break; } return d; }
function tagFlips(sym, res) {
  for (const tf of ['4H', '1D']) { const x = res.tf[tf]; if (!x || !x.flipq) continue; const q = x.flipq;
    // only fresh flips: younger than 60 candles and no BOS continuation since (a BOS means the new structure already proved itself)
    const bosSince = x.last_event && x.last_event.kind === 'BOS' && x.last_event.t > q.t;
    if (q.outcome === 'worked' || q.age >= 60 || bosSince) { q.tag = null; continue; }
    if (q.outcome === 'fake') q.tag = 'Fake-out';
    else if (q.held === false) q.tag = 'Failed';
    else if (tf === '4H') q.tag = q.ema200 === true && q.rvol >= 2 ? 'Strong' : q.ema200 === false && q.rvol != null && q.rvol < 1.5 ? 'Weak' : 'Normal';
    else q.tag = q.held === null ? 'Waiting' : 'Confirmed';
    if (tf === '1D' && sym !== 'BTC') { const d = btcDirAt(q.t + 86400); q.btc = d ? d === q.dir : null; } }
}

// ---------- build ----------
const coins = {}, kept = [], sources = {};
let nOk = 0;
let events = [];
for (const r of rows) {
  const keepOld = why => { kept.push({ sym: r.sym, why }); if (prev && prev.coins && prev.coins[r.sym]) coins[r.sym] = prev.coins[r.sym]; };
  try {
    const sc = r.scale || 1;
    const B1 = scale(load(r.series, '1H'), sc), B4 = scale(load(r.series, '4H'), sc);
    const BD = r.kind === 'coin' ? load(r.series, '1D') : null;
    const isCoin = r.kind === 'coin';   // 2H / 8H / 12H for coins only, never for gauges
    const B2 = isCoin && B1 ? MS.to2H(B1) : null, B8 = isCoin && B4 ? MS.to8H(B4) : null, B12 = isCoin && B4 ? MS.to12H(B4) : null;
    if (!B4) { keepOld('no 4H candles in Market-Data'); continue; }
    const res = MS.analyze(r.sym, B4, BD || MS.toDay(B4), NOW, {
      B1, B2, B8, B12, symbol: r.tv, source: r.kind === 'coin' ? 'Binance' : (String(r.series).startsWith('binance') ? 'Binance' : 'TradingView')
    });
    if (r.kind === 'gauge') { res.kind = 'gauge'; res.desc = r.desc; for (const t in res.tf) delete res.tf[t].flipq; }
    else tagFlips(r.sym, res);
    if (!res.tf['4H']) { keepOld('fewer than 30 closed 4H candles'); continue; }
    if (prev && prev.coins && prev.coins[r.sym]) events = events.concat(MS.diff(prev.coins[r.sym], res, NOW));
    coins[r.sym] = res; nOk++;
    sources[r.sym] = { '1H': !!B1, '2H': isCoin && !!B1 ? 'from 1H' : false, '4H': true, '8H': isCoin ? 'from 4H' : false, '12H': isCoin ? 'from 4H' : false, '1D': r.kind === 'coin' ? (BD ? 'file' : 'from 4H') : 'from 4H' };
  } catch (e) { keepOld('engine error: ' + e.message); }
}
for (const e of events) e.id = ('e_' + e.t + '_' + e.sym + '_' + e.tf + '_' + e.type).replace(/[^A-Za-z0-9_\-]/g, '_');
const log = events.concat((prev && prev.events) || []).sort((a, b) => b.t - a.t).slice(0, LOG_MAX);
if (!nOk) { console.error('::error::No row could be built; the last good board is kept.'); process.exit(1); }

const iso = new Date(NOW * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const out = {
  meta: { built: NOW, generated: iso, n: Object.keys(coins).length, order: CFG.coins.map(c => c.sym), gauges: CFG.gauges.map(g => g.sym),
          removed: CFG.removed || [], kept, inputs: finger, source: 'GitHub build from Market-Data (Binance coins, TradingView gauges)' },
  coins, events: log
};
fs.writeFileSync(OUT, JSON.stringify(out));

// ---------- freshness ----------
// built_from / rows = the newest candle and row count this build actually read from Market-Data's CSV
// (the Data check compares them with manifest.json last_open / rows).
const series = [...new Set(used)].map(sid => {
  const m = man[sid] || {}, [source, symbol, tf] = sid.split('/'), B = readCsv(sid);
  const built = B ? B.t[B.t.length - 1] : null;
  return { id: sid, series: sid, source, symbol: m.symbol || symbol, tf, period_s: PERIOD[tf],
           built_from: built, last_open: built, rows: B ? B.t.length : 0, last_close: built != null ? built + PERIOD[tf] : null, fetched_at: m.fetched_at || null };
});
for (const k of kept) k.id = k.sym;
fs.writeFileSync(FRESH, JSON.stringify({
  generated: iso, checked_at: NOW, series, kept,
  last_result: `Built ${nOk} of ${rows.length} rows, ${events.length} status change${events.length === 1 ? '' : 's'}.`
}, null, 1));
// ---------- email alerts (config.alerts): new structure flips on watched rows/timeframes -> alerts.json (not committed) ----------
{
  const A = CFG.alerts, AF = path.join(ROOT, 'alerts.json');
  try { fs.unlinkSync(AF); } catch (e) {}
  if (A) {
    const hit = events.filter(e => A.rows.includes(e.sym) && A.tfs.includes(e.tf) && A.types.includes(e.type));
    if (hit.length) {
      const name = e => e.sym === 'BTC' ? 'BTCUSDT' : e.sym;
      const title = 'Structure flip: ' + hit.map(e => `${name(e)} ${e.tf} ${e.to}`).join(', ');
      const body = [`@${A.mention} structure flipped on the Structure Shift Board (build ${iso}):`, '',
        ...hit.map(e => `- **${name(e)} ${e.tf}**: ${e.from} → **${e.to}** (${e.note}); last closed ${e.tf} candle ${coins[e.sym] && coins[e.sym].tf[e.tf] ? new Date(coins[e.sym].tf[e.tf].t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '-'}`),
        '', `Board: ${A.board}`, '', '_Watching ' + A.rows.join(', ') + ' on ' + A.tfs.join(', ') + ' (config/board.json alerts). Close this issue any time._'].join('\n');
      fs.writeFileSync(AF, JSON.stringify({ title: title.length > 200 ? title.slice(0, 197) + '...' : title, body }));
      console.log('Alert: ' + title);
    }
  }
}
console.log(`Built ${nOk} of ${rows.length} rows (${kept.length} kept from the last good board), ${events.length} status changes, log ${log.length}.`);
if (kept.length) console.log('Kept: ' + kept.map(k => k.sym + ' (' + k.why + ')').join('; '));
