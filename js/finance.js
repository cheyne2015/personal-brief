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

  // ===== IMMEDIATE: render static analysis while dedicated market news loads =====
  renderStaticFinanceAnalysis(shCur, shPrev, goldCur, goldPrev, nxCur, nxPrev);
  if (finBadge) { finBadge.className = 'freshness-badge updating'; finBadge.innerHTML = '<span class="freshness-dot"></span>AI 分析中…'; }

  Promise.all([
    loadFinanceNewsContext(shouldBypassAICache()),
    loadFinanceMacroContext(shouldBypassAICache()),
    loadFinanceFlowContext(shouldBypassAICache())
  ]).then(function() {
    var financeContext = collectFinanceContext();
    // Compute data hash to detect quote and dedicated market-news changes.
    var dataHash = hashStr([shCur, shPrev, goldCur, goldPrev, nxCur||0, nxPrev||0, JSON.stringify(financeContext.marketNews || []), JSON.stringify(financeContext.macro || []), JSON.stringify(financeContext.flows || [])].join('|'));
    var finCached = getCachedAIEntry('finance');

    if (!shouldBypassAICache() && finCached && finCached.hash === dataHash && finCached.aiHtml) {
      clearFinanceAnalysisSlots();
      el.innerHTML = finCached.aiHtml;
      syncFinanceAnalysisLayout();
      if (finBadge) { finBadge.className = 'freshness-badge live'; finBadge.innerHTML = '<span class="freshness-dot"></span>AI 已更新 (缓存)'; }
      return;
    }

    // ===== BACKGROUND: upgrade to AI analysis (with 30s timeout) =====
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 30000);

    return fetch('/api/llm/finance-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shanghai: { cur: shCur, prev: shPrev },
        gold: { cur: goldCur, prev: goldPrev },
        nasdaq: { cur: nxCur || 0, prev: nxPrev || 0 },
        context: financeContext
      }),
      signal: controller.signal
    }).then(function(response) {
      clearTimeout(timeoutId);
      if (response.status === 429) {
        return response.json().then(function(data) {
          throw new Error('429: ' + (data.error || 'Rate limit exceeded'));
        });
      }
      if (!response.ok) throw new Error('API request failed');
      return response.json();
    }).then(function(data) {
      if (!data.success) throw new Error(data.error);
      var lines = data.analysis.split('\n').filter(function(l) { return l.trim(); });
      if (!financeAnalysisHasCausalDepth(lines)) {
        throw new Error('AI finance analysis is too price-only');
      }
      var generatedAt = Date.now();
      var html = buildFinanceAnalysisCards(data.analysis, true, generatedAt);
      clearFinanceAnalysisSlots();
      el.innerHTML = html;
      syncFinanceAnalysisLayout();
      setAICache({ finance: { hash: dataHash, aiHtml: html, timestamp: generatedAt } });
      if (finBadge) { finBadge.className = 'freshness-badge live'; finBadge.innerHTML = '<span class="freshness-dot"></span>AI 已更新'; }
    }).catch(function(error) {
      clearTimeout(timeoutId);
      console.error('AI finance analysis failed, keeping static:', error);
      if (finBadge) { finBadge.className = 'freshness-badge snapshot'; finBadge.innerHTML = '<span class="freshness-dot"></span>静态数据'; }
      if (error.message && error.message.indexOf('429') >= 0) {
        showRateLimitMessage(el, '金融市场 AI 分析请求已达每日上限（10 次/天）');
      }
    });
  }).catch(function(error) {
    console.error('Finance news context failed:', error);
    if (finBadge) { finBadge.className = 'freshness-badge snapshot'; finBadge.innerHTML = '<span class="freshness-dot"></span>市场新闻不足'; }
  });
}

function parseFinanceAnalysisSections(rawText) {
  var sections = [
    { key:'cn', title:'CN MARKET', icon:'CN', cls:'cn-market', lines:[] },
    { key:'us', title:'US MARKET', icon:'US', cls:'us-market', lines:[] },
    { key:'gold', title:'GOLD & CROSS ASSETS', icon:'CA', cls:'gold-market', lines:[] }
  ];
  var map = { '中国市场':'cn', 'A股':'cn', 'CN MARKET':'cn', '美股与科技':'us', '美股':'us', '纳斯达克':'us', 'US MARKET':'us', '黄金与跨资产':'gold', 'GOLD & CROSS ASSETS':'gold', '黄金':'gold', '贵金属':'gold' };
  var current = sections[0];
  String(rawText || '').split('\n').forEach(function(rawLine) {
    var line = rawLine.trim();
    if (!line) return;
    var heading = line.replace(/^\[|\]$/g, '').replace(/^#+\s*/, '').trim();
    Object.keys(map).some(function(label) {
      if (heading.indexOf(label) >= 0) {
        current = sections.find(function(section) { return section.key === map[label]; }) || current;
        return true;
      }
      return false;
    });
    if (/^\[.*\]$/.test(line) || /^#+\s*/.test(line)) return;
    var text = line.replace(/^[•·▪\-]\s*/, '').trim();
    if (text) current.lines.push(text);
  });
  return sections;
}

function syncFinanceAnalysisLayout() {
  var host = document.getElementById('marketAnalysis');
  if (!host) return;
  var deck = host.querySelector('.finance-analysis-grid');
  if (!deck) return;
  var isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  ['cn', 'us', 'gold'].forEach(function(key) {
    var card = document.querySelector('.finance-analysis-card[data-analysis-key="' + key + '"]');
    var slot = document.querySelector('.finance-card-analysis-slot[data-analysis-key="' + key + '"]');
    if (!card) return;
    if (isMobile && slot) {
      slot.appendChild(card);
    } else {
      deck.appendChild(card);
    }
  });
  deck.classList.toggle('mobile-attached', isMobile);
}

function clearFinanceAnalysisSlots() {
  document.querySelectorAll('.finance-card-analysis-slot').forEach(function(slot) {
    slot.innerHTML = '';
  });
}

window.addEventListener('resize', function() {
  clearTimeout(window.__financeAnalysisLayoutTimer);
  window.__financeAnalysisLayoutTimer = setTimeout(syncFinanceAnalysisLayout, 120);
});

function buildFinanceAnalysisCards(rawText, isAI, generatedAt) {
  var sections = parseFinanceAnalysisSections(rawText);
  var html = '<div class="market-analysis finance-analysis-grid' + (isAI ? ' ai-just-arrived' : '') + '">';
  sections.forEach(function(section) {
    html += '<div class="analysis-card finance-analysis-card ' + section.cls + ' animate-on-scroll visible" data-analysis-key="' + section.key + '">';
    html += '<div class="an-title">' + section.icon + ' ' + section.title + (isAI ? buildAITimestamp(generatedAt || Date.now()) : '') + '</div>';
    html += '<ul class="an-list">';
    (section.lines.length ? section.lines : ['暂无足够上下文形成可靠判断。']).slice(0, 3).forEach(function(line) {
      html += '<li>' + escapeHtml(line) + '</li>';
    });
    html += '</ul></div>';
  });
  html += '</div>';
  return html;
}

function financeAnalysisHasCausalDepth(lines) {
  var text = (lines || []).join(' ');
  var causalHits = ['因为', '原因', '反映', '说明', '驱动', '可能', '更像', '确认', '风险偏好', '避险', '利率', '美元', '政策', '情绪', '预期', '证据', '不足', '科技', 'AI', '地缘', '能源', '制裁', '航运', '消费']
    .filter(function(term) { return text.indexOf(term) >= 0; }).length;
  var priceOnlyHits = ['当前', '昨收', '较昨日', '较昨收', '收报', '跌幅', '涨幅'].filter(function(term) { return text.indexOf(term) >= 0; }).length;
  return causalHits >= 2 && priceOnlyHits <= 4;
}

function scoreFinanceMarketNews(item) {
  var bucket = item.bucket || item.category || '';
  var text = ((item.title || '') + ' ' + (item.summary || '')).toLowerCase();
  var keywordMap = {
    '中国市场': ['china stocks', 'a-shares', 'a shares', 'shanghai composite', 'csi 300', 'hong kong stocks', 'property', 'yuan', 'pboc', 'stimulus', 'tariff', '中国股市', 'a股', '上证', '沪深300', '人民币', '央行', '刺激'],
    '美股与科技': ['nasdaq', 'tech stocks', 'nvidia', 'ai stocks', 'fed', 'treasury yields', 'rates', 'semiconductor', 'chip', 'earnings', '纳斯达克', '科技股', '美联储', '美债', '利率', '半导体'],
    '黄金与跨资产': ['gold', 'bullion', 'dollar', 'treasury yields', 'safe haven', 'oil', 'crude', 'inflation', 'geopolitical', '黄金', '美元', '美债', '避险', '原油', '通胀', '地缘']
  };
  var direct = keywordMap[bucket] || [];
  var shared = ['market', 'stocks', 'shares', 'futures', 'price', 'prices', 'yield', 'yields', 'investors', '市场', '股市', '期货', '价格', '收益率', '投资者'];
  var score = 0;
  direct.forEach(function(term) { if (text.indexOf(term) >= 0) score += 3; });
  shared.forEach(function(term) { if (text.indexOf(term) >= 0) score += 1; });
  if (item.time && !isNaN(Date.parse(item.time)) && Date.now() - Date.parse(item.time) < 36 * 60 * 60 * 1000) score += 1;
  var copy = Object.assign({}, item);
  copy.relevanceScore = score;
  copy.evidenceLevel = score >= 5 ? 'direct' : (score >= 3 ? 'indirect' : 'weak');
  return copy;
}

function filterFinanceMarketNewsForAnalysis(items) {
  var scored = (Array.isArray(items) ? items : []).map(scoreFinanceMarketNews);
  var buckets = ['中国市场', '美股与科技', '黄金与跨资产'];
  var selected = [];
  buckets.forEach(function(bucket) {
    scored.filter(function(item) { return item.bucket === bucket && item.relevanceScore >= 3; })
      .sort(function(a, b) { return b.relevanceScore - a.relevanceScore; })
      .slice(0, 5)
      .forEach(function(item) { selected.push(item); });
  });
  return selected;
}

function collectFinanceContext() {
  var domestic = Array.isArray(window._domesticHotItems) ? window._domesticHotItems : [];
  var world = Array.isArray(window._worldFocusItems) ? window._worldFocusItems :
    (Array.isArray(window._worldHeadlines) ? window._worldHeadlines.map(function(title) { return { title:title }; }) : []);
  var ai = Array.isArray(window._aiNewsItems) ? window._aiNewsItems : [];
  var marketNews = Array.isArray(window._financeMarketNewsItems) ? window._financeMarketNewsItems : [];
  var macro = window._financeMacroContext && Array.isArray(window._financeMacroContext.indicators) ? window._financeMacroContext.indicators : [];
  var flows = window._financeFlowContext && Array.isArray(window._financeFlowContext.flows) ? window._financeFlowContext.flows : [];
  return {
    marketNews: filterFinanceMarketNewsForAnalysis(marketNews).slice(0, 15),
    backgroundNews: marketNews.slice(0, 12),
    macro: macro.slice(0, 8),
    flows: flows.slice(0, 8),
    domestic: domestic.slice(0, 10).map(function(item) {
      return {
        title: item.title || '',
        summary: item.summary || '',
        category: item.category || '',
        time: item.publishedAt || ''
      };
    }),
    world: world.slice(0, 16).map(function(item) {
      return {
        title: item.title || String(item || ''),
        category: item.category || '',
        time: item.pubDate || item.time || ''
      };
    }),
    ai: ai.slice(0, 8).map(function(item) {
      return { title:item.title || '', summary:item.summary || '', time:item.publishedAt || '' };
    })
  };
}

function formatCrossAssetValue(value, previous, options) {
  if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(previous)) || Number(previous) === 0) return '--';
  var pct = (Number(value) - Number(previous)) / Number(previous) * 100;
  var decimals = options && Number.isFinite(options.decimals) ? options.decimals : 2;
  var prefix = options && options.prefix ? options.prefix : '';
  var suffix = options && options.suffix ? options.suffix : '';
  var valueText = prefix + Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals }) + suffix;
  var cls = pct >= 0 ? 'fin-up' : 'fin-down';
  return valueText + ' <span class="' + cls + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%</span>';
}

function updateCrossAssetIndicators(data) {
  var indicators = data && Array.isArray(data.indicators) ? data.indicators : [];
  function find(id) { return indicators.find(function(item) { return item.id === id; }); }
  var btc = find('CBBTCUSD');
  var cny = find('DEXCHUS');
  var btcEl = document.getElementById('finBTC');
  if (btcEl && btc) {
    btcEl.innerHTML = formatCrossAssetValue(btc.value, btc.previous, { prefix:'$', decimals:0 });
  }
  var cnyEl = document.getElementById('finUSDCNY');
  if (cnyEl && cny) {
    cnyEl.innerHTML = formatCrossAssetValue(cny.value, cny.previous, { decimals:4 });
    cnyEl.title = 'USD/CNY 上升通常表示人民币相对美元走弱';
  }
}

function loadFinanceMacroContext(force) {
  if (!force && window._financeMacroContext && Array.isArray(window._financeMacroContext.indicators)) {
    return Promise.resolve(window._financeMacroContext);
  }
  var cached = apiCacheGet('finance_macro_context');
  if (!force && cached && cached.data && Array.isArray(cached.data.indicators) && Date.now() - cached.ts < 30 * 60 * 1000) {
    window._financeMacroContext = cached.data;
    return Promise.resolve(window._financeMacroContext);
  }
  return fetch('/api/llm/market/macro-context' + (force ? '?refresh=1' : ''))
    .then(function(response) {
      if (!response.ok) throw new Error('Macro context HTTP ' + response.status);
      return response.json();
    })
    .then(function(data) {
      if (!data || !data.success || !Array.isArray(data.indicators) || !data.indicators.length) {
        throw new Error('Macro context unavailable');
      }
      window._financeMacroContext = data;
      updateCrossAssetIndicators(data);
      apiCacheSet('finance_macro_context', data);
      return data;
    })
    .catch(function(error) {
      console.warn('Finance macro context failed:', error.message);
      if (cached && cached.data && Array.isArray(cached.data.indicators)) {
        window._financeMacroContext = cached.data;
        updateCrossAssetIndicators(cached.data);
        return window._financeMacroContext;
      }
      window._financeMacroContext = { success:false, indicators:[] };
      return window._financeMacroContext;
    });
}

function loadFinanceFlowContext(force) {
  if (!force && window._financeFlowContext && Array.isArray(window._financeFlowContext.flows)) {
    return Promise.resolve(window._financeFlowContext);
  }
  var cached = apiCacheGet('finance_flow_context');
  if (!force && cached && cached.data && Array.isArray(cached.data.flows) && Date.now() - cached.ts < 5 * 60 * 1000) {
    window._financeFlowContext = cached.data;
    return Promise.resolve(window._financeFlowContext);
  }
  return fetch('/api/llm/market/flow-context' + (force ? '?refresh=1' : ''))
    .then(function(response) {
      if (!response.ok) throw new Error('Flow context HTTP ' + response.status);
      return response.json();
    })
    .then(function(data) {
      if (!data || !data.success || !Array.isArray(data.flows) || !data.flows.length) {
        throw new Error('Flow context unavailable');
      }
      window._financeFlowContext = data;
      apiCacheSet('finance_flow_context', data);
      return data;
    })
    .catch(function(error) {
      console.warn('Finance flow context failed:', error.message);
      if (cached && cached.data && Array.isArray(cached.data.flows)) {
        window._financeFlowContext = cached.data;
        return window._financeFlowContext;
      }
      window._financeFlowContext = { success:false, flows:[] };
      return window._financeFlowContext;
    });
}

var FINANCE_RSS_SOURCES = [
  { bucket:'中国市场', url:'https://news.google.com/rss/search?q=(China%20stocks%20OR%20A-shares%20OR%20Shanghai%20Composite%20OR%20CSI%20300%20OR%20China%20equity%20market)%20when:2d&hl=en-US&gl=US&ceid=US:en' },
  { bucket:'美股与科技', url:'https://news.google.com/rss/search?q=(Nasdaq%20OR%20tech%20stocks%20OR%20AI%20stocks%20OR%20Nvidia%20OR%20Fed%20rates%20OR%20Treasury%20yields)%20when:2d&hl=en-US&gl=US&ceid=US:en' },
  { bucket:'黄金与跨资产', url:'https://news.google.com/rss/search?q=(gold%20price%20OR%20gold%20futures%20OR%20US%20dollar%20OR%20Treasury%20yields%20OR%20safe%20haven%20OR%20oil%20prices)%20when:2d&hl=en-US&gl=US&ceid=US:en' }
];

function financeStripHtml(html) {
  var div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

function loadFinanceNewsContext(force) {
  if (!force && Array.isArray(window._financeMarketNewsItems) && window._financeMarketNewsItems.length) {
    return Promise.resolve(window._financeMarketNewsItems);
  }
  var cached = apiCacheGet('finance_market_news');
  if (!force && cached && cached.data && Array.isArray(cached.data.items) && Date.now() - cached.ts < 15 * 60 * 1000) {
    window._financeMarketNewsItems = cached.data.items;
    return Promise.resolve(window._financeMarketNewsItems);
  }
  return Promise.all(FINANCE_RSS_SOURCES.map(function(source) {
    return fetch('/api/llm/rss-proxy?url=' + encodeURIComponent(source.url))
      .then(function(response) { if (!response.ok) throw new Error('Finance RSS HTTP ' + response.status); return response.text(); })
      .then(function(xml) {
        var doc = new DOMParser().parseFromString(xml, 'application/xml');
        return Array.from(doc.querySelectorAll('item')).slice(0, 8).map(function(item) {
          var title = item.querySelector('title');
          var desc = item.querySelector('description');
          var link = item.querySelector('link');
          var pubDate = item.querySelector('pubDate');
          var publisher = item.querySelector('source');
          return {
            bucket: source.bucket,
            title: title ? title.textContent : '',
            summary: financeStripHtml(desc ? desc.textContent : '').slice(0, 220),
            url: link ? link.textContent : '',
            time: pubDate ? pubDate.textContent : '',
            source: publisher ? publisher.textContent : 'Google News'
          };
        }).filter(function(item) { return item.title; });
      }).catch(function(error) {
        console.warn('Finance RSS failed:', source.bucket, error.message);
        return [];
      });
  })).then(function(groups) {
    var seen = {};
    var items = [];
    groups.forEach(function(group) {
      group.forEach(function(item) {
        var key = item.title.toLowerCase().replace(/\s+-\s+[^-]+$/, '').replace(/\s+/g, ' ').trim();
        if (seen[key]) return;
        seen[key] = true;
        items.push(item);
      });
    });
    if (!items.length && cached && cached.data && Array.isArray(cached.data.items)) {
      items = cached.data.items;
    }
    window._financeMarketNewsItems = items.slice(0, 24);
    apiCacheSet('finance_market_news', { items: window._financeMarketNewsItems });
    return window._financeMarketNewsItems;
  });
}

/* Static fallback for finance analysis */
function renderStaticFinanceAnalysis(shCur, shPrev, goldCur, goldPrev, nxCur, nxPrev) {
  var el = document.getElementById('marketAnalysis'); 
  if (!el) return;
  function pct(cur, prev) {
    return (cur - prev) / prev * 100;
  }
  function direction(cur, prev) {
    var p = pct(cur, prev);
    if (Math.abs(p) < 0.1) return '接近平盘，方向信号不强';
    return p > 0 ? '上涨 ' + Math.abs(p).toFixed(2) + '%' : '下跌 ' + Math.abs(p).toFixed(2) + '%';
  }
  function likelyReason(name, cur, prev, type) {
    var p = pct(cur, prev);
    if (Math.abs(p) < 0.1) return name + '接近平盘，更像是资金在等待新的宏观或政策信号，暂不宜过度解读单日波动。';
    if (type === 'cn') return name + direction(cur, prev) + '，可能反映国内权益风险偏好变化，具体还需结合成交量、行业涨跌和政策消息确认。';
    if (type === 'us') return name + direction(cur, prev) + '，通常与科技股风险偏好、利率预期和大型成长股表现有关，需继续看美债与美元走势。';
    return name + direction(cur, prev) + '，可能对应避险需求、美元利率预期或通胀交易变化，单日价格不能直接归因到某一事件。';
  }
  function relation() {
    var sh = pct(shCur, shPrev), nx = pct(nxCur, nxPrev), gold = pct(goldCur, goldPrev);
    if (gold > 0.2 && (sh < 0 || nx < 0)) return '黄金强于股指，说明市场可能在增加避险或通胀对冲需求，风险资产承压信号更值得跟踪。';
    if (gold < -0.2 && (sh > 0 || nx > 0)) return '股指强于黄金，更像风险偏好回升，但仍需看美元、利率和后续新闻验证。';
    return '三类资产方向分化不强，当前更适合观察后续新闻与成交确认，避免仅凭单日涨跌下结论。';
  }
  var raw = [
    '[CN MARKET]',
    '• ' + likelyReason('上证指数', shCur, shPrev, 'cn'),
    '• 国内热点与行业结构仍是判断 A 股原因的关键，当前静态判断只作为等待 AI 深度分析前的参考。',
    '[US MARKET]',
    '• ' + likelyReason('纳斯达克', nxCur, nxPrev, 'us'),
    '• 科技股方向还要结合 AI 新闻、利率预期与大型成长股风险偏好确认。',
    '[GOLD & CROSS ASSETS]',
    '• ' + likelyReason('COMEX黄金', goldCur, goldPrev, 'gold'),
    '• ' + relation() + ' 仅为行情归因参考，不构成投资建议。'
  ].join('\n');
  clearFinanceAnalysisSlots();
  el.innerHTML = buildFinanceAnalysisCards(raw, false);
  syncFinanceAnalysisLayout();
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
      var shGoldEl = document.getElementById('finShGold');
      if (data.shGoldRaw) {
        var sh = String(data.shGoldRaw).split(',');
        var shPrice = sh.length > 3 ? parseFloat(sh[3]) : NaN;
        if (shGoldEl && isFinite(shPrice)) {
          shGoldEl.textContent = '¥' + shPrice.toFixed(2) + '/克';
          shGoldEl.title = [data.shGoldSource || '上海黄金交易所', 'Au99.99', data.shGoldTimestamp].filter(Boolean).join(' · ');
        } else if (shGoldEl) {
          shGoldEl.textContent = '暂无数据';
        }
      } else if (shGoldEl) {
        shGoldEl.textContent = '暂无数据';
        shGoldEl.title = '上海黄金交易所行情暂不可用';
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
