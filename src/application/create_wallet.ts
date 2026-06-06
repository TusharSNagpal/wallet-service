import { WalletDomain } from '../domain/wallet';

interface CreateWalletResponse {
  id: string;
  userId: string;
  balance: number;
}

const createWallet = async (userId: string): Promise<CreateWalletResponse> => {
  const wallet = await WalletDomain.createWallet(userId);

  return {
    id: wallet.id,
    userId: wallet.userId,
    balance: wallet.balance,
  };
};

export { createWallet };
