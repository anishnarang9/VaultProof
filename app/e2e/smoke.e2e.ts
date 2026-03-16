import { expect, test } from '@playwright/test';

const stagedWallet = 'DzGXeLhKHH81BKSLnQ82FWbmxyPezd7FUgLGDvSkzPge';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('vaultproof.e2e.localStorageCleared')) {
      window.localStorage.clear();
      window.sessionStorage.setItem('vaultproof.e2e.localStorageCleared', 'true');
    }
  });
});

test('navigates across the wired transaction routes', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  await page.getByRole('link', { name: 'Credential' }).click();
  await expect(page).toHaveURL(/\/credential$/);
  await expect(
    page.getByRole('heading', { name: 'Prepare a wallet-bound compliance credential' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Deposit' }).click();
  await expect(page).toHaveURL(/\/deposit$/);
  await expect(page.getByRole('heading', { name: 'Deposit into the vault' })).toBeVisible();

  await page.getByRole('link', { name: 'Withdraw' }).click();
  await expect(page).toHaveURL(/\/withdraw$/);
  await expect(
    page.getByRole('heading', { name: 'Redeem vault shares back to a main wallet' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Compliance', exact: true }).click();
  await expect(page).toHaveURL(/\/compliance$/);
  await expect(
    page.getByRole('heading', { name: 'Confidential identity, visible audit trail' }),
  ).toBeVisible();
});

test('stages a credential locally when no wallet is connected', async ({ page }) => {
  await page.goto('/credential');

  await page.getByLabel('Full legal name').fill('Jane Example');
  await page.getByLabel('Wallet public key').fill(stagedWallet);
  await page.getByLabel('Jurisdiction').fill('United States');
  await page.getByRole('button', { name: 'Issue credential' }).click();

  await expect(
    page.getByText(
      'Credential leaf staged locally. Connect the registry authority wallet to submit add_credential on-chain.',
    ),
  ).toBeVisible();

  await page.reload();

  await expect(page.getByLabel('Full legal name')).toHaveValue('Jane Example');
  await expect(page.getByLabel('Wallet public key')).toHaveValue(stagedWallet);
});

test('blocks emergency withdrawal requests until a wallet is connected', async ({ page }) => {
  await page.goto('/withdraw');

  await page.getByRole('button', { name: 'Request emergency withdrawal' }).click();

  await expect(
    page.getByText('Connect a wallet before requesting an emergency withdrawal.'),
  ).toBeVisible();
});
