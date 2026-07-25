import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 8000));
await page.screenshot({ path: '/tmp/site_full.png' });
console.log('Screenshot 1: full page');

// Click the AI Assistant button to open the panel
try {
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const title = await btn.evaluate(el => el.getAttribute('title'));
    if (title === 'AI Assistant') {
      await btn.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '/tmp/site_ai_panel.png' });
  console.log('Screenshot 2: AI panel open');
} catch (e) {
  console.log('Could not click AI button:', e.message);
}

await browser.close();
console.log('Done');
