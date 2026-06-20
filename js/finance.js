'use strict';

/* ===== Finance Analysis Rendering (show static first, AI upgrades in background) ===== */
function renderFinanceDataUnavailable() {
  var el = document.getElementById('marketAnalysis');
  if (el) el.innerHTML = '<div class="empty-section" style="padding:24px;">部分核心行情暂不可用，已停止生成市场分析，避免展示过期或推测数据。</div>';
  var badge = document.getElementById('finFreshBadge');
  if (badge) { badge.className = 'freshness-badge snapshot'; badge.innerHTML = '<span class="freshness-dot"></span>部分数据不可用'; }
}

function renderFinanceAnalysis(shCur, shPrev, goldCur, goldPrev, nxCur, nxPrev) {
  var el = document.getElementById('marketAnalysis');
  if (!el) return;
  var finBadge = document.getElementById('finFreshBadge');

  // Update finance cards with real data
  var goldPct = ((goldCur - goldPrev) / goldPrev * 100);
  var goldUp = goldCur >= goldPrev;
  var shPct = ((shCur - shPrev) / shPrev * 100);
  var shUp = shCur >= shPrev;

  // Gold card
  var goldVal = document.getElementById('finGoldValue');
  var goldChg = document.getElementById('finGoldChange');
  if (goldVal) goldVal.textContent = '$' + Math.round(goldCur);
  if (goldChg) {
    goldChg.textContent = (goldUp ? '+' : '') + goldPct.toFixed(2) + '% · COMEX 黄金';
    goldChg.className = 'fin-change ' + (goldUp ? 'fin-up' : 'fin-down');
  }

  // Shanghai Gold and oil are updated only by the dedicated market endpoint.

  // Shanghai Composite card
  var shVal = document.querySelector('.fin-cards .fin-card:nth-child(1) .fin-value');
  var shChg = document.querySelector('.fin-cards .fin-card:nth-child(1) .fin-change');
  if (shVal) shVal.textContent = Math.round(shCur);
  if (shChg) {
    shChg.textContent = (shUp ? '+' : '') + shPct.toFixed(2) + '% · 上证指数';
    shChg.className = 'fin-change ' + (shUp ? 'fin-up' : 'fin-down');
  }

  // Nasdaq card
  if (nxCur) {
    var nxPct = ((nxCur - nxPrev) / nxPrev * 100);
    var nxUp = nxCur >= nxPrev;
    var nxVal = document.querySelector('.fin-cards .fin-card:nth-child(2) .fin-value');
    var nxChg = document.querySelector('.fin-cards .fin-card:nth-child(2) .fin-change');
    if (nxVal) nxVal.textContent = nxCur.toLocaleString();
    if (nxChg) {
      nxChg.textContent = (nxUp ? '+' : '') + nxPct.toFixed(2) + '% · 纳斯达克';
      nxChg.className = 'fin-change ' + (nxUp ? 'fin-up' : 'fin-down');
    }
  }

  // Compute data hash to detect changes
  var dataHash = hashStr([shCur, shPrev, goldCur, goldPrev, nxCur||0, nxPrev||0].join('|'));
  var finCached = getCachedAIEntry('finance');

  // ===== CACHE HIT: render cached AI directly =====
  if (finCached && finCached.hash === dataHash && finCached.aiHtml) {
    el.innerHTML = finCached.aiHtml;
    if (finBadge) { finBadge.className = 'freshness-badge live'; finBadge.innerHTML = '<span class="freshness-dot"></span>AI 已更新 (缓存)'; }
    return;
  }

  // ===== IMMEDIATE: render static analysis =====
  renderStaticFinanceAnalysis(shCur, shPrev, goldCur, goldPrev, nxCur, nxPrev);
  if (finBadge) { finBadge.className = 'freshness-badge updating'; finBadge.innerHTML = '<span class="freshness-dot"></span>AI 分析中…'; }

  // ===== BACKGROUND: upgrade to AI analysis (with 30s timeout) =====
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 30000);

  fetch('/api/llm/finance-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shanghai: { cur: shCur, prev: shPrev },
      gold: { cur: goldCur, prev: goldPrev },
      nasdaq: { cur: nxCur || 0, prev: nxPrev || 0 }
    }),
    signal: controller.signal
  }).then(function(response) {
    clearTimeout(timeoutId);
    if (response.status === 429) {
      // Rate limit exceeded
      return response.json().then(function(data) {
        throw new Error('429: ' + (data.error || 'Rate limit exceeded'));
      });
    }
    if (!response.ok) throw new Error('API request failed');
    return response.json();
  }).then(function(data) {
    if (!data.success) throw new Error(data.error);
    var lines = data.analysis.split('\n').filter(function(l) { return l.trim(); });
    var html = '<div class="market-analysis ai-just-arrived">';
    html += '<div class="analysis-card animate-on-scroll visible"><div class="an-title">📊 走势分析（AI 生成）<span style="font-size:0.65em;color:var(--amber);margin-left:8px;">✨ AI 已更新</span></div><ul class="an-list">';
    lines.forEach(function(line) {
      var text = line.replace(/^[•·▪]/, '').trim();
      if (text) html += '<li>' + escapeHtml(text) + '</li>';
    });
    html += '</ul></div></div>';
    el.innerHTML = html;
    // Save to cache
    setAICache({ finance: { hash: dataHash, aiHtml: html, timestamp: Date.now() } });
    if (finBadge) { finBadge.className = 'freshness-badge live'; finBadge.innerHTML = '<span class="freshness-dot"></span>AI 已更新'; }
  }).catch(function(error) {
    clearTimeout(timeoutId);
    console.error('AI finance analysis failed, keeping static:', error);
    if (finBadge) { finBadge.className = 'freshness-badge snapshot'; finBadge.innerHTML = '<span class="freshness-dot"></span>静态数据'; }
    // Show rate limit error if 429
    if (error.message && error.message.indexOf('429') >= 0) {
      showRateLimitMessage(el, '金融市场 AI 分析请求已达每日上限（10 次/天）');
    }
  });
}

/* Static fallback for finance analysis */
function renderStaticFinanceAnalysis(shCur, shPrev, goldCur, goldPrev, nxCur, nxPrev) {
  var el = document.getElementById('marketAnalysis'); 
  if (!el) return;
  function movement(cur, prev, suffix) {
    var pct = (cur - prev) / prev * 100;
    return fmtVal(cur) + suffix + '，较前一交易日' + (pct >= 0 ? '上涨 ' : '下跌 ') + Math.abs(pct).toFixed(2) + '%';
  }
  var html = '<div class="market-analysis">';
  html += '<div class="analysis-card animate-on-scroll visible"><div class="an-title">📊 实时行情摘要</div><ul class="an-list">';
  html += '<li>上证指数 ' + movement(shCur, shPrev, ' 点') + '</li>';
  html += '<li>纳斯达克 ' + movement(nxCur, nxPrev, ' 点') + '</li>';
  html += '<li>COMEX黄金 ' + movement(goldCur, goldPrev, ' 美元/盎司') + '</li>';
  html += '<li>以上仅为价格变化描述，不对涨跌原因作无来源推断。</li></ul></div>';
  html += '</div>';
  el.innerHTML = html;
}

/* Display page refresh time separately from each market's last quote time. */
function updateFinanceTimestamps(markets) {
  var now = new Date();
  var ts = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2) + ':' + ('0' + now.getSeconds()).slice(-2);
  var dateStr = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  var fullTs = dateStr + ' ' + ts;
  var dateLabel = document.getElementById('finDateLabel');
  if (dateLabel) dateLabel.textContent = 'PAGE UPDATED ' + fullTs;
  var values = markets || marketQuoteTimes;
  [{ id:'finFetchTimeSH', timestamp:values.sh }, { id:'finFetchTimeUS', timestamp:values.us }, { id:'finFetchTimeGold', timestamp:values.gold }].forEach(function(item) {
    if (!item.timestamp) return;
    var el = document.getElementById(item.id);
    if (el) {
      var quoteDate = item.timestamp.slice(0, 10);
      var isCurrentDate = quoteDate === dateStr;
      el.textContent = (isCurrentDate ? '行情 ' : '收盘 ') + item.timestamp.slice(0, 16);
      el.classList.add('loaded');
      el.classList.toggle('closed', !isCurrentDate);
      el.setAttribute('title', '行情最后时间：' + item.timestamp + '；页面获取时间：' + fullTs);
    }
  });
}

/* Pulse live data indicators to show freshness */
function pulseLiveIndicators() {
  var tags = document.querySelectorAll('.hero-freshness-tag, #finFreshBadge, #weatherFreshBadge, #aiNewsBadge, #arenaFreshBadge, #worldFreshBadge');
  tags.forEach(function(tag) {
    tag.style.transform = 'scale(1.08)';
    tag.style.transition = 'transform 0.15s ease-out';
    setTimeout(function() { tag.style.transform = 'scale(1)'; }, 300);
  });
  // Update hero freshness text with timestamp
  var ft = document.getElementById('heroFreshTag');
  if (ft) {
    var now = new Date();
    var ts = ('0'+now.getHours()).slice(-2)+':'+('0'+now.getMinutes()).slice(-2)+':'+('0'+now.getSeconds()).slice(-2);
    ft.innerHTML = '<span class="hero-freshness-dot"></span>实时数据 · '+ts;
  }
}

/* ===== Keyboard shortcut: Esc to close diff ===== */
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeDiff();
});

/* ===== Back to Top Button ===== */
(function() {
  var btn = document.getElementById('backTopBtn');
  var showThreshold = 360;
  function toggleBtn() {
    if (window.scrollY > showThreshold) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }
  window.addEventListener('scroll', toggleBtn, { passive: true });
  btn.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

/* Supplemental market instruments */
function ready(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}
function setQuote(id, raw) {
  var el = document.getElementById(id);
  if (!el || !raw) return '';
  var p = String(raw).split('~');
  if (p.length < 5) return '';
  var cur = parseFloat(p[3]);
  var prev = parseFloat(p[4]);
  var cls = cur >= prev ? 'fin-up' : 'fin-down';
  el.innerHTML = fmtVal(cur) + ' <span class="' + cls + '">' + fmtPct(cur, prev) + '</span>';
  return parseTencentQuoteTime(raw);
}

function refreshSupplementalMarketQuotes() {
  var quotes = [
    { id:'finSH', url:'https://qt.gtimg.cn/q=sh000001', variable:'v_sh000001', market:'sh' },
    { id:'finSZ', url:'https://qt.gtimg.cn/q=sz399001', variable:'v_sz399001', market:'sh' },
    { id:'finChiNext', url:'https://qt.gtimg.cn/q=sz399006', variable:'v_sz399006', market:'sh' },
    { id:'finSTAR', url:'https://qt.gtimg.cn/q=sh000688', variable:'v_sh000688', market:'sh' },
    { id:'finCSI300', url:'https://qt.gtimg.cn/q=sh000300', variable:'v_sh000300', market:'sh' },
    { id:'finHSI', url:'https://qt.gtimg.cn/q=hkHSI', variable:'v_hkHSI', market:'sh' },
    { id:'finBond', url:'https://qt.gtimg.cn/q=sh000012', variable:'v_sh000012', market:'sh' },
    { id:'finDow', url:'https://qt.gtimg.cn/q=usDJI', variable:'v_usDJI', market:'us' },
    { id:'finNASDAQ', url:'https://qt.gtimg.cn/q=usIXIC', variable:'v_usIXIC', market:'us' },
    { id:'finSP500', url:'https://qt.gtimg.cn/q=usINX', variable:'v_usINX', market:'us' }
  ];
  var updated = { sh:false, us:false };
  return Promise.all(quotes.map(function(quote) {
    return loadVar(quote.url + '&t=' + Date.now(), quote.variable).then(function(raw) {
      rememberMarketQuoteTime(quote.market, setQuote(quote.id, raw));
      updated[quote.market] = true;
      return true;
    }).catch(function(error) {
      var el = document.getElementById(quote.id);
      if (el && (!el.textContent || el.textContent.indexOf('Loading') >= 0)) el.textContent = '暂无数据';
      console.warn('Supplemental quote failed:', quote.id, error.message);
      return false;
    });
  })).then(function() {
    updateFinanceTimestamps(marketQuoteTimes);
    return updated;
  });
}

ready(function() {
  setTimeout(function() {
    refreshSupplementalMarketQuotes();
    fetch('/api/llm/market/gold').then(function(r) {
      if (!r.ok) throw new Error('gold HTTP ' + r.status);
      return r.json();
    }).then(function(data) {
      if (!data || !data.success) return;
      rememberMarketQuoteTime('gold', parseSinaQuoteTime(data.raw));
      updateFinanceTimestamps(marketQuoteTimes);
      if (data.shGoldRaw) {
        var sh = String(data.shGoldRaw).split(',');
        var el = document.getElementById('finShGold');
        var shPrice = sh.length > 3 ? parseFloat(sh[3]) : NaN;
        if (el && isFinite(shPrice)) {
          el.textContent = '¥' + shPrice.toFixed(2) + '/克';
        } else if (el) {
          el.textContent = '暂无数据';
        }
      }
      if (data.oilRaw) {
        var oil = String(data.oilRaw).split(',');
        var oilCur = parseFloat(oil[0]);
        var oilPrev = parseFloat(oil[1]);
        if (!isFinite(oilPrev)) oilPrev = parseFloat(oil[8]);
        var oilEl = document.getElementById('finOil');
        if (oilEl && isFinite(oilCur)) {
          var oilClass = oilCur >= oilPrev ? 'fin-up' : 'fin-down';
          oilEl.innerHTML = '$' + oilCur.toFixed(2) + '/桶' + (isFinite(oilPrev) ? ' <span class="' + oilClass + '">' + fmtPct(oilCur, oilPrev) + '</span>' : '');
        }
      }
      if (data.raw) {
        var p = String(data.raw).split(',');
        var cur = parseFloat(p[0]);
        var prev = parseFloat(p[1]);
        var pct = fmtPct(cur, prev);
        var isUp = cur >= prev;
        var goldValue = document.getElementById('finGoldValue');
        var goldChange = document.getElementById('finGoldChange');
        if (goldValue && isFinite(cur)) goldValue.textContent = '$' + fmtVal(cur);
        if (goldChange && isFinite(cur) && isFinite(prev)) {
          goldChange.textContent = pct + ' · COMEX黄金 · 美元/盎司';
          goldChange.className = 'fin-change ' + (isUp ? 'fin-up' : 'fin-down');
        }
        var heroItems = document.querySelectorAll('.hero-fin-item');
        if (heroItems[1] && isFinite(cur) && isFinite(prev)) {
          heroItems[1].querySelector('.hero-fin-val').textContent = '$' + fmtVal(cur);
          var cls = isUp ? 'hero-fin-pct up' : 'hero-fin-pct down';
          heroItems[1].querySelector('.hero-fin-label').innerHTML = '黄金 <span class="' + cls + '">' + pct + '</span>';
        }
      }
    }).catch(function() {});
    setTimeout(function() {
      var analysis = document.getElementById('marketAnalysis');
      if (analysis && analysis.textContent && analysis.textContent.indexOf('GENERATING MARKET ANALYSIS') >= 0) {
        analysis.innerHTML = '<div class="market-analysis">' +
          '<div class="analysis-card animate-on-scroll visible"><div class="an-title">📊 市场快照（静态摘要）</div><ul class="an-list">' +
          '<li>CN MARKET 已完成数据获取，可通过卡片右侧时间戳确认更新时间。</li>' +
          '<li>US MARKET 与 PRECIOUS METALS 使用独立实时行情源。</li>' +
          '<li>AI 市场分析暂不可用，当前先展示静态摘要，避免页面一直处于加载状态。</li>' +
          '</ul></div></div>';
      }
    }, 5000);
  }, 1200);
});
