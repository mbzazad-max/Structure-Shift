/* Structure Shift on Cloudflare: the page normally runs inside claude.ai, where window.claude gives it a database and
   the TradingView connector. Here the board arrives fully built in data.json (built on GitHub from Market-Data), so
   every capability answers "not available": the page reads data.json only and its TradingView button stays hidden. */
(function () {
  'use strict';
  window.claude = { use: function () { return Promise.resolve(null); } };
})();
