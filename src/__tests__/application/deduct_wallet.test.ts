import { deductWallet } from '../../application/deduct_wallet';
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

describe('deductWallet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('debits wallet and creates a transaction when balance is sufficient', async () => {
    mockWalletDomain.findWalletById.mockResolvedValue({ id: 'wallet-1', balance: 500 } as any);
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue(null);
    mockWalletDomain.updateWalletBalance.mockResolvedValue({ id: 'wallet-1', balance: 300 } as any);
    mockTransactionDomain.createTransaction.mockResolvedValue({ id: 'txn-1' } as any);
    mockInvalidateCache.mockResolvedValue(undefined);

    const result = await deductWallet('wallet-1', 'payment-1', 200);

    expect(mockWalletDomain.findWalletById).toHaveBeenCalledWith('wallet-1', { lock: true, transaction: {} });
    expect(mockTransactionDomain.findTransactionByPaymentId).toHaveBeenCalledWith('payment-1', {});
    expect(mockWalletDomain.updateWalletBalance).toHaveBeenCalledWith('wallet-1', 'debit', 200, {});
    expect(mockTransactionDomain.createTransaction).toHaveBeenCalledWith('wallet-1', 'payment-1', 'debit', 200, {});
    expect(mockInvalidateCache).toHaveBeenCalledWith('wallet-1');
    expect(result).toEqual({ walletId: 'wallet-1', balance: 300, transactionId: 'txn-1' });
  });

  it('returns existing transaction without debiting when paymentId is a duplicate', async () => {
    mockWalletDomain.findWalletById.mockResolvedValue({ id: 'wallet-1', balance: 500 } as any);
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue({ id: 'txn-existing' } as any);
    mockInvalidateCache.mockResolvedValue(undefined);

    const result = await deductWallet('wallet-1', 'payment-1', 200);

    expect(mockWalletDomain.updateWalletBalance).not.toHaveBeenCalled();
    expect(mockTransactionDomain.createTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({ walletId: 'wallet-1', balance: 500, transactionId: 'txn-existing' });
  });

  it('always invalidates cache including for idempotent requests', async () => {
    mockWalletDomain.findWalletById.mockResolvedValue({ id: 'wallet-1', balance: 500 } as any);
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue({ id: 'txn-existing' } as any);
    mockInvalidateCache.mockResolvedValue(undefined);

    await deductWallet('wallet-1', 'payment-1', 200);

    expect(mockInvalidateCache).toHaveBeenCalledTimes(1);
    expect(mockInvalidateCache).toHaveBeenCalledWith('wallet-1');
  });

  it('throws insufficient balance when the domain rejects with that error', async () => {
    mockWalletDomain.findWalletById.mockResolvedValue({ id: 'wallet-1', balance: 100 } as any);
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue(null);
    mockWalletDomain.updateWalletBalance.mockRejectedValue(new Error('insufficient balance'));

    await expect(deductWallet('wallet-1', 'payment-1', 500)).rejects.toThrow('insufficient balance');
  });

  it('throws wallet not found when the domain rejects with that error', async () => {
    mockWalletDomain.findWalletById.mockResolvedValue({ id: 'wallet-1', balance: 0 } as any);
    mockTransactionDomain.findTransactionByPaymentId.mockResolvedValue(null);
    mockWalletDomain.updateWalletBalance.mockRejectedValue(new Error('wallet not found'));

    await expect(deductWallet('wallet-1', 'payment-1', 100)).rejects.toThrow('wallet not found');
  });
});
