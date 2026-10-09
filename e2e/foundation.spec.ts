import { expect, test } from '@playwright/test';

test('serves the frontend and reports API liveness', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Site Availability Monitor' })).toBeVisible();
  await expect(page.getByText('api erişilebilir')).toBeVisible();
});

test('supports two independent browser clients', async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  await Promise.all([firstPage.goto('/'), secondPage.goto('/')]);
  await Promise.all([
    expect(firstPage.getByRole('heading', { name: 'Site Availability Monitor' })).toBeVisible(),
    expect(secondPage.getByRole('heading', { name: 'Site Availability Monitor' })).toBeVisible(),
  ]);

  await Promise.all([firstContext.close(), secondContext.close()]);
});
