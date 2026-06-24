'use strict';

/* ===== Arena Rendering ===== */
function formatArenaDate(offsetDays) {
  var date = new Date();
  date.setDate(date.getDate() - (offsetDays || 0));
  return date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
}

function fetchArenaCategory(dateStr, category) {
  return fetch('/api/llm/arena-leaderboard?date=' + encodeURIComponent(dateStr) + '&category=' + encodeURIComponent(category))
    .then(function(response) {
      if (!response.ok) throw new Error('Arena ' + category + ' ' + dateStr + ' HTTP ' + response.status);
      return response.json();
    })
    .then(function(data) {
      if (!data || !Array.isArray(data.models)) throw new Error('Invalid Arena payload');
      return data.models;
    });
}

function fetchArenaData() {
  var cats = ['text','code','text-to-image','text-to-video'];
  var dates = [0, 1, 2, 3].map(formatArenaDate);
  function tryDate(idx) {
    if (idx >= dates.length) throw new Error('Arena data unavailable');
    var dateStr = dates[idx];
    return Promise.all(cats.map(function(cat) { return fetchArenaCategory(dateStr, cat); }))
      .then(function(groups) { return { date: dateStr, groups: groups, categories: cats }; })
      .catch(function() { return tryDate(idx + 1); });
  }
  return tryDate(0);
}

function normalizeArenaPayload(payload) {
  if (Array.isArray(payload)) return { date: null, groups: payload };
  if (payload && Array.isArray(payload.groups)) return {
    date: payload.date || null,
    groups: payload.groups,
    categories: Array.isArray(payload.categories) ? payload.categories : null
  };
  if (payload && Array.isArray(payload.data)) return {
    date: payload.date || null,
    groups: payload.data,
    categories: Array.isArray(payload.categories) ? payload.categories : null
  };
  return { date: null, groups: [] };
}

var arenaTitles = {
  text: '💬 Chat Arena (Text Overall) · Elo',
  code: '💻 Code Arena (WebDev) · Elo',
  'text-to-image': '🖼️ Image Arena (Text-to-Image) · Elo',
  'text-to-video': '🎬 Video Arena (Text-to-Video) · Elo'
};

function genArenaNote(models, cat) {
  var vendors = {}; models.forEach(function(m) { vendors[m.vendor] = (vendors[m.vendor]||0)+1; });
  var cnIn = []; models.forEach(function(m, i) { if (i<10 && ['Alibaba','Z.ai','DeepSeek','Moonshot','MiniMax','Xiaomi','ByteDance'].indexOf(m.vendor)>=0) cnIn.push(m.model); });
  if (cnIn.length>0) return '🏆 国产模型进入前十：' + cnIn.slice(0,3).join('、');
  var top = Object.entries(vendors).sort(function(a,b){return b[1]-a[1];}).slice(0,3).map(function(v){return v[0]+' ×'+v[1];}).join(' / ');
  return top + ' 垄断前十';
}

function renderArena(payload) {
  var normalizedArena = normalizeArenaPayload(payload);
  var data = normalizedArena.groups;
  var categoryOrder = normalizedArena.categories || ['text','code','text-to-image','text-to-video'];
  var groupByKey = {};
  categoryOrder.forEach(function(key, idx) {
    groupByKey[key] = data[idx] || [];
  });
  var container = document.getElementById('arenaContainer');
  var countEl = document.querySelector('#arena .major-count');
  if (!container) return;

  if (!data || !data.length) {
    container.innerHTML = '<div class="empty-section" style="padding:40px;">📭 暂无 Arena 数据</div>';
    return;
  }
  if (countEl) {
    var today = new Date();
    var dateStr = normalizedArena.date ? normalizedArena.date.replace(/-/g, '.') : today.getFullYear() + '.' + ('0'+(today.getMonth()+1)).slice(-2) + '.' + ('0'+today.getDate()).slice(-2);
    countEl.textContent = '数据截至 ' + dateStr + ' · arena.ai';
  }

  var html = '';
  // Tab Nav
  var tabs = [
    {key:'code',     icon:'💻', label:'Code'},
    {key:'text',     icon:'💬', label:'Chat'},
    {key:'text-to-image', icon:'🖼️', label:'Image'},
    {key:'text-to-video', icon:'🎬', label:'Video'}
  ];

  html += '<div class="arena-tabs animate-on-scroll visible">';
  tabs.forEach(function(t, i) {
    html += '<button class="arena-tab'+(i===0?' active':'')+'" data-tab="' + t.key + '">' + t.icon + ' ' + t.label + '</button>';
  });
  html += '</div>';

  // Tab Panels
  html += '<div class="arena-panels">';
  tabs.forEach(function(t, ti) {
    var d = groupByKey[t.key]; if (!d || !d.length) return;
    html += '<div class="arena-panel'+(ti===0?' active':'')+'" id="panel-' + t.key + '">';
    html += '<div class="arena-grid">';
    html += '<div class="arena-card animate-on-scroll visible">';
    html += '<div class="arena-label">' + arenaTitles[t.key] + '</div>';

    var cnVendors = ['Alibaba','Alibaba-ATH','Z.ai','DeepSeek','Moonshot','MiniMax','Xiaomi','ByteDance','Bytedance','01.AI','Qwen','Tencent','Baidu','Huawei','iFlytek'];
    d.slice(0,10).forEach(function(m, i) {
      var rankCls = ''; if (i===0) rankCls=' gold'; else if (i===1) rankCls=' silver'; else if (i===2) rankCls=' bronze';
      var vendor = String(m.vendor || '');
      var isCN = !!vendor && cnVendors.some(function(v){ return vendor === v || vendor.indexOf(v) >= 0 || v.indexOf(vendor) >= 0; });
      var cnCls = isCN ? ' cn-highlight' : '';
      html += '<div class="arena-row' + cnCls + '"><span class="arena-rank' + rankCls + '">' + escapeHtml(String(m.rank)) + '</span><span class="arena-name">' + escapeHtml(m.model) + '</span><span class="arena-score">' + escapeHtml(String(m.score)) + '</span></div>';
    });
    html += '<div class="arena-note">' + escapeHtml(genArenaNote(d, t.key)) + '</div>';
    html += '</div></div></div>';
  });
  html += '</div>';
  container.innerHTML = html;

  // Re-bind tab click handlers
  setTimeout(function() {
    var tabs = document.querySelectorAll('#arena .arena-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var t = this.getAttribute('data-tab');
        document.querySelectorAll('#arena .arena-tab').forEach(function(b){b.classList.remove('active');});
        this.classList.add('active');
        document.querySelectorAll('#arena .arena-panel').forEach(function(p){p.classList.remove('active');});
        document.getElementById('panel-'+t).classList.add('active');
      });
    });
  }, 100);

  // ===== AI Summary: 国产模型动态 =====
  var cnModels = [];
  var catLabel = { text:'Chat', code:'Code', 'text-to-image':'Image', 'text-to-video':'Video' };
  var cnVendorsAI = ['Alibaba','Alibaba-ATH','Z.ai','DeepSeek','Moonshot','MiniMax','Xiaomi','ByteDance','Bytedance','01.AI','Qwen','Tencent','Baidu','Huawei','iFlytek'];
  tabs.forEach(function(tab) {
    var catModels = groupByKey[tab.key] || [];
    if (!catModels) return;
    catModels.forEach(function(m) {
      var vendor = String(m.vendor || '');
      var isCN = !!vendor && cnVendorsAI.some(function(v){ return vendor === v || vendor.indexOf(v) >= 0 || v.indexOf(vendor) >= 0; });
      if (isCN && parseInt(m.rank) <= 10) {
        cnModels.push({
          model: m.model, vendor: m.vendor,
          rank: m.rank, score: m.score,
          category: catLabel[tab.key] || tab.label || ''
        });
      }
    });
  });
  cnModels.sort(function(a,b){ return parseFloat(b.score) - parseFloat(a.score); });
  cnModels = cnModels.slice(0, 8);

  function buildArenaCNSummaryHtml(aiLines, generatedAt) {
    var html = '<div class="arena-summary-head"><span class="arena-summary-title">CN 国产模型动态</span><span class="arena-summary-tag">AI 总结</span>' + buildAITimestamp(generatedAt || Date.now()) + '</div>';
    html += '<div class="arena-cn-models">';
    cnModels.forEach(function(m) {
      html += '<div class="arena-cn-model">';
      html += '<span class="arena-cn-cat">' + escapeHtml(m.category) + '</span>';
      html += '<span class="arena-cn-rank">#' + escapeHtml(String(m.rank)) + '</span>';
      html += '<span class="arena-cn-name">' + escapeHtml(m.model) + '</span>';
      html += '<span class="arena-cn-score">' + escapeHtml(String(m.score)) + '</span>';
      html += '</div>';
    });
    html += '</div>';
    if (aiLines && aiLines.length) {
      html += '<ul class="an-list arena-summary-list">';
      aiLines.forEach(function(line) {
        var text = line.replace(/^[•·▪]/, '').trim();
        if (text) html += '<li>' + escapeHtml(text) + '</li>';
      });
      html += '</ul>';
    }
    return html;
  }

  var sumDiv = document.createElement('div');
  sumDiv.id = 'arenaCNSummary';
  sumDiv.className = 'arena-summary animate-on-scroll visible';
  sumDiv.innerHTML = '<div class="arena-summary-head"><span class="arena-summary-title">CN 国产模型动态</span><span class="arena-summary-tag">AI 分析中</span></div>' +
    '<div style="min-height:40px;">' +
    '<div class="shimmer" style="height:14px;width:80%;margin:8px 0;border-radius:4px;"></div>' +
    '<div class="shimmer" style="height:14px;width:60%;margin:8px 0;border-radius:4px;"></div>' +
    '</div>';
  container.appendChild(sumDiv);

  if (cnModels.length) {
    var checkArenaCommentCache = getCachedAIEntry('arena_comment');
    var arenaHash = hashStr('cn-summary-v2|' + cnModels.map(function(m){return m.model+m.rank+m.score+m.category;}).join('|'));
    if (!shouldBypassAICache() && checkArenaCommentCache && checkArenaCommentCache.hash === arenaHash) {
      sumDiv.innerHTML = checkArenaCommentCache.html;
    } else {
      fetch('/api/llm/arena-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rankings: cnModels.map(function(m) {
            return { modelName: m.model + ' (' + m.vendor + ')', score: m.score, rank: m.rank, category: m.category };
          }),
          category: '综合'
        })
      }).then(function(r) { return r.json(); }).then(function(result) {
        if (result.success) {
          var lines = result.comment.split('\n').filter(function(l) { return l.trim(); });
          var generatedAt = Date.now();
          var shtml = buildArenaCNSummaryHtml(lines, generatedAt);
          sumDiv.innerHTML = shtml;
          setAICache({ arena_comment: { hash: arenaHash, html: shtml, timestamp: generatedAt } });
        } else {
          sumDiv.innerHTML = buildArenaCNSummaryHtml(['AI 总结暂不可用'], Date.now());
        }
      }).catch(function() {
        sumDiv.innerHTML = buildArenaCNSummaryHtml(['AI 总结加载失败'], Date.now());
      });
    }
  } else {
    sumDiv.innerHTML = '<div class="arena-summary-head"><span class="arena-summary-title">CN 国产模型动态</span></div><p style="color:var(--text-dim);padding:8px 0;">本期暂无国产模型进入前十排名</p>';
  }
}
