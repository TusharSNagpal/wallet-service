import { topupWallet } from '../../application/topup_wallet';
import { WalletDomain } from '../../domain/wallet';
import { TransactionDomain } from '../../domain/transaction';
import { invalidateWalletBalanceCache } from '../../redis';

jest.mock('../../domain/wallet', () => ({
  WalletDomain: {
    findWalletById: jest.fn(),
    updateWalletBalance: jest.fn(),
  },
}));
jest.mock('../../domain/transaction', () => ({
  TransactionDomain: {
    findTransactionByPaymentId: jest.fn(),
    createTransaction: jest.fn(),
  },
}));
jest.mock('../../redis', () => ({ invalidateWalletBalanceCache: jest.fn() }));
jest.mock('../../utils/wallet_queue', () => ({
  withWalletLock: jest.fn((_id: string, fn: () => Promise<unknown>) => fn()),
}));
jest.mock('../../utils/worker_info', () => ({ workerLabel: 'Worker 1 (PID 1)' }));
jest.mock('../../database', () => ({
  __esModule: true,
  default: { transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn({})) },
}));

const mockWalletDomain = WalletDomain as jest.Mocked<typeof WalletDomain>;
const mockTransactionDomain = TransactionDomain as jest.Mocked<typeof TransactionDomain>;
const mockInvalidateCache = invalidateWalletBalanceCache as jest.MockedFunction<typeof invalidateWalletBalanceCache>;

describe('topupWallet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('credits wallet and creates a transaction when no duplicate paymentId exists', async () => {
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue(null);
    mockWalletDomain.updateWalletBalance.mockResolvedValue({ id: 'wallet-1', balance: 500 } as any);
    mockTransactionDomain.createTransaction.mockResolvedValue({ id: 'txn-1' } as any);
    mockInvalidateCache.mockResolvedValue(undefined);

    const result = await topupWallet('wallet-1', 'payment-1', 500);

    expect(mockTransactionDomain.findTransactionByPaymentId).toHaveBeenCalledWith('payment-1');
    expect(mockWalletDomain.updateWalletBalance).toHaveBeenCalledWith('wallet-1', 'credit', 500, {});
    expect(mockTransactionDomain.createTransaction).toHaveBeenCalledWith('wallet-1', 'payment-1', 'credit', 500, {});
    expect(mockInvalidateCache).toHaveBeenCalledWith('wallet-1');
    expect(result).toEqual({ walletId: 'wallet-1', balance: 500, transactionId: 'txn-1' });
  });

  it('returns existing transaction without crediting when paymentId is a duplicate', async () => {
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue({ id: 'txn-existing' } as any);
    mockWalletDomain.findWalletById.mockResolvedValue({ id: 'wallet-1', balance: 500 } as any);

    const result = await topupWallet('wallet-1', 'payment-1', 500);

    expect(mockWalletDomain.updateWalletBalance).not.toHaveBeenCalled();
    expect(mockTransactionDomain.createTransaction).not.toHaveBeenCalled();
    expect(mockInvalidateCache).not.toHaveBeenCalled();
    expect(result).toEqual({ walletId: 'wallet-1', balance: 500, transactionId: 'txn-existing' });
  });

  it('invalidates redis cache after a successful topup', async () => {
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue(null);
    mockWalletDomain.updateWalletBalance.mockResolvedValue({ id: 'wallet-1', balance: 300 } as any);
    mockTransactionDomain.createTransaction.mockResolvedValue({ id: 'txn-2' } as any);
    mockInvalidateCache.mockResolvedValue(undefined);

    await topupWallet('wallet-1', 'payment-2', 300);

    expect(mockInvalidateCache).toHaveBeenCalledTimes(1);
    expect(mockInvalidateCache).toHaveBeenCalledWith('wallet-1');
  });

  it('does not invalidate cache when returning an idempotent response', async () => {
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue({ id: 'txn-existing' } as any);
    mockWalletDomain.findWalletById.mockResolvedValue({ id: 'wallet-1', balance: 500 } as any);

    await topupWallet('wallet-1', 'payment-1', 500);

    expect(mockInvalidateCache).not.toHaveBeenCalled();
  });

  it('throws and skips cache invalidation when the DB write fails', async () => {
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue(null);
    mockWalletDomain.updateWalletBalance.mockRejectedValue(new Error('DB error'));

    await expect(topupWallet('wallet-1', 'payment-3', 100)).rejects.toThrow('DB error');
    expect(mockInvalidateCache).not.toHaveBeenCalled();
  });
});
