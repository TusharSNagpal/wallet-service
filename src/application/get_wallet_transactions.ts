import { TransactionDomain } from '../domain/transaction';

interface TransactionItem {
  id: string;
  paymentId: string;
  type: string;
  amount: number;
  createdAt: Date;
}

interface GetWalletTransactionsResponse {
  transactions: TransactionItem[];
  total: number;
  page: number;
  limit: number;
}

const getWalletTransactions = async (
  walletId: string,
  page: number,
  limit: number
): Promise<GetWalletTransactionsResponse> => {
  const { rows, count } = await TransactionDomain.findTransactionsByWalletId(walletId, page, limit);

  return {
    transactions: rows.map((t) => ({
      id: t.id,
      paymentId: t.paymentId,
      type: t.type,
      amount: t.amount,
      createdAt: t.created_at,
    })),
    total: count,
    page,
    limit,
  };
};

export { getWalletTransactions };
