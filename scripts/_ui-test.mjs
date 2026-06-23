import puppeteer from 'puppeteer';
import fs from 'fs';

const URL = process.env.TEST_URL || 'http://localhost:3000/';
const WAIT_MS = Number(process.env.WAIT_MS || 15000);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: [
    '--no-sandbox',
    '--disable-web-security',
    '--use-gl=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const warnings = [];
const logs = [];

page.on('console', (msg) => {
  const type = msg.type();
  const text = msg.text();
  if (type === 'error') consoleErrors.push(text);
  else if (type === 'warning') warnings.push(text);
  else logs.push(`[${type}] ${text}`);
});
page.on('pageerror', (err) => pageErrors.push(err.message + '\n' + (err.stack || '')));
page.on('requestfailed', (req) => {
  failedRequests.push(`${req.method()} ${req.url()} -> ${req.failure()?.errorText}`);
});

try {
  console.log(`Loading ${URL} ...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('DOM loaded, waiting for app to render...');
  await new Promise((r) => setTimeout(r, WAIT_MS));

  // Try to detect key UI elements
  const probe = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    return {
      title: document.title,
      bodyTextLen: document.body?.innerText?.length || 0,
      hasCesiumCanvas: !!q('canvas'),
      hasLoginModal: !!q('[style*="zIndex: 10000"]') || !!document.querySelector('input[placeholder="Password"]'),
      // Detect main app shell
      layerButtons: document.querySelectorAll('[data-layer-id], button').length,
      // Top-level error overlay
      errorOverlays: Array.from(document.querySelectorAll('div')).filter(d =>
        d.textContent && d.textContent.length < 200 &&
        /error|failed|cannot|undefined is not/i.test(d.textContent)
      ).slice(0, 5).map(d => d.textContent?.slice(0, 120)),
    };
  });
  console.log('\n=== PROBE ===');
  console.log(JSON.stringify(probe, null, 2));

  await page.screenshot({ path: '/tmp/ui-screenshot.png', fullPage: false });
  console.log('Screenshot saved to /tmp/ui-screenshot.png');
} catch (err) {
  console.error('Test failed:', err.message);
  await page.screenshot({ path: '/tmp/ui-screenshot.png', fullPage: false }).catch(() => {});
} finally {
  const report = {
    url: URL,
    consoleErrors: consoleErrors.slice(0, 50),
    pageErrors: pageErrors.slice(0, 20),
    failedRequests: failedRequests.slice(0, 50),
    warnings: warnings.slice(0, 30),
    recentLogs: logs.slice(-40),
  };
  fs.writeFileSync('/tmp/ui-report.json', JSON.stringify(report, null, 2));
  console.log('\n=== CONSOLE ERRORS ===');
  consoleErrors.slice(0, 30).forEach(e => console.log('  ✗', e));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.slice(0, 15).forEach(e => console.log('  ✗', e.split('\n')[0]));
  console.log('\n=== FAILED REQUESTS ===');
  failedRequests.slice(0, 30).forEach(r => console.log('  ✗', r));
  await browser.close();
}
