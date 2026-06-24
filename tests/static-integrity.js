'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('ai-morning-brief.html');
const scriptFiles = [
  'js/effects.js', 'js/domestic-news.js', 'js/core.js', 'js/arena.js',
  'js/world.js', 'js/finance.js', 'js/data.js'
];
const app = scriptFiles.map(read).join('\n');
const backend = read('llm-server.js');
const preview = read('local-preview-server.js');
const styles = read('styles.css');

assert(!html.includes('2026年6月15日'), 'Browser title contains a stale fixed date');
assert(app.includes('function updateDocumentTitle()'), 'Browser title must update to the current date');
assert(html.includes('CHEY Intelligence Brief'), 'Browser title brand is missing');

scriptFiles.forEach(file => new vm.Script(read(file), { filename:file }));
new vm.Script(backend, { filename:'llm-server.js' });
new vm.Script(preview, { filename:'local-preview-server.js' });

scriptFiles.forEach(file => {
  assert(html.includes(`src="/${file}"`), `HTML does not load ${file}`);
  assert(preview.includes(`'${file}'`), `Preview allowlist does not expose ${file}`);
});
assert(!html.includes('src="/app.js"'), 'Legacy monolithic app.js is still loaded');
assert(!fs.existsSync(path.join(root, 'app.js')), 'Legacy monolithic app.js should be removed after the split');
assert(styles.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)'), 'Mobile hero briefs must use equal-width columns');

const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepStrictEqual(duplicateIds, [], 'HTML contains duplicate IDs');

[
  'finSH', 'finSZ', 'finChiNext', 'finSTAR', 'finCSI300', 'finHSI', 'finBond',
  'finDow', 'finNASDAQ', 'finSP500', 'finGoldValue', 'finBTC', 'finUSDCNY', 'chartSH', 'chartNASDAQ', 'chartGOLD'
].forEach(id => assert(ids.includes(id), `Missing required element #${id}`));

const staleMarketValues = ['4096.47', '25888.84', '51202.26', '7431.46'];
staleMarketValues.forEach(value => assert(!html.includes(value) && !app.includes(value), `Stale market fallback remains: ${value}`));
assert(!app.includes('Trump%20Iran'), 'International feeds must not contain event-specific searches');
assert(app.includes('parseTencentQuoteTime') && app.includes('parseSinaQuoteTime'), 'Market timestamps must come from quote payloads');
assert(app.includes('formatDomesticTime'), 'Domestic news timestamp formatter is missing');
assert(app.includes('item.publishedAt || observedAt'), 'Domestic news does not render publication/fetch timestamps');
assert(html.includes('id="chengdu-local"'), 'Chengdu local section is missing');
assert(app.includes('refreshChengduLocal'), 'Chengdu local refresh function is missing');
assert(backend.includes("app.get('/chengdu-local'"), 'Chengdu local backend endpoint is missing');
assert(app.includes("focus-v7-zh-market-military-top10|||"), 'My Focus cache version is missing');
assert(app.includes('translateFocusTexts'), 'My Focus candidates must be translated before rendering');
assert(app.includes('shouldRunDailyAutoRefresh'), 'Daily first-open AI refresh guard is missing');
assert(backend.includes('所有事件标题必须是完整中文'), 'My Focus prompt must require Chinese titles');
assert(backend.includes('5 条「美国态势」'), 'My Focus prompt must require US military tracking');
assert(app.includes('translationComplete'), 'World RSS cache must only be reused after complete translation');
assert(app.includes('collectFinanceContext()'), 'Finance analysis must send news context');
assert(app.includes('FINANCE_RSS_SOURCES'), 'Finance analysis must use dedicated market RSS context');
assert(app.includes('buildFinanceAnalysisCards'), 'Finance analysis must render three section cards');
assert(app.includes('syncFinanceAnalysisLayout'), 'Finance analysis must attach to market cards on mobile');
assert(app.includes('buildFallbackMyFocusHtml'), 'My Focus must render RSS fallback instead of disappearing');
assert(app.includes('buildAITimestamp'), 'AI-generated sections must render generation timestamps');
assert(app.includes('isDuplicateWorldCandidate'), 'World My Focus must dedupe against displayed RSS cards');
assert(app.includes('focus-source-link'), 'My Focus cards must expose source links');
assert(app.includes('link:item.link'), 'My Focus candidates must preserve RSS source links');
assert(app.includes('buildFocusSupplementCards'), 'My Focus must supplement AI output when fewer than 10 cards render');
assert(backend.includes('候选编号'), 'My Focus prompt must preserve candidate IDs for frontend dedupe');
assert(app.includes('categories: cats'), 'Arena payload must carry category order');
assert(app.includes('groupByKey[t.key]'), 'Arena tabs must render by category key, not array index');
assert(!app.includes('var d = data[ti]'), 'Arena tab rendering must not depend on mismatched tab/data order');
assert(app.includes('filterFinanceMarketNewsForAnalysis'), 'Finance analysis must score and filter market news relevance');
assert(backend.includes('直接市场证据'), 'Finance prompt must separate direct market evidence from background news');
assert(app.includes('loadFinanceMacroContext'), 'Finance analysis must load macro indicator context');
assert(backend.includes("app.get('/market/macro-context'"), 'Backend must expose macro context endpoint');
assert(backend.includes('FRED_MACRO_SERIES'), 'Macro context must use explicit FRED series definitions');
assert(app.includes('loadFinanceFlowContext'), 'Finance analysis must load fund-flow context');
assert(backend.includes("app.get('/market/flow-context'"), 'Backend must expose money-flow context endpoint');
assert(backend.includes('CBBTCUSD') && backend.includes('DEXCHUS'), 'Cross-asset macro context must include BTC and USD/CNY');
assert(app.includes('GOLD & CROSS ASSETS'), 'Finance analysis cards must keep English section titles');
assert(app.includes("'PAGE UPDATED '"), 'Page refresh time must be labeled separately from quote time');
assert(!app.includes("el.setAttribute('title', 'Data fetched at '"), 'Market cards must not label request time as quote time');
assert(preview.includes("const publicFiles = new Set"), 'Preview server must use a public-file allowlist');
assert(fs.existsSync(path.join(root, 'package-lock.json')), 'package-lock.json is required');

console.log(`Static integrity OK: ${ids.length} IDs, scripts parse, required safeguards present.`);
