import { redis } from '../redis';

const LOCK_TTL_MS = 5000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 50;

const acquireWalletLock = async (walletId: string): Promise<boolean> => {
  const result = await redis.set(
    `lock:wallet:${walletId}`,
    '1',
    'PX', LOCK_TTL_MS,
    'NX'
  );
  return result === 'OK';
};

const releaseWalletLock = async (walletId: string): Promise<void> => {
  await redis.del(`lock:wallet:${walletId}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withWalletLock = async <T>(
  walletId: string,
  fn: () => Promise<T>
): Promise<T> => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const acquired = await acquireWalletLock(walletId);

    if (acquired) {
      try {
        return await fn();
      } finally {
        await releaseWalletLock(walletId);
      }
    }

    if (attempt === MAX_RETRIES) {
      throw new Error('wallet is busy, please try again later');
    }

    // exponential backoff with jitter to avoid thundering herd
    const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * BASE_DELAY_MS;
    await sleep(delay);
  }

  throw new Error('wallet is busy, please try again later');
};

export { withWalletLock };
