import { getWalletTransactions } from '../../application/get_wallet_transactions';
import { TransactionDomain } from '../../domain/transaction';

jest.mock('../../domain/transaction');

const mockTransactionDomain = TransactionDomain as jest.Mocked<typeof TransactionDomain>;

describe('getWalletTransactions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns transactions mapped to the response shape with pagination metadata', async () => {
    const createdAt = new Date('2024-01-01');
    mockTransactionDomain.findTransactionsByWalletId.mockResolvedValue({
      rows: [
        { id: 'txn-1', paymentId: 'pay-1', type: 'credit', amount: 100, created_at: createdAt } as any,
        { id: 'txn-2', paymentId: 'pay-2', type: 'debit', amount: 50, created_at: createdAt } as any,
      ],
      count: 2,
    });

    const result = await getWalletTransactions('wallet-1', 1, 10);

    expect(mockTransactionDomain.findTransactionsByWalletId).toHaveBeenCalledWith('wallet-1', 1, 10);
    expect(result).toEqual({
      transactions: [
        { id: 'txn-1', paymentId: 'pay-1', type: 'credit', amount: 100, createdAt },
        { id: 'txn-2', paymentId: 'pay-2', type: 'debit', amount: 50, createdAt },
      ],
      total: 2,
      page: 1,
      limit: 10,
    });
  });

  it('returns an empty list when the wallet has no transactions', async () => {
    mockTransactionDomain.findTransactionsByWalletId.mockResolvedValue({ rows: [], count: 0 });

    const result = await getWalletTransactions('wallet-1', 1, 10);

    expect(result).toEqual({ transactions: [], total: 0, page: 1, limit: 10 });
  });

  it('passes page and limit through to the domain correctly', async () => {
    mockTransactionDomain.findTransactionsByWalletId.mockResolvedValue({ rows: [], count: 0 });

    await getWalletTransactions('wallet-1', 3, 25);

    expect(mockTransactionDomain.findTransactionsByWalletId).toHaveBeenCalledWith('wallet-1', 3, 25);
  });
});
