/* Domestic hot events: aggregate Weibo, Baidu and Toutiao rankings. */
(function() {
function escapeDomestic(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatDomesticTime(value, isPublished) {
  var date = new Date(value);
  if (isNaN(date.getTime())) return '';
  var now = new Date();
  var sameDay = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  var label;
  if (sameDay) {
    var hours = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 3600000));
    label = hours < 1 ? '\u4e0d\u8db31\u5c0f\u65f6\u524d' : hours + '\u5c0f\u65f6\u524d';
  } else {
    label = date.getFullYear() + '-' +
      ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
      ('0' + date.getDate()).slice(-2) + ' ' +
      ('0' + date.getHours()).slice(-2) + ':' +
      ('0' + date.getMinutes()).slice(-2);
  }
  return (isPublished ? '\u53d1\u5e03 ' : '\u6293\u53d6 ') + label;
}
function initDomesticHot(forceRefresh) {
  var container = document.getElementById('domesticHotContainer');
  var badge = document.getElementById('domesticFreshBadge');
  var sourceLabel = document.getElementById('domesticSourceLabel');
  if (!container) return Promise.resolve({ tag:'domestic', ok:false });
  return fetch('/api/llm/domestic-hot' + (forceRefresh ? '?refresh=1' : '')).then(function(response) {
    if (!response.ok) throw new Error('Domestic hot HTTP ' + response.status);
    return response.json();
  }).then(function(data) {
    if (!data || !data.success || !Array.isArray(data.items) || !data.items.length) throw new Error('No domestic hot events');
    window._domesticHotItems = data.items.slice(0, 10);
    var html = '<div class="domestic-hot-list">';
    var observedAt = data.fetchedAt || new Date().toISOString();
    data.items.slice(0, 10).forEach(function(item, index) {
      var url = /^https?:\/\//.test(item.url || '') ? item.url : '#';
      var ranks = Array.isArray(item.sourceRanks) ? item.sourceRanks.join(' · ') : '';
      var sourceCount = Array.isArray(item.sources) ? item.sources.length : 1;
      var summary = item.summary || '';
      var timeLabel = formatDomesticTime(item.publishedAt || observedAt, !!item.publishedAt);
      var meta = [timeLabel, ranks].filter(Boolean).join(' \u00b7 ');
      html += '<a class="domestic-hot-item" href="' + escapeDomestic(url) + '" target="_blank" rel="noopener noreferrer">';
      html += '<span class="domestic-hot-rank">' + String(index + 1).padStart(2, '0') + '</span>';
      html += '<span class="domestic-hot-main"><span class="domestic-hot-category">' + escapeDomestic(item.category || '社会要闻') + '</span>';
      html += '<span class="domestic-hot-title">' + escapeDomestic(item.title) + '</span>';
      html += '<span class="domestic-hot-summary">' + escapeDomestic(summary) + '</span>';
      html += '<span class="domestic-hot-meta">' + escapeDomestic(meta) + '</span></span>';
      html += '<span class="domestic-hot-score">' + sourceCount + '源</span></a>';
    });
    html += '</div>';
    container.innerHTML = html;
    if (sourceLabel) sourceLabel.textContent = '国内热点 TOP 10 · ' + (data.sources || []).join(' . ');
    if (badge) {
      var fetched = new Date(data.fetchedAt || Date.now());
      var stamp = ('0' + fetched.getHours()).slice(-2) + ':' + ('0' + fetched.getMinutes()).slice(-2);
      badge.className = 'freshness-badge live';
      badge.innerHTML = '<span class="freshness-dot"></span>' + stamp;
    }
    return { tag:'domestic', ok:true };
  }).catch(function(error) {
    console.error('Domestic hot events failed:', error);
    container.innerHTML = '<div class="empty-section" style="padding:30px;">国内热点暂时无法获取，请稍后刷新</div>';
    if (badge) {
      badge.className = 'freshness-badge snapshot';
      badge.innerHTML = '<span class="freshness-dot"></span>OFFLINE';
    }
    return { tag:'domestic', ok:false };
  });
}
function initChengduLocal(forceRefresh) {
  var container = document.getElementById('chengduLocalContainer');
  var badge = document.getElementById('chengduLocalFreshBadge');
  var sourceLabel = document.getElementById('chengduLocalSourceLabel');
  if (!container) return Promise.resolve({ tag:'chengdu', ok:false });
  return fetch('/api/llm/chengdu-local' + (forceRefresh ? '?refresh=1' : '')).then(function(response) {
    if (!response.ok) throw new Error('Chengdu local HTTP ' + response.status);
    return response.json();
  }).then(function(data) {
    if (!data || !data.success || !Array.isArray(data.items) || !data.items.length) throw new Error('No Chengdu local items');
    window._chengduLocalItems = data.items.slice(0, 8);
    var html = '<div class="domestic-hot-list local-chengdu-list">';
    var observedAt = data.fetchedAt || new Date().toISOString();
    data.items.slice(0, 8).forEach(function(item, index) {
      var url = /^https?:\/\//.test(item.url || '') ? item.url : '#';
      var source = item.source ? item.source : '成都本地';
      var summary = item.summary || '';
      var timeLabel = formatDomesticTime(item.publishedAt || observedAt, !!item.publishedAt);
      var meta = [timeLabel, source].filter(Boolean).join(' \u00b7 ');
      html += '<a class="domestic-hot-item local-chengdu-item" href="' + escapeDomestic(url) + '" target="_blank" rel="noopener noreferrer">';
      html += '<span class="domestic-hot-rank">' + String(index + 1).padStart(2, '0') + '</span>';
      html += '<span class="domestic-hot-main"><span class="domestic-hot-category">' + escapeDomestic(item.category || '成都生活') + '</span>';
      html += '<span class="domestic-hot-title">' + escapeDomestic(item.title) + '</span>';
      html += '<span class="domestic-hot-summary">' + escapeDomestic(summary) + '</span>';
      html += '<span class="domestic-hot-meta">' + escapeDomestic(meta) + '</span></span>';
      html += '<span class="domestic-hot-score">LOCAL</span></a>';
    });
    html += '</div>';
    container.innerHTML = html;
    if (sourceLabel) sourceLabel.textContent = '活动 · 美食 · 出行 · 市民热点 TOP ' + Math.min(8, data.items.length) + ' · ' + (data.sources || []).join(' . ');
    if (badge) {
      var fetched = new Date(data.fetchedAt || Date.now());
      var stamp = ('0' + fetched.getHours()).slice(-2) + ':' + ('0' + fetched.getMinutes()).slice(-2);
      badge.className = 'freshness-badge live';
      badge.innerHTML = '<span class="freshness-dot"></span>' + stamp;
    }
    return { tag:'chengdu', ok:true };
  }).catch(function(error) {
    console.error('Chengdu local failed:', error);
    container.innerHTML = '<div class="empty-section" style="padding:30px;">成都活动、美食、出行与市民热点暂时无法获取，请稍后刷新</div>';
    if (badge) {
      badge.className = 'freshness-badge snapshot';
      badge.innerHTML = '<span class="freshness-dot"></span>OFFLINE';
    }
    return { tag:'chengdu', ok:false };
  });
}
window.refreshChengduLocal = initChengduLocal;
window.refreshDomesticHot = initDomesticHot;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() {
  initChengduLocal();
  initDomesticHot();
});
else {
  initChengduLocal();
  initDomesticHot();
}
})();
