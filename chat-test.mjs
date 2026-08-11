import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
const networkErrors = [];

page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', err => consoleErrors.push(err.message));
page.on('response', resp => {
  if (resp.status() >= 400 && resp.url().includes('/api/')) {
    networkErrors.push(`${resp.status()} ${resp.url()}`);
  }
});

console.log('=== Navigating to http://localhost:5173 ===');
await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });
console.log('Page loaded');

// Wait a bit for React to render
await page.waitForTimeout(3000);

// Check if page has content
const title = await page.title();
console.log(`Page title: ${title}`);

// Look for chat-related elements
const chatPanel = await page.$('.chat-panel, [class*="chat-panel"], [class*="ChatPanel"]');
console.log(`Chat panel found: ${!!chatPanel}`);

const chatInput = await page.$('textarea[class*="chat"], textarea[placeholder*="chat"], textarea[placeholder*="message"], textarea[placeholder*="Ask"], input[class*="chat-input"]');
console.log(`Chat input found: ${!!chatInput}`);

// Look for any buttons
const buttons = await page.$$('button');
console.log(`Total buttons found: ${buttons.length}`);

// Get all button texts
for (const btn of buttons.slice(0, 15)) {
  const text = await btn.textContent();
  const visible = await btn.isVisible();
  if (text?.trim() && visible) {
    console.log(`  Button: "${text.trim().substring(0, 50)}"`);
  }
}

// Look for chat toggle / AI button
const aiButton = await page.$('button[aria-label*="AI"], button[title*="AI"], button[title*="chat"], button[aria-label*="chat"]');
if (aiButton) {
  console.log('\n=== Found AI/Chat toggle button, clicking... ===');
  await aiButton.click();
  await page.waitForTimeout(2000);
}

// Check for chat input again after toggling
const chatInputAfter = await page.$('textarea');
console.log(`\nTextarea after toggle: ${!!chatInputAfter}`);

if (chatInputAfter) {
  console.log('\n=== Typing test message ===');
  await chatInputAfter.fill('hello');
  await page.waitForTimeout(500);
  
  // Look for send button
  const sendBtn = await page.$('button[aria-label*="Send"], button[class*="send"], button[class*="ai-send"]');
  if (sendBtn) {
    console.log('Found send button, clicking...');
    await sendBtn.click();
    await page.waitForTimeout(5000);
  } else {
    // Try pressing Enter
    console.log('No send button found, pressing Enter...');
    await chatInputAfter.press('Enter');
    await page.waitForTimeout(5000);
  }
  
  // Check for AI response or error
  const messages = await page.$$('[class*="message"], [class*="Message"]');
  console.log(`Messages visible: ${messages.length}`);
}

// Take a screenshot for reference
await page.screenshot({ path: '/tmp/chat-test-screenshot.png', fullPage: false });
console.log('\nScreenshot saved to /tmp/chat-test-screenshot.png');

// Report console errors
console.log('\n=== CONSOLE ERRORS ===');
if (consoleErrors.length === 0) {
  console.log('None!');
} else {
  consoleErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e.substring(0, 200)}`));
}

// Report network errors
console.log('\n=== NETWORK ERRORS (API calls >= 400) ===');
if (networkErrors.length === 0) {
  console.log('None!');
} else {
  networkErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
}

await browser.close();
console.log('\n=== TEST COMPLETE ===');
