import { getWalletBalance } from '../../application/get_wallet_balance';
import { WalletDomain } from '../../domain/wallet';
import { getWalletBalanceCache, setWalletBalanceCache } from '../../redis';

jest.mock('../../domain/wallet');
jest.mock('../../redis', () => ({
  getWalletBalanceCache: jest.fn(),
  setWalletBalanceCache: jest.fn(),
}));

const mockWalletDomain = WalletDomain as jest.Mocked<typeof WalletDomain>;
const mockGetCache = getWalletBalanceCache as jest.MockedFunction<typeof getWalletBalanceCache>;
const mockSetCache = setWalletBalanceCache as jest.MockedFunction<typeof setWalletBalanceCache>;

describe('getWalletBalance', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns cached balance without hitting the DB on cache hit', async () => {
    mockGetCache.mockResolvedValue(750);

    const result = await getWalletBalance('wallet-1');

    expect(mockGetCache).toHaveBeenCalledWith('wallet-1');
    expect(mockWalletDomain.findWalletById).not.toHaveBeenCalled();
    expect(mockSetCache).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'wallet-1', balance: 750 });
  });

  it('fetches from DB, populates cache, and returns balance on cache miss', async () => {
    mockGetCache.mockResolvedValue(null);
    mockWalletDomain.findWalletById.mockResolvedValue({ id: 'wallet-1', balance: 500 } as any);
    mockSetCache.mockResolvedValue(undefined);

    const result = await getWalletBalance('wallet-1');

    expect(mockWalletDomain.findWalletById).toHaveBeenCalledWith('wallet-1');
    expect(mockSetCache).toHaveBeenCalledWith('wallet-1', 500);
    expect(result).toEqual({ id: 'wallet-1', balance: 500 });
  });

  it('throws wallet not found when the wallet does not exist', async () => {
    mockGetCache.mockResolvedValue(null);
    mockWalletDomain.findWalletById.mockResolvedValue(null);

    await expect(getWalletBalance('wallet-1')).rejects.toThrow('wallet not found');
    expect(mockSetCache).not.toHaveBeenCalled();
  });
});
