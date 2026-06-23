'use strict';

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const port = 18080 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['local-preview-server.js'], {
  cwd:root,
  env:{ ...process.env, PREVIEW_PORT:String(port) },
  stdio:['ignore', 'pipe', 'pipe'],
  windowsHide:true
});

async function request(pathname, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(origin + pathname, { ...options, signal:controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await request('/');
      if (response.ok) return;
    } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Preview server did not start');
}

(async function run() {
  try {
    await waitUntilReady();
    for (const pathname of [
      '/', '/styles.css', '/js/effects.js', '/js/domestic-news.js', '/js/core.js',
      '/js/arena.js', '/js/world.js', '/js/finance.js', '/js/data.js'
    ]) {
      const response = await request(pathname);
      assert.strictEqual(response.status, 200, `${pathname} should be public`);
    }
    for (const pathname of ['/.env', '/package.json', '/%E9%98%BF%E9%87%8C%E4%BA%91.pem']) {
      const response = await request(pathname);
      assert.strictEqual(response.status, 403, `${pathname} should be blocked`);
    }

    const domestic = await (await request('/api/llm/domestic-hot?refresh=1')).json();
    assert(domestic.success && domestic.items.length === 10, 'Domestic TOP10 is unavailable');
    assert(domestic.items.every(item => item.title && item.summary), 'Domestic item missing title or summary');
    assert(domestic.items.some(item => item.publishedAt), 'Domestic media publication timestamps are missing');

    const chengdu = await (await request('/api/llm/chengdu-local?refresh=1')).json();
    assert(chengdu.success && chengdu.items.length > 0 && chengdu.items.length <= 8, 'Chengdu local news is unavailable');
    assert(chengdu.items.every(item => item.title && item.summary), 'Chengdu local item missing title or summary');

    for (const symbol of ['shanghai', 'nasdaq', 'gold']) {
      const history = await (await request(`/api/llm/market/history?symbol=${symbol}&refresh=1`)).json();
      assert(history.success && history.points.length === 30, `${symbol} history should contain 30 points`);
    }

    const gold = await (await request('/api/llm/market/gold')).json();
    assert(gold.success && gold.raw, 'Gold quote is unavailable');
    assert(Number.isFinite(Number(String(gold.shGoldRaw || '').split(',')[3])), 'Shanghai gold quote is unavailable');
    assert.strictEqual(gold.shGoldSource, 'Shanghai Gold Exchange', 'Shanghai gold should use the official exchange source');
    assert(gold.shGoldTimestamp, 'Shanghai gold quote timestamp is missing');
    console.log('Smoke test OK: public assets, sensitive-file blocking, news and market APIs.');
  } finally {
    child.kill();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
