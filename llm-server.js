const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.set('trust proxy', true); // 信任 Nginx 反代传递的真实 IP
app.use(cors());
app.use(express.json());

// ===== AI 速率限制中间件（分层限制）=====
const TRANSLATE_DAILY_LIMIT = 50;  // 翻译：50次/天（每次加载可能多次调用）
const ANALYSIS_DAILY_LIMIT = 10;   // 分析：10次/天（较耗 Token）
const WHITELIST_IPS = ['127.0.0.1', '::1'];  // 白名单 IP（服务器本地不受限）

const ipDayCounts = new Map(); // key: "ip_YYYYMMDD_type" → count

function getDateKey() {
  var now = new Date();
  return now.getFullYear() + ('0'+(now.getMonth()+1)).slice(-2) + ('0'+now.getDate()).slice(-2);
}

function getClientIP(req) {
  var ip = req.ip || req.connection.remoteAddress || 'unknown';
  // 规范化 IP（去掉 IPv6 前缀 ::ffff: 和 localhost 变体）
  ip = ip.replace(/^::ffff:/, '');
  if (ip === '::1' || ip === '127.0.0.1') ip = '127.0.0.1';
  return ip;
}

function aiRateLimiter(req, res, next) {
  var ip = getClientIP(req);

  // 白名单检查
  if (WHITELIST_IPS.includes(ip)) {
    console.log(`[RateLimit] IP ${ip} is whitelisted, skipping limit`);
    return next();
  }

  // 根据端点类型确定限制
  var isTranslate = req.path === '/translate';
  var limit = isTranslate ? TRANSLATE_DAILY_LIMIT : ANALYSIS_DAILY_LIMIT;
  var type = isTranslate ? 'translate' : 'analysis';

  var dateKey = getDateKey();
  var entryKey = ip + '_' + dateKey + '_' + type;
  var count = ipDayCounts.get(entryKey) || 0;

  if (count >= limit) {
    console.warn(`[RateLimit] IP ${ip} exceeded daily ${type} limit (${count}/${limit})`);
    return res.status(429).json({
      success: false,
      error: `${isTranslate ? '翻译' : '分析'}请求已达每日上限（${limit} 次/天），请明天再试`,
      retryAfter: '明天 00:00'
    });
  }

  ipDayCounts.set(entryKey, count + 1);
  console.log(`[RateLimit] IP ${ip}: ${count + 1}/${limit} ${type} calls today`);
  next();
}

// 每天凌晨清理过期计数
setInterval(function() {
  var todayKey = getDateKey();
  var deleted = 0;
  ipDayCounts.forEach(function(v, k) {
    if (!k.endsWith('_' + todayKey)) { ipDayCounts.delete(k); deleted++; }
  });
  if (deleted > 0) console.log(`[RateLimit] Cleaned ${deleted} old entries`);
}, 60 * 60 * 1000); // 每小时检查一次

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// 调用 DeepSeek API 的通用函数
async function callDeepSeek(messages, maxTokens = 500) {
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: messages,
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('DeepSeek API call failed:', error);
    throw error;
  }
}

// 1. 金融走势分析
app.post('/finance-analysis', aiRateLimiter, async (req, res) => {
  try {
    const { shanghai, gold, nasdaq } = req.body;

    const shChange = ((shanghai.cur - shanghai.prev) / shanghai.prev * 100).toFixed(2);
    const goldChange = ((gold.cur - gold.prev) / gold.prev * 100).toFixed(2);
    const nasdaqChange = ((nasdaq.cur - nasdaq.prev) / nasdaq.prev * 100).toFixed(2);

    const prompt = `你是一位专业的金融分析师。请根据以下实时数据，生成一段简洁的 A 股 + 黄金市场走势分析（3-4 条，每条 30-50 字）。

实时数据：
- 上证指数：当前 ${shanghai.cur}，昨收 ${shanghai.prev}，涨跌 ${shChange}%
- 黄金价格：当前 ${gold.cur}，昨收 ${gold.prev}，涨跌 ${goldChange}%
- 纳斯达克：当前 ${nasdaq.cur}，昨收 ${nasdaq.prev}，涨跌 ${nasdaqChange}%

要求：
1. 用中文输出，语气专业但易懂
2. 每条以 "•" 开头
3. 包含技术面、资金面、情绪面的简要分析
4. 不要提及"根据数据"等废话，直接给出分析
5. 如果涨跌幅度很小（<0.1%），说明市场观望情绪浓厚

只输出分析内容，不要加任何前缀或说明。`;

    const analysis = await callDeepSeek([
      { role: 'system', content: '你是专业金融分析师，擅长 A 股和黄金市场分析。输出简洁专业。' },
      { role: 'user', content: prompt }
    ], 500);

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

    const prompt = `以下是今日 AI 领域的新闻列表，请生成一段 100 字左右的综合摘要，提炼最重要的趋势或事件。

新闻列表：
${articles.slice(0, 8).map((a, i) => `${i + 1}. ${a.title} (${a.source || '未知来源'})`).join('\n')}

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

    const prompt = `以下是 LM Arena 的 ${category} 排行榜前 5 名，请生成一段简短的点评（2-3 条，每条 20-40 字）。

排行榜：
${rankings.slice(0, 5).map((r, i) => `${i + 1}. ${r.modelName} (${r.score} 分)`).join('\n')}

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

    const prompt = `以下是今日国际局势的关键新闻标题，请生成一段 100 字左右的局势分析。

新闻标题：
${headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join('\n')}

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
app.get('/rss-proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    const timeout = 8000;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const rssRes = await fetch(decodeURIComponent(url), { signal: controller.signal });
    clearTimeout(id);
    const text = await rssRes.text();
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(text);
  } catch (err) {
    console.error('RSS proxy error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 国际新闻生成（LLM 驱动，不依赖 RSS）=====
// POST /world-news-generate
// Body: { count = 6, lang = 'zh' }
// 返回: { success, news: [{ title, desc, category, pubDate }] }
app.post('/world-news-generate', aiRateLimiter, async (req, res) => {
  try {
    const { count = 6, lang = 'zh' } = req.body;
    const now = new Date();
    const dateStr = now.getFullYear() + '年' + (now.getMonth()+1) + '月' + now.getDate() + '日';
    const weekday = ['日','一','二','三','四','五','六'][now.getDay()];

    const systemPrompt = '你是国际新闻编辑，擅长整理每日国际要闻。输出专业、客观、简洁。';
    const userPrompt = `请生成${dateStr}（周${weekday}）的国际局势要闻 ${count} 条。

要求：
1. 每条新闻包含：标题、摘要（80-120字）、分类（如：中东局势、俄乌战争、中美关系、欧洲政治、全球经济、亚太安全等）
2. 用中文输出
3. 严格按照以下 JSON 数组格式输出，不要加任何说明、不要加markdown代码块标记：
[{"title":"标题","desc":"摘要内容","category":"分类名称","pubDate":"${dateStr}"}]
4. 内容要基于你训练数据中最接近当前日期的国际事件，尽量贴近真实
5. 分类要多样，覆盖不同地区/议题
6. 直接输出 JSON 数组，开头就是 [，结尾就是 ]`;

    const raw = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], 1200);

    // 将 LLM 返回的内容组装成 RSS XML 格式，复用前端 renderWorldNews 解析逻辑
    let newsItems = [];
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) newsItems = parsed;
    } catch (e) {
      // 如果不是 JSON，尝试从纯文本解析
      const lines = raw.split('\n').filter(l => l.trim());
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('**') && lines[i].endsWith('**')) {
          newsItems.push({
            title: lines[i].replace(/\*\*/g, '').trim(),
            desc: (lines[i+1] || '').replace('摘要：', '').trim(),
            category: '国际',
            pubDate: dateStr
          });
        }
      }
    }

    // 组装成 RSS XML 字符串
    let rssXml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n';
    rssXml += `  <title>AI 早报 · 国际局势</title>\n`;
    rssXml += `  <description>由 DeepSeek LLM 生成的每日国际要闻</description>\n`;
    newsItems.forEach(item => {
      const title = (item.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const desc = (item.desc || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const cat = (item.category || '国际').replace(/&/g, '&amp;');
      rssXml += `  <item>\n    <title>${title}</title>\n    <description>${desc}</description>\n    <category>${cat}</category>\n    <pubDate>${dateStr}</pubDate>\n  </item>\n`;
    });
    rssXml += '</channel>\n</rss>';

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(rssXml);
  } catch (error) {
    console.error('World news generate error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. 我关注的国际局势 — 侧重美国对外战争大动作
app.post('/my-focus-analysis', aiRateLimiter, async (req, res) => {
  try {
    const { headlines } = req.body;

    const prompt = `以下是今日国际局势的关键新闻标题。请你特别关注其中涉及美国对外军事行动、战争、制裁、军事部署等大动作的新闻，筛选出 3-5 条最有价值的信息。

新闻标题：
${headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join('\n')}

请按以下格式输出，每条用 "---" 分隔：
🔴 事件标题
📋 事件简述：（30-50字简述事件内容）
🎯 关注原因：（30-50字说明为什么值得关注）

要求：
1. 只关注美国对外战争/军事行动相关的大动作（如：对伊朗动武、中东增兵、制裁升级、军事同盟变化等）
2. 筛选 3-5 条最有价值的，不要凑数
3. 用中文输出，简洁有力
4. 如果没有找到相关事件，输出"暂无美军重大行动相关事件"
5. 直接输出，不要加任何前言`;

    const analysis = await callDeepSeek([
      { role: 'system', content: '你是国际军事分析师，专注美国对外军事行动和中东局势。输出简洁专业，善于识别关键信号。' },
      { role: 'user', content: prompt }
    ], 800);

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
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ success: false, error: 'No texts provided' });
    }

    // 过滤掉已经是中文的文本
    const needTranslation = texts.filter(t => t && !/^[\u4e00-\u9fa5]/.test(t));
    if (needTranslation.length === 0) {
      return res.json({ success: true, translations: texts });
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
    const result = texts.map(t => {
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
// 404 处理
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, 'localhost', () => {
  console.log(`✅ LLM 后端服务已启动：http://localhost:${PORT}`);
  console.log(`📊 模型：deepseek-v4-flash`);
  console.log(`🔑 API Key：${DEEPSEEK_API_KEY ? '已配置' : '❌ 未配置'}`);
});
