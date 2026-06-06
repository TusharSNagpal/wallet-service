import { Router } from 'express';
import { createWalletHandler, getWalletBalanceHandler, topupWalletHandler, deductWalletHandler, getWalletTransactionsHandler } from './wallet.controller';

const router = Router();

router.post('/wallets', createWalletHandler);
router.get('/wallets/:id/balance', getWalletBalanceHandler);
router.post('/wallets/:id/topup', topupWalletHandler);
router.post('/wallets/:id/deduct', deductWalletHandler);
router.get('/wallets/:id/transactions', getWalletTransactionsHandler);

export default router;
