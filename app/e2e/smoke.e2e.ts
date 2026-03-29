/**
 * smoke.e2e.ts — Navigation, landing page, and basic layout verification.
 *
 * These tests do NOT require a wallet or on-chain state.
 * They verify the app loads, routes work, and key UI elements render.
 */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

/* ------------------------------------------------------------------ */
/*  Landing page                                                       */
/* ------------------------------------------------------------------ */

test('landing page renders hero, nav links, and CTAs', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', {
      name: /compliant infrastructure for institutional digital assets/i,
    }),
  ).toBeVisible();

  // Two entry-point CTAs exist
  const devLink = page.getByRole('link', { name: /developer console/i });
  const investorLink = page.getByRole('link', { name: /investor portal/i });
  await expect(devLink.first()).toBeVisible();
  await expect(investorLink.first()).toBeVisible();
});

/* ------------------------------------------------------------------ */
/*  Developer console navigation                                       */
/* ------------------------------------------------------------------ */

test('developer console sidebar navigates all pages', async ({ page }) => {
  await page.goto('/developer');

  // Dashboard loads as index
  await expect(page.getByText(/operator overview/i)).toBeVisible();

  // KYC Onboarding
  await page.getByRole('link', { name: /kyc onboarding/i }).click();
  await expect(page).toHaveURL(/\/developer\/onboard$/);
  await expect(page.getByText(/issue an investor credential/i)).toBeVisible();

  // Yield Management
  await page.getByRole('link', { name: /yield management/i }).click();
  await expect(page).toHaveURL(/\/developer\/yield$/);
  await expect(page.getByText(/venue registry/i)).toBeVisible();

  // Risk Controls
  await page.getByRole('link', { name: /risk controls/i }).click();
  await expect(page).toHaveURL(/\/developer\/risk$/);
  await expect(page.getByText(/circuit breaker and transaction limits/i)).toBeVisible();

  // Governance
  await page.getByRole('link', { name: /governance/i }).click();
  await expect(page).toHaveURL(/\/developer\/governance$/);
  await expect(page.getByText(/authority-routed decryption controls/i)).toBeVisible();

  // Compliance
  await page.getByRole('link', { name: 'Compliance', exact: true }).click();
  await expect(page).toHaveURL(/\/developer\/compliance$/);
  await expect(page.getByText(/transfer record explorer/i)).toBeVisible();
});

/* ------------------------------------------------------------------ */
/*  Investor portal navigation                                         */
/* ------------------------------------------------------------------ */

test('investor portal sidebar navigates all pages', async ({ page }) => {
  await page.goto('/investor');

  // Portfolio loads as index
  await expect(page.getByText(/share price appreciation/i)).toBeVisible();

  // Deposit
  await page.getByRole('link', { name: 'Deposit', exact: true }).click();
  await expect(page).toHaveURL(/\/investor\/deposit$/);
  await expect(page.getByText(/deposit usdc with proof/i)).toBeVisible();

  // Transfer
  await page.getByRole('link', { name: 'Transfer', exact: true }).click();
  await expect(page).toHaveURL(/\/investor\/transfer$/);
  await expect(page.getByText(/transfer shares with proof/i)).toBeVisible();

  // Withdraw
  await page.getByRole('link', { name: 'Withdraw', exact: true }).click();
  await expect(page).toHaveURL(/\/investor\/withdraw$/);
  await expect(page.getByText(/withdraw with proof or emergency hatch/i)).toBeVisible();
});

/* ------------------------------------------------------------------ */
/*  Legacy route redirects                                             */
/* ------------------------------------------------------------------ */

test('legacy routes redirect to new paths', async ({ page }) => {
  await page.goto('/deposit');
  await expect(page).toHaveURL(/\/investor\/deposit$/);

  await page.goto('/withdraw');
  await expect(page).toHaveURL(/\/investor\/withdraw$/);

  await page.goto('/transfer');
  await expect(page).toHaveURL(/\/investor\/transfer$/);

  await page.goto('/compliance');
  await expect(page).toHaveURL(/\/developer\/compliance$/);

  await page.goto('/operator');
  await expect(page).toHaveURL(/\/developer$/);

  await page.goto('/portfolio');
  await expect(page).toHaveURL(/\/investor$/);
});

/* ------------------------------------------------------------------ */
/*  No "demo mode" or "mocked" text anywhere                           */
/* ------------------------------------------------------------------ */

test('no demo-mode or mock text appears on any page', async ({ page }) => {
  const demoPattern = /demo mode|mocked ui|mock data|placeholder/i;

  const pages = [
    '/developer',
    '/developer/onboard',
    '/developer/yield',
    '/developer/risk',
    '/developer/governance',
    '/developer/compliance',
    '/investor',
    '/investor/deposit',
    '/investor/transfer',
    '/investor/withdraw',
  ];

  for (const route of pages) {
    await page.goto(route);
    // Wait for content to load
    await page.waitForTimeout(500);
    const body = await page.locator('body').textContent();
    expect(body, `Found demo/mock text on ${route}`).not.toMatch(demoPattern);
  }
});
