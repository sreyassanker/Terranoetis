import puppeteer from 'puppeteer';
import fs from 'fs';

const URL = process.env.TEST_URL || 'http://localhost:3000/';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: [
    '--no-sandbox',
    '--use-gl=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('requestfailed', (req) => {
  failedRequests.push(`${req.method()} ${req.url()} -> ${req.failure()?.errorText}`);
});
page.on('response', async (resp) => {
  const status = resp.status();
  if (status >= 400) {
    const url = resp.url();
    if (url.includes('/api/')) {
      console.log(`  [HTTP ${status}] ${resp.request().method()} ${url.replace('http://localhost:3000', '')}`);
    }
  }
});

async function snapshot(label) {
  const data = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    // Find the top status bar text
    const findText = (re) => {
      const m = text.match(re);
      return m ? m[0] : null;
    };
    return {
      clock: findText(/\d{4}\/\d{2}\/\d{2}[^\n]*IST/i) || findText(/\d{2}:\d{2}:\d{2}[^\n]*IST/i),
      fps: findText(/FPS[:\s]*\d+/i),
      camera: findText(/\d+\.\d+°[NSEW]\s+\d+\.\d+°[NSEW]/i) || findText(/Camera[^\n]{0,40}/i),
      entityCount: findText(/\d+\s*(?:entities|entity|objects|points)/i),
      layerActive: findText(/\d+\s*\/\s*\d+\s*(?:layers|active)/i),
      hasChat: /Send a message|Ask the AI|chat/i.test(text),
    };
  });
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(data, null, 2));
  return data;
}

try {
  console.log(`Loading ${URL} ...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 12000));

  await snapshot('Initial load');

  await page.screenshot({ path: '/tmp/ui-1-initial.png' });

  // Try toggling a layer (earthquakes is usually default). Find checkboxes/toggles.
  console.log('\n=== Layer toggle test ===');
  const layerPanel = await page.evaluate(() => {
    // Find all clickable layer items
    const items = Array.from(document.querySelectorAll('[data-layer-id], [data-id]'));
    return items.slice(0, 10).map(i => ({
      id: i.getAttribute('data-layer-id') || i.getAttribute('data-id'),
      text: i.textContent?.trim().slice(0, 50),
    }));
  });
  console.log('First layer items:', JSON.stringify(layerPanel, null, 2));

  // Look for the chat input
  console.log('\n=== Chat input detection ===');
  const chatInputs = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('textarea, input[type="text"]'));
    return inputs.map(i => ({
      tag: i.tagName,
      placeholder: i.placeholder,
      ariaLabel: i.getAttribute('aria-label'),
      visible: i.offsetParent !== null,
    })).filter(i => i.visible);
  });
  console.log('Visible text inputs:', JSON.stringify(chatInputs, null, 2));

  await new Promise((r) => setTimeout(r, 5000));
  await snapshot('After idle');

} catch (err) {
  console.error('Test error:', err.message);
} finally {
  console.log('\n=== PAGE ERRORS ===');
  [...new Set(pageErrors)].slice(0, 15).forEach(e => console.log('  ✗', e));
  console.log('\n=== UNIQUE CONSOLE ERRORS ===');
  [...new Set(consoleErrors)].slice(0, 20).forEach(e => console.log('  ✗', e));
  console.log('\n=== FAILED REQUESTS ===');
  [...new Set(failedRequests)].slice(0, 20).forEach(r => console.log('  ✗', r));
  await browser.close();
}
