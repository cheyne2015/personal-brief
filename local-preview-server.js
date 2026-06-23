const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');

const root = __dirname;
const port = Number(process.env.PREVIEW_PORT || 8080);
const liveOrigin = process.env.LIVE_ORIGIN || 'https://brief.0cy.top';
const localLlmOrigin = process.env.LOCAL_LLM_ORIGIN || 'http://127.0.0.1:3000';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};
const publicFiles = new Set([
  'ai-morning-brief.html', 'styles.css', 'favicon.ico', 'favicon.png',
  'js/effects.js', 'js/domestic-news.js', 'js/core.js', 'js/arena.js',
  'js/world.js', 'js/finance.js', 'js/data.js'
]);

function fetchTextWithCurl(url, headers) {
  return new Promise((resolve, reject) => {
    const args = ['-L', '-s', '--ssl-no-revoke'];
    (headers || []).forEach((header) => args.push('-H', header));
    args.push(url);
    execFile('curl.exe', args, { timeout: 10000, windowsHide: true }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

async function sendProxyRequest(req, res, target, chunks, proxyLabel) {
  const upstream = await fetch(target, {
    method: req.method,
    headers: {
      'content-type': req.headers['content-type'] || 'application/json',
      'user-agent': 'local-preview-server',
      'x-brief-local-preview': '1'
    },
    body: chunks.length ? Buffer.concat(chunks) : undefined
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Preview-Proxy': proxyLabel || 'unknown'
  });
  res.end(body);
}

async function proxyToLive(req, res) {
  const target = new URL(req.url, liveOrigin);
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    try {
      await sendProxyRequest(req, res, target, chunks, 'live');
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  });
}

async function proxyToLocalLlm(req, res) {
  const target = new URL(req.url.replace(/^\/api\/llm\//, '/'), localLlmOrigin);
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    try {
      await sendProxyRequest(req, res, target, chunks, 'local-llm');
    } catch (err) {
      // Keep preview usable when the local LLM service is not running.
      try {
        await sendProxyRequest(req, res, new URL(req.url, liveOrigin), chunks, 'live-fallback');
      } catch (fallbackErr) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: fallbackErr.message, localError: err.message }));
      }
    }
  });
}

function normalizeHotTitle(title) {
  return String(title || '').toLowerCase().replace(/[#\s\p{P}\p{S}]/gu, '');
}

function similarHotTitle(left, right) {
  if (left.includes(right) || right.includes(left)) return true;
  const bigrams = value => new Set(Array.from({ length:Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)));
  const a = bigrams(left), b = bigrams(right);
  let shared = 0;
  a.forEach(token => { if (b.has(token)) shared++; });
  return shared >= 5 && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.58;
}

function classifyDomesticImportance(title, summary) {
  const text = String(title || '') + ' ' + String(summary || '');
  const blocked = ['明星','演员','男团','女团','综艺','粉丝','恋情','演唱会','红毯','穿搭','票房','电视剧','电影','网红','直播带货','游戏','电竞','赛龙舟','龙舟','屈原','粽子','端午','仪式感','萌宠','球星','世界杯','决赛门票','秀书法','香包','乡愁','半裸救女客','耍流氓','找她老公','黄子韬','李现','闫学晶','老年团','旅游团','低价团','韩国','英国','加拿大','阿根廷','墨西哥','瑞士','莫斯科','泰国','缅甸','中缅','全球治理','佛得角','统一品牌10周年','全社会跨区域人员流动量','加速迈向价值竞争','投资中国的“下一篇”','讲述我的育人故事','报告锚定净零','机甲巡游','巧打“侨”牌','催人奋进','永远的“四大队”','光彩事业'];
  if (blocked.some(term => String(title || '').includes(term))) return null;
  const groups = [
    { category:'社会要闻', terms:['警方','公安','法院','检察院','调查','通报','事故','案件','违法','犯罪','救援','灾害','自然灾害','安全','公共事件','社会治理','消费者','权益','房东','退租','杀熟','运营商','防暴','纠纷','献血','血库','媒体评'] },
    { category:'民生', terms:['民生','医疗','教育','就业','住房','房价','养老','社保','医保','食品','物价','生育','儿童','未成年人','居民','工资','天气','高温','暴雨','12306','铁路','航空','机场','公交','地铁','高速','交通运输部','跨区域人员流动','行李箱','外卖','献血','血库','中毒','谣言','孕妇','农户','老人','蛇咬'] },
    { category:'机会观察', terms:['招聘','创业','补贴','消费券','技能培训','职业培训','职业技能','新职业','人才计划','个体工商户','小微企业','税费减免','贷款贴息','项目申报','项目资金','以旧换新','养老服务','托育服务','县域经济','夜间经济','产业带','平台经济','大中小企业协同','跨境电商','出海','出口订单','增收','就业机会','灵活就业'] },
    { category:'科技发展', terms:['科技','人工智能','AI','DeepSeek','芯片','半导体','航天','卫星','量子','算力','大模型','新能源','电池','科研','技术突破','国产替代','机器人','机甲','智能制造','AMOLED','生产线','单神经元','网络安全','网联摄像头'] },
    { category:'金融经济', terms:['经济','金融','央行','人民币','A股','股市','楼市','财政','税收','银行','基金','债券','消费政策','消费数据','外贸','出口','进口','投资','企业','产业','油价','金价','GDP','市场监管','关税','平台经济','项目资金','中欧班列','集装箱船'] },
    { category:'政策政务', terms:['总书记','国务院','中央','政府','政策','新规','改革','发布会','国家统计局','最高法','教育部','工信部','商务部','国家卫健委'] }
  ];
  let best = null;
  groups.forEach(group => {
    const hits = group.terms.filter(term => text.includes(term)).length;
    if (hits && (!best || hits > best.score)) best = { category:group.category, score:hits };
  });
  const opportunitySignals = ['招聘','创业','补贴','消费券','技能培训','职业培训','新职业','个体工商户','小微企业','税费减免','贷款贴息','项目申报','以旧换新','平台经济','大中小企业协同','跨境电商','出海','出口订单','灵活就业'];
  const opportunityHits = opportunitySignals.filter(term => text.includes(term)).length;
  if (opportunityHits) best = { category:'机会观察', score:Math.max(best ? best.score : 0, opportunityHits * 3) };
  if (text.includes('中欧班列')) best = { category:'金融经济', score:Math.max(best ? best.score : 0, 3) };
  const majorTerms = ['重大产业工程','国家级','全球首次','科学家','自然灾害','网络安全','实施规则','加征','关税','量产','生产线','项目资金','平台经济','防汛','洪水','招聘','创业','补贴','消费券','技能培训','新职业','税费减免','贷款贴息'];
  if (best) best.score += majorTerms.filter(term => text.includes(term)).length * 3;
  return best;
}

function decodeRssValue(value) {
  return String(value || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function parseSeriousRss(xml, source, forcedCategory) {
  const items = [];
  const now = Date.now();
  for (const match of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const read = tag => {
      const found = block.match(new RegExp('<' + tag + '(?:[^>]*)>([\\s\\S]*?)<\\/' + tag + '>'));
      return decodeRssValue(found ? found[1] : '');
    };
    const title = read('title');
    const pubDate = read('pubDate');
    const timestamp = Date.parse(pubDate);
    if (!title || !timestamp || now - timestamp > 36 * 60 * 60 * 1000) continue;
    const summary = read('description');
    const detected = classifyDomesticImportance(title, summary);
    const category = detected ? detected.category : '';
    if (!category) continue;
    items.push({ title, summary, url:read('link'), source, category, importanceScore:detected.score, pubDate });
    if (items.length >= 30) break;
  }
  return items;
}

let domesticHotCache = null;
async function serveDomesticHot(req, res) {
  try {
    const forceRefresh = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';
    if (!forceRefresh && domesticHotCache && Date.now() - domesticHotCache.savedAt < 5 * 60 * 1000) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ...domesticHotCache.payload, cached: true }));
      return;
    }
    const baseHeaders = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,text/html;q=0.9,*/*;q=0.8' };
    const results = await Promise.allSettled([
      fetch('https://weibo.com/ajax/side/hotSearch', { headers: { ...baseHeaders, Referer: 'https://weibo.com/' } }).then(r => r.json()),
      fetch('https://top.baidu.com/board?tab=realtime', { headers: { ...baseHeaders, Referer: 'https://top.baidu.com/' } }).then(r => r.text()),
      fetch('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', { headers: { ...baseHeaders, Referer: 'https://www.toutiao.com/' } }).then(r => r.json()),
      fetch('https://www.chinanews.com.cn/rss/finance.xml', { headers:baseHeaders }).then(r => r.text()),
      fetch('https://www.chinanews.com.cn/rss/china.xml', { headers:baseHeaders }).then(r => r.text()),
      fetch('https://www.chinanews.com.cn/rss/society.xml', { headers:baseHeaders }).then(r => r.text()),
      fetch('https://www.chinanews.com.cn/rss/life.xml', { headers:baseHeaders }).then(r => r.text())
    ]);
    const ranked = [];
    const sources = [];
    if (results[0].status === 'fulfilled') {
      const rows = results[0].value && results[0].value.data && results[0].value.data.realtime || [];
      if (rows.length) sources.push('微博');
      rows.filter(x => x.word && x.realpos).slice(0, 40).forEach((x, i) => ranked.push({ source: '微博', rank: Number(x.realpos) || i + 1, title: x.word, summary:'', heat: Number(x.num) || 0, url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(x.word) }));
    }
    if (results[1].status === 'fulfilled') {
      try {
        const match = results[1].value.match(/<!--s-data:([\s\S]*?)-->/);
        const payload = match ? JSON.parse(match[1]) : null;
        const cards = payload && payload.data && payload.data.cards || [];
        const card = cards.find(x => x.component === 'hotList');
        const rows = card && card.content || [];
        if (rows.length) sources.push('百度');
        rows.slice(0, 40).forEach((x, i) => ranked.push({ source: '百度', rank: i + 1, title: x.query, summary:x.desc || '', heat: Number(x.hotScore) || 0, url: x.rawUrl || x.url || 'https://top.baidu.com/board?tab=realtime' }));
      } catch (err) {}
    }
    if (results[2].status === 'fulfilled') {
      const rows = results[2].value && results[2].value.data || [];
      if (rows.length) sources.push('头条');
      rows.slice(0, 40).forEach((x, i) => ranked.push({ source: '头条', rank: i + 1, title: x.Title, summary:'', heat: Number(x.HotValue) || 0, url: x.Url || 'https://www.toutiao.com/' }));
    }
    if (results[3].status === 'fulfilled') {
      const rows = parseSeriousRss(results[3].value, '中新网财经', '金融经济');
      if (rows.length) sources.push('中新网财经');
      rows.forEach((x, i) => ranked.push({ ...x, rank:i + 1, heat:0 }));
    }
    if (results[4].status === 'fulfilled') {
      const rows = parseSeriousRss(results[4].value, '中新网国内', '社会要闻');
      if (rows.length) sources.push('中新网国内');
      rows.forEach((x, i) => ranked.push({ ...x, rank:i + 1, heat:0 }));
    }
    if (results[5].status === 'fulfilled') {
      const rows = parseSeriousRss(results[5].value, '中新网社会');
      if (rows.length) sources.push('中新网社会');
      rows.forEach((x, i) => ranked.push({ ...x, rank:i + 1, heat:0 }));
    }
    if (results[6].status === 'fulfilled') {
      const rows = parseSeriousRss(results[6].value, '中新网生活');
      if (rows.length) sources.push('中新网生活');
      rows.forEach((x, i) => ranked.push({ ...x, rank:i + 1, heat:0 }));
    }
    const grouped = new Map();
    ranked.forEach(item => {
      const importance = item.category ? { category:item.category, score:item.importanceScore || 2 } : classifyDomesticImportance(item.title, item.summary);
      if (!importance) return;
      let key = normalizeHotTitle(item.title);
      if (!key) return;
      const similarKey = Array.from(grouped.keys()).find(existing => existing.length >= 8 && key.length >= 8 && similarHotTitle(existing, key));
      if (similarKey) key = similarKey;
      const entry = grouped.get(key) || { title: item.title, summary:item.summary || '', category:importance.category, url: item.url, publishedAt:item.pubDate || '', score: 0, heat: 0, sources: [], sourceRanks: [] };
      if (item.summary && item.summary.length > entry.summary.length) entry.summary = item.summary;
      if (item.pubDate && (!entry.publishedAt || Date.parse(item.pubDate) > Date.parse(entry.publishedAt))) entry.publishedAt = item.pubDate;
      if (!entry.sources.includes(item.source)) entry.sources.push(item.source);
      entry.sourceRanks.push(item.source + '#' + item.rank);
      entry.score += Math.max(1, 41 - item.rank) + importance.score * 20;
      entry.heat = Math.max(entry.heat, item.heat);
      grouped.set(key, entry);
    });
    const sorted = Array.from(grouped.values()).filter(item => item.summary)
      .sort((a, b) => (b.sources.length - a.sources.length) || (b.score - a.score) || (b.heat - a.heat));
    const picked = [];
    function take(categories, count) {
      sorted.forEach(item => {
        if (picked.length >= 10 || count <= 0 || picked.includes(item)) return;
        if (categories.includes(item.category)) { picked.push(item); count--; }
      });
    }
    take(['社会要闻','民生'], 4);
    take(['机会观察'], 2);
    take(['金融经济'], 2);
    take(['科技发展'], 1);
    take(['社会要闻','民生','机会观察','金融经济','科技发展','政策政务'], 10 - picked.length);
    const items = picked.slice(0, 10).map((item, index) => ({ ...item, rank:index + 1, aggregateScore:item.sources.length * 1000 + item.score }));
    const payload = { success: true, fetchedAt: new Date().toISOString(), sources, items };
    domesticHotCache = { savedAt: Date.now(), payload };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function serveGoldMarket(res) {
  try {
    let text = '';
    try {
      const upstream = await fetch('https://hq.sinajs.cn/list=hf_XAU,hf_CL,SGE_AUTD,SGE_AU9999', {
        headers: {
          'Referer': 'https://finance.sina.com.cn/',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      if (upstream.ok) text = await upstream.text();
    } catch (err) {
      text = '';
    }
    if (!text) {
      text = await fetchTextWithCurl('https://hq.sinajs.cn/list=hf_XAU,hf_CL,SGE_AUTD,SGE_AU9999', [
        'Referer: https://finance.sina.com.cn/',
        'User-Agent: Mozilla/5.0'
      ]).catch(() => '');
    }
    const londonGold = text.match(/hq_str_hf_XAU="([^"]*)"/);
    const crudeOil = text.match(/hq_str_hf_CL="([^"]*)"/);
    const shGold = text.match(/hq_str_SGE_AUTD="([^"]*)"/);
    const shGold9999 = text.match(/hq_str_SGE_AU9999="([^"]*)"/);
    let shGoldRaw = shGold ? shGold[1] : '';
    let shGoldTimestamp = '';
    let shGoldSource = shGoldRaw ? 'Sina' : '';
    const shGoldPrice = parseFloat(shGoldRaw.split(',')[3]);
    if (!Number.isFinite(shGoldPrice)) {
      shGoldRaw = shGold9999 ? shGold9999[1] : '';
      if (shGoldRaw) shGoldSource = 'Sina';
    }
    try {
      const sge = await fetch('https://www.sge.com.cn/graph/quotations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Referer': 'https://www.sge.com.cn/',
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        body: 'instid=Au99.99'
      });
      if (sge.ok) {
        const quote = await sge.json();
        const prices = Array.isArray(quote.data)
          ? quote.data.map(Number).filter(value => Number.isFinite(value) && value > 0)
          : [];
        if (prices.length) {
          const contract = String(quote.heyue || 'Au99.99');
          shGoldRaw = `${contract},${contract},${contract},${prices[prices.length - 1]},--,--,--,--,--,--,--,--,--,--,--,--,SGE,`;
          shGoldTimestamp = String(quote.delaystr || '');
          shGoldSource = 'Shanghai Gold Exchange';
        }
      }
    } catch (err) {}
    if (!Number.isFinite(parseFloat(shGoldRaw.split(',')[3]))) {
      try {
        const emText = await fetchTextWithCurl('https://push2.eastmoney.com/api/qt/stock/get?fltt=2&fields=f43,f57,f58,f60,f169,f170&secid=118.mAUTD');
        const quote = JSON.parse(emText);
        const q = quote && quote.data ? quote.data : {};
        if (Number.isFinite(Number(q.f43))) {
          shGoldRaw = `${q.f57 || 'mAUTD'},${q.f58 || 'Mini Gold T+D'},${q.f58 || 'Mini Gold T+D'},${q.f43},--,--,--,--,--,--,--,--,--,--,--,--,Eastmoney,${q.f170 || ''}%`;
          shGoldSource = 'Eastmoney';
        }
      } catch (err) {}
    }
    if (!londonGold && !shGoldRaw) throw new Error('Gold market sources unavailable');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      success: true,
      raw: londonGold ? londonGold[1] : '',
      oilRaw: crudeOil ? crudeOil[1] : '',
      shGoldRaw,
      shGoldTimestamp,
      shGoldSource
    }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

const MARKET_HISTORY_SYMBOLS = {
  shanghai: { tencent:'sh000001', responseKey:'sh000001', name:'上证指数', currency:'CNY' },
  nasdaq: { tencent:'usIXIC', responseKey:'us.IXIC', name:'纳斯达克', currency:'USD' },
  gold: { sina:'GC', name:'COMEX黄金', currency:'USD/oz' }
};
const marketHistoryCache = new Map();

async function serveMarketHistory(req, res) {
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const symbolKey = requestUrl.searchParams.get('symbol') || '';
    const config = MARKET_HISTORY_SYMBOLS[symbolKey];
    if (!config) throw new Error('Unsupported market symbol');
    const cached = marketHistoryCache.get(symbolKey);
    if (requestUrl.searchParams.get('refresh') !== '1' && cached && Date.now() - cached.savedAt < 10 * 60 * 1000) {
      res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
      res.end(JSON.stringify({ ...cached.payload, cached:true }));
      return;
    }
    let points = [];
    if (config.tencent) {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${config.tencent},day,,,35`;
      const text = await fetchTextWithCurl(url, ['User-Agent: Mozilla/5.0', 'Accept: application/json']);
      const json = JSON.parse(text);
      const rows = json && json.data && json.data[config.responseKey] ? json.data[config.responseKey].day || [] : [];
      points = rows.map(row => ({ date:String(row[0] || ''), close:Number(row[2]) }));
    } else if (config.sina) {
      const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var_${config.sina}=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${config.sina}`;
      const text = await fetchTextWithCurl(url, ['Referer: https://finance.sina.com.cn/', 'User-Agent: Mozilla/5.0']);
      const start = text.indexOf(`var_${config.sina}=(`);
      const end = text.lastIndexOf(');');
      if (start >= 0 && end > start) {
        const rows = JSON.parse(text.slice(start + `var_${config.sina}=(`.length, end));
        points = rows.map(row => ({ date:String(row.date || ''), close:Number(row.close) }));
      }
    }
    points = points.filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.close)).slice(-30);
    if (points.length < 2) throw new Error('Insufficient history data');
    const payload = { success:true, symbol:symbolKey, name:config.name, currency:config.currency, fetchedAt:new Date().toISOString(), points };
    marketHistoryCache.set(symbolKey, { savedAt:Date.now(), payload });
    res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.writeHead(502, { 'Content-Type':'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success:false, error:err.message }));
  }
}

async function serveRssProxy(req, res) {
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const rawUrl = requestUrl.searchParams.get('url');
    if (!rawUrl) throw new Error('Missing url parameter');
    const target = new URL(rawUrl);
    const allowedHosts = ['actually-relevant-api.onrender.com', 'news.google.com'];
    const allowed = target.protocol === 'https:' && allowedHosts.some(host => target.hostname === host || target.hostname.endsWith('.' + host));
    if (!allowed) throw new Error('RSS host is not allowed');
    let text = '';
    try {
      text = await fetchTextWithCurl(target.href, [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'Accept: application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language: en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7'
      ]);
    } catch (curlError) {
      const upstream = await fetch(target.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7'
        }
      });
      if (!upstream.ok) throw new Error(`RSS upstream error: ${upstream.status}`);
      text = await upstream.text();
    }
    if (!text || text.indexOf('<item') < 0) throw new Error('RSS upstream returned no items');
    res.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(text);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function serveArenaLeaderboard(req, res) {
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const date = requestUrl.searchParams.get('date') || '';
    const category = requestUrl.searchParams.get('category') || '';
    const allowedCategories = new Set(['text', 'code', 'text-to-image', 'text-to-video']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Invalid date' }));
      return;
    }
    if (!allowedCategories.has(category)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Invalid category' }));
      return;
    }
    const upstream = await fetch(`https://raw.githubusercontent.com/oolong-tea-2026/arena-ai-leaderboards/main/data/${date}/${category}.json`, {
      headers: { 'User-Agent': 'local-preview-server' }
    });
    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: `Arena upstream error: ${upstream.status}` }));
      return;
    }
    const data = await upstream.text();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  if (urlPath.startsWith('/api/llm/') || urlPath.startsWith('/api/aihot/')) {
    if (urlPath === '/api/llm/rss-proxy') {
      serveRssProxy(req, res);
      return;
    }
    if (urlPath === '/api/llm/arena-leaderboard') {
      serveArenaLeaderboard(req, res);
      return;
    }
    if (urlPath === '/api/llm/market/gold') {
      serveGoldMarket(res);
      return;
    }
    if (urlPath === '/api/llm/market/history') {
      serveMarketHistory(req, res);
      return;
    }
    if (urlPath === '/api/llm/domestic-hot') {
      serveDomesticHot(req, res);
      return;
    }
    if (urlPath.startsWith('/api/llm/')) {
      proxyToLocalLlm(req, res);
    } else {
      proxyToLive(req, res);
    }
    return;
  }

  if (urlPath === '/' || urlPath === '/index.html') {
    sendFile(res, path.join(root, 'ai-morning-brief.html'));
    return;
  }

  const requestedFile = urlPath.replace(/^\/+/, '');
  if (!publicFiles.has(requestedFile)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  sendFile(res, path.join(root, requestedFile));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local preview: http://127.0.0.1:${port}/`);
  console.log(`Local LLM target: ${localLlmOrigin}`);
  console.log(`Proxy target: ${liveOrigin}`);
});
