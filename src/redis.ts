import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
});

const WALLET_BALANCE_TTL = 300; // 5 minutes

const getWalletBalanceCache = async (walletId: string): Promise<number | null> => {
  const value = await redis.get(`wallet:${walletId}:balance`);
  return value !== null ? Number(value) : null;
};

const setWalletBalanceCache = async (walletId: string, balance: number): Promise<void> => {
  await redis.set(`wallet:${walletId}:balance`, balance, 'EX', WALLET_BALANCE_TTL);
};

const invalidateWalletBalanceCache = async (walletId: string): Promise<void> => {
  await redis.del(`wallet:${walletId}:balance`);
};

export { redis, getWalletBalanceCache, setWalletBalanceCache, invalidateWalletBalanceCache };
