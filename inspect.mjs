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

// Open AI panel
const buttons = await page.$$('button');
for (const btn of buttons) {
  const title = await btn.evaluate(el => el.getAttribute('title'));
  if (title === 'AI Assistant') {
    await btn.click();
    break;
  }
}
await new Promise(r => setTimeout(r, 2000));

// Find ALL panels/divs that look like the AI chat panel
const info = await page.evaluate(() => {
  // Look for the AI input field by placeholder
  const aiInput = document.querySelector('input[placeholder*="Ask"]') || document.querySelector('input[placeholder*="analyze"]');
  if (!aiInput) return { error: 'No AI input found', allInputs: [...document.querySelectorAll('input')].map(i => i.placeholder).slice(0, 10) };

  // Walk up to find the panel container
  let container = aiInput;
  for (let i = 0; i < 10; i++) {
    if (container.parentElement) container = container.parentElement;
  }

  // Get the AI panel's structure
  const panel = container;
  const allBtns = panel.querySelectorAll('button, label.sandbox-file-btn, .sandbox-file-btn');
  const btnInfo = [...allBtns].map(b => ({
    tag: b.tagName.toLowerCase(),
    text: b.textContent?.trim().slice(0, 40),
    title: b.getAttribute('title') || '',
    hasIcon: !!b.querySelector('svg'),
  }));

  // Check for model tier selector
  const modelTierText = panel.textContent?.includes('Balanced') || panel.textContent?.includes('Fast') || panel.textContent?.includes('Deep');

  // Check for voice mode
  const voiceModeText = panel.textContent?.includes('Voice mode') || panel.textContent?.includes('Listening');

  // Check for the old "Plan" button
  const planBtn = [...allBtns].find(b => b.textContent?.includes('Plan'));

  // Get the action bar content
  const actionBars = panel.querySelectorAll('.sandbox-file-upload');

  return {
    aiInputPlaceholder: aiInput.placeholder,
    buttonsInPanel: btnInfo,
    modelTierVisible: modelTierText,
    voiceModeVisible: voiceModeText,
    planButtonVisible: !!planBtn,
    actionBarCount: actionBars.length,
    panelRect: panel.getBoundingClientRect(),
  };
});

console.log(JSON.stringify(info, null, 2));

// Also take a screenshot
await page.screenshot({ path: '/tmp/site_ai_open.png' });
console.log('Screenshot saved');

await browser.close();
