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

const buttons = await page.$$('button');
for (const btn of buttons) {
  const title = await btn.evaluate(el => el.getAttribute('title'));
  if (title === 'AI Assistant') { await btn.click(); break; }
}
await new Promise(r => setTimeout(r, 2000));

const info = await page.evaluate(() => {
  const aiInput = document.querySelector('input[placeholder*="Ask"]');
  if (!aiInput) return { error: 'no input' };

  // Find the AI panel — the closest positioned ancestor
  let panel = aiInput;
  while (panel && panel.parentElement) {
    panel = panel.parentElement;
    const rect = panel.getBoundingClientRect();
    if (rect.width > 200 && rect.width < 600 && rect.height > 200) break;
  }

  // Get all text in the action bar area
  const inputWrap = aiInput.closest('.ai-input-wrap');
  const actionBar = panel.querySelector('.sandbox-file-upload');

  // Get the computed styles / layout of key elements
  const inputRect = aiInput.getBoundingClientRect();
  const actionBarRect = actionBar?.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();

  // Check what's between input and action bar (should be nothing now)
  const between = inputRect.bottom - (actionBarRect?.top || 0);

  // Get the text content of the action bar
  const actionBarText = actionBar?.textContent?.trim().slice(0, 200);

  // Count visible elements between input and action bar
  const allChildren = panel.querySelectorAll('*');
  const modelTierElements = [...allChildren].filter(el => {
    const t = el.textContent?.trim();
    return t && (t === 'Fast' || t === 'Balanced' || t === 'Deep');
  });

  return {
    inputRect: { x: inputRect.x, y: inputRect.y, w: inputRect.width, h: inputRect.height },
    actionBarRect: actionBarRect ? { x: actionBarRect.x, y: actionBarRect.y, w: actionBarRect.width, h: actionBarRect.height } : null,
    panelRect: { x: panelRect.x, y: panelRect.y, w: panelRect.width, h: panelRect.height },
    gapBetweenInputAndActionBar: between,
    actionBarText,
    modelTierElementsFound: modelTierElements.length,
    modelTierElements: modelTierElements.map(el => ({
      tag: el.tagName,
      text: el.textContent?.trim(),
      class: el.className,
    })),
  };
});

console.log(JSON.stringify(info, null, 2));

await browser.close();
