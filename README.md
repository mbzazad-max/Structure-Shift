# Structure Shift board

Market structure for 36 Binance coins and 12 market gauges on **1H, 4H, 1D and 1W**: trend (Uptrend / Downtrend / Range),
close-based BOS / CHoCH structure, the candle close that flips it, continuation level, pending flag, a status-change log,
and strong support / resistance clusters (fib + FVG + swings + structure + EMA, from 4H, 1D and 1W).

Live (owner login): https://dashboards.mbzazad.workers.dev/structure-shift/

## How it runs
- **Data**: the board reads ONLY from Market-Data (`mbzazad-max/market-data`), the shared candle store for every dashboard.
  It never calls Binance or TradingView itself. What Market-Data holds for it:
  - Coins: Binance spot USDT pairs, 1H, 4H, 1D (`binance/<SYM>USDT/<TF>`), fetched by Market-Data's own GitHub workflow
    (binance.yml) every 4 hours, 7 min after each 4H close. 1W is built from 1D.
  - Gauges: TradingView `CRYPTOCAP:*` 1H and 4H, loaded by the daily 11:30 Sydney Claude task (TV_TASK.md); 1D and 1W built
    from 4H. USDT.D+USDC.D is the candle-by-candle sum; USDT.D also has its own row (added 20 Nov 2026). ETHBTC from Binance (1H, 4H).
- **Build**: `.github/workflows/build.yml` runs when Market-Data imports a series the board uses (dispatched by Market-Data),
  on the Refresh button, daily at 01:05 UTC and on pushes. `build/build.js` runs the page's own engine (`public/ms.js`) and writes
  `public/data.json` + `public/freshness.json`. It skips when no input changed and keeps a row's last good version on any failure.
- **Page**: `public/index.html` = the claude.ai artifact page (Structure Shift Board, artifact TYw4191SyBwjXrA2Cg4gb9) with the
  1H column added and the artifact's own data code (claude.ai database, TradingView refresh button) removed, so the page reads
  only the built data.json; `cloud.js` adds Refresh, the freshness strip and the
  "← Dashboards" link. `reference/` keeps the artifact's original page and engine; `reference/SHA256SUMS` locks the files.
- **Tests**: `node tests/engine.js` (run by the workflow): 1H present, and 4H / 1D / 1W and the zones identical to the original engine.

Config: `config/board.json` (rows, Market-Data series, scale). Removed rows: MNT, VVV, LIT, LEO, XMR (not on Binance).
