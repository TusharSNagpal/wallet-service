import sequelize from '../database';
import { WalletDomain } from '../domain/wallet';
import { TransactionDomain } from '../domain/transaction';
import { invalidateWalletBalanceCache } from '../redis';
import { withWalletLock } from '../utils/wallet_queue';

interface TopupWalletResponse {
  walletId: string;
  balance: number;
  transactionId: string;
}

const topupWallet = async (
  walletId: string,
  paymentId: string,
  amount: number
): Promise<TopupWalletResponse> => {
  const existingTransaction = await TransactionDomain.findTransactionByPaymentId(paymentId);

  if (existingTransaction) {
    const wallet = await WalletDomain.findWalletById(walletId);
    return {
      walletId,
      balance: wallet!.balance,
      transactionId: existingTransaction.id,
    };
  }

  const result = await withWalletLock(walletId, () => sequelize.transaction(async (t) => {
    const wallet = await WalletDomain.updateWalletBalance(walletId, 'credit', amount, t);
    const transaction = await TransactionDomain.createTransaction(walletId, paymentId, 'credit', amount, t);

    return {
      walletId: wallet.id,
      balance: wallet.balance,
      transactionId: transaction.id,
    };
  }));

  await invalidateWalletBalanceCache(walletId);
  return result;
};

export { topupWallet };
