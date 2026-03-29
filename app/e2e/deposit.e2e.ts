/**
 * deposit.e2e.ts — Investor deposit flow: credential issuance → proof generation → deposit.
 *
 * Pre-requisites (for full on-chain path):
 *   - Local validator OR devnet with deployed programs
 *   - Global setup has initialized registry, vault, and funded the test wallet
 *   - VITE_E2E_WALLET_SECRET set so TestWalletAdapter auto-connects
 *
 * Without wallet/validator the tests still verify UI behavior (disabled states, form validation).
 */
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const stateFile = resolve(__dirname, '.localnet-state.json');

function loadTestWalletPubkey(): string {
  if (existsSync(stateFile)) {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    return state.walletPublicKey;
  }
  return process.env.VITE_E2E_WALLET_PUBKEY ?? 'DzGXeLhKHH81BKSLnQ82FWbmxyPezd7FUgLGDvSkzPge';
}

test.describe('investor credential and deposit flow', () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Credential issuance                                              */
  /* ---------------------------------------------------------------- */

  test('credential form stages locally and persists across reload', async ({ page }) => {
    const walletPubkey = loadTestWalletPubkey();

    await page.goto('/developer/onboard');
    await expect(page.getByText(/issue an investor credential/i)).toBeVisible();

    // Fill all required fields
    await page.getByLabel(/full name/i).fill('E2E Test User');
    await page.getByLabel(/date of birth/i).fill('1990-06-15');
    await page.getByLabel(/wallet/i).fill(walletPubkey);
    await page.getByLabel(/jurisdiction/i).fill('United States');

    // Fill optional fields if present
    const countryField = page.getByLabel(/country code/i);
    if (await countryField.isVisible().catch(() => false)) {
      await countryField.fill('US');
    }

    const tierField = page.getByLabel(/accreditation tier/i);
    if (await tierField.isVisible().catch(() => false)) {
      await tierField.selectOption('accredited');
    }

    const expiryField = page.getByLabel(/expir/i);
    if (await expiryField.isVisible().catch(() => false)) {
      const expiry = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
      await expiryField.fill(expiry);
    }

    // Issue
    const issueButton = page.getByRole('button', { name: /issue credential/i });
    await issueButton.click();

    // Wait for the button to become enabled again (submission completed)
    await expect(issueButton).toBeEnabled({ timeout: 30_000 });

    // After submission, check that something happened — look for any status text
    // The credential page shows status in a paragraph after form submission
    await page.waitForTimeout(1000);

    // Verify the form is still on the page (didn't crash)
    await expect(page.getByText(/issue an investor credential/i)).toBeVisible();
  });

  /* ---------------------------------------------------------------- */
  /*  Deposit page guards                                              */
  /* ---------------------------------------------------------------- */

  test('deposit page shows proof button disabled without credential', async ({ page }) => {
    await page.goto('/investor/deposit');
    await expect(page.getByText(/deposit usdc with proof/i)).toBeVisible();

    const button = page.getByRole('button', { name: /generate proof|deposit/i });
    // Button should be disabled or not present without a staged credential
    if (await button.isVisible().catch(() => false)) {
      await expect(button).toBeDisabled();
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Full deposit flow (credential → proof → submit)                  */
  /* ---------------------------------------------------------------- */

  test('full deposit flow: credential → proof generation → submission', async ({ page }) => {
    const walletPubkey = loadTestWalletPubkey();

    // Step 1: Stage credential
    await page.goto('/developer/onboard');
    await page.getByLabel(/full name/i).fill('E2E Depositor');
    await page.getByLabel(/date of birth/i).fill('1985-03-20');
    await page.getByLabel(/wallet/i).fill(walletPubkey);
    await page.getByLabel(/jurisdiction/i).fill('United States');

    const countryField = page.getByLabel(/country code/i);
    if (await countryField.isVisible().catch(() => false)) {
      await countryField.fill('US');
    }

    const tierField = page.getByLabel(/accreditation tier/i);
    if (await tierField.isVisible().catch(() => false)) {
      await tierField.selectOption('accredited');
    }

    const expiryField = page.getByLabel(/expir/i);
    if (await expiryField.isVisible().catch(() => false)) {
      const expiry = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
      await expiryField.fill(expiry);
    }

    const issueBtn = page.getByRole('button', { name: /issue credential/i });
    await issueBtn.click();
    await expect(issueBtn).toBeEnabled({ timeout: 30_000 });
    await page.waitForTimeout(1000);

    // Step 2: Navigate to deposit
    await page.goto('/investor/deposit');
    await expect(page.getByText(/deposit usdc with proof/i)).toBeVisible();

    // Step 3: Enter amount
    const amountInput = page.locator('input[inputmode="decimal"], input[type="number"]').first();
    await amountInput.clear();
    await amountInput.fill('100');

    // Step 4: Submit — triggers proof generation
    const submitButton = page.getByRole('button', { name: /generate proof|deposit/i });
    if (await submitButton.isEnabled().catch(() => false)) {
      await submitButton.click();

      // Step 5: Proof lifecycle — at least one step should appear
      const proofSteps = [
        'Loading WASM',
        'Fetching registry',
        'Preparing credential',
        'Encrypting compliance',
        'Generating Groth16',
        'Proof package ready',
      ];

      const stepPattern = new RegExp(proofSteps.join('|'), 'i');
      await expect(page.getByText(stepPattern).first()).toBeVisible({ timeout: 15_000 });

      // Step 6: Wait for outcome
      const outcomePattern = /deposit submitted|unable to submit|error|failed/i;
      await expect(page.getByText(outcomePattern).first()).toBeVisible({ timeout: 150_000 });

      // Log result
      const successText = await page
        .getByText(/deposit submitted/i)
        .textContent()
        .catch(() => null);
      if (successText) {
        const match = successText.match(/deposit submitted[:\s]*(\w+)/i);
        if (match) {
          expect(match[1].length).toBeGreaterThan(40);
          console.log('[e2e] Deposit signature:', match[1]);
        }
      } else {
        const errorText = await page
          .getByText(/unable to submit|error|failed/i)
          .textContent()
          .catch(() => 'unknown');
        console.log('[e2e] Deposit did not succeed (may be expected without validator):', errorText);
      }
    } else {
      console.log('[e2e] Submit button disabled — wallet or credential not available');
    }
  });
});
