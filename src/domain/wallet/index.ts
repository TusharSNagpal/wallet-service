import { Transaction } from 'sequelize';
import Wallet from './wallet.model';

type TransactionType = 'credit' | 'debit';

interface FindWalletOptions {
  lock?: boolean;
  transaction?: Transaction;
}

const findWalletById = async (id: string, options?: FindWalletOptions): Promise<Wallet | null> => {
  return Wallet.findByPk(id, {
    lock: options?.lock,
    transaction: options?.transaction,
  });
};

const createWallet = async (userId: string): Promise<Wallet> => {
  return Wallet.create({ userId, balance: 0 });
};

const updateWalletBalance = async (
  id: string,
  type: TransactionType,
  amount: number,
  t: Transaction
): Promise<Wallet> => {
  const wallet = await findWalletById(id, { lock: true, transaction: t });
  if (!wallet) throw new Error('wallet not found');

  if (type === 'debit' && wallet.balance < amount) {
    throw new Error('insufficient balance');
  }

  const updatedBalance = type === 'credit'
    ? wallet.balance + amount
    : wallet.balance - amount;

  await wallet.update({ balance: updatedBalance }, { transaction: t });
  return wallet;
};

export const WalletDomain = {
  findWalletById,
  createWallet,
  updateWalletBalance,
};
