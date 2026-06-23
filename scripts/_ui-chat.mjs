import puppeteer from 'puppeteer';

const URL = process.env.TEST_URL || 'http://localhost:3000/';
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1700, height: 1050 });

const errors = [];
const apiCalls = [];
page.on('pageerror', (e) => errors.push('PAGE: ' + e.message));
page.on('request', (req) => {
  const url = req.url();
  if (url.includes('/api/agent/ask') || url.includes('/api/agent/pipeline')) {
    apiCalls.push(`REQUEST: ${req.method()} ${url}`);
  }
});
page.on('response', (resp) => {
  const url = resp.url();
  if (url.includes('/api/agent/ask') || url.includes('/api/agent/pipeline')) {
    apiCalls.push(`RESPONSE: ${resp.status()} ${url}`);
  }
});

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 10000));

  // Type into AI input
  const sel = 'input.ai-input';
  await page.waitForSelector(sel, { timeout: 10000 });
  console.log('Found AI input, typing query...');
  await page.click(sel);
  await page.type(sel, 'What earthquakes happened recently?');
  await new Promise((r) => setTimeout(r, 500));

  // Press Enter to send
  await page.keyboard.press('Enter');
  console.log('Sent query, waiting for agent response...');

  // Wait up to 40s for a response to appear
  let responded = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const state = await page.evaluate(() => {
      const msgs = Array.from(document.querySelectorAll('.ai-message, .ai-msg, [class*="message"]'));
      const text = document.body.innerText;
      return {
        msgCount: msgs.length,
        hasResponse: /magnitude|earthquake|quake|recent|depth|latitude/i.test(text.slice(-2000)),
        bodyTail: text.slice(-300),
      };
    });
    if (i % 5 === 0) console.log(`  [${i}s] msgs=${state.msgCount} hasResponse=${state.hasResponse}`);
    if (state.hasResponse && i > 3) {
      responded = true;
      console.log('\n=== GOT RESPONSE ===');
      console.log(state.bodyTail);
      break;
    }
  }
  if (!responded) {
    console.log('\n=== NO RESPONSE after 40s ===');
    const text = await page.evaluate(() => document.body.innerText.slice(-600));
    console.log(text);
  }
  await page.screenshot({ path: '/tmp/ui-chat.png' });
} catch (err) {
  console.error('Test error:', err.message);
} finally {
  console.log('\n=== PAGE ERRORS ===');
  [...new Set(errors)].forEach(e => console.log('  ✗', e));
  console.log('\n=== AGENT API CALLS ===');
  [...new Set(apiCalls)].forEach(c => console.log('  ', c));
  await browser.close();
}
