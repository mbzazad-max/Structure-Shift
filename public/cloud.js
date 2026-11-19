/* Structure Shift on Cloudflare: Refresh button (asks GitHub to rebuild from the newest Market-Data candles),
   a freshness strip that flags every series more than one candle old, and the "← Dashboards" link. Uses the page's own styles. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var slug = location.pathname.split('/')[1] || '';
  var API = slug ? '/api/' + slug + '/' : 'api/';
  var btns = document.querySelector('header .btns');
  var pill = document.createElement('span'); pill.className = 'pill'; pill.id = 'runState'; pill.hidden = true;
  var btn = document.createElement('button'); btn.className = 'btn main'; btn.type = 'button'; btn.id = 'ghRefresh'; btn.textContent = 'Refresh'; btn.hidden = true;
  btn.title = 'Ask GitHub to rebuild the board from the newest candles';
  btns.appendChild(pill); btns.appendChild(btn);
  var strip = document.createElement('div'); strip.className = 'note'; strip.id = 'fresh'; strip.hidden = true;
  var hdr = document.querySelector('header'); hdr.parentNode.insertBefore(strip, hdr.nextSibling);

  var t2s = function (s) { if (!s) return '-'; var d = new Date(s * 1000); return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  function state(text, kind) { pill.hidden = false; pill.className = 'pill ' + (kind || ''); pill.textContent = text; }
  // Binance 1H arrives every 4 hours, TradingView once a day: only flag what is later than its normal schedule.
  function slack(s) { return s.source === 'tv' ? Math.ceil(86400 / s.period_s) + 1 : s.tf === '1H' ? 5 : 1; }

  function showFresh(F) {
    var now = Date.now() / 1000, rows = F.series.map(function (s) {
      var behind = s.last_close ? Math.max(0, Math.floor((now - s.last_close) / s.period_s)) : null;
      return { s: s, behind: behind, flag: behind === null || behind > slack(s) };
    });
    var flagged = rows.filter(function (r) { return r.flag; });
    var head = 'Board built ' + esc(F.generated) + ' · ' + rows.length + ' data series, ' +
      (flagged.length ? '<b>' + flagged.length + ' later than their normal schedule</b>' : 'all on schedule');
    if (F.kept && F.kept.length) head += ' · kept last good: ' + F.kept.map(function (k) { return esc(k.sym); }).join(', ');
    var body = rows.map(function (r) {
      var s = r.s, label = esc(s.symbol + ' ' + s.tf) + ' <span class="muted">(' + (s.source === 'tv' ? 'TradingView' : 'Binance') + ')</span>';
      var st = r.behind === null ? 'no data yet' : r.behind === 0 ? 'current' : r.behind + ' candle' + (r.behind > 1 ? 's' : '') + ' behind';
      return '<tr' + (r.flag ? ' class="dn"' : '') + '><td>' + label + '</td><td class="num">' + esc(t2s(s.last_close)) + '</td><td>' + st + '</td></tr>';
    }).join('');
    var kept = (F.kept || []).map(function (k) { return '<li>' + esc(k.sym) + ': ' + esc(k.why) + '</li>'; }).join('');
    strip.hidden = false;
    strip.innerHTML = '<details><summary>' + head + '</summary>' +
      (kept ? '<p class="small" style="margin:8px 0 4px">These rows show their last good version (or none yet):</p><ul class="small" style="margin:0 0 8px">' + kept + '</ul>' : '') +
      '<div style="overflow-x:auto"><table style="margin-top:8px;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding-right:16px">Series</th>' +
      '<th style="text-align:left;padding-right:16px">Last closed candle (your time)</th><th style="text-align:left">Status</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="small muted" style="margin:8px 0 0">' + esc(F.last_result || '') + ' Binance candles arrive every 4 hours (1H four at a time), TradingView gauges once a day after 11:30 am Sydney.</p></details>';
  }
  fetch('freshness.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (F) { if (F) showFresh(F); }).catch(function () {});

  var polling = null;
  function poll(startedAt) {
    clearTimeout(polling);
    fetch(API + 'status', { cache: 'no-store', redirect: 'manual', credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('no access'); return r.json(); }).then(function (s) {
      btn.hidden = false;
      if (s.status && s.status !== 'completed') { state('Running…', 'flag'); btn.disabled = true; polling = setTimeout(function () { poll(startedAt || Date.now()); }, 8000); return; }
      btn.disabled = false;
      if (!startedAt) return;
      if (s.conclusion === 'success') { state('Done ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'Uptrend'); setTimeout(function () { location.reload(); }, 1500); }
      else state('Refresh failed, last good board kept', 'flag');
    }).catch(function () { btn.disabled = false; if (startedAt) state('Could not check progress', 'flag'); else btn.hidden = true; });
  }
  btn.addEventListener('click', function () {
    btn.disabled = true; state('Starting…', '');
    fetch(API + 'refresh', { method: 'POST', redirect: 'manual', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function () { state('Running…', 'flag'); setTimeout(function () { poll(Date.now()); }, 5000); })
      .catch(function (e) { btn.disabled = false; state('Refresh not started: ' + e.message, 'flag'); });
  });
  poll(0);

  // "← Dashboards" link back to the home site
  var a = document.createElement('a'); a.href = '/'; a.textContent = '← Dashboards'; a.className = 'small'; a.style.textDecoration = 'none';
  a.title = 'Back to the list of dashboards';
  var w = document.querySelector('.wrap'); w.insertBefore(a, w.firstChild);
})();
