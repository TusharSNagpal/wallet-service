# Redis as Cache — Get Wallet Balance

## Why cache the balance?

`GET /wallets/:id/balance` is a pure read with no side effects. In a clustered deployment each worker can independently serve this endpoint, which means the same wallet's balance can be fetched from Postgres many times per second under load. Caching the result in Redis:

- Eliminates repeated Postgres reads for the same wallet within a short window.
- Reduces DB connection pressure across all CPU-forked workers.
- Returns sub-millisecond responses for cache hits vs. a round-trip to the DB.

The cached value is intentionally short-lived and is proactively invalidated on every write, so staleness is bounded to near zero in the happy path.

---

## Cache design

### Key

```
wallet:<walletId>:balance
```

One key per wallet, storing only the balance value (a plain number string).

### TTL

```ts
// src/redis.ts
const WALLET_BALANCE_TTL = 300; // seconds = 5 minutes
```

The TTL is a safety net. Under normal operation the cache is invalidated explicitly after every topup or deduct (see below), so a cached entry rarely survives its full 5 minutes. The TTL protects against stale entries lingering if an invalidation call is missed (e.g. a process crash between the DB write and the `DEL`).

---

## Cache operations

### Read-through on cache miss

Returns `null` on a miss so the caller can distinguish "not cached" from a balance of `0`.

### Cache hit path

```
Client → GET /wallets/:id/balance
           └─ getWalletBalanceCache(id)  →  Redis GET  →  "1500"
              return { id, balance: 1500 }              (no DB touch)
```

### Cache miss path

```
Client → GET /wallets/:id/balance
           └─ getWalletBalanceCache(id)  →  Redis GET  →  null
              WalletDomain.findWalletById(id)  →  Postgres SELECT
              setWalletBalanceCache(id, 1500)  →  Redis SET EX 300
              return { id, balance: 1500 }
```

---

## Invalidation on write

Both mutating operations call `invalidateWalletBalanceCache` after the DB transaction commits and the lock is released:

### Topup

```
withWalletLock → sequelize.transaction (UPDATE balance) → commit
invalidateWalletBalanceCache(walletId)   ← DEL wallet:<id>:balance
```

### Deduct

```
withWalletLock → sequelize.transaction (UPDATE balance) → commit
invalidateWalletBalanceCache(walletId)   ← DEL wallet:<id>:balance
```

The next `GET /balance` after either write will be a cache miss, re-populate from the now-updated Postgres row, and serve fresh data to all subsequent readers until the next write.

---

## Consistency model

This is **cache-aside with proactive invalidation**:

| Event | Cache state |
|---|---|
| First GET after service start | Miss → populated from DB |
| Subsequent GETs (within TTL, no write) | Hit — served from Redis |
| Topup or deduct completes | Key deleted (DEL) |
| Next GET after a write | Miss → re-populated from DB |
| Worker crash after DB write but before DEL | Stale entry survives up to 300 s |

The worst-case staleness is 5 minutes (TTL), occurring only if a worker crashes in the narrow window between the DB commit and the invalidation call. In practice this window is a few microseconds of application code.

---

## What is NOT cached

| Operation | Cached? | Reason |
|---|---|---|
| `GET /wallets/:id/balance` | Yes | High-read, cheap to cache, safe to serve slightly stale |
| `GET /wallets/:id/transactions` | No | Paginated list; invalidation granularity would be complex |
| `POST /wallets/:id/topup` | No | Write — must always hit the DB |
| `POST /wallets/:id/deduct` | No | Write — must always hit the DB |
| `POST /wallets` | No | One-time create — no read to cache |

---

## Constants summary

| Constant | Value | Purpose |
|---|---|---|
| `WALLET_BALANCE_TTL` | 300 s | Maximum staleness if invalidation is missed |
| Cache key pattern | `wallet:<walletId>:balance` | Per-wallet granularity; independent TTLs |
