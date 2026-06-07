# Keychain OS — Wallet Service Submission

**GITHUB REPOSITORY LINK:** [https://github.com/TusharSNagpal/wallet-service](https://github.com/TusharSNagpal/wallet-service)

**Stack:** Node.js · TypeScript · Express · MySQL (Sequelize) · Redis · Jest

---

## Architecture

```
HTTP Request
     │
     ▼
┌─────────────┐
│  API Layer  │  wallet.controller.ts — HTTP only, no logic
└──────┬──────┘
       │
       ▼
┌──────────────────────┐
│  Application Layer   │  topup_wallet.ts / deduct_wallet.ts
│  - idempotency check │  - orchestrates domain calls
│  - Redis lock        │  - owns the write flow
│  - cache invalidate  │
└──────┬───────────────┘
       │
       ▼
┌─────────────┐
│ Domain Layer│  WalletDomain / TransactionDomain
│  - DB reads │  - pure DB operations, no business rules
│  - DB writes│
└─────────────┘
```

---

## Concurrency Protection — Two Layers

```
POST /deduct (Worker 1)          Redis              POST /deduct (Worker 2)
       │                           │                        │
       │── SET lock:W1 NX PX ─────►│                        │
       │◄── OK ────────────────────│                        │
       │                           │◄── SET lock:W1 NX PX ──│
       │                           │──► null (retry loop) ──►│
       │
       │── BEGIN txn ──────────────────────────────────────────► MySQL
       │── SELECT wallet FOR UPDATE   (row lock acquired)
       │── check paymentId duplicate
       │── UPDATE balance
       │── INSERT transaction
       │── COMMIT ───────────────────────────────────────────►
       │
       │── DEL lock:W1 ───────────►│
       │── DEL cache:W1 ──────────►│
                                   │◄── SET lock:W1 NX PX ──│
                                   │──► OK ─────────────────►│ (Worker 2 proceeds)
```

**Why two layers?**
- Redis lock → stops workers from even entering the DB transaction simultaneously
- `FOR UPDATE` → safety net if Redis TTL expires mid-transaction

---

## Idempotency

```
First call (paymentId=P1)          Retry (paymentId=P1)
        │                                  │
        ▼                                  ▼
  paymentId exists? ─── No          paymentId exists? ─── Yes
        │                                  │
        ▼                                  ▼
  acquire lock                     return stored result
  UPDATE balance                   (no DB write, no lock)
  INSERT transaction
  return result
```

`paymentId` has a `UNIQUE` constraint in MySQL — a duplicate insert fails at the DB level even if application logic is bypassed.

---

## Balance Cache

```
GET /balance
     │
     ▼
Redis GET wallet:id:balance
     │
     ├── HIT  ──► return balance  (no DB)
     │
     └── MISS ──► MySQL SELECT
                       │
                       ▼
                  Redis SET EX 300
                       │
                       ▼
                  return balance

POST /topup or /deduct
     └── after COMMIT ──► Redis DEL wallet:id:balance  (next GET re-fetches from DB)
```

---

## Data Model

```
wallets                           transactions
──────────────────────            ──────────────────────────────
id          CHAR(36) PK           id          CHAR(36) PK
user_id     CHAR(36)              wallet_id   CHAR(36) FK + INDEX
balance     BIGINT  ← paise       payment_id  CHAR(36) UNIQUE  ← idempotency key
created_at  DATETIME              type        ENUM(credit, debit)
updated_at  DATETIME              amount      BIGINT
                                  created_at  DATETIME
```

> Balance stored in **paise** (₹1 = 100). Integer arithmetic, no floating point.

---

## Multi-Core Setup

```
                    ┌─ Worker 1 ── own event loop ──┐
OS (N cores)        ├─ Worker 2 ── own event loop ──┤     ┌────────┐
cluster.fork() ────►├─ Worker 3 ── own event loop ──┼────►│ Redis  │ (shared lock + cache)
                    ├─ ...                           │     └────────┘
                    └─ Worker N ── own event loop ──┘     ┌────────┐
                                                          │ MySQL  │ (pool: max 20/worker)
                                                          └────────┘
```

Workers share nothing in memory. Redis is the only coordination point.

---

## Retry Back-off (lock contention)

```
Attempt 0 ──► wait  50–100 ms
Attempt 1 ──► wait 100–150 ms
Attempt 2 ──► wait 200–250 ms
Attempt 3 ──► wait 400–450 ms
Attempt 4 ──► wait 800–850 ms
Attempt 5 ──► throw "wallet is busy"  (HTTP 400)
```

Random jitter on each attempt prevents thundering herd when a lock releases.

---

## Order Service Scripts

`src/order_service_script/` — runnable stubs demonstrating the integration:

```
deduct/
  multiple_in_single_wallet.ts    ← concurrent deducts on one wallet (tests the lock)
  mutiple_in_multiple_wallet.ts   ← parallel deducts across wallets (no cross-wallet block)
topup/
  multiple_in_single_wallet.ts
  multiple_in_multiple_wallet.ts
deduct_top_up/
  deduct_top_up_single_wallet.ts  ← interleaved credit + debit on same wallet
```

Run with: `npx ts-node src/order_service_script/<path>.ts`

---

## What I'd Add With More Time

| Gap | Fix |
|---|---|
| `console.log` logging | Structured JSON logs + Prometheus metrics |
| No auth | JWT / API key; Order Service gets a scoped key for `/deduct` only |
| Fixed 5s TTL | Measure p99 DB latency, set TTL at 3–5× that |

---
