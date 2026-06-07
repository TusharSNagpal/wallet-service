# Transaction-Level Locking — Wallet Service

## What this layer does

Every balance-mutating operation wraps its DB work in a `sequelize.transaction()`. Inside that transaction, the wallet row is fetched with `lock: true`, which translates to `SELECT ... FOR UPDATE` in MySQL. This is the **second line of defence** — the Redis distributed lock is the first. The two layers serve different failure modes and are complementary, not redundant.

| Layer | Mechanism | Guards against |
|---|---|---|
| Redis lock | `SET NX PX` | Concurrent application-layer entry per wallet |
| DB transaction + `FOR UPDATE` | `SELECT ... FOR UPDATE` | Redis TTL expiry during a slow transaction; direct DB access bypassing the app |

---

## MySQL `SELECT ... FOR UPDATE`

When a transaction executes `SELECT ... FOR UPDATE` on a row, MySQL's InnoDB engine places an **exclusive row lock** on that row. Any other transaction attempting to read or write the same row is blocked until the holding transaction commits or rolls back.

```sql
-- what Sequelize emits for lock: true
SELECT * FROM wallets WHERE id = ? FOR UPDATE;
```

This prevents two concurrent DB transactions from reading the same balance, independently computing a new value, and writing back diverging results — even if the Redis lock has already expired.

---

## Sequelize transaction wrapping

Both `topup_wallet.ts` and `deduct_wallet.ts` wrap their DB operations inside `sequelize.transaction()`:

```ts
await withWalletLock(walletId, () => sequelize.transaction(async (t) => {
  // all reads and writes here are atomic
}));
```

`sequelize.transaction()` issues `BEGIN` before the callback and `COMMIT` on success or `ROLLBACK` on any thrown error. The wallet balance update and the transaction record insert are always committed together or not at all — partial writes are impossible.

### Connection pool

```ts
// src/database.ts
pool: {
  max: 20,   // up to 20 concurrent DB connections across all workers
  min: 5,    // 5 connections kept warm
  acquire: 30000,
  idle: 10000,
}
```

Each `sequelize.transaction()` call holds one connection from the pool for its entire duration. With 20 connections shared across all cluster workers, long-running transactions reduce the pool available to other requests — another reason to keep transactions short.

---

## Deduct flow — step by step

```ts
// src/application/deduct_wallet.ts
await withWalletLock(walletId, () => sequelize.transaction(async (t) => {

  // 1. Acquire row lock immediately
  await WalletDomain.findWalletById(walletId, { lock: true, transaction: t });

  // 2. Idempotency check — inside the lock
  const existingTransaction = await TransactionDomain.findTransactionByPaymentId(paymentId, t);
  if (existingTransaction) {
    const wallet = await WalletDomain.findWalletById(walletId, { transaction: t });
    return { walletId, balance: wallet!.balance, transactionId: existingTransaction.id };
  }

  // 3. Read-modify-write under the row lock
  const wallet = await WalletDomain.updateWalletBalance(walletId, 'debit', amount, t);

  // 4. Create audit record in the same transaction
  const transaction = await TransactionDomain.createTransaction(walletId, paymentId, 'debit', amount, t);

  return { walletId: wallet.id, balance: wallet.balance, transactionId: transaction.id };
}));
```

### Why `FOR UPDATE` is called first in deduct

Step 1 (`findWalletById` with `lock: true`) acquires the row lock at the very start of the transaction, before the idempotency check. This is intentional:

- If two concurrent deduct requests arrive with different `paymentId`s, both will race to acquire the row lock. Only one proceeds; the other blocks at step 1 until the first commits.
- Without step 1, both transactions could pass the idempotency check simultaneously (both see no duplicate), then both attempt to write, resulting in a double-deduct.

### Sequence under contention (deduct)

```
Txn A (deduct 100)               MySQL (wallet row)           Txn B (deduct 50)
      │                                  │                           │
      │── SELECT … FOR UPDATE ──────────►│                           │
      │   (row lock acquired)            │── SELECT … FOR UPDATE ◄───│
      │                                  │   (blocked — waits)       │
      │── check idempotency              │                           │
      │── UPDATE balance 1000→900        │                           │
      │── INSERT transaction record      │                           │
      │── COMMIT ───────────────────────►│                           │
      │                                  │   (lock released)         │
      │                                  │── OK ─────────────────────►│
      │                                  │   (Txn B proceeds)        │
      │                                  │   UPDATE balance 900→850  │
      │                                  │   INSERT transaction       │
      │                                  │   COMMIT                  │
```

---

The `lock: true` + `transaction: t` pair is what issues `SELECT ... FOR UPDATE` within the ongoing transaction. The balance check and `UPDATE` are both inside the same transaction, so the read value is guaranteed to be the value that gets modified — no other transaction can change it between the `SELECT` and the `UPDATE`.

---

## What happens on failure

| Failure point | Outcome |
|---|---|
| `insufficient balance` thrown | Sequelize calls `ROLLBACK`; no balance change, no transaction record inserted |
| DB connection lost mid-transaction | MySQL rolls back automatically on connection drop |
| Worker crashes after `COMMIT` but before cache invalidation | Balance in DB is correct; Redis cache may be stale for up to 5 min (TTL) |
| `paymentId` unique constraint violated (race on topup idempotency) | Second INSERT throws; Sequelize `ROLLBACK`; caller gets an error |

---

## Layers summary

```
HTTP request
    │
    ▼
Redis lock (SET NX PX 5000)           ← prevents concurrent app-layer entry
    │
    ▼
sequelize.transaction() — BEGIN       ← guarantees atomicity of all DB writes
    │
    ▼
SELECT wallet FOR UPDATE              ← blocks concurrent DB transactions on the same row
    │
    ▼
balance check / idempotency check
    │
    ▼
UPDATE wallets SET balance = ?
INSERT INTO transactions …
    │
    ▼
COMMIT
    │
    ▼
DEL lock:wallet:<id>                  ← release Redis lock
DEL wallet:<id>:balance               ← invalidate balance cache
```
