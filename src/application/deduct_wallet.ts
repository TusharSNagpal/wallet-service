import sequelize from '../database';
import { WalletDomain } from '../domain/wallet';
import { TransactionDomain } from '../domain/transaction';
import { invalidateWalletBalanceCache } from '../redis';
import { withWalletLock } from '../utils/wallet_queue';

interface DeductWalletResponse {
  walletId: string;
  balance: number;
  transactionId: string;
}

const deductWallet = async (
  walletId: string,
  paymentId: string,
  amount: number
): Promise<DeductWalletResponse> => {
  const result = await withWalletLock(walletId, () => sequelize.transaction(async (t) => {

    await WalletDomain.findWalletById(walletId, { lock: true, transaction: t });

    const existingTransaction = await TransactionDomain.findTransactionByPaymentId(paymentId, t);

    if (existingTransaction) {
      const wallet = await WalletDomain.findWalletById(walletId, { transaction: t });
      return {
        walletId,
        balance: wallet!.balance,
        transactionId: existingTransaction.id,
      };
    }

    const wallet = await WalletDomain.updateWalletBalance(walletId, 'debit', amount, t);
    
    const transaction = await TransactionDomain.createTransaction(walletId, paymentId, 'debit', amount, t);

    return {
      walletId: wallet.id,
      balance: wallet.balance,
      transactionId: transaction.id,
    };
  }));

  await invalidateWalletBalanceCache(walletId);
  return result;
};

export { deductWallet };
