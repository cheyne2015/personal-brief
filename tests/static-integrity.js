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
  'finDow', 'finNASDAQ', 'finSP500', 'finGoldValue', 'chartSH', 'chartNASDAQ', 'chartGOLD'
].forEach(id => assert(ids.includes(id), `Missing required element #${id}`));

const staleMarketValues = ['4096.47', '25888.84', '51202.26', '7431.46'];
staleMarketValues.forEach(value => assert(!html.includes(value) && !app.includes(value), `Stale market fallback remains: ${value}`));
assert(!app.includes('Trump%20Iran'), 'International feeds must not contain event-specific searches');
assert(app.includes('parseTencentQuoteTime') && app.includes('parseSinaQuoteTime'), 'Market timestamps must come from quote payloads');
assert(app.includes('formatDomesticTime'), 'Domestic news timestamp formatter is missing');
assert(app.includes('item.publishedAt || observedAt'), 'Domestic news does not render publication/fetch timestamps');
assert(app.includes("zh-title-v2|||"), 'My Focus Chinese-title cache version is missing');
assert(backend.includes('所有事件标题必须是完整中文'), 'My Focus prompt must require Chinese titles');
assert(app.includes("'PAGE UPDATED '"), 'Page refresh time must be labeled separately from quote time');
assert(!app.includes("el.setAttribute('title', 'Data fetched at '"), 'Market cards must not label request time as quote time');
assert(preview.includes("const publicFiles = new Set"), 'Preview server must use a public-file allowlist');
assert(fs.existsSync(path.join(root, 'package-lock.json')), 'package-lock.json is required');

console.log(`Static integrity OK: ${ids.length} IDs, scripts parse, required safeguards present.`);
