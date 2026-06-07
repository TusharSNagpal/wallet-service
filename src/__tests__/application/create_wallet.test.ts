import { createWallet } from '../../application/create_wallet';
import { WalletDomain } from '../../domain/wallet';

jest.mock('../../domain/wallet');

const mockWalletDomain = WalletDomain as jest.Mocked<typeof WalletDomain>;

describe('createWallet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a wallet and returns id, userId, and zero balance', async () => {
    mockWalletDomain.createWallet.mockResolvedValue({ id: 'wallet-1', userId: 'user-1', balance: 0 } as any);

    const result = await createWallet('user-1');

    expect(mockWalletDomain.createWallet).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ id: 'wallet-1', userId: 'user-1', balance: 0 });
  });
});
