import { NextFunction, Request, Response } from 'express';
import { createWallet } from '../../application/create_wallet';
import { getWalletBalance } from '../../application/get_wallet_balance';
import { topupWallet } from '../../application/topup_wallet';
import { deductWallet } from '../../application/deduct_wallet';
import { getWalletTransactions } from '../../application/get_wallet_transactions';

const createWalletHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.body;
    const wallet = await createWallet(userId);
    res.status(201).json({ data: wallet });
  } catch (err) {
    next(err);
  }
};

const getWalletBalanceHandler = async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const wallet = await getWalletBalance(id);
    res.status(200).json({ data: wallet });
  } catch (err) {
    next(err);
  }
};

const topupWalletHandler = async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { paymentId, amount } = req.body;
    const result = await topupWallet(id, paymentId, amount);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

const deductWalletHandler = async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { paymentId, amount } = req.body;
    const result = await deductWallet(id, paymentId, amount);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

const getWalletTransactionsHandler = async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const result = await getWalletTransactions(id, page, limit);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

export { createWalletHandler, getWalletBalanceHandler, topupWalletHandler, deductWalletHandler, getWalletTransactionsHandler };
