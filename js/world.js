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
  'https://news.google.com/rss/search?q=(peace%20deal%20OR%20framework%20agreement%20OR%20memorandum%20of%20understanding%20OR%20signed%20agreement%20OR%20diplomatic%20breakthrough%20OR%20hostage%20deal)%20when:1d&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=(export%20controls%20OR%20chips%20OR%20semiconductor%20OR%20rare%20earth%20OR%20shipping%20OR%20supply%20chain)%20when:1d&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=(Pentagon%20OR%20%22US%20military%22%20OR%20%22US%20forces%22%20OR%20%22American%20troops%22%20OR%20%22US%20Navy%22%20OR%20%22US%20Air%20Force%22%20OR%20%22US%20Army%22%20OR%20USS%20OR%20carrier)%20when:3d&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=(%22US%20troops%22%20OR%20%22US%20base%22%20OR%20%22military%20exercise%22%20OR%20%22joint%20drills%22%20OR%20deployment%20OR%20airstrike%20OR%20%22security%20assistance%22%20OR%20%22arms%20shipment%22)%20when:3d&hl=en-US&gl=US&ceid=US:en',
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
    function isUSMilitaryEvent(item) {
      var text = ((item.title || '') + ' ' + (item.desc || '') + ' ' + (item.category || '')).toLowerCase();
      var hasUS = /(^|\W)(u\.s\.|us|united states|american|pentagon|white house|biden|trump)($|\W)/.test(text);
      var hasMilitary = /military|troops|forces|navy|air force|army|marines|pentagon|carrier|uss |base|deployment|deployed|drill|exercise|airstrike|strike|missile|weapons|arms shipment|security assistance|defense aid|joint patrol|warship|fighter jet|bomber|drone/.test(text);
      var excludeCivil = /tariff|trade deal|election|court|immigration|student visa|lawsuit|campaign|congressional race|stock market/.test(text) && !hasMilitary;
      return hasMilitary && (hasUS || /pentagon|uss |us navy|us air force|us army|american troops/.test(text)) && !excludeCivil;
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
    window._worldDisplayedHeadlines = origTitles.slice();
    var focusSeen = {};
    var focusCandidates = diverseNews.slice(8, 24).concat(newsItems.slice(0, 60)).filter(function(item) {
      if (!item || !item.title) return false;
      if (displayed.some(function(shown) { return relatedWorldEvent(item, shown); })) return false;
      var key = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
      if (focusSeen[key]) return false;
      focusSeen[key] = true;
      return true;
    });
    var militaryFocus = focusCandidates.filter(function(item) { return isUSMilitaryEvent(item); });
    var macroFocus = focusCandidates.filter(function(item) { return !isUSMilitaryEvent(item); });
    var orderedFocus = macroFocus.slice(0, 24).concat(militaryFocus.slice(0, 24));
    focusCandidates.forEach(function(item) {
      if (orderedFocus.length >= 48) return;
      if (orderedFocus.indexOf(item) < 0) orderedFocus.push(item);
    });
    window._worldFocusItems = orderedFocus.slice(0, 48).map(function(item) {
      return { title:item.title, pubDate:item.pubDate || '', category:item.category || '', desc:item.desc || '', link:item.link || '', track:isUSMilitaryEvent(item) ? '美国态势' : '宏观风险' };
    });
    window._worldFocusHeadlines = window._worldFocusItems.map(function(item) { return item.title; });

    // Compute content hash from titles
    var worldHash = hashStr(origTitles.slice().sort().join('|||'));

    // ===== CACHE HIT: render cached news + analysis + myFocus =====
    var worldCached = getCachedAIEntry('world');
    if (!shouldBypassAICache() && worldCached && worldCached.hash === worldHash && worldCached.translationComplete) {
      if (worldCached.newsHtml) container.innerHTML = worldCached.newsHtml;
      if (worldCached.analysisHtml) {
        var analysisEl = ensureWorldAnalysisEl(container);
        analysisEl.innerHTML = worldCached.analysisHtml;
      }
      renderMyFocusAnalysis(window._worldFocusItems, displayed);
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

    // Generate My Focus immediately from verified RSS candidates; translation is not a prerequisite.
    renderMyFocusAnalysis(window._worldFocusItems, displayed);

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

function normalizeEventText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u{1f300}-\u{1faff}]/gu, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function eventTextTokens(text) {
  var stop = {
    the:1, and:1, for:1, with:1, from:1, into:1, after:1, before:1, this:1, that:1,
    says:1, said:1, will:1, over:1, amid:1, about:1, latest:1, news:1,
    可能:1, 全球:1, 影响:1, 关注:1, 原因:1, 事件:1, 新闻:1, 运输:1, 市场:1
  };
  return normalizeEventText(text).split(/\s+/).filter(function(token) {
    return token.length > 1 && !stop[token];
  });
}

function eventTextSimilarity(leftText, rightText) {
  var left = Array.isArray(rightText) ? eventTextTokens(leftText) : eventTextTokens(leftText);
  var right = Array.isArray(rightText) ? rightText : eventTextTokens(rightText);
  if (!left.length || !right.length) return 0;
  var rightSet = {};
  right.forEach(function(token) { rightSet[token] = true; });
  var shared = left.filter(function(token) { return rightSet[token]; }).length;
  return shared / Math.max(3, Math.min(left.length, right.length));
}

function isDuplicateWorldCandidate(item, shownItems) {
  var candidateText = [item.title, item.desc, item.category].join(' ');
  return (shownItems || []).some(function(shown) {
    var shownText = [shown.title, shown.titleEn, shown.desc, shown.descEn, shown.category].join(' ');
    return eventTextSimilarity(candidateText, shownText) >= 0.24 || eventTextSimilarity(shownText, candidateText) >= 0.24;
  });
}

function formatFocusEventTime(value) {
  if (!value) return '';
  var text = String(value).trim();
  if (!text || text === '未知') return text || '';
  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return fmtPubDate(text);
  return text;
}

function focusSourceName(item) {
  var title = String(item && item.title || '');
  var match = title.match(/\s+-\s+([^-]{2,80})$/);
  return String(item && item.category || (match ? match[1] : '') || '来源').trim();
}

function focusEventKeyText(item) {
  return [
    String(item && item.title || '').replace(/\s+-\s+[^-]{2,80}$/, ''),
    item && item.desc || ''
  ].join(' ');
}

function isSameFocusEvent(a, b) {
  var aText = focusEventKeyText(a);
  var bText = focusEventKeyText(b);
  return eventTextSimilarity(aText, bText) >= 0.32 || eventTextSimilarity(bText, aText) >= 0.32;
}

function clusterFocusCandidates(items) {
  var clusters = [];
  (items || []).forEach(function(item) {
    var found = clusters.find(function(cluster) { return isSameFocusEvent(item, cluster.main); });
    if (!found) {
      found = { main:Object.assign({}, item), sources:[] };
      clusters.push(found);
    }
    found.sources.push(Object.assign({}, item, { sourceName:focusSourceName(item) }));
    if (new Date(item.pubDate || 0) > new Date(found.main.pubDate || 0)) {
      found.main = Object.assign({}, item);
    }
  });
  return clusters.map(function(cluster, index) {
    var sourceNames = {};
    cluster.sources.forEach(function(source) { sourceNames[source.sourceName || '来源'] = true; });
    return Object.assign({}, cluster.main, {
      sourceId:index + 1,
      sourceCount:cluster.sources.length,
      sourceNames:Object.keys(sourceNames).slice(0, 4),
      sourceLinks:cluster.sources.filter(function(source) { return source.link; }).slice(0, 4).map(function(source) {
        return { name:source.sourceName || '来源', link:source.link };
      }),
      relatedSources:cluster.sources
    });
  }).sort(function(a, b) {
    return (b.sourceCount - a.sourceCount) || (new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
  });
}

function buildFocusSourceMeta(item) {
  if (!item || !item.sourceCount || item.sourceCount <= 1) return '';
  var names = Array.isArray(item.sourceNames) && item.sourceNames.length ? item.sourceNames.join(' / ') : '多家媒体';
  var html = '<div class="fe-sources">多源报道 ' + item.sourceCount + ' 家：' + escapeHtml(names) + '</div>';
  if (Array.isArray(item.sourceLinks) && item.sourceLinks.length > 1) {
    html += '<div class="fe-source-links">';
    item.sourceLinks.slice(0, 3).forEach(function(source) {
      html += '<a href="' + escapeHtml(safeExternalUrl(source.link)) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source.name || '来源') + '</a>';
    });
    html += '</div>';
  }
  return html;
}

/* Background upgrades: translate → AI generate → update UI */
function hasChineseText(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

async function translateFocusTexts(items) {
  var list = Array.isArray(items) ? items : [];
  async function translateField(field, maxLength) {
    var targets = list.map(function(item) {
      var text = String(item[field] || '').trim();
      return { item:item, text:text };
    }).filter(function(entry) {
      return entry.text && !hasChineseText(entry.text);
    });
    for (var start = 0; start < targets.length; start += 24) {
      var chunk = targets.slice(start, start + 24);
      try {
        var resp = await fetch('/api/llm/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: chunk.map(function(entry) { return entry.text.slice(0, maxLength); }) })
        });
        if (!resp.ok) continue;
        var data = await resp.json();
        if (!data.success || !Array.isArray(data.translations)) continue;
        chunk.forEach(function(entry, offset) {
          var translated = String(data.translations[offset] || '').trim();
          if (translated && hasChineseText(translated)) entry.item[field] = translated;
        });
      } catch (error) {
        console.warn('Focus translation failed:', field, error.message);
      }
    }
  }
  await translateField('title', 500);
  await translateField('desc', 900);
  return list;
}

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
  var translationComplete = translatedTitles && translatedDescs;
  if (badge) {
    badge.className = translationComplete ? 'freshness-badge live' : 'freshness-badge snapshot';
    badge.innerHTML = '<span class="freshness-dot"></span>' + (translationComplete ? '已翻译' : '翻译不完整');
  }

  // Save world news (translations only) to cache
  var wh = window._worldHash;
  if (wh && translationComplete) {
    var cache = getAICache();
    var entry = cache.world || {};
    entry.hash = wh;
    entry.newsHtml = buildWorldNewsHTML(displayed, '');
    entry.translationComplete = true;
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
    var generatedAt = Date.now();
    var lines = data.analysis.split('\n').filter(function(l) { return l.trim(); });
    var html = '<div class="analysis-card animate-on-scroll visible" style="margin-top:24px;background:linear-gradient(135deg, var(--clr-world-bg), var(--clr-product-bg));border:1px solid var(--r-glow);">';
    html += '<div class="an-title">🌍 国际局势分析（AI 生成）' + buildAITimestamp(generatedAt) + '</div><ul class="an-list">';
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
async function renderMyFocusAnalysis(headlines, shownHeadlines) {
  var focusEl = ensureWorldMyFocusEl(document.getElementById('worldContainer'));
  var originalCandidates = Array.isArray(headlines) ? headlines.filter(Boolean).slice(0, 48).map(function(item) {
    if (typeof item === 'string') return { title:item, pubDate:'', category:'' };
    return { title:item.title || '', pubDate:item.pubDate || item.time || '', category:item.category || '', desc:item.desc || '', link:item.link || item.url || '', track:item.track || '', sourceId:item.sourceId || '' };
  }).filter(function(item) { return item.title; }) : [];
  var shownItems = Array.isArray(shownHeadlines) ? shownHeadlines.filter(Boolean).slice(0, 12).map(function(item) {
    if (typeof item === 'string') return { title:item, desc:'', titleEn:'', descEn:'', category:'' };
    return { title:item.title || '', desc:item.desc || '', titleEn:item.titleEn || '', descEn:item.descEn || '', category:item.category || '' };
  }) : [];
  var shownTexts = shownItems.map(function(item) { return normalizeEventText([item.title, item.titleEn, item.desc, item.descEn].join(' ')); });
  var candidateItems = originalCandidates.filter(function(item) {
    return !isDuplicateWorldCandidate(item, shownItems);
  });
  if (!candidateItems.length) candidateItems = originalCandidates.slice(0, 20);
  if (!candidateItems.length) {
    focusEl.innerHTML = '';
    return;
  }
  candidateItems = candidateItems.map(function(item, index) {
    return Object.assign({}, item, { sourceId:index + 1 });
  });
  candidateItems = await translateFocusTexts(candidateItems);
  candidateItems = clusterFocusCandidates(candidateItems).slice(0, 48);
  var focusHash = hashStr('focus-v8-clustered-zh-market-military-top10|||' + candidateItems.map(function(item) { return item.title + '|' + item.pubDate + '|' + item.track + '|' + item.sourceCount; }).join('|||') + '|||shown|||' + shownItems.map(function(item) { return item.title; }).join('|||'));

  // Check cache first — if valid cache exists, show it and skip fetch
  var cached = getCachedAIEntry('myFocus');
  if (!shouldBypassAICache() && cached && cached.dateKey === todayStr() && cached.hash === focusHash) {
    focusEl.innerHTML = cached.html;
    return;
  }

  // Show loading state
  focusEl.innerHTML = '<div class="my-focus-section" style="margin-top:24px;">' +
    '<div class="my-focus-title">' +
    '🎯 我的关注 <span class="badge-tag">✨ AI 精选</span>' + buildAITimestamp(Date.now()) + '</div>' +
    '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;color:var(--text-muted);font-size:0.9rem;">' +
    '<div class="spinner" style="width:20px;height:20px;border:3px solid var(--border);border-top-color:var(--amber);border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
    'AI 正在生成美军相关重大动态…</div></div>';

  try {
    var response = await fetch('/api/llm/my-focus-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: candidateItems, shownHeadlines: shownItems.map(function(item) { return item.title; }) })
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);

    var data = await response.json();
    if (!data.success) throw new Error(data.error);

    // Parse AI response into event cards
    var raw = data.analysis.trim();
    if (/暂无(符合关注条件的)?重大事件|暂无美军/.test(raw)) {
      focusEl.innerHTML = buildFallbackMyFocusHtml(candidateItems, 'AI 未筛出足够事件，以下显示 RSS 候选');
      return;
    }

    var blocks = raw.split('---').filter(function(b) { return b.trim(); });
    if (blocks.length === 0) {
      focusEl.innerHTML = buildFallbackMyFocusHtml(candidateItems, 'AI 返回为空，以下显示 RSS 候选');
      return;
    }

    var generatedAt = Date.now();
    var candidateById = {};
    candidateItems.forEach(function(item) { candidateById[String(item.sourceId)] = item; });
    var usedSourceIds = {};
    var renderedFocusCount = 0;
    var html = '<div class="my-focus-section ai-just-arrived" style="margin-top:24px;">';
    html += '<div class="my-focus-title">';
    html += '🎯 我的关注 <span class="badge-tag">TOP 10 · AI 精选</span>' + buildAITimestamp(generatedAt) + '</div>';

    blocks.forEach(function(block) {
      var lines = block.trim().split('\n').filter(function(l) { return l.trim(); });
      if (lines.length < 2) return;
      // Parse title and content
      var group = '宏观风险';
      var title = '';
      var time = '';
      var desc = '';
      var reason = '';
      var sourceId = '';
      lines.forEach(function(rawLine) {
        var line = rawLine.trim();
        if (line.indexOf('🏷️') === 0 || line.indexOf('类别') >= 0) {
          group = line.replace(/^🏷️\s*(类别[：:]?\s*)?/, '').trim() || group;
        } else if (line.indexOf('候选编号') >= 0) {
          var match = line.match(/(\d+)/);
          if (match) sourceId = match[1];
        } else if (line.indexOf('🕒') === 0 || line.indexOf('新闻时间') >= 0) {
          time = line.replace(/^🕒\s*(新闻时间[：:]?\s*)?/, '').trim();
        } else if (line.indexOf('🔴') === 0) {
          title = line.replace(/^🔴\s*(事件标题[：:]?\s*)?/, '').trim();
        }
      });
      var sourceItem = sourceId ? candidateById[sourceId] : null;
      if (sourceItem) {
        if (usedSourceIds[sourceId] || isDuplicateWorldCandidate(sourceItem, shownItems)) return;
        usedSourceIds[sourceId] = true;
        if (!time && sourceItem.pubDate) time = sourceItem.pubDate;
      }
      if (!title) title = lines[0].replace(/^🔴\s*/, '').trim();
      if (sourceItem && title && !hasChineseText(title) && sourceItem.title) title = sourceItem.title;
      for (var i = 0; i < lines.length; i++) {
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
      if (sourceItem && desc && !hasChineseText(desc) && sourceItem.desc) desc = String(sourceItem.desc).slice(0, 140);
      var combined = title + ' ' + desc + ' ' + reason;
      if (shownTexts.some(function(shown) { return eventTextSimilarity(combined, shown) >= 0.28; })) return;

      if (/美军|美国|对外|海外/.test(group)) group = '美国态势';
      var groupClass = /美国|美军/.test(group) ? ' us-track' : ' macro-track';
      var displayTime = formatFocusEventTime(time);
      var sourceUrl = sourceItem && sourceItem.link ? safeExternalUrl(sourceItem.link) : '';
      html += '<div class="focus-event-card' + groupClass + '">';
      html += '<div class="fe-topline"><span class="fe-group">' + escapeHtml(group) + '</span>' + (displayTime ? '<span class="fe-time">🕒 ' + escapeHtml(displayTime) + '</span>' : '') + '</div>';
      html += '<div class="fe-title">🔴 ' + escapeHtml(title) + '</div>';
      if (desc) html += '<div class="fe-desc"><span class="fe-label">📋 事件简述：</span>' + escapeHtml(desc) + '</div>';
      if (reason) html += '<div class="fe-reason"><span class="reason-label">🎯 关注原因：</span>' + escapeHtml(reason) + '</div>';
      if (sourceItem) html += buildFocusSourceMeta(sourceItem);
      if (sourceUrl) html += '<a href="' + escapeHtml(sourceUrl) + '" class="card-action focus-source-link" target="_blank" rel="noopener noreferrer">来源 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>';
      html += '</div>';
      renderedFocusCount++;
    });

    if (renderedFocusCount < 10) {
      html += buildFocusSupplementCards(candidateItems, usedSourceIds, 10 - renderedFocusCount, shownItems);
    }
    html += '</div>';
    if (html.indexOf('focus-event-card') < 0) {
      focusEl.innerHTML = buildFallbackMyFocusHtml(candidateItems, 'AI 结果与上方新闻重复，以下显示 RSS 候选');
      return;
    }
    focusEl.innerHTML = html;

    // Save myFocus to independent date-keyed cache (not tied to world news)
    var dk = data.dateKey || todayStr();
    setAICache({ myFocus: { dateKey: dk, hash: focusHash, html: html, timestamp: generatedAt } });

  } catch (error) {
    console.error('My focus analysis failed:', error);
    focusEl.innerHTML = buildFallbackMyFocusHtml(candidateItems, 'AI 加载失败，以下显示 RSS 候选');
  }
}

function buildFocusSupplementCards(candidateItems, usedSourceIds, limit, shownItems) {
  var html = '';
  var count = 0;
  var ordered = (candidateItems || []).slice().sort(function(a, b) {
    var au = /美国|美军/.test(a.track || '') ? 1 : 0;
    var bu = /美国|美军/.test(b.track || '') ? 1 : 0;
    return bu - au;
  });
  ordered.forEach(function(item) {
    if (count >= limit) return;
    if (!item || !item.title || usedSourceIds[String(item.sourceId)]) return;
    if (isDuplicateWorldCandidate(item, shownItems || [])) return;
    usedSourceIds[String(item.sourceId)] = true;
    var group = /美国|美军/.test(item.track || '') ? '美国态势' : '宏观风险';
    var groupClass = group === '美国态势' ? ' us-track' : ' macro-track';
    var time = item.pubDate ? fmtPubDate(item.pubDate) : '未知';
    html += '<div class="focus-event-card' + groupClass + '">';
    html += '<div class="fe-topline"><span class="fe-group">' + group + '</span><span class="fe-time">🕒 ' + escapeHtml(time) + '</span></div>';
    html += '<div class="fe-title">🔴 ' + escapeHtml(item.title || '') + '</div>';
    if (item.desc) html += '<div class="fe-desc"><span class="fe-label">📋 事件简述：</span>' + escapeHtml(String(item.desc).slice(0, 120)) + '</div>';
    html += '<div class="fe-reason"><span class="reason-label">🎯 关注原因：</span>' + (group === '美国态势' ? 'AI 有效结果不足，补充展示美国军事、防务或海外行动态势候选。' : 'AI 有效结果不足，补充展示国际宏观风险候选事件。') + '</div>';
    html += buildFocusSourceMeta(item);
    if (item.link) html += '<a href="' + escapeHtml(safeExternalUrl(item.link)) + '" class="card-action focus-source-link" target="_blank" rel="noopener noreferrer">来源 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>';
    html += '</div>';
    count++;
  });
  return html;
}

function buildFallbackMyFocusHtml(candidateItems, note) {
  var macro = [];
  var military = [];
  (candidateItems || []).forEach(function(item) {
    if (/美军/.test(item.track || '') && military.length < 5) military.push(item);
    else if (macro.length < 5) macro.push(item);
  });
  if (military.length < 5) {
    (candidateItems || []).forEach(function(item) {
      if (military.length >= 5) return;
      var text = ((item.title || '') + ' ' + (item.desc || '')).toLowerCase();
      if (/pentagon|us military|u\.s\. military|us forces|u\.s\. forces|troops|navy|air force|army|carrier|uss |base|deployment|exercise|drill|weapons|arms shipment|security assistance/.test(text) && military.indexOf(item) < 0) {
        military.push(item);
      }
    });
  }
  var picked = macro.slice(0, 5).concat(military.slice(0, 5));
  if (!picked.length) return '';
  var html = '<div class="my-focus-section ai-just-arrived" style="margin-top:24px;">';
  html += '<div class="my-focus-title">🎯 我的关注 <span class="badge-tag">TOP 10 · RSS 候选</span>' + buildAITimestamp(Date.now(), '更新') + '</div>';
  if (note) html += '<div class="my-focus-note">' + escapeHtml(note) + '</div>';
  picked.forEach(function(item, index) {
    var group = index < macro.slice(0, 5).length ? '宏观风险' : '美国态势';
    var groupClass = group === '美国态势' ? ' us-track' : ' macro-track';
    var time = item.pubDate ? fmtPubDate(item.pubDate) : '未知';
    html += '<div class="focus-event-card' + groupClass + '">';
    html += '<div class="fe-topline"><span class="fe-group">' + group + '</span><span class="fe-time">🕒 ' + escapeHtml(time) + '</span></div>';
    html += '<div class="fe-title">🔴 ' + escapeHtml(item.title || '') + '</div>';
    if (item.desc) html += '<div class="fe-desc"><span class="fe-label">📋 事件简述：</span>' + escapeHtml(String(item.desc).slice(0, 120)) + '</div>';
    html += '<div class="fe-reason"><span class="reason-label">🎯 关注原因：</span>' + (group === '美国态势' ? '涉及美国军事、防务或海外行动态势，需关注对地区安全与市场风险偏好的影响。' : '属于国际宏观风险候选事件，需结合后续新闻确认其对能源、贸易和资产价格的影响。') + '</div>';
    html += buildFocusSourceMeta(item);
    if (item.link) html += '<a href="' + escapeHtml(safeExternalUrl(item.link)) + '" class="card-action focus-source-link" target="_blank" rel="noopener noreferrer">来源 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}
