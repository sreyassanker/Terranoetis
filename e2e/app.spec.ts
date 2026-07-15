import { test, expect } from '@playwright/test';

test.describe('Application smoke tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Earth Intelligence|Realtime/i);
  });

  test('main content is visible', async ({ page }) => {
    await page.goto('/');
    // Wait for initial render - don't use networkidle for Cesium apps
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // Allow Cesium to initialize
    await expect(page.locator('body')).toBeVisible();
  });

  test('no critical console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    
    // Filter out known acceptable errors
    const criticalErrors = errors.filter(
      e => !e.includes('401') && 
           !e.includes('Unauthorized') && 
           !e.includes('Failed to fetch') &&
           !e.includes('WebSocket') &&
           !e.includes('net::ERR')
    );
    
    expect(criticalErrors).toHaveLength(0);
  });

  test('app has interactive elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    // Check for any visible buttons or interactive elements
    const interactive = page.locator('button, [role="button"], input, select, a[href]').first();
    await expect(interactive).toBeVisible({ timeout: 10000 });
  });
});
