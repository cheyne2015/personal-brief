'use strict';

/* ===== World News HTML Builder ===== */
function buildWorldNewsHTML(displayed, aiHtml) {
  var breaking = displayed[0];
  var html = (aiHtml || '');
  
  if (breaking) {
    html += '<div class="world-breaking animate-on-scroll visible">';
    html += '<span class="tag">⚡ ' + escapeHtml(breaking.category) + '</span>';
    if (breaking.pubDate) html += '<span style="font-size:0.72rem;color:var(--text-muted);margin-left:8px;">🕐 ' + fmtPubDate(breaking.pubDate) + '</span>';
    html += '<p><strong>' + escapeHtml(breaking.title) + '</strong>';
    if (breaking.titleEn && breaking.titleEn !== breaking.title) {
      html += ' <small style="opacity:0.55;font-weight:400;">(' + escapeHtml(breaking.titleEn) + ')</small>';
    }
    html += '<br>' + escapeHtml(breaking.desc.slice(0, 200)) + (breaking.desc.length>200?'…':'') + '</p>';
    html += '<a href="' + escapeHtml(safeExternalUrl(breaking.link)) + '" class="card-action" target="_blank" rel="noopener noreferrer">阅读原文 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>';
    html += '</div>';
  }
  html += '<div class="world-grid">';
  displayed.forEach(function(item) {
    var icons = {'(Nuclear) War':'🔴','Global Governance Failure':'🌐','Existential Threats':'⚠️','Planet & Climate':'🌍','Human Development':'🏛️','Science & Technology':'🔬'};
    var icon = Object.entries(icons).find(function(e){return item.category.indexOf(e[0])>=0;});
    icon = icon ? icon[1] : '📰';
    html += '<div class="world-card animate-on-scroll visible">';
    html += '<h4>' + icon + ' ' + escapeHtml(item.title);
    if (item.titleEn && item.titleEn !== item.title) {
      html += ' <small style="display:block;opacity:0.55;font-weight:400;font-size:0.82em;margin-top:2px;">' + escapeHtml(item.titleEn) + '</small>';
    }
    html += '</h4>';
    html += '<div class="news-meta">';
    html += '<span class="news-source-tag">' + escapeHtml(item.category) + '</span>';
    if (item.pubDate) html += '<span class="news-pub-time">' + fmtPubDate(item.pubDate) + '</span>';
    html += '</div>';
    html += '<p>' + escapeHtml(item.desc.slice(0, 250)) + (item.desc.length>250?'…':'') + '</p>';
    html += '<a href="' + escapeHtml(safeExternalUrl(item.link)) + '" class="card-action" target="_blank" rel="noopener noreferrer">阅读原文 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 012-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

/* ===== Multi-source RSS fetcher with fallback ===== */
var WORLD_RSS_SOURCES = [
  'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=(war%20OR%20ceasefire%20OR%20treaty%20OR%20summit%20OR%20sanctions%20OR%20election)%20when:1d&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=(earthquake%20OR%20disaster%20OR%20attack%20OR%20coup%20OR%20assassination%20OR%20emergency)%20when:1d&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=(tariff%20OR%20central%20bank%20OR%20recession%20OR%20oil%20OR%20trade%20agreement)%20when:1d&hl=en-US&gl=US&ceid=US:en',
  'https://actually-relevant-api.onrender.com/api/feed'
];

function stripHtml(html) {
  var div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

function fetchWorldNewsRSS() {
  return Promise.all(WORLD_RSS_SOURCES.map(function(url, index) {
    return fetch('/api/llm/rss-proxy?url=' + encodeURIComponent(url))
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function(text) { return { text:text, sourceIdx:index }; })
      .catch(function() { return null; });
  })).then(function(results) {
    var serializer = new XMLSerializer();
    var seen = {};
    var serializedItems = [];
    results.filter(Boolean).forEach(function(result) {
      var doc = new DOMParser().parseFromString(result.text, 'text/xml');
      Array.from(doc.querySelectorAll('item')).slice(0, 30).forEach(function(item) {
        var titleEl = item.querySelector('title');
        var key = titleEl ? titleEl.textContent.toLowerCase().replace(/\s+/g, ' ').trim() : '';
        if (!key || seen[key]) return;
        seen[key] = true;
        serializedItems.push(serializer.serializeToString(item));
      });
    });
    if (!serializedItems.length) throw new Error('All RSS sources exhausted');
    return { text:'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Aggregated World Intelligence</title>' + serializedItems.join('') + '</channel></rss>', sourceIdx:-1 };
  });
}

/* ===== World News Rendering (cache-first: show cached or raw data, upgrade in background) ===== */
function renderWorldNews(rssText) {
  var container = document.getElementById('worldContainer');
  var badge = document.getElementById('worldFreshBadge');
  if (!container) return;

  try {
    var parser = new DOMParser();
    var doc = parser.parseFromString(rssText, 'application/xml');
    var items = doc.querySelectorAll('item');
    if (!items || items.length === 0) throw new Error('No items in RSS');

    // Auto-detect: Google News RSS uses <source> for publisher, not <category>
    var hasSource = items[0] && items[0].querySelector('source');
    var hasCategory = items[0] && items[0].querySelector('category');
    var isGNews = hasSource && !hasCategory;

    var newsItems = [];
    items.forEach(function(item) {
      // Guard: skip items missing required RSS elements (can happen with error pages)
      var titleEl = item.querySelector('title');
      var linkEl = item.querySelector('link');
      var descEl = item.querySelector('description');
      if (!titleEl || !descEl) return;  // skip malformed items

      var title = titleEl.textContent;
      var link = linkEl ? linkEl.textContent : '#';
      var descRaw = descEl.textContent;
      var pubDate = item.querySelector('pubDate');
      var pubDateStr = pubDate ? pubDate.textContent : '';

      // Google News: use <source> as publisher name; strip HTML from description
      var category = 'World';
      var srcEl = item.querySelector('source');
      if (srcEl) {
        category = srcEl ? srcEl.textContent : 'World';
        descRaw = stripHtml(descRaw);
      } else {
        var cat = item.querySelector('category');
        if (cat) category = cat.textContent;
      }

      newsItems.push({title:title, link:link, desc:descRaw, pubDate:pubDateStr, category:category});
    });

    // Guard: all items were malformed (e.g., error page parsed as XML)
    if (!newsItems.length) throw new Error('No valid news items in response');

    var priorityTerms = [
      ['ceasefire', 14], ['peace deal', 14], ['treaty', 13], ['agreement', 11], ['memorandum', 11],
      ['declares war', 14], ['invasion', 13], ['war', 10], ['nuclear', 12], ['missile', 10], ['strike', 10],
      ['sanction', 9], ['military', 8], ['attack', 10], ['assassination', 14], ['coup', 13],
      ['election', 10], ['resign', 10], ['summit', 9], ['tariff', 9], ['central bank', 9],
      ['earthquake', 12], ['tsunami', 13], ['disaster', 11], ['emergency', 9], ['evacuat', 9],
      ['停火', 14], ['和平协议', 14], ['条约', 13], ['协议', 11], ['战争', 10], ['核', 12],
      ['导弹', 10], ['袭击', 10], ['制裁', 9], ['军事', 8], ['选举', 10], ['峰会', 9],
      ['关税', 9], ['央行', 9], ['地震', 12], ['海啸', 13], ['灾难', 11], ['紧急状态', 9]
    ];
    var eventStopWords = { the:1, a:1, an:1, and:1, or:1, of:1, to:1, in:1, on:1, for:1, from:1, with:1, at:1, by:1, as:1, is:1, are:1, was:1, were:1, be:1, has:1, have:1, had:1, says:1, said:1, after:1, before:1, over:1, amid:1, new:1, latest:1, live:1, update:1, president:1, minister:1, government:1, world:1 };
    function eventTokens(item) {
      return (item.title || '').toLowerCase().replace(/\s+-\s+[^-]+$/, '').replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').split(/\s+/)
        .filter(function(token) { return token.length > 2 && !eventStopWords[token]; });
    }
    function relatedWorldEvent(a, b) {
      var left = eventTokens(a), right = eventTokens(b), rightSet = {};
      right.forEach(function(token) { rightSet[token] = true; });
      var shared = left.filter(function(token) { return rightSet[token]; }).length;
      return shared >= 2 && shared / Math.max(3, Math.min(left.length, right.length)) >= 0.28;
    }
    function worldCategory(item) {
      var text = (item.title || '').toLowerCase();
      if (/earthquake|tsunami|flood|wildfire|hurricane|disaster|emergency|evacuat/.test(text)) return 'disaster';
      if (/central bank|tariff|trade|oil|market|recession|inflation|econom/.test(text)) return 'economy';
      if (/election|vote|resign|coup|parliament|government/.test(text)) return 'politics';
      if (/agreement|ceasefire|treaty|summit|diploma|memorandum|peace/.test(text)) return 'diplomacy';
      if (/war|military|attack|missile|nuclear|strike|sanction|conflict/.test(text)) return 'security';
      return 'other';
    }
    function worldPriorityScore(item) {
      var text = ((item.title || '') + ' ' + (item.category || '')).toLowerCase();
      var termScore = priorityTerms.reduce(function(score, pair) { return score + (text.indexOf(pair[0]) >= 0 ? pair[1] : 0); }, 0);
      var consensus = newsItems.filter(function(other) { return other !== item && relatedWorldEvent(item, other); }).length;
      var ageHours = Math.max(0, (Date.now() - new Date(item.pubDate).getTime()) / 3600000);
      var recency = isFinite(ageHours) ? Math.max(0, 6 - ageHours / 4) : 0;
      return termScore + Math.min(consensus, 4) * 6 + recency;
    }
    newsItems.sort(function(a, b) {
      var scoreDiff = worldPriorityScore(b) - worldPriorityScore(a);
      if (scoreDiff) return scoreDiff;
      return new Date(b.pubDate) - new Date(a.pubDate);
    });

    var diverseNews = [];
    var categoryCounts = {};
    newsItems.forEach(function(item) {
      if (diverseNews.length >= 20) return;
      var sameEventCount = diverseNews.filter(function(selected) { return relatedWorldEvent(item, selected); }).length;
      if (sameEventCount >= 2) return;
      var category = worldCategory(item);
      if (diverseNews.length < 8 && (categoryCounts[category] || 0) >= (category === 'other' ? 1 : 3)) return;
      diverseNews.push(item);
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });

    var displayed = diverseNews.slice(0, 8);
    var origTitles = displayed.map(function(item) { return item.title; });
    var origDescs = displayed.map(function(item) { return item.desc; });
    window._worldHeadlines = diverseNews.slice(0, 20).map(function(item) { return item.title; });

    // Compute content hash from titles
    var worldHash = hashStr(origTitles.slice().sort().join('|||'));

    // ===== CACHE HIT: render cached news + analysis + myFocus =====
    var worldCached = getCachedAIEntry('world');
    if (!forceRefresh && worldCached && worldCached.hash === worldHash) {
      if (worldCached.newsHtml) container.innerHTML = worldCached.newsHtml;
      if (worldCached.analysisHtml) {
        var analysisEl = ensureWorldAnalysisEl(container);
        analysisEl.innerHTML = worldCached.analysisHtml;
      }
      renderMyFocusAnalysis(window._worldHeadlines);
      if (badge) { badge.className = 'freshness-badge live'; badge.innerHTML = '<span class="freshness-dot"></span>已翻译 (缓存)'; }
      return;
    }

    // Save worldHash for background upgrade to use
    window._worldHash = worldHash;

    // ===== IMMEDIATE: render raw English news =====
    displayed.forEach(function(item) { item.titleEn = item.title; item.descEn = item.desc; });
    container.innerHTML = buildWorldNewsHTML(displayed, '');
    if (badge) { badge.className = 'freshness-badge updating'; badge.innerHTML = '<span class="freshness-dot"></span>翻译中…'; }

    // ===== BACKGROUND: upgrade with translation + AI =====
    upgradeWorldNews(container, badge, displayed, origTitles, origDescs);

    // AI analysis runs in background too
    renderWorldNewsAnalysis(displayed);

    // "我关注的国际局势" — 已移至 initAutoLoad 独立调用，不依赖此处

  } catch(e) {
    console.error('World news parse error:', e);
    container.innerHTML = '<div class="empty-section" style="padding:40px;color:var(--red);">⚠️ 国际局势加载失败：' + e.message + '</div>';
    if (badge) { badge.className = 'freshness-badge snapshot'; badge.innerHTML = '<span class="freshness-dot"></span>加载失败'; }
  }
}

/* Ensure worldAnalysis element exists, insert after "我的关注" */
function ensureWorldAnalysisEl(worldContainer) {
  var analysisEl = document.getElementById('worldAnalysis');
  if (!analysisEl) {
    analysisEl = document.createElement('div');
    analysisEl.id = 'worldAnalysis';
    analysisEl.className = 'world-analysis';
    var focusEl = document.getElementById('worldMyFocus');
    if (focusEl && focusEl.parentNode) focusEl.parentNode.insertBefore(analysisEl, focusEl.nextSibling);
    else if (worldContainer) worldContainer.parentNode.insertBefore(analysisEl, worldContainer.nextSibling);
  }
  return analysisEl;
}

/* Ensure worldMyFocus element exists, insert before worldAnalysis */
function ensureWorldMyFocusEl(worldContainer) {
  var focusEl = document.getElementById('worldMyFocus');
  if (!focusEl) {
    focusEl = document.createElement('div');
    focusEl.id = 'worldMyFocus';
    focusEl.className = 'world-my-focus';
    var analysisEl = document.getElementById('worldAnalysis');
    if (analysisEl && analysisEl.parentNode) {
      analysisEl.parentNode.insertBefore(focusEl, analysisEl);
    } else if (worldContainer && worldContainer.parentNode) {
      worldContainer.parentNode.insertBefore(focusEl, worldContainer.nextSibling);
    }
  } else {
    var existingAnalysisEl = document.getElementById('worldAnalysis');
    if (existingAnalysisEl && existingAnalysisEl.parentNode && (focusEl.compareDocumentPosition(existingAnalysisEl) & Node.DOCUMENT_POSITION_PRECEDING)) {
      existingAnalysisEl.parentNode.insertBefore(focusEl, existingAnalysisEl);
    }
  }
  return focusEl;
}

/* Background upgrades: translate → AI generate → update UI */
async function upgradeWorldNews(container, badge, displayed, origTitles, origDescs) {
  var translatedTitles = false;
  var translatedDescs = false;

  // Translate titles
  try {
    var titleResp = await fetch('/api/llm/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: origTitles })
    });
    if (titleResp.ok) {
      var td = await titleResp.json();
      if (td.success && td.translations) {
        displayed.forEach(function(item, idx) {
          item.title = td.translations[idx] || item.title;
        });
        translatedTitles = true;
      }
    }
  } catch(e) { console.error('Title translation failed:', e); }

  // Translate descriptions
  try {
    var descResp = await fetch('/api/llm/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: origDescs })
    });
    if (descResp.ok) {
      var dd = await descResp.json();
      if (dd.success && dd.translations) {
        displayed.forEach(function(item, idx) {
          item.desc = dd.translations[idx] || item.desc;
        });
        translatedDescs = true;
      }
    }
  } catch(e) { console.error('Description translation failed:', e); }

  // Update UI with translations (no AI news generation)
  if (translatedTitles || translatedDescs) {
    container.innerHTML = buildWorldNewsHTML(displayed, '');
  }
  if (badge) { badge.className = 'freshness-badge live'; badge.innerHTML = '<span class="freshness-dot"></span>已翻译'; }

  // Generate focus cards from translated titles so card headings are Chinese.
  renderMyFocusAnalysis(displayed.map(function(item) { return item.title; }));

  // Save world news (translations only) to cache
  var wh = window._worldHash;
  if (wh) {
    var cache = getAICache();
    var entry = cache.world || {};
    entry.hash = wh;
    entry.newsHtml = buildWorldNewsHTML(displayed, '');
    entry.timestamp = Date.now();
    setAICache({ world: entry });
  }
}

/* AI 分析国际局势 (only called when cache missed, saves result to cache) */
async function renderWorldNewsAnalysis(newsItems) {
  var analysisEl = ensureWorldAnalysisEl(document.getElementById('worldContainer'));

  // Show loading
  analysisEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);">🤖 AI 正在分析国际局势…</div>';

  try {
    var headlines = newsItems.map(function(item) { return item.title; });

    var response = await fetch('/api/llm/world-news-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headlines: headlines })
    });

    if (!response.ok) throw new Error('API request failed');

    var data = await response.json();
    if (!data.success) throw new Error(data.error);

    // Render AI-generated analysis
    var lines = data.analysis.split('\n').filter(function(l) { return l.trim(); });
    var html = '<div class="analysis-card animate-on-scroll visible" style="margin-top:24px;background:linear-gradient(135deg, var(--clr-world-bg), var(--clr-product-bg));border:1px solid var(--r-glow);">';
    html += '<div class="an-title">🌍 国际局势分析（AI 生成）</div><ul class="an-list">';
    lines.forEach(function(line) {
      var text = line.replace(/^[•·▪]/, '').trim();
      if (text) html += '<li>' + escapeHtml(text) + '</li>';
    });
    html += '</ul></div>';
    analysisEl.innerHTML = html;

    // Save analysis to world cache entry
    var wh = window._worldHash;
    if (wh) {
      var cache = getAICache();
      var entry = cache.world || {};
      entry.hash = wh;
      entry.analysisHtml = html;
      entry.timestamp = Date.now();
      setAICache({ world: entry });
    }

  } catch (error) {
    console.error('AI world news analysis failed, falling back to static:', error);
    renderStaticWorldNewsAnalysis(newsItems);
  }
}

/* Static fallback for world news analysis */
function renderStaticWorldNewsAnalysis(newsItems) {
  var analysisEl = ensureWorldAnalysisEl(document.getElementById('worldContainer'));

  var html = '<div class="analysis-card animate-on-scroll visible" style="margin-top:24px;background:var(--clr-world-bg);border:1px solid var(--r-border);">';
  html += '<div class="an-title">🌍 关键国际标题（AI 暂不可用）</div><ul class="an-list">';
  newsItems.slice(0, 4).forEach(function(item) { html += '<li>' + escapeHtml(item.title || '') + '</li>'; });
  html += '</ul></div>';
  analysisEl.innerHTML = html;
}

/* "我的关注" — 从已核验的国际新闻标题中提取高影响事件 */
async function renderMyFocusAnalysis(headlines) {
  var focusEl = ensureWorldMyFocusEl(document.getElementById('worldContainer'));
  headlines = Array.isArray(headlines) ? headlines.filter(Boolean).slice(0, 20) : [];
  if (!headlines.length) return;
  var focusHash = hashStr('zh-title-v2|||' + headlines.join('|||'));

  // Check cache first — if valid cache exists, show it and skip fetch
  var cached = getCachedAIEntry('myFocus');
  if (!forceRefresh && cached && cached.dateKey === todayStr() && cached.hash === focusHash) {
    focusEl.innerHTML = cached.html;
    return;
  }

  // Show loading state
  focusEl.innerHTML = '<div class="my-focus-section" style="margin-top:24px;">' +
    '<div class="my-focus-title">' +
    '🎯 我的关注 <span class="badge-tag">✨ AI 精选</span></div>' +
    '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;color:var(--text-muted);font-size:0.9rem;">' +
    '<div class="spinner" style="width:20px;height:20px;border:3px solid var(--border);border-top-color:var(--amber);border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
    'AI 正在生成美军相关重大动态…</div></div>';

  try {
    var response = await fetch('/api/llm/my-focus-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headlines: headlines })
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);

    var data = await response.json();
    if (!data.success) throw new Error(data.error);

    // Parse AI response into event cards
    var raw = data.analysis.trim();
    if (/暂无(符合关注条件的)?重大事件|暂无美军/.test(raw)) {
      // No relevant events found — don't show anything
      focusEl.innerHTML = '';
      return;
    }

    var blocks = raw.split('---').filter(function(b) { return b.trim(); });
    if (blocks.length === 0) { focusEl.innerHTML = ''; return; }

    var html = '<div class="my-focus-section ai-just-arrived" style="margin-top:24px;">';
    html += '<div class="my-focus-title">';
    html += '🎯 我的关注 <span class="badge-tag">✨ AI 精选</span></div>';

    blocks.forEach(function(block) {
      var lines = block.trim().split('\n').filter(function(l) { return l.trim(); });
      if (lines.length < 2) return;
      // Parse title and content
      var title = lines[0].replace(/^🔴\s*/, '').trim();
      var desc = '';
      var reason = '';
      for (var i = 1; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('📋') === 0) {
          desc = line.replace(/^📋\s*(事件简述[：:]?\s*)?/, '').trim();
        } else if (line.indexOf('🎯') === 0) {
          reason = line.replace(/^🎯\s*(关注原因[：:]?\s*)?/, '').trim();
        } else if (line.indexOf('事件简述') >= 0 || line.indexOf('关注原因') >= 0) {
          // skip header-only lines
        } else if (desc && !reason) {
          reason = line;
        } else if (!desc) {
          desc = line;
        } else {
          reason = line;
        }
      }

      html += '<div class="focus-event-card">';
      html += '<div class="fe-title">🔴 ' + escapeHtml(title) + '</div>';
      if (desc) html += '<div class="fe-desc"><span class="fe-label">📋 事件简述：</span>' + escapeHtml(desc) + '</div>';
      if (reason) html += '<div class="fe-reason"><span class="reason-label">🎯 关注原因：</span>' + escapeHtml(reason) + '</div>';
      html += '</div>';
    });

    html += '</div>';
    focusEl.innerHTML = html;

    // Save myFocus to independent date-keyed cache (not tied to world news)
    var dk = data.dateKey || todayStr();
    setAICache({ myFocus: { dateKey: dk, hash: focusHash, html: html } });

  } catch (error) {
    console.error('My focus analysis failed:', error);
    // Show brief error instead of hiding completely
    focusEl.innerHTML = '<div class="my-focus-section" style="margin-top:24px;">' +
      '<div class="my-focus-title">' +
      '🎯 我的关注 <span class="badge-tag">✨ AI 精选</span></div>' +
      '<div style="color:var(--text-muted);font-size:0.85rem;padding:12px 0;">⚠️ 加载失败，请稍后刷新重试</div></div>';
  }
}

