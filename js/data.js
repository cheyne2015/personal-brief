'use strict';

/* ===== Refresh Button - Real API Data Loading ===== */
var btn = document.getElementById('refreshBtn');
var tooltip = document.getElementById('refreshTooltip');
var toast = document.getElementById('refreshToast');
var tooltipTimer;

// WMO weather code → Chinese
var wmoMap = {0:'晴天',1:'大部晴',2:'多云',3:'阴天',45:'雾',48:'霜雾',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'阵雨',81:'阵雨',82:'大阵雨',85:'小雪',86:'大雪',95:'雷暴',96:'冰雹雷暴',99:'强冰雹'};
var wmoIcon = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'🌨️',73:'🌨️',75:'🌨️',80:'🌧️',81:'🌧️',82:'🌧️',85:'❄️',86:'❄️',95:'⛈️',96:'⛈️',99:'⛈️'};

function showTooltip() {
  tooltip.classList.add('show');
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(function() { tooltip.classList.remove('show'); }, 2500);
}

function showToast(msg, type) {
  toast.textContent = msg;
  toast.className = 'refresh-toast ' + (type || 'info') + ' show';
  setTimeout(function() { toast.classList.remove('show'); }, 3000);
}

btn.addEventListener('mouseenter', showTooltip);
btn.addEventListener('focus', showTooltip);
setTimeout(showTooltip, 800);

// JSONP script loader (Tencent/Sina global-var pattern)
function loadVar(url, vname) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    var done = false;
    var t = setTimeout(function() { if(!done){done=true;s.remove();reject(new Error('timeout'));} }, 8000);
    s.onload = function() { if(done)return;done=true;clearTimeout(t);var v=window[vname];s.remove();if(v!==undefined)resolve(v);else reject(new Error('no var')); };
    s.onerror = function() { if(done)return;done=true;clearTimeout(t);s.remove();reject(new Error('network')); };
    s.src = url;
    document.head.appendChild(s);
  });
}

function fmtVal(n) { n=parseFloat(n); if(isNaN(n))return'--'; if(Math.abs(n)>=100)return Math.round(n).toLocaleString(); return n.toFixed(1); }
function fmtPct(curr,prev) { var p=((curr-prev)/prev*100); return (p>=0?'+':'')+p.toFixed(1)+'%'; }

var marketQuoteTimes = { sh:'', us:'', gold:'' };
function parseTencentQuoteTime(raw) {
  var value = String(raw || '').split('~')[30] || '';
  if (/^\d{14}$/.test(value)) {
    return value.slice(0,4) + '-' + value.slice(4,6) + '-' + value.slice(6,8) + ' ' + value.slice(8,10) + ':' + value.slice(10,12) + ':' + value.slice(12,14);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return value;
  return '';
}

function parseSinaQuoteTime(raw) {
  var parts = String(raw || '').split(',');
  var date = parts[12] || '';
  var time = parts[6] || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}:\d{2}$/.test(time) ? date + ' ' + time : '';
}

function rememberMarketQuoteTime(market, timestamp) {
  if (!timestamp) return;
  if (!marketQuoteTimes[market] || timestamp > marketQuoteTimes[market]) marketQuoteTimes[market] = timestamp;
}

var marketChartData = {};
function drawMarketChart(canvasId, points) {
  var canvas = document.getElementById(canvasId);
  if (!canvas || !points || points.length < 2) return;
  var rect = canvas.getBoundingClientRect();
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var width = Math.max(240, Math.round(rect.width));
  var height = Math.max(110, Math.round(rect.height));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  var values = points.map(function(point) { return Number(point.close); });
  var min = Math.min.apply(Math, values);
  var max = Math.max.apply(Math, values);
  var spread = Math.max(max - min, Math.abs(max) * 0.005, 1);
  min -= spread * 0.12;
  max += spread * 0.12;
  var pad = { left:8, right:8, top:34, bottom:20 };
  var chartW = width - pad.left - pad.right;
  var chartH = height - pad.top - pad.bottom;
  var styles = getComputedStyle(document.documentElement);
  var muted = styles.getPropertyValue('--divider').trim() || 'rgba(127,127,127,.18)';
  var rising = values[values.length - 1] >= values[0];
  var color = styles.getPropertyValue(rising ? '--red' : '--green').trim() || (rising ? '#ef4444' : '#22c55e');
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  [0, 0.5, 1].forEach(function(step) {
    var y = pad.top + chartH * step;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  values.forEach(function(value, index) {
    var x = pad.left + (index / (values.length - 1)) * chartW;
    var y = pad.top + (1 - (value - min) / (max - min)) * chartH;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = color;
  var lastX = width - pad.right;
  var lastY = pad.top + (1 - (values[values.length - 1] - min) / (max - min)) * chartH;
  ctx.beginPath(); ctx.arc(lastX, lastY, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = styles.getPropertyValue('--text-muted').trim() || '#94a3b8';
  ctx.font = '10px monospace';
  ctx.textBaseline = 'bottom';
  ctx.fillText(points[0].date.slice(5), pad.left, height - 3);
  var endLabel = points[points.length - 1].date.slice(5);
  ctx.fillText(endLabel, width - pad.right - ctx.measureText(endLabel).width, height - 3);
}

function loadMarketHistoryCharts(force) {
  var charts = [
    { key:'shanghai', canvas:'chartSH', wrap:'chartWrapSH', status:'chartStatusSH', range:'chartRangeSH' },
    { key:'nasdaq', canvas:'chartNASDAQ', wrap:'chartWrapNASDAQ', status:'chartStatusNASDAQ', range:'chartRangeNASDAQ' },
    { key:'gold', canvas:'chartGOLD', wrap:'chartWrapGOLD', status:'chartStatusGOLD', range:'chartRangeGOLD' }
  ];
  return Promise.all(charts.map(function(chart) {
    var wrap = document.getElementById(chart.wrap);
    var status = document.getElementById(chart.status);
    if (wrap) wrap.className = 'market-chart';
    if (status) status.textContent = '正在获取历史行情...';
    return fetch('/api/llm/market/history?symbol=' + chart.key + (force ? '&refresh=1' : ''))
      .then(function(response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(function(data) {
        if (!data.success || !Array.isArray(data.points) || data.points.length < 2) throw new Error('历史行情不足');
        marketChartData[chart.canvas] = data.points;
        drawMarketChart(chart.canvas, data.points);
        if (wrap) wrap.classList.add('ready');
        var range = document.getElementById(chart.range);
        if (range) range.textContent = data.points.length + '个交易日';
        return { tag:'chart-' + chart.key, ok:true };
      }).catch(function(error) {
        if (wrap) wrap.classList.add('error');
        if (status) status.textContent = '历史行情暂不可用';
        console.error('Market history failed:', chart.key, error);
        return { tag:'chart-' + chart.key, ok:false };
      });
  }));
}

window.addEventListener('resize', function() {
  Object.keys(marketChartData).forEach(function(canvasId) { drawMarketChart(canvasId, marketChartData[canvasId]); });
});

// Stock loader with cache fallback — global scope, used by both initAutoLoad and refresh handler
function safeLoadStock(url, vname, cacheKey) {
  // Sina API (hq.sinajs.cn) uses path-style params; adding ?t= or &t= corrupts the variable name
  // Only add cache-buster for Tencent API (qt.gtimg.cn) which handles &t= correctly
  var finalUrl = url;
  if (url.indexOf('qt.gtimg.cn') >= 0) {
    finalUrl = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
  }
  return loadVar(finalUrl, vname)
    .then(function(d) { apiCacheSet(cacheKey, d); return d; })
    .catch(function() {
      var c = apiCacheGet(cacheKey);
      if (c && c.data) return c.data;
      throw new Error('no cache for ' + cacheKey);
    });
}

function loadGoldQuote() {
  return fetch('/api/llm/market/gold').then(function(response) {
    if (!response.ok) throw new Error('gold HTTP ' + response.status);
    return response.json();
  }).then(function(data) {
    if (!data || !data.success || !data.raw) throw new Error('gold quote unavailable');
    apiCacheSet('gold_raw', data.raw);
    return data.raw;
  }).catch(function(error) {
    var cached = apiCacheGet('gold_raw');
    if (cached && cached.data) return cached.data;
    throw error;
  });
}

/* Show AI rate limit error message */
function showRateLimitMessage(container, defaultMsg) {
  if (!container) return;
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red);background:var(--clr-world-bg);border-radius:12px;border:1px solid var(--r-glow);">' +
    '<div style="font-size:1.5rem;margin-bottom:8px;">⚠️</div>' +
    '<div style="font-weight:600;margin-bottom:4px;">AI 请求已达每日上限</div>' +
    '<div style="font-size:0.85rem;color:var(--text-muted);">' + (defaultMsg || '每 IP 每天最多 10 次分析请求，请明天再试') + '</div>' +
    '</div>';
}

function updateTime() {
  var n=new Date(), wd=['日','一','二','三','四','五','六'];
  var ts=n.getFullYear()+'年'+(n.getMonth()+1)+'月'+n.getDate()+'日 星期'+wd[n.getDay()]+' · 数据截至 '+('0'+n.getHours()).slice(-2)+':'+('0'+n.getMinutes()).slice(-2)+' 北京时间';
  var el=document.getElementById('heroSubtitle'); if(el)el.textContent=ts;
  el=document.getElementById('footerCoverage'); if(el)el.textContent='数据截至 '+('0'+n.getHours()).slice(-2)+':'+('0'+n.getMinutes()).slice(-2)+' 北京时间 · 实时聚合生成';
}

/* ===== Weather Forecast Rendering ===== */

// WMO code → text/icon for hourly Open-Meteo
function wmoText(code) {
  if (code === 0) return '晴';
  if (code <= 2) return '大部晴';
  if (code === 3) return '阴天';
  if (code <= 48) return '雾';
  if (code <= 55) return '细雨';
  if (code <= 65) return '小雨';
  if (code <= 77) return '雪';
  if (code <= 82) return '阵雨';
  return '雷雨';
}

function windKmhLevel(kmh) {
  if (kmh < 6) return '1级';
  if (kmh < 12) return '2级';
  if (kmh < 20) return '3级';
  if (kmh < 29) return '4级';
  return '5级+';
}

// Render today's hourly slots from Open-Meteo hourly data
function renderHourlySlots(hourly, targetDate) {
  var slotDefs = [
    {label:'🌅 早晨', icon:'🌅', start:6, end:9},
    {label:'☀️ 上午', icon:'☀️', start:9, end:12},
    {label:'🌞 中午', icon:'🌞', start:12, end:15},
    {label:'⛅ 下午', icon:'⛅', start:15, end:18},
    {label:'🌆 傍晚', icon:'🌆', start:18, end:21},
    {label:'🌙 夜间', icon:'🌙', start:21, end:24},
  ];
  var times = hourly.time, temps = hourly.temperature_2m;
  var prec = hourly.precipitation_probability, wind = hourly.windspeed_10m;
  var wcode = hourly.weathercode;

  // Index by hour for the target date
  var byHour = {};
  for (var i = 0; i < times.length; i++) {
    if (times[i].startsWith(targetDate)) {
      var h = parseInt(times[i].split('T')[1].split(':')[0]);
      byHour[h] = {temp: temps[i], rain: prec[i], wind: wind[i], code: wcode[i]};
    }
  }

  var html = '<div class="weather-hourly"><div class="weather-hourly-title">📅 今日分时段预报</div><div class="weather-slots">';
  slotDefs.forEach(function(slot) {
    var hours = [];
    for (var h = slot.start; h < slot.end; h++) { if (byHour[h]) hours.push(byHour[h]); }
    if (!hours.length) return;
    var avgT = hours.reduce(function(s,x){return s+x.temp;},0)/hours.length;
    var maxRain = Math.max.apply(null, hours.map(function(x){return x.rain||0;}));
    var avgWind = hours.reduce(function(s,x){return s+x.wind;},0)/hours.length;
    var midCode = hours[Math.floor(hours.length/2)].code;
    html += '<div class="weather-slot">';
    html += '<div class="slot-label">' + slot.label + '</div>';
    html += '<div class="slot-temp">' + Math.round(avgT) + '°C</div>';
    html += '<div class="slot-desc">' + wmoText(midCode) + ' · ' + windKmhLevel(avgWind) + '</div>';
    if (maxRain > 0) html += '<div class="slot-rain">💧 ' + maxRain + '%</div>';
    html += '</div>';
  });
  html += '</div></div>';
  return html;
}

// Called with both seniverse daily data and open-meteo combined data
function renderWeatherCards(daily, seniverseData, openMeteoHourly) {
  var dayLabels = ['今天','明天','后天'];
  for (var d = 0; d < 3; d++) {
    var card = document.getElementById('wc'+d); if (!card) continue;
    var wc = daily.weather_code[d], tmax = daily.temperature_2m_max[d], tmin = daily.temperature_2m_min[d];
    var rain = daily.precipitation_probability_max[d], wind = daily.wind_speed_10m_max[d];
    var label = dayLabels[d];
    var dateObj;
    if (d === 0) {
      dateObj = new Date();
      label = '今天 ' + (dateObj.getMonth()+1) + '/' + dateObj.getDate();
    } else if (d === 1) {
      dateObj = new Date(); dateObj.setDate(dateObj.getDate()+1);
      label = '明天 ' + (dateObj.getMonth()+1) + '/' + dateObj.getDate();
    } else {
      dateObj = new Date(); dateObj.setDate(dateObj.getDate()+2);
      label = '后天 ' + (dateObj.getMonth()+1) + '/' + dateObj.getDate();
    }

    var icon = wmoIcon[wc] || '🌤️';
    var desc = wmoMap[wc] || '多云';

    // 今天：优先使用心知天气数据
    if (d === 0 && seniverseData) {
      var snResults = (seniverseData.daily && seniverseData.daily.results && seniverseData.daily.results[0]) || null;
      var snDaily = snResults && snResults.daily && snResults.daily[0];
      var snNowResults = (seniverseData.now && seniverseData.now.results && seniverseData.now.results[0]) || null;
      var snNow = snNowResults && snNowResults.now;
      if (snNow) {
        var nowTemp = parseInt(snNow.temperature || '0');
        var t2 = document.querySelector('.hero-weather-brief .temp');
        if (t2) t2.textContent = nowTemp + '°';
        var s2 = document.querySelector('.hero-weather-brief .desc strong');
        if (s2) s2.textContent = '成都双流 · ' + (snNow.text || '多云');
      }
      if (snDaily) {
        tmax = parseInt(snDaily.high || tmax);
        tmin = parseInt(snDaily.low || tmin);
        rain = Math.round(parseFloat(snDaily.precip || 0) * 100);
        icon = wmoIcon[wc] || '🌤️';
        desc = snDaily.text_day || desc;
      }
      // Today card stretches full width
      card.classList.add('today-card');
    } else {
      card.classList.remove('today-card');
    }

    card.querySelector('.day-label').textContent = icon + ' ' + label;
    card.querySelector('.big-temp').textContent = Math.round(tmax) + '°';
    card.querySelector('.big-temp').removeAttribute('style');

    var prevMax = d > 0 ? daily.temperature_2m_max[d-1] : tmax;
    var diff = Math.round(tmax - prevMax);
    var diffHtml = '';
    if (d > 0 && diff !== 0) {
      var arrow = diff > 0 ? '↑' : '↓';
      var diffColor = diff > 0 ? 'var(--red)' : 'var(--green)';
      diffHtml = ' <span style="color:' + diffColor + ';font-weight:600;">' + arrow + ' ' + Math.abs(diff) + '°</span>';
    }
    var hiLo = '最高 ' + Math.round(tmax) + '° / 最低 ' + Math.round(tmin) + '°' + diffHtml;
    card.querySelector('.hi-lo').innerHTML = hiLo;

    var extras = [];
    extras.push('<span>' + icon + ' ' + desc + '</span>');
    extras.push('<span>💧 降雨 ' + rain + '%</span>');
    if (wind < 12) extras.push('<span>🌬️ 微风 ' + Math.round(wind) + ' km/h</span>');
    else if (wind < 30) extras.push('<span>💨 大风 ' + Math.round(wind) + ' km/h</span>');
    else extras.push('<span>🌪️ 强风 ' + Math.round(wind) + ' km/h</span>');
    if (rain >= 50) extras.push('<span>☂️ 建议带伞</span>');
    if (d > 0 && diff < -4) extras.push('<span>🧥 添衣保暖</span>');
    card.querySelector('.extra').innerHTML = extras.join('');

    // 今天：添加分时段预报
    if (d === 0 && openMeteoHourly) {
      var existHourly = card.querySelector('.weather-hourly');
      if (existHourly) existHourly.remove();
      var todayStr = dateObj.getFullYear() + '-' + ('0'+(dateObj.getMonth()+1)).slice(-2) + '-' + ('0'+dateObj.getDate()).slice(-2);
      card.insertAdjacentHTML('beforeend', renderHourlySlots(openMeteoHourly, todayStr));
    }
  }

  // Weather alert
  var alertEl = document.getElementById('weatherAlert');
  if (alertEl) {
    var rain3 = daily.precipitation_probability_max.slice(0,3);
    var maxRain = Math.max.apply(null, rain3);
    var tDiff = Math.round(daily.temperature_2m_max[2] - daily.temperature_2m_max[0]);
    var msg = '';
    if (maxRain >= 70) {
      msg = '<span style="font-size:1.5rem;">🌧️</span><div><strong>降雨提醒：</strong>未来3天降雨概率最高达 '+maxRain+'%，建议随身携带雨具。</div>';
    } else if (tDiff <= -5) {
      msg = '<span style="font-size:1.5rem;">🥶</span><div><strong>降温提醒：</strong>后天最高气温将降至 '+Math.round(daily.temperature_2m_max[2])+'°C，较今日降约 '+Math.abs(tDiff)+'°C，建议添衣保暖。</div>';
    } else if (maxRain >= 50) {
      msg = '<span style="font-size:1.5rem;">⛅</span><div><strong>天气提醒：</strong>未来3天有降雨可能（最高 '+maxRain+'%），出行注意天气变化。</div>';
    }
    if (msg) alertEl.innerHTML = msg;
    else alertEl.innerHTML = '';
  }
}

/* ===== AI News Fetch & Render ===== */
function timeAgo(isoStr) {
  var pub = new Date(isoStr), now = new Date();
  var diffMin = Math.floor((now - pub) / 60000);
  if (diffMin < 60) return diffMin + ' 分钟前';
  if (diffMin < 1440) return Math.floor(diffMin / 60) + ' 小时前';
  return Math.floor(diffMin / 1440) + ' 天前';
}

function fmtPubDate(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  var now = new Date();
  var diffMs = now - d;
  var diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return diffMin + ' 分钟前';
  if (diffMin < 1440) return Math.floor(diffMin / 60) + ' 小时前';
  var diffDay = Math.floor(diffMin / 1440);
  if (diffDay < 7) return diffDay + ' 天前';
  var mo = d.getMonth()+1, da = d.getDate(), hr = d.getHours(), mi = d.getMinutes();
  return mo + '月' + da + '日 ' + ('0'+hr).slice(-2) + ':' + ('0'+mi).slice(-2);
}

function sourceIcon(source) {
  if (source.indexOf('公众号')>=0 || source.indexOf('微信')>=0) return '📱 ';
  if (source.indexOf('X：')>=0 || source.indexOf('@')>=0) return '🐦 ';
  if (source.indexOf('TechCrunch')>=0) return '📰 ';
  if (source.indexOf('Bloomberg')>=0) return '📊 ';
  return '📝 ';
}

function renderAINews(items) {
  var container = document.getElementById('aiNewsContainer');
  var countEl = document.getElementById('aiNewsCount');
  if (!container) return;

  if (!items || !items.length) {
    container.innerHTML = '<div class="empty-section" style="padding:40px;">📭 暂无 AI 资讯，请稍后刷新</div>';
    if (countEl) countEl.textContent = '暂无数据';
    return;
  }

  // Group by category
  var cats = {
    'ai-models':  {icon:'🤖', title:'模型发布/更新', items:[]},
    'ai-products':{icon:'🚀', title:'产品发布/更新', items:[]},
    'industry':   {icon:'📡', title:'行业动态', items:[]},
    'paper':      {icon:'📄', title:'论文研究', items:[]},
    'tip':        {icon:'💡', title:'技巧与观点', items:[]}
  };
  items.forEach(function(item) {
    var cat = item.category || 'industry';
    if (cats[cat]) cats[cat].items.push(item);
  });

  var totalCount = items.length;
  if (countEl) countEl.textContent = '过去24小时精选 · 共 ' + totalCount + ' 条';

  var globalNum = 0;
  var html = '';
  var catOrder = ['ai-models','ai-products','industry','paper','tip'];
  catOrder.forEach(function(key) {
    var cat = cats[key];
    var count = cat.items.length;
    if (count === 0) {
      html += '<div class="sub-section collapsed" id="' + key + '">';
      html += '<div class="sub-header collapsible" onclick="toggleSubSection(\'' + key + '\')">';
      html += '<h3>' + cat.icon + ' ' + cat.title + '</h3><span class="sub-count">0 条</span></div>';
      html += '<div class="empty-section">暂无相关资讯</div></div>';
      return;
    }

    html += '<div class="sub-section" id="' + key + '">';
    html += '<div class="sub-header"><h3>' + cat.icon + ' ' + cat.title + '</h3><span class="sub-count">' + count + ' 条</span></div>';
    html += '<div class="cards-grid">';

    cat.items.forEach(function(item) {
      globalNum++;
      html += '<article class="card ' + key + ' animate-on-scroll visible">';
      html += '<div class="card-header"><span class="card-number">' + globalNum + '</span><h3>' + escapeHtml(item.title || '') + '</h3></div>';
      html += '<div class="card-meta"><span class="source-chip">' + sourceIcon(item.source) + escapeHtml(item.source || '未知来源') + '</span><span class="card-time">⏱ ' + escapeHtml(timeAgo(item.publishedAt)) + '</span></div>';
      html += '<p class="card-summary">' + escapeHtml(item.summary || '') + '</p>';
      html += '<a href="' + escapeHtml(safeExternalUrl(item.url)) + '" class="card-action" target="_blank" rel="noopener noreferrer">阅读原文 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 012-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>';
      html += '</article>';
    });

    html += '</div></div>';
  });

  container.innerHTML = html;
}

/* ===== Refresh Handler ===== */
btn.addEventListener('click', function() {
  btn.classList.add('spinning');
  showToast('正在获取最新数据...', 'info');
  clearAICache(); // wipe AI cache on manual refresh
  loadMarketHistoryCharts(true);
  refreshSupplementalMarketQuotes();

  Promise.all([
    // 1. Weather (current + 3-day forecast) — 心知天气 + Open-Meteo hourly
    (function() {
      var omUrl = 'https://api.open-meteo.com/v1/forecast?latitude=30.5728&longitude=104.0668&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max&hourly=temperature_2m,precipitation_probability,weathercode,windspeed_10m&timezone=Asia/Shanghai&forecast_days=3';
      return Promise.all([
        fetch(omUrl).then(function(r){return r.json();}),
        fetch('/api/llm/weather-now').then(function(r){return r.json();}).catch(function(){return null;})
      ]).then(function(rs){
        apiCacheSet('weather', rs[0]);
        apiCacheSet('weather_seniverse', rs[1]);
        return {tag:'weather', ok:true, data:rs[0], seniverse:rs[1]};
      }).catch(function(){
        var c=apiCacheGet('weather');
        return c&&c.data ? {tag:'weather',ok:true,data:c.data,seniverse:apiCacheGet('weather_seniverse')&&apiCacheGet('weather_seniverse').data,fromCache:true} : {tag:'weather',ok:false};
      });
    })(),
    // 2. 上证指数 — use safeLoadStock to share cache with finance section
    safeLoadStock('https://qt.gtimg.cn/q=sh000001','v_sh000001','sh_raw').then(function(d){return{tag:'sh',ok:true,data:d};})
      .catch(function(){return{tag:'sh',ok:false};}),
    // 3. 纳斯达克
    safeLoadStock('https://qt.gtimg.cn/q=usIXIC','v_usIXIC','nx_raw').then(function(d){return{tag:'nasdaq',ok:true,data:d};})
      .catch(function(){return{tag:'nasdaq',ok:false};}),
    // 4. 黄金 (Sina JSONP)
    loadGoldQuote().then(function(d){return{tag:'gold',ok:true,data:d};})
      .catch(function(){return{tag:'gold',ok:false};}),
    // 5. AI News — cache fallback
    fetch('/api/aihot/items?mode=selected&take=8').then(function(r){return r.json();}).then(function(d){apiCacheSet('ainews',d);return{tag:'ainews',ok:true,data:d};})
      .catch(function(){var c=apiCacheGet('ainews');return c&&c.data?{tag:'ainews',ok:true,data:c.data,fromCache:true}:{tag:'ainews',ok:false};}),
    // 6. Arena (4 categories in parallel) — cache fallback
    fetchArenaData().then(function(payload){apiCacheSet('arena',payload);return{tag:'arena',ok:true,data:payload};})
      .catch(function(){var c=apiCacheGet('arena');return c&&c.data?{tag:'arena',ok:true,data:c.data,fromCache:true}:{tag:'arena',ok:false};}),
    // 7. World News — LLM 生成 (主源), RSS 代理 (回退)
    (function() {
      return fetchWorldNewsRSS()
        .then(function(result) {
          var xml = result.text;
          if (xml && xml.indexOf('<rss') >= 0) {
            apiCacheSet('world_rss', xml);
            return { tag:'world', ok:true, source:'rss', data:xml };
          }
          throw new Error('Invalid RSS');
        })
        .catch(function() {
          var c = apiCacheGet('world_rss');
          if (c && c.data && c.data.indexOf('<rss') >= 0) {
            return { tag:'world', ok:true, fromCache:true, data:c.data };
          }
          return { tag:'world', ok:false };
        });
    })(),
    (function() {
      if (typeof window.refreshDomesticHot !== 'function') return Promise.resolve({ tag:'domestic', ok:false });
      return window.refreshDomesticHot(true);
    })(),
  ]).then(function(rs){
    var ok=0;
    var fromCacheCount=0;
    var shCur=0, shPrev=0, goldCur=0, goldPrev=0, nxCur=0, nxPrev=0;
    rs.forEach(function(r){
      if(!r.ok)return;
      if(r.fromCache) fromCacheCount++;

      if(r.tag==='weather'){
        var d=r.data&&r.data.daily;
        var snData = r.seniverse && r.seniverse.success ? {now: r.seniverse.now, daily: r.seniverse.daily} : null;
        // Hero bar: prefer seniverse current, fallback open-meteo current
        if (r.data && r.data.current) {
          var c=r.data.current;
          if (!snData) {
            var t=document.querySelector('.hero-weather-brief .temp'); if(t)t.textContent=Math.round(c.temperature_2m)+'°';
            var s=document.querySelector('.hero-weather-brief .desc strong'); if(s)s.textContent='成都双流 · '+(wmoMap[c.weather_code]||'多云');
            var desc=document.querySelector('.hero-weather-brief .desc span'); if(desc)desc.textContent='体感 '+Math.round(c.apparent_temperature)+'° · 湿度 '+c.relative_humidity_2m+'% · 微风 '+Math.round(c.wind_speed_10m)+' km/h';
          }
        }
        if(d) renderWeatherCards(d, snData, r.data && r.data.hourly ? r.data.hourly : null);
        ok++;
      }

      if(r.tag==='sh'){
        rememberMarketQuoteTime('sh', parseTencentQuoteTime(r.data));
        var p=r.data.split('~'); if(p.length>=5){
          var cur=parseFloat(p[3]), prev=parseFloat(p[4]), pct=fmtPct(cur,prev);
          shCur=cur; shPrev=prev;
          var items=document.querySelectorAll('.hero-fin-item');
          if(items[0]){items[0].querySelector('.hero-fin-val').textContent=fmtVal(cur);var pctCls=cur>=prev?'hero-fin-pct up':'hero-fin-pct down';items[0].querySelector('.hero-fin-label').innerHTML='上证 <span class="'+pctCls+'">'+pct+'</span>';}
          var all=document.querySelectorAll('.fin-item');
          for(var i=0;i<all.length;i++){if(all[i].querySelector('.name')&&all[i].querySelector('.name').textContent==='上证指数'){var upCls=cur>=prev?'fin-up':'fin-down';all[i].querySelector('.val').innerHTML=fmtVal(cur)+' <span class="'+upCls+'">'+pct+'</span>';break;}}
          ok++;
        }
      }

      if(r.tag==='nasdaq'){
        rememberMarketQuoteTime('us', parseTencentQuoteTime(r.data));
        var p=r.data.split('~'); if(p.length>=5){
          var cur=parseFloat(p[3]), prev=parseFloat(p[4]), pct=fmtPct(cur,prev);
          nxCur=cur; nxPrev=prev;  // Store Nasdaq data
          var all=document.querySelectorAll('.fin-item');
          for(var i=0;i<all.length;i++){if(all[i].querySelector('.name')&&all[i].querySelector('.name').textContent==='纳斯达克'){var upCls=cur>=prev?'fin-up':'fin-down';all[i].querySelector('.val').innerHTML=fmtVal(cur)+' <span class="'+upCls+'">'+pct+'</span>';break;}}
          ok++;
        }
      }

      if(r.tag==='gold'){
        rememberMarketQuoteTime('gold', parseSinaQuoteTime(r.data));
        var p=r.data.split(','); if(p.length>=2){
          var cur=parseFloat(p[0]), prev=parseFloat(p[1]), pct=fmtPct(cur,prev);
          goldCur=cur; goldPrev=prev;
          var items=document.querySelectorAll('.hero-fin-item');
          if(items[1]){items[1].querySelector('.hero-fin-val').textContent='$'+fmtVal(cur);var gPctCls=cur>=prev?'hero-fin-pct up':'hero-fin-pct down';items[1].querySelector('.hero-fin-label').innerHTML='黄金 <span class="'+gPctCls+'">'+pct+'</span>';}
          var gv=document.querySelector('.finance-card:nth-child(3) .fin-value'); if(gv)gv.textContent='$'+fmtVal(cur);
          var gd=document.querySelector('.finance-card:nth-child(3) .fin-change'); if(gd){gd.textContent='COMEX 黄金 · 美元/盎司';gd.className='fin-change '+(cur>=prev?'fin-up':'fin-down');}
          ok++;
        }
      }

      if(r.tag==='ainews'){
        renderAINews(r.data.items);
        ok++;
      }

      if(r.tag==='arena'){
        renderArena(r.data);
        ok++;
      }

      if(r.tag==='world'){
        renderWorldNews(r.data);
        ok++;
      }

      if(r.tag==='domestic'){
        ok++;
      }
    });

    updateFinanceTimestamps({ sh:marketQuoteTimes.sh, us:marketQuoteTimes.us, gold:marketQuoteTimes.gold });
    if (shCur && shPrev && goldCur && goldPrev && nxCur && nxPrev) {
      renderFinanceAnalysis(shCur, shPrev, goldCur, goldPrev, nxCur, nxPrev);
    } else {
      renderFinanceDataUnavailable();
    }

    updateTime();
    pulseLiveIndicators();
    btn.classList.remove('spinning');
    forceRefresh = false;
    var msg = '✅ 数据已刷新';
    if (fromCacheCount > 0) msg += ' (' + fromCacheCount + ' 项来自缓存)';
    showToast(ok>=6?msg:'⚠️ 部分数据获取失败 ('+ok+'/8)', ok>=6?'success':'error');
  }).catch(function(error){
    console.error('Manual refresh failed:', error);
    btn.classList.remove('spinning');
    forceRefresh = false;
    showToast('❌ 刷新失败：' + (error && error.message ? error.message : '未知错误'),'error');
  });
});

// Auto-run on DOM ready — network-first, cache-fallback for all API data
function initAutoLoad() {
  // ===== Weather: 心知天气(当前+日预报) + Open-Meteo(daily+hourly) =====
  var openMeteoDaily = 'https://api.open-meteo.com/v1/forecast?latitude=30.5728&longitude=104.0668&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max&hourly=temperature_2m,precipitation_probability,weathercode,windspeed_10m&timezone=Asia/Shanghai&forecast_days=3';
  var seniverseProxy = '/api/llm/weather-now';

  Promise.all([
    fetch(openMeteoDaily).then(function(r){return r.json();}),
    fetch(seniverseProxy).then(function(r){return r.json();}).catch(function(){return null;})
  ]).then(function(results) {
    var omData = results[0], snData = results[1];
    if (omData) {
      apiCacheSet('weather', omData);
      apiCacheSet('weather_seniverse', snData);
      if (omData.daily) {
        var snNowDaily = snData && snData.success ? {now: snData.now, daily: snData.daily} : null;
        renderWeatherCards(omData.daily, snNowDaily, omData.hourly || null);
      }
    }
  }).catch(function(e){
    console.error('Weather auto-load failed:',e);
    var cached = apiCacheGet('weather');
    if (cached && cached.data && cached.data.daily) {
      var snCached = apiCacheGet('weather_seniverse');
      renderWeatherCards(cached.data.daily, snCached && snCached.data, cached.data.hourly || null);
    }
  });

  // ===== AI News =====
  var c = document.getElementById('aiNewsContainer');
  if (!c) { console.error('aiNewsContainer not found'); return; }

  var cnt = document.getElementById('aiNewsCount');
  var badge = document.getElementById('aiNewsBadge');

  fetch('/api/aihot/items?mode=selected&take=8')
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(d) {
      if (!d || !d.items) { console.error('AI news API: no items in response', d); throw new Error('empty response'); }
      apiCacheSet('ainews', d);
      renderAINews(d.items);
      if (badge) { badge.className = 'freshness-badge live'; badge.innerHTML = '<span class="freshness-dot"></span>实时数据'; }
    })
    .catch(function(e) {
      console.error('AI news auto-load error:', e);
      var cached = apiCacheGet('ainews');
      if (cached && cached.data && cached.data.items) {
        renderAINews(cached.data.items);
        if (badge) { badge.className = 'freshness-badge snapshot'; badge.innerHTML = '<span class="freshness-dot"></span>缓存数据'; }
      } else {
        if (c) c.innerHTML = '<div class="empty-section" style="padding:40px;color:var(--red);">⚠️ AI 资讯加载失败，请点击右下角刷新按钮重试<br><small style="opacity:0.6;margin-top:8px;display:block;">' + (e.message||'网络错误') + '</small></div>';
        if (cnt) cnt.textContent = '加载失败';
        if (badge) { badge.className = 'freshness-badge snapshot'; badge.innerHTML = '<span class="freshness-dot"></span>加载失败'; }
      }
    });

  // ===== Arena =====
  fetchArenaData()
    .then(function(payload){
      apiCacheSet('arena', payload);
      renderArena(payload);
    })
    .catch(function(e){
      console.error('Arena auto-load error:', e);
      var cached = apiCacheGet('arena');
      if (cached && cached.data) renderArena(cached.data);
    });

  // ===== World News — LLM 生成 (主源), RSS 代理 (回退) =====
  (function() {
    return fetchWorldNewsRSS()
      .then(function(result) {
        var xml = result.text;
        if (xml && xml.indexOf('<rss') >= 0) {
          apiCacheSet('world_rss', xml);
          renderWorldNews(xml);
        } else {
          throw new Error('Invalid RSS response');
        }
      })
      .catch(function(e) {
        console.error('World news auto-load error:', e);
        var cached = apiCacheGet('world_rss');
        if (cached && cached.data && cached.data.indexOf('<rss') >= 0) {
          renderWorldNews(cached.data);
        } else {
          var wc = document.getElementById('worldContainer');
          if (wc) wc.innerHTML = '<div class="empty-section" style="padding:40px;color:var(--red);">国际局势加载失败：' + (e.message || '网络错误') + '</div>';
        }
      });
  })();

  // ===== "我的关注" — 独立加载，不依赖国际新闻解析成功 =====
  // My Focus is generated after verified world-news headlines are available.

  // ===== Stock Market Data (上证 / 纳斯达克 / 黄金) =====
  // Load stocks and update hero-finance-brief + fin-cards + render AI finance analysis
  loadMarketHistoryCharts(false);
  Promise.all([
    safeLoadStock('https://qt.gtimg.cn/q=sh000001','v_sh000001','sh_raw').then(function(d){return{tag:'sh',ok:true,data:d};})
      .catch(function(){return{tag:'sh',ok:false};}),
    safeLoadStock('https://qt.gtimg.cn/q=usIXIC','v_usIXIC','nx_raw').then(function(d){return{tag:'nasdaq',ok:true,data:d};})
      .catch(function(){return{tag:'nasdaq',ok:false};}),
    loadGoldQuote().then(function(d){return{tag:'gold',ok:true,data:d};})
      .catch(function(){return{tag:'gold',ok:false};})
  ]).then(function(rs){
    var shCur=0, shPrev=0, goldCur=0, goldPrev=0, nxCur=0, nxPrev=0;
    rs.forEach(function(r){
      if(!r.ok)return;
      if(r.tag==='sh'){
        rememberMarketQuoteTime('sh', parseTencentQuoteTime(r.data));
        var p=r.data.split('~'); if(p.length>=5){
          shCur=parseFloat(p[3]); shPrev=parseFloat(p[4]);
          var pct=fmtPct(shCur,shPrev);
          var items=document.querySelectorAll('.hero-fin-item');
          if(items[0]){items[0].querySelector('.hero-fin-val').textContent=fmtVal(shCur);var pctCls=shCur>=shPrev?'hero-fin-pct up':'hero-fin-pct down';items[0].querySelector('.hero-fin-label').innerHTML='上证 <span class="'+pctCls+'">'+pct+'</span>';}
          var all=document.querySelectorAll('.fin-item');
          for(var i=0;i<all.length;i++){if(all[i].querySelector('.name')&&all[i].querySelector('.name').textContent==='上证指数'){var upCls=shCur>=shPrev?'fin-up':'fin-down';all[i].querySelector('.val').innerHTML=fmtVal(shCur)+' <span class="'+upCls+'">'+pct+'</span>';break;}}
        }
      }
      if(r.tag==='nasdaq'){
        rememberMarketQuoteTime('us', parseTencentQuoteTime(r.data));
        var p=r.data.split('~'); if(p.length>=5){
          nxCur=parseFloat(p[3]); nxPrev=parseFloat(p[4]);
          var pct=fmtPct(nxCur,nxPrev);
          var all=document.querySelectorAll('.fin-item');
          for(var i=0;i<all.length;i++){if(all[i].querySelector('.name')&&all[i].querySelector('.name').textContent==='纳斯达克'){var upCls=nxCur>=nxPrev?'fin-up':'fin-down';all[i].querySelector('.val').innerHTML=fmtVal(nxCur)+' <span class="'+upCls+'">'+pct+'</span>';break;}}
        }
      }
      if(r.tag==='gold'){
        rememberMarketQuoteTime('gold', parseSinaQuoteTime(r.data));
        var p=r.data.split(','); if(p.length>=2){
          goldCur=parseFloat(p[0]); goldPrev=parseFloat(p[1]);
          var pct=fmtPct(goldCur,goldPrev);
          var items=document.querySelectorAll('.hero-fin-item');
          if(items[1]){items[1].querySelector('.hero-fin-val').textContent='$'+fmtVal(goldCur);var gPctCls=goldCur>=goldPrev?'hero-fin-pct up':'hero-fin-pct down';items[1].querySelector('.hero-fin-label').innerHTML='黄金 <span class="'+gPctCls+'">'+pct+'</span>';}
          var gv=document.querySelector('.finance-card:nth-child(3) .fin-value'); if(gv)gv.textContent='$'+fmtVal(goldCur);
          var gd=document.querySelector('.finance-card:nth-child(3) .fin-change'); if(gd){gd.textContent='COMEX 黄金 · 美元/盎司';gd.className='fin-change '+(goldCur>=goldPrev?'fin-up':'fin-down');}
        }
      }
    });
    updateFinanceTimestamps({ sh:marketQuoteTimes.sh, us:marketQuoteTimes.us, gold:marketQuoteTimes.gold });
    if (shCur && shPrev && goldCur && goldPrev && nxCur && nxPrev) {
      renderFinanceAnalysis(shCur, shPrev, goldCur, goldPrev, nxCur, nxPrev);
    } else {
      renderFinanceDataUnavailable();
    }
  });
}

// Run as soon as DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAutoLoad);
} else {
  initAutoLoad();
}

