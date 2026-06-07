# Redis Distributed Locking — Wallet Service

## Why a distributed lock?

The service runs as a Node.js **cluster** (`cluster.ts`): one master process forks one worker per CPU core. Every worker shares the same port and handles HTTP requests independently. Without coordination, two workers can concurrently read the same wallet balance, both decide the operation is safe, and write back conflicting results — a classic read-modify-write race.

The Postgres `SELECT … FOR UPDATE` row lock guards against intra-transaction races on the database level, but the read-modify-write window in application code (between fetching the wallet and committing the update) is still exposed across concurrent workers. The Redis lock closes that window at the application layer before the DB transaction even starts.

---

## Lock design

### Key

```
lock:wallet:<walletId>
```

One lock key per wallet. Two concurrent requests on different wallets never block each other.

### Acquire — `SET NX PX`

```ts
// src/utils/wallet_queue.ts
const result = await redis.set(
  `lock:wallet:${walletId}`,
  '1',
  'PX', LOCK_TTL_MS,   // expire after 5 000 ms
  'NX'                 // only set if key does not exist
);
const acquired = result === 'OK';
```

`SET key value PX ttl NX` is a **single atomic command** in Redis. Either the key did not exist and is now set (returns `"OK"`) or it already existed (returns `null`). No WATCH/MULTI/EXEC needed — atomicity is guaranteed by Redis's single-threaded command processing.

### TTL — safety net against dead locks

`LOCK_TTL_MS = 5000` (5 seconds). If a worker crashes or is killed after acquiring the lock but before releasing it, Redis automatically expires the key after 5 s. Without this, the lock would be held forever and all subsequent requests for that wallet would fail indefinitely.

### Release

```ts
await redis.del(`lock:wallet:${walletId}`);
```

Called inside a `finally` block so the lock is always released regardless of whether the wrapped function succeeds or throws.

### Retry with exponential back-off + jitter

```ts
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 50;

const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * BASE_DELAY_MS;
```

| Attempt | Base delay | Max jitter | Window          |
|---------|-----------|------------|-----------------|
| 0       | 50 ms     | +50 ms     | 50 – 100 ms     |
| 1       | 100 ms    | +50 ms     | 100 – 150 ms    |
| 2       | 200 ms    | +50 ms     | 200 – 250 ms    |
| 3       | 400 ms    | +50 ms     | 400 – 450 ms    |
| 4       | 800 ms    | +50 ms     | 800 – 850 ms    |

After 5 failed attempts the function throws `"wallet is busy, please try again later"` with HTTP 400 back to the caller.

The random jitter prevents **thundering herd**: if 8 workers are all waiting on the same wallet and the lock releases, they don't all retry at the identical millisecond.

---

## Full lock lifecycle

```
Worker A                          Redis                         Worker B
   │                                │                                │
   │── SET lock:wallet:W1 NX PX ──►│                                │
   │◄── OK (lock acquired) ─────────│                                │
   │                                │   SET lock:wallet:W1 NX PX ◄──│
   │                                │── null (already exists) ──────►│
   │  [DB transaction runs]         │   (Worker B sleeps, retries)   │
   │── DEL lock:wallet:W1 ─────────►│                                │
   │                                │   SET lock:wallet:W1 NX PX ◄──│
   │                                │── OK (lock acquired) ──────────►│
   │                                │                       [DB txn runs]
   │                                │   DEL lock:wallet:W1 ◄─────────│
```

---

## Integration with application flows

### Deduct (`deduct_wallet.ts`)

```
withWalletLock(walletId)
  └─ sequelize.transaction
       ├─ SELECT wallet FOR UPDATE   ← Postgres row lock (belt-and-suspenders)
       ├─ check idempotency key (paymentId)
       ├─ UPDATE wallet balance
       └─ INSERT transaction record
invalidateWalletBalanceCache(walletId)
```

The Redis lock is acquired first. Inside it, the DB transaction runs with `FOR UPDATE` to also protect against any edge case where two requests somehow reach the DB layer concurrently (e.g. lock expiry under extreme latency). The balance cache is invalidated after the lock is released.

### Topup (`topup_wallet.ts`)

```
findTransactionByPaymentId(paymentId)   ← idempotency check BEFORE lock
  └─ if duplicate → return early (no lock needed)

withWalletLock(walletId)
  └─ sequelize.transaction
       ├─ UPDATE wallet balance
       └─ INSERT transaction record
invalidateWalletBalanceCache(walletId)
```

Topup checks idempotency **before** acquiring the lock. If the `paymentId` already exists the response is returned immediately without touching Redis or the DB under a lock — reducing contention for replay requests.

---

## Constants summary

| Constant        | Value  | Purpose                                       |
|-----------------|--------|-----------------------------------------------|
| `LOCK_TTL_MS`   | 5000   | Auto-expire lock if worker dies               |
| `MAX_RETRIES`   | 5      | Max acquisition attempts before giving up     |
| `BASE_DELAY_MS` | 50     | Exponential back-off base unit                |

---

## Limitations of this approach

1. **Single Redis node** — if the Redis instance goes down, all lock operations fail and all mutating wallet requests are rejected. A Redis Sentinel or Cluster setup mitigates this; Redlock (acquiring locks across N independent Redis nodes with quorum) provides stronger guarantees under network partitions.

2. **TTL vs. operation duration** — if a DB transaction takes longer than 5 s (slow query, lock wait, etc.) the Redis key expires and another worker can acquire the lock while the first is still in its transaction. The `FOR UPDATE` Postgres lock provides a second line of defence in this case, but the TTL should be sized well above the 99th-percentile DB transaction time.
