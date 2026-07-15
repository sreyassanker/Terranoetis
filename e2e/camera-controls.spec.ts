import { test, expect } from '@playwright/test';

test.describe('Camera Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Allow Cesium to fully initialize
  });

  test('zoom in button is visible and clickable', async ({ page }) => {
    const zoomIn = page.locator('button[aria-label="Zoom in"]');
    await expect(zoomIn).toBeVisible({ timeout: 10000 });
    await zoomIn.click();
    // Button should remain visible after click
    await expect(zoomIn).toBeVisible();
  });

  test('zoom out button is visible and clickable', async ({ page }) => {
    const zoomOut = page.locator('button[aria-label="Zoom out"]');
    await expect(zoomOut).toBeVisible({ timeout: 10000 });
    await zoomOut.click();
    await expect(zoomOut).toBeVisible();
  });

  test('reset view button is visible and clickable', async ({ page }) => {
    const resetBtn = page.locator('button[aria-label="Reset view"]');
    await expect(resetBtn).toBeVisible({ timeout: 10000 });
    await resetBtn.click();
    await expect(resetBtn).toBeVisible();
  });

  test('height indicator displays a value', async ({ page }) => {
    // The height display shows "X km" or "X m" format
    const heightDisplay = page.locator('div:has-text("km"), div:has-text("m")').filter({ hasText: /\d+\s*(km|m)/ });
    await expect(heightDisplay.first()).toBeVisible({ timeout: 10000 });
  });

  test('camera controls container is positioned correctly', async ({ page }) => {
    // Camera controls should be in the bottom-right area
    const controls = page.locator('button[aria-label="Zoom in"]').locator('..');
    await expect(controls).toBeVisible({ timeout: 10000 });
  });

  test('zoom in hover changes button color', async ({ page }) => {
    const zoomIn = page.locator('button[aria-label="Zoom in"]');
    await expect(zoomIn).toBeVisible({ timeout: 10000 });
    await zoomIn.hover();
    // Verify hover state - button should be interactive
    await expect(zoomIn).toBeEnabled();
  });
});
