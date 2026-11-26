/* Engine checks on the built board (run by the workflow after the build, and locally: node tests/engine.js).
   1. Every row has 4H, 1D and the price; 1H appears wherever its candles exist; 2H (from 1H), 8H and 12H (from 4H) on coins only.
   2. Adding 1H did not change 4H/1D/1W or the zones: the original engine (reference/ms.original.js) gives the same
      answers for the same 4H and 1D candles (price pinned to the same value). */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const NEW = require(path.join(ROOT, 'public', 'ms.js')), OLD = require(path.join(ROOT, 'reference', 'ms.original.js'));
let fail = 0; const bad = m => { fail++; console.error('FAIL ' + m); };
// synthetic candles: a random walk with trends, 6,000 1H bars
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const H1 = { t: [], o: [], h: [], l: [], c: [], v: [] }; let p = 100; const t0 = 1700000000 - (1700000000 % 86400);
for (let i = 0; i < 6000; i++) { const o = p; p *= 1 + (rnd() - 0.5) * 0.02 + Math.sin(i / 400) * 0.001; const hi = Math.max(o, p) * (1 + rnd() * 0.005), lo = Math.min(o, p) * (1 - rnd() * 0.005);
  H1.t.push(t0 + i * 3600); H1.o.push(o); H1.h.push(hi); H1.l.push(lo); H1.c.push(p); H1.v.push(1); }
const rs = (B, P) => { const o = { t: [], o: [], h: [], l: [], c: [], v: [] }; let k = null; B.t.forEach((t, i) => { const b = Math.floor(t / P) * P; if (b !== k) { k = b; o.t.push(b); o.o.push(B.o[i]); o.h.push(B.h[i]); o.l.push(B.l[i]); o.c.push(B.c[i]); o.v.push(1); } else { const j = o.t.length - 1; o.h[j] = Math.max(o.h[j], B.h[i]); o.l[j] = Math.min(o.l[j], B.l[i]); o.c[j] = B.c[i]; } }); return o; };
const B4 = rs(H1, 14400), BD = rs(H1, 86400), now = H1.t[H1.t.length - 1] + 3600 + 60;
const B2 = NEW.to2H(H1), B8 = NEW.to8H(B4), B12 = NEW.to12H(B4), a = NEW.analyze('X', B4, BD, now, { B1: H1, B2, B8, B12 }), b = OLD.analyze('X', B4, BD, now, { live: a.price });
if (!a.tf['1H']) bad('no 1H result');
for (const tf of ['2H', '8H', '12H']) if (!a.tf[tf]) bad('no ' + tf + ' result');
for (const [tf, P, X] of [['8H', 28800, B8], ['12H', 43200, B12]]) { const R = rs(H1, P);
  if (JSON.stringify([R.t, R.h, R.l, R.c]) !== JSON.stringify([X.t, X.h, X.l, X.c].map(a => a.slice(0, R.t.length)))) bad(tf + ' from 4H differs from a plain ' + tf + ' resample of 1H');
  if (X.t.some(t => t % P)) bad(tf + ' candles not UTC-aligned'); }
{ const R2 = rs(H1, 7200); if (JSON.stringify([R2.t, R2.h, R2.l, R2.c]) !== JSON.stringify([B2.t, B2.h, B2.l, B2.c])) bad('to2H differs from a plain 2H resample');
  const cut = { t: H1.t.slice(0, -1), o: H1.o.slice(0, -1), h: H1.h.slice(0, -1), l: H1.l.slice(0, -1), c: H1.c.slice(0, -1), v: H1.v.slice(0, -1) };
  if (NEW.to2H(cut).t.length !== B2.t.length - 1) bad('to2H kept a half-built 2H candle'); }
for (const tf of ['4H', '1D', '1W']) {
  const x = JSON.stringify(a.tf[tf]), y = JSON.stringify(b.tf[tf]);
  if (x !== y) bad(tf + ' differs from the original engine');
}
if (JSON.stringify(a.zones) !== JSON.stringify(b.zones)) bad('zones differ from the original engine');
const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data.json'), 'utf8'));
for (const [k, c] of Object.entries(d.coins)) { if (!c.tf || !c.tf['4H'] || !c.tf['1D'] || !isFinite(c.price)) bad(k + ': missing 4H/1D/price');
  if (c.kind === 'gauge' && (c.tf['2H'] || c.tf['8H'] || c.tf['12H'])) bad(k + ': gauge has a 2H/8H/12H column');
  if (c.kind !== 'gauge' && (!c.tf['8H'] || !c.tf['12H'])) bad(k + ': coin has no 8H/12H');
  if (c.kind !== 'gauge' && c.tf['1H'] && !c.tf['2H']) bad(k + ': coin has 1H but no 2H'); }
console.log(fail ? fail + ' check(s) failed' : `Engine OK: 1H, plus 2H/8H/12H for coins, added; 4H/1D/1W and zones identical to the original engine; ${Object.keys(d.coins).length} board rows complete.`);
process.exit(fail ? 1 : 0);
