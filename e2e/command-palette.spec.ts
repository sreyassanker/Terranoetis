import { test, expect } from '@playwright/test';

test.describe('Command Palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
  });

  test('command palette opens with keyboard shortcut', async ({ page }) => {
    // Press Ctrl+K or Cmd+K to open command palette
    await page.keyboard.press('Control+k');
    
    // Look for the search input in the command palette
    const searchInput = page.locator('input[placeholder="Search layers..."]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test('command palette closes with Escape', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const searchInput = page.locator('input[placeholder="Search layers..."]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible({ timeout: 3000 });
  });

  test('command palette shows layer results', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const searchInput = page.locator('input[placeholder="Search layers..."]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    
    // Type to search for a layer
    await searchInput.fill('earth');
    await page.waitForTimeout(500);
    
    // Should show results containing "Earth"
    const results = page.locator('div:has-text("Toggle: Earthquakes")');
    await expect(results.first()).toBeVisible({ timeout: 3000 });
  });

  test('command palette keyboard navigation', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const searchInput = page.locator('input[placeholder="Search layers..."]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    
    // Navigate down
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    
    // Navigate up
    await page.keyboard.press('ArrowUp');
    
    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible({ timeout: 3000 });
  });

  test('command palette backdrop click closes', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const searchInput = page.locator('input[placeholder="Search layers..."]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    
    // Click the backdrop (the fixed overlay)
    await page.locator('div[style*="position: fixed"][style*="background: rgba(0,0,0,0.5)"]').click();
    await expect(searchInput).not.toBeVisible({ timeout: 3000 });
  });

  test('command palette footer shows keyboard hints', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(1000);
    
    // Check for keyboard hint text
    const footer = page.locator('div:has-text("Navigate"), div:has-text("Select"), div:has-text("Close")');
    await expect(footer.first()).toBeVisible({ timeout: 5000 });
  });
});
