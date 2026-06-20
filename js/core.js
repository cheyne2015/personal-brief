'use strict';

var STORAGE_KEY = '_brief_snapshot';
var PENDING_KEY  = '_brief_pending_compare';
var THEME_KEY    = '_brief_theme';
var AI_CACHE_KEY = '_brief_ai_cache';
var AI_CACHE_VERSION = 10; // bump when HTML structure or sanitization changes

var forceRefresh = false; // set true by refresh button to skip cache

function getAICache() {
  try { return JSON.parse(localStorage.getItem(AI_CACHE_KEY)) || {}; }
  catch(e) { return {}; }
}
function getCachedAIEntry(key) {
  var entry = getAICache()[key];
  if (entry && entry.htmlVersion === AI_CACHE_VERSION) return entry;
  return null;
}
function setAICache(updates) {
  var cache = getAICache();
  Object.keys(updates).forEach(function(k) {
    if (typeof updates[k] === 'object' && updates[k] !== null && !Array.isArray(updates[k])) {
      updates[k].htmlVersion = AI_CACHE_VERSION;
    }
    cache[k] = updates[k];
  });
  try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache)); }
  catch(e) { /* storage full, silently ignore */ }
}
function clearAICache() {
  try { localStorage.removeItem(AI_CACHE_KEY); }
  catch(e) {}
  forceRefresh = true; // ensure this session also re-fetches
}
function hashStr(s) {
  // djb2 hash — fast, good enough for cache keys
  var h = 5381;
  for (var i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); }
  return h.toString(36);
}

/* get today's date as YYYY-MM-DD for cache keys */
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
}

/* ===== API Data Cache (network-first, cache-fallback) ===== */
var API_CACHE_KEY = '_brief_api_cache';
function apiCacheGet(key) {
  try {
    var c = JSON.parse(localStorage.getItem(API_CACHE_KEY)) || {};
    return c[key] || null;
  } catch(e) { return null; }
}
function apiCacheSet(key, value) {
  try {
    var c = JSON.parse(localStorage.getItem(API_CACHE_KEY)) || {};
    c[key] = { data: value, ts: Date.now() };
    localStorage.setItem(API_CACHE_KEY, JSON.stringify(c));
  } catch(e) { /* storage full */ }
}

/* ===== Sub-section toggle (collapse 0-item boards) ===== */
window.toggleSubSection = function(id) {
  var sec = document.getElementById(id);
  if (!sec) return;
  sec.classList.toggle('collapsed');
};

/* ===== Theme Toggle ===== */
var themeToggle = document.getElementById('themeToggle');
var themeMeta = document.querySelector('meta[name="theme-color"]');
var savedTheme = localStorage.getItem(THEME_KEY) || 'dark';

function applyTheme(th) {
  document.documentElement.setAttribute('data-theme', th);
  themeToggle.classList.toggle('dark', th === 'dark');
  if (themeMeta) themeMeta.setAttribute('content', th === 'dark' ? '#060a14' : '#f0f4f8');
}
applyTheme(savedTheme);

themeToggle.addEventListener('click', function() {
  var current = document.documentElement.getAttribute('data-theme');
  var next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

/* ===== Scroll Animation ===== */
var observer = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.12, rootMargin: '0px 0px -36px 0px' });
document.querySelectorAll('.animate-on-scroll').forEach(function(el) { observer.observe(el); });

/* ===== Arena Tabs ===== */
var tabs = document.querySelectorAll('.arena-tab');
tabs.forEach(function(tab) {
  tab.addEventListener('click', function() {
    tabs.forEach(function(t) { t.classList.remove('active'); });
    this.classList.add('active');
    var panelId = 'panel-' + this.getAttribute('data-tab');
    document.querySelectorAll('.arena-panel').forEach(function(p) { p.classList.remove('active'); });
    var panel = document.getElementById(panelId);
    if (panel) { panel.classList.add('active'); }
  });
});

/* ===== DOM Snapshot Builder ===== */
function text(el, selector) {
  var e = el ? el.querySelector(selector) : document.querySelector(selector);
  return e ? e.textContent.trim() : '';
}

function buildSnapshot() {
  var snap = { ts: Date.now(), sections: {} };

  /* Hero */
  snap.heroSubtitle = text(null, '.hero-subtitle');
  var wb = document.querySelector('.hero-weather-brief');
  if (wb) {
    snap.heroWeather = text(wb, '.temp');
    snap.heroWeatherDesc = text(wb, '.desc strong');
    snap.heroWeatherExtra = text(wb, '.desc span');
  }
  snap.heroStats = [];
  document.querySelectorAll('.hero-stat').forEach(function(s) {
    snap.heroStats.push({ count: text(s,'.count'), label: text(s,'.label') });
  });

  /* AI Daily */
  snap.sections['ai-daily'] = { items: [], coverage: '' };
  var aiSec = document.getElementById('ai-daily');
  if (aiSec) {
    snap.sections['ai-daily'].coverage = text(aiSec, '.major-count');
    aiSec.querySelectorAll('.card').forEach(function(card) {
      var sub = card.closest('.sub-section');
      snap.sections['ai-daily'].items.push({
        num:     text(card, '.card-number'),
        title:   text(card, 'h3'),
        summary: text(card, '.card-summary'),
        source:  text(card, '.source-chip'),
        link:    (card.querySelector('.card-action') || {}).href || '',
        section: sub ? sub.id : ''
      });
    });
    // Empty section markers
    snap.sections['ai-daily'].emptySections = [];
    aiSec.querySelectorAll('.empty-section').forEach(function(e) {
      snap.sections['ai-daily'].emptySections.push(e.textContent.trim());
    });
  }

  /* Weather */
  snap.sections['weather'] = { location: '', alert: '', cards: [] };
  var wSec = document.getElementById('weather');
  if (wSec) {
    snap.sections['weather'].location = text(wSec, '.major-count');
    var alertEl = wSec.querySelector('.weather-alert div');
    if (alertEl) snap.sections['weather'].alert = alertEl.textContent.trim();
    wSec.querySelectorAll('.weather-card').forEach(function(c) {
      snap.sections['weather'].cards.push({
        label: text(c, '.day-label'),
        temp:  text(c, '.big-temp'),
        hilo:  text(c, '.hi-lo')
      });
    });
  }

  /* Arena */
  snap.sections['arena'] = { date: '', panels: [] };
  var aSec = document.getElementById('arena');
  if (aSec) {
    snap.sections['arena'].date = text(aSec, '.major-count');
    aSec.querySelectorAll('.arena-card').forEach(function(p) {
      var rows = [];
      p.querySelectorAll('.arena-row').forEach(function(r) { rows.push(r.textContent.trim()); });
      snap.sections['arena'].panels.push({
        label: text(p, '.arena-label'),
        rows: rows,
        note: text(p, '.arena-note')
      });
    });
  }

  /* Finance */
  snap.sections['finance'] = { date: '', cards: [] };
  var fSec = document.getElementById('finance');
  if (fSec) {
    snap.sections['finance'].date = text(fSec, '.major-count');
    fSec.querySelectorAll('.finance-card').forEach(function(c) {
      var items = [];
      c.querySelectorAll('.fin-item').forEach(function(i) { items.push(i.textContent.trim()); });
      snap.sections['finance'].cards.push({
        label: text(c, '.fin-label'),
        value: text(c, '.fin-value'),
        items: items
      });
    });
  }

  /* World */
  snap.sections['world'] = { date: '', breaking: '', cards: [] };
  var wlSec = document.getElementById('world');
  if (wlSec) {
    snap.sections['world'].date = text(wlSec, '.major-count');
    var bp = wlSec.querySelector('.world-breaking p');
    if (bp) snap.sections['world'].breaking = bp.textContent.trim();
    wlSec.querySelectorAll('.world-card').forEach(function(c) {
      snap.sections['world'].cards.push({
        title: text(c, 'h4'),
        text:  text(c, 'p')
      });
    });
  }

  snap.footer = text(null, '.footer');
  return snap;
}

/* ===== Compare Two Snapshots ===== */
function compareSnapshots(oldSnap, newSnap) {
  var diff = { sections: {}, summary: { added: 0, updated: 0, unchanged: 0 }, tsDiff: newSnap.ts - oldSnap.ts };

  /* --- AI Daily --- */
  var oldItems = (oldSnap.sections['ai-daily'] || {}).items || [];
  var newItems = (newSnap.sections['ai-daily'] || {}).items || [];
  var oldTitles = {}; oldItems.forEach(function(it) { oldTitles[it.title] = true; });
  var newTitles = {}; newItems.forEach(function(it) { newTitles[it.title] = true; });

  var addedAI = [], removedAI = [];
  newItems.forEach(function(it) { if (!oldTitles[it.title]) addedAI.push(it); });
  oldItems.forEach(function(it) { if (!newTitles[it.title]) removedAI.push(it); });

  var aiChanged = addedAI.length > 0 || removedAI.length > 0 || oldItems.length !== newItems.length;
  diff.sections['ai-daily'] = {
    name: 'AI 日报', icon: '🧠',
    oldCount: oldItems.length, newCount: newItems.length,
    added: addedAI, removed: removedAI, changed: aiChanged
  };
  if (aiChanged) diff.summary.updated++;
  else diff.summary.unchanged++;

  /* --- Weather --- */
  var oldW = oldSnap.sections['weather'] || { cards: [] };
  var newW = newSnap.sections['weather'] || { cards: [] };
  var wDiffs = [];
  for (var i = 0; i < Math.max(oldW.cards.length, newW.cards.length); i++) {
    var oc = oldW.cards[i] || {}, nc = newW.cards[i] || {};
    if (oc.temp !== nc.temp || oc.hilo !== nc.hilo) {
      wDiffs.push({ label: nc.label || oc.label, oldTemp: oc.temp, newTemp: nc.temp, oldHiLo: oc.hilo, newHiLo: nc.hilo });
    }
  }
  var wChanged = wDiffs.length > 0 || oldW.alert !== newW.alert;
  diff.sections['weather'] = {
    name: '天气看板', icon: '🌤️',
    changed: wChanged, diffs: wDiffs,
    oldAlert: oldW.alert, newAlert: newW.alert, alertChanged: oldW.alert !== newW.alert
  };
  if (wChanged) diff.summary.updated++;
  else diff.summary.unchanged++;

  /* --- Arena --- */
  var oldA = (oldSnap.sections['arena'] || {}).panels || [];
  var newA = (newSnap.sections['arena'] || {}).panels || [];
  var aChanged = JSON.stringify(oldA) !== JSON.stringify(newA);
  diff.sections['arena'] = {
    name: 'Arena 排行', icon: '🏆',
    changed: aChanged,
    oldDate: (oldSnap.sections['arena'] || {}).date,
    newDate: (newSnap.sections['arena'] || {}).date
  };
  if (aChanged) diff.summary.updated++;
  else diff.summary.unchanged++;

  /* --- Finance --- */
  var oldF = (oldSnap.sections['finance'] || {}).cards || [];
  var newF = (newSnap.sections['finance'] || {}).cards || [];
  var fChanged = JSON.stringify(oldF) !== JSON.stringify(newF);
  diff.sections['finance'] = {
    name: '金融市场', icon: '💹',
    changed: fChanged,
    oldDate: (oldSnap.sections['finance'] || {}).date,
    newDate: (newSnap.sections['finance'] || {}).date
  };
  if (fChanged) diff.summary.updated++;
  else diff.summary.unchanged++;

  /* --- World --- */
  var oldWl = oldSnap.sections['world'] || { cards: [] };
  var newWl = newSnap.sections['world'] || { cards: [] };
  var wlChanged = JSON.stringify(oldWl.cards) !== JSON.stringify(newWl.cards) || oldWl.breaking !== newWl.breaking;
  diff.sections['world'] = {
    name: '国际局势', icon: '🌍',
    changed: wlChanged,
    oldDate: oldWl.date, newDate: newWl.date
  };
  if (wlChanged) diff.summary.updated++;
  else diff.summary.unchanged++;

  // Count added items across AI daily
  diff.summary.added = addedAI.length;

  return diff;
}

/* ===== Render Diff Panel ===== */
function renderDiff(diff, oldTs, newTs) {
  var panel = document.getElementById('diffPanel');
  var dtf = new Intl.DateTimeFormat('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });

  var html = '';
  html += '<div class="diff-countdown-bar running" id="diffCountdownBar"></div>';
  html += '<span class="diff-countdown-text" id="diffCountdownText">3s 后自动关闭</span>';
  html += '<button class="diff-close" id="diffClose" aria-label="关闭">&times;</button>';
  html += '<div class="diff-header">';
  html += '<h2>📊 数据刷新对比</h2>';
  html += '</div>';
  html += '<div class="diff-meta">上次快照: ' + dtf.format(new Date(oldTs)) + ' → 本次: ' + dtf.format(new Date(newTs)) + '</div>';

  // Summary chips
  html += '<div class="diff-summary">';
  if (diff.summary.added > 0) html += '<span class="diff-chip added">🆕 新增 ' + diff.summary.added + ' 条</span>';
  if (diff.summary.updated > 0) html += '<span class="diff-chip updated">📝 ' + diff.summary.updated + ' 个版块有更新</span>';
  if (diff.summary.unchanged > 0) html += '<span class="diff-chip unchanged">✅ ' + diff.summary.unchanged + ' 个版块无变化</span>';
  html += '</div>';

  // Per-section details
  var secKeys = ['ai-daily','weather','arena','finance','world'];
  secKeys.forEach(function(key) {
    var sec = diff.sections[key];
    if (!sec) return;

    html += '<div class="diff-section">';
    html += '<div class="diff-section-header">';
    html += '<h3>' + sec.icon + ' ' + sec.name + '</h3>';
    if (sec.changed) {
      html += '<span class="badge changed">有变化</span>';
    } else {
      html += '<span class="badge same">无变化</span>';
    }
    html += '</div>';

    if (key === 'ai-daily') {
      if (sec.added.length > 0) {
        html += '<p style="font-size:0.82rem;color:var(--green);font-weight:600;margin-bottom:8px;">+ 新增 ' + sec.added.length + ' 条资讯（' + sec.oldCount + ' → ' + sec.newCount + '）</p>';
        sec.added.forEach(function(item) {
          html += '<div class="diff-item new">';
          html += '<span class="tag new-tag">新增</span>';
          html += '<strong>' + escapeHtml(item.title) + '</strong>';
          html += '<div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px;">' + escapeHtml(item.summary.substring(0, 80)) + (item.summary.length > 80 ? '…' : '') + '</div>';
          html += '</div>';
        });
      }
      if (sec.removed.length > 0) {
        html += '<p style="font-size:0.82rem;color:var(--red);font-weight:600;margin-bottom:8px;">- 移除 ' + sec.removed.length + ' 条资讯</p>';
        sec.removed.forEach(function(item) {
          html += '<div class="diff-item removed">';
          html += '<span class="tag removed-tag">移除</span>';
          html += '<strong>' + escapeHtml(item.title) + '</strong>';
          html += '</div>';
        });
      }
      if (sec.added.length === 0 && sec.removed.length === 0 && sec.oldCount === sec.newCount) {
        html += '<div class="diff-item neutral">条数和内容均无变化（' + sec.newCount + ' 条）</div>';
      }
    }

    else if (key === 'weather') {
      if (sec.alertChanged) {
        html += '<div class="diff-item changed"><span class="tag changed-tag">预警更新</span>降温提醒文案已更新</div>';
      }
      if (sec.diffs.length > 0) {
        html += '<p style="font-size:0.82rem;color:var(--amber);font-weight:600;margin-bottom:8px;">' + sec.diffs.length + ' 天预报有变动</p>';
        sec.diffs.forEach(function(d) {
          html += '<div class="diff-item changed">';
          html += '<strong>' + escapeHtml(d.label) + '</strong>';
          html += '<div class="diff-compare-row" style="margin-top:6px;">';
          html += '<div><span class="old-val">' + escapeHtml(d.oldTemp || '—') + '</span> <span style="font-size:0.75rem;color:var(--text-muted);">旧</span></div>';
          html += '<div class="arrow-col">→</div>';
          html += '<div><span class="new-val">' + escapeHtml(d.newTemp || '—') + '</span> <span style="font-size:0.75rem;color:var(--clr-weather);">新</span></div>';
          html += '</div>';
          if (d.oldHiLo && d.newHiLo) {
            html += '<div class="diff-compare-row">';
            html += '<div style="font-size:0.78rem;"><span class="old-val">' + escapeHtml(d.oldHiLo) + '</span></div>';
            html += '<div class="arrow-col">→</div>';
            html += '<div style="font-size:0.78rem;"><span class="new-val">' + escapeHtml(d.newHiLo) + '</span></div>';
            html += '</div>';
          }
          html += '</div>';
        });
      }
      if (!sec.changed) {
        html += '<div class="diff-item neutral">气温预报无变化</div>';
      }
    }

    else if (key === 'arena') {
      var oldD = sec.oldDate || '—', newD = sec.newDate || '—';
      html += '<div style="font-size:0.84rem;color:var(--text-dim);">';
      html += '数据日期: <span style="text-decoration:line-through;color:var(--text-muted);">' + escapeHtml(oldD) + '</span> → <strong>' + escapeHtml(newD) + '</strong>';
      html += '</div>';
      if (sec.changed) {
        html += '<div class="diff-item changed" style="margin-top:8px;"><span class="tag changed-tag">更新</span>排行榜数据已刷新，请查看页面正文获取最新排名</div>';
      } else {
        html += '<div class="diff-item neutral" style="margin-top:8px;">排行榜数据无变化</div>';
      }
    }

    else if (key === 'finance') {
      var oldDf = sec.oldDate || '—', newDf = sec.newDate || '—';
      html += '<div style="font-size:0.84rem;color:var(--text-dim);">';
      html += '数据日期: <span style="text-decoration:line-through;color:var(--text-muted);">' + escapeHtml(oldDf) + '</span> → <strong>' + escapeHtml(newDf) + '</strong>';
      html += '</div>';
      if (sec.changed) {
        html += '<div class="diff-item changed" style="margin-top:8px;"><span class="tag changed-tag">更新</span>市场数据已刷新，请查看页面正文获取最新行情</div>';
      } else {
        html += '<div class="diff-item neutral" style="margin-top:8px;">市场数据无变化</div>';
      }
    }

    else if (key === 'world') {
      var oldDw = sec.oldDate || '—', newDw = sec.newDate || '—';
      html += '<div style="font-size:0.84rem;color:var(--text-dim);">';
      html += '数据日期: <span style="text-decoration:line-through;color:var(--text-muted);">' + escapeHtml(oldDw) + '</span> → <strong>' + escapeHtml(newDw) + '</strong>';
      html += '</div>';
      if (sec.changed) {
        html += '<div class="diff-item changed" style="margin-top:8px;"><span class="tag changed-tag">更新</span>国际局势动态已刷新，请查看页面正文获取最新内容</div>';
      } else {
        html += '<div class="diff-item neutral" style="margin-top:8px;">国际动态无变化</div>';
      }
    }

    html += '</div>'; // .diff-section
  });

  panel.innerHTML = html;

  // Close button
  document.getElementById('diffClose').addEventListener('click', closeDiff);

  // Show overlay
  var overlay = document.getElementById('diffOverlay');
  overlay.classList.add('show');

  // Click backdrop to close
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeDiff();
  });

  // Auto-dismiss countdown (5 seconds)
  var countdownText = document.getElementById('diffCountdownText');
  var remaining = 5;
  var countdownTimer = setInterval(function() {
    remaining--;
    if (remaining > 0) {
      countdownText.textContent = remaining + 's 后自动关闭';
    } else {
      clearInterval(countdownTimer);
      closeDiff();
    }
  }, 1000);

  // Store timer ref on the overlay element for cleanup
  overlay._diffTimer = countdownTimer;
  // Pause countdown on hover
  overlay.addEventListener('mouseenter', function() {
    clearInterval(countdownTimer);
    document.getElementById('diffCountdownBar').style.animationPlayState = 'paused';
    countdownText.textContent = '悬停暂停 · 移开继续';
  });
  overlay.addEventListener('mouseleave', function() {
    document.getElementById('diffCountdownBar').style.animationPlayState = 'running';
    countdownText.textContent = remaining + 's 后自动关闭';
    countdownTimer = setInterval(function() {
      remaining--;
      if (remaining > 0) {
        countdownText.textContent = remaining + 's 后自动关闭';
      } else {
        clearInterval(countdownTimer);
        closeDiff();
      }
    }, 1000);
    overlay._diffTimer = countdownTimer;
  });
  // Click on empty area of panel also pauses
  panel.addEventListener('click', function(e) {
    if (e.target === panel) return;
    // user is reading — reset countdown
    clearInterval(overlay._diffTimer);
    remaining = 3;
    document.getElementById('diffCountdownBar').style.animation = 'none';
    void document.getElementById('diffCountdownBar').offsetWidth; // reflow
    document.getElementById('diffCountdownBar').style.animation = 'countdown 5s linear forwards';
    countdownText.textContent = '3s 后自动关闭';
    overlay._diffTimer = setInterval(function() {
      remaining--;
      if (remaining > 0) {
        countdownText.textContent = remaining + 's 后自动关闭';
      } else {
        clearInterval(overlay._diffTimer);
        closeDiff();
      }
    }, 1000);
  });

}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function safeExternalUrl(value) {
  try {
    var parsed = new URL(String(value || ''), window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '#';
  } catch (error) {
    return '#';
  }
}

function closeDiff() {
  var overlay = document.getElementById('diffOverlay');
  if (overlay._diffTimer) { clearInterval(overlay._diffTimer); overlay._diffTimer = null; }
  overlay.classList.remove('show');
}

/* ===== On Page Load: check for pending comparison ===== */
var pending = sessionStorage.getItem(PENDING_KEY);
if (pending) {
  sessionStorage.removeItem(PENDING_KEY);
  var oldSnap = JSON.parse(pending);
  var newSnap = buildSnapshot();
  var diff = compareSnapshots(oldSnap, newSnap);

  // Small delay for DOM to settle
  setTimeout(function() {
    renderDiff(diff, oldSnap.ts, newSnap.ts);
    // Also save new snapshot for next refresh
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSnap));
  }, 300);
} else {
  // Save initial snapshot silently
  var initSnap = buildSnapshot();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initSnap));
}

