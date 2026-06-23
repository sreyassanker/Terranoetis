import puppeteer from 'puppeteer';

const URL = 'http://localhost:3000/';
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1700, height: 1050 });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGE: ' + e.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 10000));

  // Send a chat message
  const sel = 'input.ai-input';
  await page.waitForSelector(sel, { timeout: 10000 });
  await page.click(sel);
  await page.type(sel, 'What wildfires are burning right now?');
  await page.keyboard.press('Enter');
  console.log('Sent query, waiting up to 45s for response...');

  // Poll for the rendered AI response in the DOM
  let rendered = false;
  let startCount = 0;
  // Get initial assistant message count
  startCount = await page.evaluate(() => document.querySelectorAll('.ai-msg.assistant').length);
  console.log(`Initial assistant messages: ${startCount}`);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const state = await page.evaluate(() => {
      const msgs = Array.from(document.querySelectorAll('.ai-msg.assistant'));
      const last = msgs[msgs.length - 1];
      const text = last ? (last.textContent || '').trim() : '';
      return {
        count: msgs.length,
        text,
      };
    });
    if (i % 5 === 0) console.log(`  [${i}s] assistantMsgs=${state.count} lastLen=${state.text.length}`);
    // A NEW assistant message appeared (count grew) after the query
    if (state.count > startCount && state.text.length > 30) {
      rendered = true;
      console.log(`\n=== NEW AI RESPONSE RENDERED (${state.count} msgs) ===`);
      console.log(state.text.slice(0, 600));
      break;
    }
  }
  if (!rendered) console.log('\n=== NO NEW RENDERED RESPONSE ===');

  await page.screenshot({ path: '/tmp/ui-chat-final.png' });
} catch (err) {
  console.error('Test error:', err.message);
} finally {
  console.log('\n=== PAGE ERRORS ===');
  [...new Set(errors)].forEach(e => console.log('  ✗', e));
  await browser.close();
}
