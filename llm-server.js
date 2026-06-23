const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.set('trust proxy', true);

const DEFAULT_ALLOWED_ORIGINS = 'http://0cy.top,https://0cy.top,http://brief.0cy.top,https://brief.0cy.top';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: function(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '256kb' }));

const TRANSLATE_DAILY_LIMIT = parseInt(process.env.TRANSLATE_DAILY_LIMIT || '50', 10);
const ANALYSIS_DAILY_LIMIT = parseInt(process.env.ANALYSIS_DAILY_LIMIT || '20', 10);
const GENERATE_DAILY_LIMIT = parseInt(process.env.GENERATE_DAILY_LIMIT || '10', 10);
const WHITELIST_IPS = ['127.0.0.1', '::1'];
const ipDayCounts = new Map();
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Shanghai';
const RUNTIME_DIR = path.resolve(process.env.RUNTIME_DIR || path.join(__dirname, '.runtime'));
const RATE_LIMIT_FILE = path.join(RUNTIME_DIR, 'rate-limits.json');

function getDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year:'numeric', month:'2-digit', day:'2-digit'
  }).format(new Date()).replace(/-/g, '');
}

function getClientIP(req) {
  let ip = req.ip || req.connection.remoteAddress || 'unknown';
  ip = ip.replace(/^::ffff:/, '');
  if (ip === '::1' || ip === '127.0.0.1') ip = '127.0.0.1';
  return ip;
}

function persistRateLimitState() {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive:true });
    const tempFile = RATE_LIMIT_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(Object.fromEntries(ipDayCounts)), 'utf8');
    fs.renameSync(tempFile, RATE_LIMIT_FILE);
  } catch (error) {
    console.warn('Rate-limit persistence unavailable:', error.message);
  }
}

function loadRateLimitState() {
  try {
    const saved = JSON.parse(fs.readFileSync(RATE_LIMIT_FILE, 'utf8'));
    const todayMarker = '_' + getDateKey() + '_';
    Object.entries(saved).forEach(function(entry) {
      const key = entry[0];
      const value = Number(entry[1]);
      if (key.includes(todayMarker) && Number.isInteger(value) && value > 0) ipDayCounts.set(key, value);
    });
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Rate-limit state ignored:', error.message);
  }
}

loadRateLimitState();

function aiRateLimiter(req, res, next) {
  const ip = getClientIP(req);
  if (WHITELIST_IPS.includes(ip)) return next();

  const isTranslate = req.path === '/translate';
  const isGenerate = req.path === '/world-news-generate' || req.path === '/my-focus-analysis';
  let limit = ANALYSIS_DAILY_LIMIT;
  let type = 'analysis';
  if (isTranslate) {
    limit = TRANSLATE_DAILY_LIMIT;
    type = 'translate';
  } else if (isGenerate) {
    limit = GENERATE_DAILY_LIMIT;
    type = 'generate';
  }

  const entryKey = ip + '_' + getDateKey() + '_' + type;
  const count = ipDayCounts.get(entryKey) || 0;
  if (count >= limit) {
    return res.status(429).json({
      success: false,
      error: 'Daily ' + type + ' request limit reached: ' + limit,
      retryAfter: 'tomorrow 00:00'
    });
  }

  ipDayCounts.set(entryKey, count + 1);
  persistRateLimitState();
  next();
}

setInterval(function() {
  const todayKey = getDateKey();
  let changed = false;
  ipDayCounts.forEach(function(_value, key) {
    if (!key.includes('_' + todayKey + '_')) {
      ipDayCounts.delete(key);
      changed = true;
    }
  });
  if (changed) persistRateLimitState();
}, 60 * 60 * 1000);

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const RSS_PROXY_ALLOWLIST = (process.env.RSS_PROXY_ALLOWLIST || 'actually-relevant-api.onrender.com,news.google.com')
  .split(',')
  .map(host => host.trim().toLowerCase())
  .filter(Boolean);
const ARENA_CATEGORIES = new Set(['text', 'code', 'text-to-image', 'text-to-video']);

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function callDeepSeek(messages, maxTokens = 500) {
  if (!DEEPSEEK_API_KEY) throw new Error('DeepSeek API key is not configured');
  const response = await fetchWithTimeout(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + DEEPSEEK_API_KEY
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7,
      stream: false
    })
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error('DeepSeek API error: ' + response.status + ' ' + error);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

function isValidQuote(value) {
  return value && Number.isFinite(Number(value.cur)) && Number.isFinite(Number(value.prev)) && Number(value.prev) !== 0;
}

function cleanTextList(values, maxItems, maxLength) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, maxItems).map(value => String(value || '').trim().slice(0, maxLength)).filter(Boolean);
}

// 1. 金融走势分析
app.post('/finance-analysis', aiRateLimiter, async (req, res) => {
  try {
    const { shanghai, gold, nasdaq, context } = req.body;
    if (![shanghai, gold, nasdaq].every(isValidQuote)) {
      return res.status(400).json({ success:false, error:'Valid current and previous market values are required' });
    }

    const shChange = ((shanghai.cur - shanghai.prev) / shanghai.prev * 100).toFixed(2);
    const goldChange = ((gold.cur - gold.prev) / gold.prev * 100).toFixed(2);
    const nasdaqChange = ((nasdaq.cur - nasdaq.prev) / nasdaq.prev * 100).toFixed(2);

    const cleanContextItems = (values, maxItems) => Array.isArray(values) ? values.slice(0, maxItems).map(item => ({
      title: String(item && item.title || '').trim().slice(0, 260),
      summary: String(item && item.summary || '').trim().slice(0, 260),
      category: String(item && (item.category || item.bucket) || '').trim().slice(0, 80),
      time: String(item && item.time || '').trim().slice(0, 80)
    })).filter(item => item.title) : [];
    const financeContext = {
      marketNews: cleanContextItems(context && context.marketNews, 18),
      domestic: cleanContextItems(context && context.domestic, 10),
      world: cleanContextItems(context && context.world, 16),
      ai: cleanContextItems(context && context.ai, 8)
    };
    const formatContext = items => items.length ? items.map((item, i) => `${i + 1}. ${item.title}${item.summary ? ' — ' + item.summary : ''}${item.category ? ' [' + item.category + ']' : ''}${item.time ? ' (' + item.time + ')' : ''}`).join('\n') : '无';

    const prompt = `你是一位专业的跨资产金融分析师。请根据行情数据和新闻上下文，生成三个板块的市场走势归因分析。注意：用户已经能看到涨跌幅，不需要你重复报价；你的重点是解释“为什么可能这样走”和“背后可能反映的市场逻辑”。

实时数据：
- 上证指数：当前 ${shanghai.cur}，昨收 ${shanghai.prev}，涨跌 ${shChange}%
- 黄金价格：当前 ${gold.cur}，昨收 ${gold.prev}，涨跌 ${goldChange}%
- 纳斯达克：当前 ${nasdaq.cur}，昨收 ${nasdaq.prev}，涨跌 ${nasdaqChange}%

国内热点上下文：
${formatContext(financeContext.domestic)}

国际风险上下文：
${formatContext(financeContext.world)}

AI/科技上下文：
${formatContext(financeContext.ai)}

市场新闻上下文（优先用于归因）：
${formatContext(financeContext.marketNews)}

要求：
1. 用中文输出，语气专业但易懂
2. 必须严格按以下格式输出三个板块，每个板块 2 条 bullet：
[中国市场]
• ...
• ...
[美股与科技]
• ...
• ...
[黄金与跨资产]
• ...
• ...
3. 必须优先使用“市场新闻上下文”做归因；国内热点、国际风险、AI/科技上下文只能作为辅助验证，不能强行把无关新闻套到涨跌原因上
4. 禁止把“当前价格、昨收、涨跌百分比”作为主要内容复述；每条必须引用或概括至少一个市场新闻中的驱动线索
5. 中国市场板块要优先从 China stocks / A-shares / Shanghai Composite 相关新闻中找原因；没有直接市场新闻时，必须写“缺少直接市场新闻证据”
6. 美股与科技板块要优先从 Nasdaq / tech stocks / AI stocks / Fed rates / Treasury yields 相关新闻中找原因
7. 黄金与跨资产板块要优先从 gold / dollar / Treasury yields / safe haven / oil 相关新闻中找原因，并说明股债商/黄金之间的信号
8. 不能编造具体新闻、政策、成交量、资金流向、机构观点或支撑阻力；如新闻上下文不足，必须明确写“当前上下文不足以确认直接原因”
9. 最后一条必须注明“仅为行情归因参考，不构成投资建议”

只输出三个板块内容，不要加任何前言。`;

    const analysis = await callDeepSeek([
      { role: 'system', content: '你是严谨的跨资产市场分析师。你必须优先使用用户提供的新闻上下文进行归因，不能只复述涨跌，也不得编造未提供的新闻事实；必须区分事实、推测和待核验。' },
      { role: 'user', content: prompt }
    ], 800);

    res.json({ success: true, analysis });
  } catch (error) {
    console.error('Finance analysis error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. AI 日报摘要生成
app.post('/ai-news-summary', aiRateLimiter, async (req, res) => {
  try {
    const { articles } = req.body;
    const safeArticles = Array.isArray(articles) ? articles.slice(0, 8).filter(article => article && String(article.title || '').trim()) : [];
    if (!safeArticles.length) return res.status(400).json({ success:false, error:'Articles are required' });

    const prompt = `以下是今日 AI 领域的新闻列表，请生成一段 100 字左右的综合摘要，提炼最重要的趋势或事件。

新闻列表：
${safeArticles.map((a, i) => `${i + 1}. ${String(a.title).slice(0, 300)} (${String(a.source || '未知来源').slice(0, 80)})`).join('\n')}

要求：
1. 用中文输出
2. 突出 1-2 个最重要的趋势
3. 语气客观，不要夸大
4. 直接输出摘要，不要加"今日 AI 领域"等前缀`;

    const summary = await callDeepSeek([
      { role: 'system', content: '你是 AI 行业分析师，擅长提炼技术趋势。输出简洁。' },
      { role: 'user', content: prompt }
    ], 300);

    res.json({ success: true, summary });
  } catch (error) {
    console.error('AI news summary error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Arena 排行榜点评
app.post('/arena-comment', aiRateLimiter, async (req, res) => {
  try {
    const { rankings, category } = req.body;
    const safeRankings = Array.isArray(rankings) ? rankings.slice(0, 5).filter(item => item && String(item.modelName || '').trim()) : [];
    if (!safeRankings.length) return res.status(400).json({ success:false, error:'Rankings are required' });

    const prompt = `以下是 LM Arena 的 ${category} 排行榜前 5 名，请生成一段简短的点评（2-3 条，每条 20-40 字）。

排行榜：
${safeRankings.map((r, i) => `${i + 1}. ${String(r.modelName).slice(0, 160)} (${Number(r.score) || 0} 分)`).join('\n')}

要求：
1. 用中文输出
2. 关注国产模型表现（如 01.AI、Alibaba、Zhipu 等）
3. 每条以 "•" 开头
4. 直接输出点评，不要加多余说明`;

    const comment = await callDeepSeek([
      { role: 'system', content: '你是 AI 大模型领域专家，熟悉 LM Arena 排行榜。输出简洁。' },
      { role: 'user', content: prompt }
    ], 400);

    res.json({ success: true, comment });
  } catch (error) {
    console.error('Arena comment error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. 国际局势分析
app.post('/world-news-analysis', aiRateLimiter, async (req, res) => {
  try {
    const { headlines } = req.body;
    const safeHeadlines = cleanTextList(headlines, 20, 500);
    if (!safeHeadlines.length) return res.status(400).json({ success:false, error:'Headlines are required' });

    const prompt = `以下是今日国际局势的关键新闻标题，请生成一段 100 字左右的局势分析。

新闻标题：
${safeHeadlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join('\n')}

要求：
1. 用中文输出
2. 提炼地缘政治的主要矛盾或趋势
3. 语气客观冷静
4. 直接输出分析，不要加"根据新闻"等前缀`;

    const analysis = await callDeepSeek([
      { role: 'system', content: '你是国际政治分析师，擅长地缘政治分析。输出简洁客观。' },
      { role: 'user', content: prompt }
    ], 400);

    res.json({ success: true, analysis });
  } catch (error) {
    console.error('World news analysis error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== RSS 代理（解决浏览器 CORS 问题）=====
// 接受 GET /rss-proxy?url=<encoded-rss-url>
// 服务端抓取 RSS 并返回原始 XML（无 CORS 限制）
app.get('/arena-leaderboard', async (req, res) => {
  try {
    const date = String(req.query.date || '');
    const category = String(req.query.category || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'Invalid date' });
    }
    if (!ARENA_CATEGORIES.has(category)) {
      return res.status(400).json({ success: false, error: 'Invalid category' });
    }
    const url = 'https://raw.githubusercontent.com/oolong-tea-2026/arena-ai-leaderboards/main/data/' + date + '/' + category + '.json';
    const upstream = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'ai-morning-brief' }
    }, 10000);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ success: false, error: 'Arena upstream error: ' + upstream.status });
    }
    res.json(await upstream.json());
  } catch (error) {
    console.error('Arena leaderboard proxy error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/rss-proxy', async (req, res) => {
  try {
    const rawUrl = req.query.url;
    if (!rawUrl) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    const parsed = new URL(decodeURIComponent(rawUrl));
    if (parsed.protocol !== 'https:') throw new Error('Only https RSS URLs are allowed');
    const host = parsed.hostname.toLowerCase();
    const allowed = RSS_PROXY_ALLOWLIST.some(item => host === item || host.endsWith('.' + item));
    if (!allowed) throw new Error('RSS host is not allowed');

    const rssRes = await fetchWithTimeout(parsed.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ai-morning-brief/1.0; +https://brief.0cy.top)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7'
      }
    }, 10000);
    if (!rssRes.ok) throw new Error('RSS upstream error: ' + rssRes.status);
    const body = await rssRes.text();
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(body);
  } catch (err) {
    console.error('RSS proxy error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 国际新闻生成（LLM 驱动，不依赖 RSS）=====
// POST /world-news-generate
// Body: { count = 6, lang = 'zh' }
// 返回: { success, news: [{ title, desc, category, pubDate }] }
app.post('/world-news-generate', async (req, res) => {
  res.status(410).json({
    success: false,
    error: 'world-news-generate is disabled. Use RSS data plus translation and analysis instead.'
  });
});

// 7. 我关注的国际局势 — 从已核验标题中筛选高影响事件
app.post('/my-focus-analysis', aiRateLimiter, async (req, res) => {
  try {
    const { headlines, shownHeadlines, events } = req.body;
    const safeEvents = Array.isArray(events) ? events.slice(0, 48).map((item, index) => ({
      id: Number(item && item.sourceId) || index + 1,
      title: String(item && item.title || '').trim().slice(0, 500),
      time: String(item && (item.pubDate || item.time) || '').trim().slice(0, 120),
      category: String(item && item.category || '').trim().slice(0, 120),
      desc: String(item && item.desc || '').trim().slice(0, 500),
      track: String(item && item.track || '').trim().slice(0, 80)
    })).filter(item => item.title) : [];
    const safeHeadlines = safeEvents.length ? safeEvents.map(item => item.title) : cleanTextList(headlines, 40, 500);
    const safeShownHeadlines = cleanTextList(shownHeadlines, 12, 500);
    if (!safeHeadlines.length) {
      return res.status(400).json({ success: false, error: 'Verified headlines are required' });
    }

    const eventLines = safeEvents.length
      ? safeEvents.map((item, i) => `${i + 1}. 候选编号：${item.id}\n   标题：${item.title}\n   时间：${item.time || '未知'}\n   来源/类别：${item.category || '未知'}\n   建议归类：${item.track || '宏观风险'}\n   摘要：${item.desc || '无'}`).join('\n')
      : safeHeadlines.slice(0, 30).map((h, i) => `${i + 1}. 标题：${h}\n   时间：未知\n   来源/类别：未知\n   摘要：无`).join('\n');

    const prompt = `以下是从真实新闻源抓取的今日国际局势候选事件。页面上方 RSS 卡片已经展示了一批新闻；“我的关注”要做补充筛选，避免重复上方内容。

你的新任务：输出 TOP 10，分成两类：
- 5 条「宏观风险」：类似现在的全球政治、能源、金融市场、供应链、科技竞争等高影响事件。
- 5 条「美国态势」：只选择与美国军事/防务、海外部署、Pentagon/美国防部、美国海空军、航母/舰队、海外基地、驻外兵力、军演/联合巡航、空袭/军事行动、军援/武器交付直接相关的事件。

上方已展示标题（尽量不要重复）：
${safeShownHeadlines.length ? safeShownHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n') : '无'}

候选事件：
${eventLines}

请按以下格式输出，每条用 "---" 分隔：
🏷️ 类别：宏观风险 / 美国态势
# 候选编号：（必须使用候选事件里的候选编号）
🕒 新闻时间：（必须使用候选事件里的时间；未知则写未知）
🔴 事件标题
📋 事件简述：（30-50字简述事件内容）
🎯 关注原因：（30-50字说明为什么值得关注）

要求：
1. 总共尽量输出 10 条；前 5 条必须是「宏观风险」，后 5 条必须是「美国态势」
2. 「美国态势」必须与美国军队或美国防务行动直接相关；普通美国外交、制裁、贸易、内政、选举、白宫表态，如果没有军队/军援/军事部署/军事行动内容，一律不要放入该类
3. 如果美军候选不足，可以少于 5 条，但不得用美国普通对外新闻硬凑
4. 用中文输出，简洁有力
5. 只能基于所给标题，不得补造未出现的事实；如果没有重大事件，输出"暂无符合关注条件的重大事件"
6. 所有事件标题必须是完整中文，必须把英文新闻标题准确翻译后再输出；人名、机构名可保留必要的英文缩写，但不得直接复制整句英文标题
7. 不要选择与“上方已展示标题”明显同一件事的新闻，除非候选标题提供了明显更高的影响信息
8. 每条必须保留候选编号，方便前端做二次去重
9. 直接输出，不要加任何前言`;

    const analysis = await callDeepSeek([
      { role: 'system', content: '你是国际局势与美国军事防务态势分析师，负责为个人决策简报挑选补充关注事件。你必须避开已展示新闻的重复内容，只能依据输入候选事件判断，不得编造事实。美国态势只限美国军事部署、演训、行动、基地、军援和防务相关事件，不包括普通外交或制裁新闻。你的全部输出必须使用中文。' },
      { role: 'user', content: prompt }
    ], 1400);

    res.json({ success: true, analysis });
  } catch (error) {
    console.error('My focus analysis error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. 批量翻译 API
app.post('/translate', aiRateLimiter, async (req, res) => {
  try {
    const { texts, targetLang = 'zh' } = req.body;
    const safeTexts = cleanTextList(texts, 30, 2000);
    if (!safeTexts.length || safeTexts.join('').length > 20000) {
      return res.status(400).json({ success: false, error: 'No texts provided' });
    }

    // 过滤掉已经是中文的文本
    const needTranslation = safeTexts.filter(t => !/^[\u4e00-\u9fa5]/.test(t));
    if (needTranslation.length === 0) {
      return res.json({ success: true, translations: safeTexts });
    }

    const prompt = `请将以下英文文本翻译成中文，保持专业和准确。每条翻译占一行，顺序与输入一致，不要加编号。

原文：
${needTranslation.join('\n')}

只输出翻译结果，每条一行，不要加任何说明或前缀。`;

    const translation = await callDeepSeek([
      { role: 'system', content: '你是专业翻译，擅长中英文互译。输出简洁准确，只返回翻译结果。' },
      { role: 'user', content: prompt }
    ], 1000);

    const translatedLines = translation.split('\n').map(l => l.trim()).filter(Boolean);
    let idx = 0;
    const result = safeTexts.map(t => {
      if (!t || /^[\u4e00-\u9fa5]/.test(t)) return t || '';
      return translatedLines[idx++] || t;
    });

    res.json({ success: true, translations: result });
  } catch (error) {
    console.error('Translation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: 'deepseek-v4-flash', version: '1.0.0' });
});

// ===== 心知天气代理（GET /weather-now）=====
// 返回：当前天气 + 3天日预报
// 多组密钥自动轮询
const crypto = require('crypto');
// 心知天气密钥从环境变量读取，格式：SENIVERSE_KEYS="uid1:key1,uid2:key2,..."
var seniversePairs = (process.env.SENIVERSE_KEYS || '').split(',');
var SENIVERSE_CREDENTIALS = [];
seniversePairs.forEach(function(pair) {
  var parts = pair.trim().split(':');
  if (parts.length === 2) SENIVERSE_CREDENTIALS.push({ public_key: parts[0], private_key: parts[1] });
});
const SENIVERSE_LOCATION = '30.520314:104.082823';

function seniverseSign(uid, privKey) {
  var ts = Math.floor(Date.now() / 1000);
  var ttl = 300;
  var paramStr = 'ts=' + ts + '&ttl=' + ttl + '&uid=' + uid;
  var sig = crypto.createHmac('sha1', privKey).update(paramStr).digest('base64');
  return { ts: ts, ttl: ttl, sig: encodeURIComponent(sig) };
}

async function callSeniverse(endpoint, uid, privKey) {
  var sign = seniverseSign(uid, privKey);
  var extra = '';
  if (endpoint === 'daily.json') {
    extra = '&start=0&days=3';
  }
  var url = 'https://api.seniverse.com/v3/weather/' + endpoint +
    '?location=' + encodeURIComponent(SENIVERSE_LOCATION) +
    '&language=zh-Hans&unit=c' + extra +
    '&ts=' + sign.ts + '&ttl=' + sign.ttl + '&uid=' + uid +
    '&sig=' + sign.sig;
  var resp = await fetch(url);
  return resp.json();
}

async function callSeniverseWithRetry(endpoint) {
  for (var i = 0; i < SENIVERSE_CREDENTIALS.length; i++) {
    try {
      var cred = SENIVERSE_CREDENTIALS[i];
      var result = await callSeniverse(endpoint, cred.public_key, cred.private_key);
      if (result.status) {
        console.warn('Seniverse key #' + i + ' failed:', result.status);
        continue;
      }
      return result;
    } catch (e) {
      console.error('Seniverse key #' + i + ' error:', e.message);
    }
  }
  return null;
}

app.get('/weather-now', async (req, res) => {
  try {
    const [nowResult, dailyResult] = await Promise.all([
      callSeniverseWithRetry('now.json'),
      callSeniverseWithRetry('daily.json'),
    ]);

    res.json({
      success: !!(nowResult || dailyResult),
      now: nowResult || null,
      daily: dailyResult || null,
    });
  } catch (err) {
    console.error('Seniverse weather error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
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

async function fetchDomesticHotEvents() {
  const baseHeaders = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,text/html;q=0.9,*/*;q=0.8' };
  const results = await Promise.allSettled([
    fetchWithTimeout('https://weibo.com/ajax/side/hotSearch', { headers: { ...baseHeaders, Referer: 'https://weibo.com/' } }, 10000).then(r => r.json()),
    fetchWithTimeout('https://top.baidu.com/board?tab=realtime', { headers: { ...baseHeaders, Referer: 'https://top.baidu.com/' } }, 10000).then(r => r.text()),
    fetchWithTimeout('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', { headers: { ...baseHeaders, Referer: 'https://www.toutiao.com/' } }, 10000).then(r => r.json()),
    fetchWithTimeout('https://www.chinanews.com.cn/rss/finance.xml', { headers:baseHeaders }, 10000).then(r => r.text()),
    fetchWithTimeout('https://www.chinanews.com.cn/rss/china.xml', { headers:baseHeaders }, 10000).then(r => r.text()),
    fetchWithTimeout('https://www.chinanews.com.cn/rss/society.xml', { headers:baseHeaders }, 10000).then(r => r.text()),
    fetchWithTimeout('https://www.chinanews.com.cn/rss/life.xml', { headers:baseHeaders }, 10000).then(r => r.text())
  ]);
  const ranked = [];
  const sources = [];
  if (results[0].status === 'fulfilled') {
    const rows = results[0].value?.data?.realtime || [];
    if (rows.length) sources.push('微博');
    rows.filter(x => x.word && x.realpos).slice(0, 40).forEach((x, i) => ranked.push({ source: '微博', rank: Number(x.realpos) || i + 1, title: x.word, summary:'', heat: Number(x.num) || 0, url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(x.word) }));
  }
  if (results[1].status === 'fulfilled') {
    try {
      const match = results[1].value.match(/<!--s-data:([\s\S]*?)-->/);
      const payload = match ? JSON.parse(match[1]) : null;
      const card = (payload?.data?.cards || []).find(x => x.component === 'hotList');
      const rows = card?.content || [];
      if (rows.length) sources.push('百度');
      rows.slice(0, 40).forEach((x, i) => ranked.push({ source: '百度', rank: i + 1, title: x.query, summary:x.desc || '', heat: Number(x.hotScore) || 0, url: x.rawUrl || x.url || 'https://top.baidu.com/board?tab=realtime' }));
    } catch (err) { console.warn('Baidu hot parse failed:', err.message); }
  }
  if (results[2].status === 'fulfilled') {
    const rows = results[2].value?.data || [];
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
  return { sources, items };
}

let domesticHotCache = null;
app.get('/domestic-hot', async (req, res) => {
  try {
    if (req.query.refresh !== '1' && domesticHotCache && Date.now() - domesticHotCache.savedAt < 5 * 60 * 1000) {
      res.json({ ...domesticHotCache.payload, cached: true });
      return;
    }
    const result = await fetchDomesticHotEvents();
    const payload = { success: true, fetchedAt: new Date().toISOString(), sources: result.sources, items: result.items };
    domesticHotCache = { savedAt: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    console.error('Domestic hot events error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

function classifyChengduLocal(title, summary) {
  const text = `${title || ''} ${summary || ''}`;
  const groups = [
    { category:'城市民生', terms:['成都','双流','天府新区','高新区','锦江','青羊','金牛','武侯','成华','龙泉驿','温江','郫都','新都','简阳','居民','社区','医院','学校','教育','医保','社保','住房','租房','房价','就业','招聘','养老','消费','补贴','服务'] },
    { category:'交通出行', terms:['成都','双流机场','天府机场','地铁','公交','高铁','铁路','交通','道路','绕城','成渝','航线','通车','施工','限行','停车','出行'] },
    { category:'生活消费', terms:['成都','消费券','商圈','餐饮','文旅','演出','展会','夜经济','以旧换新','家电','汽车','购物','市场监管','食品安全','价格','便民'] },
    { category:'产业机会', terms:['成都','项目','签约','招商','创业','人才','补贴','园区','产业','低空经济','人工智能','算力','半导体','新能源汽车','生物医药','跨境电商','小微企业','贷款','税费'] },
    { category:'政务政策', terms:['成都','成都市','四川','政策','发布','通知','新规','规划','住建','发改委','人社','商务局','教育局','公安','政务','办事'] },
    { category:'天气安全', terms:['成都','暴雨','高温','预警','雷电','大风','内涝','防汛','地灾','安全','事故','消防','应急'] }
  ];
  let best = null;
  groups.forEach(group => {
    const hits = group.terms.filter(term => text.includes(term)).length;
    if (hits && (!best || hits > best.score)) best = { category:group.category, score:hits };
  });
  return best || { category:'成都生活', score:1 };
}

function parseChengduRss(xml, source) {
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
    if (!title || !timestamp || now - timestamp > 14 * 24 * 60 * 60 * 1000) continue;
    const summary = read('description');
    const text = `${title} ${summary}`;
    if (!/成都|双流|天府新区|高新区|锦江|青羊|金牛|武侯|成华|龙泉驿|温江|郫都|新都|简阳|四川/.test(text)) continue;
    if (/明星|演唱会门票黄牛|网红打卡|旅游攻略|美食推荐/.test(text) && !/政策|消费|交通|安全|民生|补贴|市场/.test(text)) continue;
    const importance = classifyChengduLocal(title, summary);
    items.push({
      title,
      summary: summary || title,
      url: read('link'),
      source,
      category: importance.category,
      importanceScore: importance.score,
      publishedAt: pubDate
    });
    if (items.length >= 30) break;
  }
  return items;
}

function parseChengduHtml(html, source, baseUrl) {
  const items = [];
  const nowIso = new Date().toISOString();
  const seen = new Set();
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url = decodeRssValue(match[1]);
    let title = decodeRssValue(match[2]);
    title = title.replace(/\s+/g, ' ').trim();
    if (!title || title.length < 8 || title.length > 90) continue;
    if (!/成都|双流|天府新区|高新区|锦江|青羊|金牛|武侯|成华|龙泉驿|温江|郫都|新都|简阳|四川/.test(title)) continue;
    if (/首页|频道|更多|登录|注册|客户端|二维码|专题|图片|视频|直播|广告/.test(title)) continue;
    if (/明星|网红打卡|旅游攻略|美食推荐/.test(title) && !/政策|消费|交通|安全|民生|补贴|市场|产业/.test(title)) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    try {
      url = new URL(url, baseUrl).toString();
    } catch {
      url = baseUrl;
    }
    const importance = classifyChengduLocal(title, '');
    items.push({
      title,
      summary: `${source}本地报道：${title}`,
      url,
      source,
      category: importance.category,
      importanceScore: importance.score,
      publishedAt: nowIso
    });
    if (items.length >= 20) break;
  }
  return items;
}

async function fetchChengduLocalEvents() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; ai-morning-brief/1.0; +https://brief.0cy.top)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
  };
  const feeds = [
    { source:'成都民生', url:'https://news.google.com/rss/search?q=%E6%88%90%E9%83%BD%20%E6%B0%91%E7%94%9F%20when:14d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
    { source:'成都交通', url:'https://news.google.com/rss/search?q=%E6%88%90%E9%83%BD%20%E4%BA%A4%E9%80%9A%20when:14d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
    { source:'成都消费', url:'https://news.google.com/rss/search?q=%E6%88%90%E9%83%BD%20%E6%B6%88%E8%B4%B9%20%E6%94%BF%E7%AD%96%20when:14d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
    { source:'成都机会', url:'https://news.google.com/rss/search?q=%E6%88%90%E9%83%BD%20%E4%BA%A7%E4%B8%9A%20%E6%8B%9B%E8%81%98%20%E5%88%9B%E4%B8%9A%20when:14d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
    { source:'成都安全', url:'https://news.google.com/rss/search?q=%E6%88%90%E9%83%BD%20%E5%A4%A9%E6%B0%94%20%E5%AE%89%E5%85%A8%20when:14d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
    { source:'Bing成都民生', url:'https://www.bing.com/news/search?q=%E6%88%90%E9%83%BD%20%E6%B0%91%E7%94%9F&format=rss' },
    { source:'Bing成都交通', url:'https://www.bing.com/news/search?q=%E6%88%90%E9%83%BD%20%E4%BA%A4%E9%80%9A&format=rss' },
    { source:'Bing成都生活', url:'https://www.bing.com/news/search?q=%E6%88%90%E9%83%BD%20%E7%94%9F%E6%B4%BB%20%E6%B6%88%E8%B4%B9&format=rss' }
  ];
  const htmlPages = [
    { source:'新华网成都', url:'https://sc.news.cn/cd/' },
    { source:'红星新闻网', url:'https://www.chengdu.cn/' },
    { source:'四川在线成都', url:'https://cd.scol.com.cn/' },
    { source:'中新网四川成都', url:'https://www.sc.chinanews.com.cn/cdxw/index.shtml' }
  ];
  const settled = await Promise.allSettled(feeds.map(feed =>
    fetchWithTimeout(feed.url, { headers }, 10000).then(response => {
      if (!response.ok) throw new Error(`Chengdu RSS HTTP ${response.status}`);
      return response.text();
    }).then(xml => parseChengduRss(xml, feed.source))
  ));
  const htmlSettled = await Promise.allSettled(htmlPages.map(page =>
    fetchWithTimeout(page.url, { headers:{ ...headers, 'Accept':'text/html,*/*' } }, 8000).then(response => {
      if (!response.ok) throw new Error(`Chengdu HTML HTTP ${response.status}`);
      return response.text();
    }).then(html => parseChengduHtml(html, page.source, page.url))
  ));
  const sources = [];
  const grouped = new Map();
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    if (result.value.length) sources.push(feeds[index].source);
    result.value.forEach(item => {
      const key = normalizeHotTitle(item.title);
      if (!key) return;
      const existing = grouped.get(key);
      if (existing) {
        existing.score += item.importanceScore + 2;
        if (item.summary.length > existing.summary.length) existing.summary = item.summary;
        if (!existing.sources.includes(item.source)) existing.sources.push(item.source);
      } else {
        grouped.set(key, { ...item, score:item.importanceScore, sources:[item.source] });
      }
    });
  });
  htmlSettled.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    if (result.value.length) sources.push(htmlPages[index].source);
    result.value.forEach(item => {
      const key = normalizeHotTitle(item.title);
      if (!key) return;
      const existing = grouped.get(key);
      if (existing) {
        existing.score += item.importanceScore + 1;
        if (!existing.sources.includes(item.source)) existing.sources.push(item.source);
      } else {
        grouped.set(key, { ...item, score:item.importanceScore, sources:[item.source] });
      }
    });
  });
  const items = Array.from(grouped.values())
    .sort((a, b) => (b.sources.length - a.sources.length) || (b.score - a.score) || (Date.parse(b.publishedAt) - Date.parse(a.publishedAt)))
    .slice(0, 8)
    .map((item, index) => ({
      rank:index + 1,
      title:item.title,
      summary:item.summary,
      url:item.url,
      source:item.sources.join(' / '),
      category:item.category,
      publishedAt:item.publishedAt
    }));
  return { sources, items };
}

let chengduLocalCache = null;
app.get('/chengdu-local', async (req, res) => {
  try {
    if (req.query.refresh !== '1' && chengduLocalCache && Date.now() - chengduLocalCache.savedAt < 10 * 60 * 1000) {
      res.json({ ...chengduLocalCache.payload, cached: true });
      return;
    }
    const result = await fetchChengduLocalEvents();
    const payload = { success: true, fetchedAt: new Date().toISOString(), sources: result.sources, items: result.items };
    chengduLocalCache = { savedAt: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    console.error('Chengdu local events error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const MARKET_HISTORY_SYMBOLS = {
  shanghai: { tencent:'sh000001', responseKey:'sh000001', name:'上证指数', currency:'CNY' },
  nasdaq: { tencent:'usIXIC', responseKey:'us.IXIC', name:'纳斯达克', currency:'USD' },
  gold: { sina:'GC', name:'COMEX黄金', currency:'USD/oz' }
};
const marketHistoryCache = new Map();

async function fetchMarketHistory(symbolKey, forceRefresh) {
  const config = MARKET_HISTORY_SYMBOLS[symbolKey];
  if (!config) throw new Error('Unsupported market symbol');
  const cached = marketHistoryCache.get(symbolKey);
  if (!forceRefresh && cached && Date.now() - cached.savedAt < 10 * 60 * 1000) return cached.payload;
  let points = [];
  if (config.tencent) {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${config.tencent},day,,,35`;
    const response = await fetchWithTimeout(url, { headers:{ 'User-Agent':'Mozilla/5.0', 'Accept':'application/json' } }, 10000);
    if (!response.ok) throw new Error(`Tencent history HTTP ${response.status}`);
    const json = await response.json();
    const rows = json && json.data && json.data[config.responseKey] ? json.data[config.responseKey].day || [] : [];
    points = rows.map(row => ({ date:String(row[0] || ''), close:Number(row[2]) }));
  } else if (config.sina) {
    const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var_${config.sina}=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${config.sina}`;
    const response = await fetchWithTimeout(url, { headers:{ 'Referer':'https://finance.sina.com.cn/', 'User-Agent':'Mozilla/5.0' } }, 10000);
    if (!response.ok) throw new Error(`Sina history HTTP ${response.status}`);
    const text = await response.text();
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
  return payload;
}

app.get('/market/history', async (req, res) => {
  try {
    res.json(await fetchMarketHistory(String(req.query.symbol || ''), req.query.refresh === '1'));
  } catch (err) {
    res.status(502).json({ success:false, error:err.message });
  }
});

app.get('/market/gold', async (req, res) => {
  try {
    let rawText = '';
    try {
      const upstream = await fetchWithTimeout('https://hq.sinajs.cn/list=hf_XAU,hf_CL,SGE_AUTD,SGE_AU9999', {
        headers: {
          'Referer': 'https://finance.sina.com.cn/',
          'User-Agent': 'Mozilla/5.0'
        }
      }, 10000);
      if (upstream.ok) rawText = await upstream.text();
    } catch (err) {
      rawText = '';
    }
    let londonGoldRaw = (rawText.match(/hq_str_hf_XAU="([^"]*)"/) || [])[1] || '';
    let crudeOilRaw = (rawText.match(/hq_str_hf_CL="([^"]*)"/) || [])[1] || '';
    const shGold = rawText.match(/hq_str_SGE_AUTD="([^"]*)"/);
    const shGold9999 = rawText.match(/hq_str_SGE_AU9999="([^"]*)"/);
    let shGoldRaw = shGold ? shGold[1] : '';
    let shGoldTimestamp = '';
    let shGoldSource = shGoldRaw ? 'Sina' : '';
    const shGoldPrice = parseFloat(shGoldRaw.split(',')[3]);
    if (!Number.isFinite(shGoldPrice)) {
      shGoldRaw = shGold9999 ? shGold9999[1] : '';
      if (shGoldRaw) shGoldSource = 'Sina';
    }
    // Use the exchange's own Au99.99 series as the authoritative Shanghai gold quote.
    try {
      const sge = await fetchWithTimeout('https://www.sge.com.cn/graph/quotations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Referer': 'https://www.sge.com.cn/',
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        body: 'instid=Au99.99'
      }, 10000);
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
        const eastmoney = await fetchWithTimeout('https://push2.eastmoney.com/api/qt/stock/get?fltt=2&fields=f43,f57,f58,f60,f169,f170&secid=118.mAUTD', {
          headers: {
            'Referer': 'https://quote.eastmoney.com/',
            'User-Agent': 'Mozilla/5.0'
          }
        }, 6000);
        if (eastmoney.ok) {
          const quote = await eastmoney.json();
          const q = quote && quote.data ? quote.data : {};
          if (Number.isFinite(Number(q.f43))) {
            shGoldRaw = `${q.f57 || 'mAUTD'},${q.f58 || 'Mini Gold T+D'},${q.f58 || 'Mini Gold T+D'},${q.f43},--,--,--,--,--,--,--,--,--,--,--,--,Eastmoney,${q.f170 || ''}%`;
            shGoldSource = 'Eastmoney';
          }
        }
      } catch (err) {}
    }
    if (!londonGoldRaw || !crudeOilRaw) {
      try {
        const tencent = await fetchWithTimeout('https://qt.gtimg.cn/q=hf_GC,hf_CL', {
          headers:{ 'Referer':'https://gu.qq.com/', 'User-Agent':'Mozilla/5.0' }
        }, 8000);
        if (tencent.ok) {
          const quoteText = await tencent.text();
          const normalize = value => {
            const fields = String(value || '').split(',');
            const normalized = new Array(14).fill('');
            normalized[0] = fields[0] || '';
            normalized[1] = fields[7] || '';
            normalized[6] = fields[6] || '';
            normalized[12] = fields[12] || '';
            normalized[13] = fields[13] || '';
            return normalized.join(',');
          };
          if (!londonGoldRaw) londonGoldRaw = normalize((quoteText.match(/v_hf_GC="([^"]*)"/) || [])[1]);
          if (!crudeOilRaw) crudeOilRaw = normalize((quoteText.match(/v_hf_CL="([^"]*)"/) || [])[1]);
        }
      } catch (err) {}
    }
    if (!londonGoldRaw && !shGoldRaw) throw new Error('Gold market sources unavailable');
    res.json({
      success: true,
      raw: londonGoldRaw,
      oilRaw: crudeOilRaw,
      shGoldRaw,
      shGoldTimestamp,
      shGoldSource
    });
  } catch (err) {
    console.error('Gold proxy error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ LLM 后端服务已启动：http://localhost:${PORT}`);
  console.log(`📊 模型：deepseek-v4-flash`);
  console.log(`🔑 API Key：${DEEPSEEK_API_KEY ? '已配置' : '❌ 未配置'}`);
});
