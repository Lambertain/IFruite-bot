const { chromium } = require('playwright');

const API_BASE = process.env.ADSPOWER_API_BASE || 'http://local.adspower.net:50325';

async function apiGet(route, params = {}) {
  const apiKey = process.env.ADSPOWER_API_KEY;
  if (!apiKey) throw new Error('Missing ADSPOWER_API_KEY env');
  const url = new URL(route, API_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`AdsPower non-JSON: ${text}`); }
}

async function stopProfile(profileId) {
  try { await apiGet('/api/v1/browser/stop', { user_id: profileId }); } catch {}
}

async function openPage(profileId) {
  const result = await apiGet('/api/v1/browser/start', { user_id: profileId });
  if (result.code !== 0) throw new Error(`AdsPower start failed: ${result.msg || 'unknown'}`);
  const ws = result.data?.ws || {};
  const cdp = ws.puppeteer || ws.playwright || ws.chrome || null;
  if (!cdp) throw new Error('No CDP endpoint');
  const browser = await chromium.connectOverCDP(cdp, { timeout: 120000 });
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();

  async function close() {
    try { await browser.close(); } catch {}
    await stopProfile(profileId);
  }

  return { browser, context, page, close };
}

module.exports = { openPage, stopProfile };
