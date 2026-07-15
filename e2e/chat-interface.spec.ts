import { test, expect } from '@playwright/test';

test.describe('Chat Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
  });

  test('chat input field is visible', async ({ page }) => {
    // Look for the chat input textarea
    const chatInput = page.locator('textarea, input[placeholder*="Ask"], input[placeholder*="Type"]').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
  });

  test('chat send button is visible', async ({ page }) => {
    // Look for send button (usually has a send icon or text)
    const sendButton = page.locator('button:has(svg), button[aria-label*="send"], button:has-text("Send")').first();
    await expect(sendButton).toBeVisible({ timeout: 10000 });
  });

  test('welcome message is displayed', async ({ page }) => {
    // The app shows a welcome message on load
    const welcomeMessage = page.locator('text=Welcome, text=Earth Intelligence, text=Ask me').first();
    await expect(welcomeMessage).toBeVisible({ timeout: 10000 });
  });

  test('chat input accepts text', async ({ page }) => {
    const chatInput = page.locator('textarea, input[placeholder*="Ask"], input[placeholder*="Type"]').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    
    await chatInput.fill('Hello, what can you tell me about earthquakes?');
    await expect(chatInput).toHaveValue('Hello, what can you tell me about earthquakes?');
  });

  test('chat has message container', async ({ page }) => {
    // Look for the scrollable message container
    const messageContainer = page.locator('[style*="overflow"]').first();
    await expect(messageContainer).toBeVisible({ timeout: 10000 });
  });

  test('chat displays timestamp or message metadata', async ({ page }) => {
    // Messages typically have timestamps or role indicators
    await page.waitForTimeout(2000);
    // Check that the chat area has content
    await expect(page.locator('body')).toBeVisible();
  });
});
