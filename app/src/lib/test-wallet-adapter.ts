/**
 * TestWalletAdapter — auto-signing wallet adapter for Playwright e2e tests.
 *
 * Only instantiated when VITE_E2E_WALLET_SECRET env var is set.
 * Signs transactions with an in-memory Keypair — no browser extension popup.
 */
import {
  BaseSignerWalletAdapter,
  WalletReadyState,
  type WalletName,
} from '@solana/wallet-adapter-base';
import { Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

export const TEST_WALLET_NAME = 'TestWallet' as WalletName<'TestWallet'>;

export class TestWalletAdapter extends BaseSignerWalletAdapter {
  name = TEST_WALLET_NAME;
  url = 'https://vaultproof.dev/test';
  icon =
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiMwMGZmOTkiLz48L3N2Zz4=';
  readyState = WalletReadyState.Installed;
  supportedTransactionVersions = new Set<0>([0]);

  private _keypair: Keypair;
  private _publicKey: PublicKey;
  private _connected = false;

  constructor(secretKeyBase58: string) {
    super();
    this._keypair = Keypair.fromSecretKey(bs58.decode(secretKeyBase58));
    this._publicKey = this._keypair.publicKey;
  }

  get publicKey(): PublicKey | null {
    return this._connected ? this._publicKey : null;
  }

  get connecting(): boolean {
    return false;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    this._connected = true;
    this.emit('connect', this._publicKey);
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.emit('disconnect');
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    if (transaction instanceof Transaction) {
      transaction.partialSign(this._keypair);
    }
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    for (const tx of transactions) {
      await this.signTransaction(tx);
    }
    return transactions;
  }
}
