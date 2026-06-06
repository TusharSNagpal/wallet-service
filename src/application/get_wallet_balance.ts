import { WalletDomain } from '../domain/wallet';
import { getWalletBalanceCache, setWalletBalanceCache } from '../redis';

interface GetWalletBalanceResponse {
  id: string;
  balance: number;
}

const getWalletBalance = async (id: string): Promise<GetWalletBalanceResponse> => {
  const cached = await getWalletBalanceCache(id);
  if (cached !== null) {
    return { id, balance: cached };
  }

  const wallet = await WalletDomain.findWalletById(id);
  if (!wallet) throw new Error('wallet not found');

  await setWalletBalanceCache(id, wallet.balance);

  return { id, balance: wallet.balance };
};

export { getWalletBalance };
