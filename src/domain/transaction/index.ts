import { Transaction as SequelizeTransaction } from 'sequelize';
import Transaction from './transaction.model';

type TransactionType = 'credit' | 'debit';

const findTransactionById = async (id: string): Promise<Transaction | null> => {
  return Transaction.findByPk(id);
};

const findTransactionByPaymentId = async (paymentId: string, t?: SequelizeTransaction): Promise<Transaction | null> => {
  return Transaction.findOne({ where: { paymentId }, transaction: t });
};

const findTransactionsByWalletId = async (
  walletId: string,
  page: number,
  limit: number
): Promise<{ rows: Transaction[]; count: number }> => {
  return Transaction.findAndCountAll({
    where: { walletId },
    order: [['created_at', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
};

const createTransaction = async (
  walletId: string,
  paymentId: string,
  type: TransactionType,
  amount: number,
  t?: SequelizeTransaction
): Promise<Transaction> => {
  return Transaction.create({ walletId, paymentId, type, amount }, { transaction: t });
};

export const TransactionDomain = {
  findTransactionById,
  findTransactionByPaymentId,
  findTransactionsByWalletId,
  createTransaction,
};
