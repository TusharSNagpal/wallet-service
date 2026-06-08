# Wallet Service — Kafka Async Architecture

## Problem with current synchronous approach

Current flow for topup/deduct:
```
HTTP Request → Redis Lock (retry/backoff) → SQL Transaction → Response
```

**Limitations at scale:**
- Redis lock with 5 retries = max ~1.5s wait, then request is dropped
- Starvation: unlucky requests exhaust retries even if wallet isn't truly busy
- DB connection pool (max: 20) gets exhausted under high concurrency on hot wallets
- Synchronous response means the caller waits for the full DB round trip

---

## Kafka-based async approach

### High level flow

```
HTTP Request
    │
    ▼
API Layer → validate → publish event to Kafka → return 202 Accepted + paymentId
                                │
                                ▼
                        Kafka Topic: wallet-transactions
                                │
                         (partitioned)
                                │
                                ▼
                        Consumer Group (wallet-workers)
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              Partition 0             Partition 1
              (1 consumer)            (1 consumer)
                    │                       │
                    ▼                       ▼
             Redis Lock +            Redis Lock +
             SQL Transaction         SQL Transaction
                    │
                    ▼
             Push Notification → user notified async
```

---

## Partition strategy (the critical design decision)

### Why not partition by walletId?

```
walletId-A → partition 0
walletId-B → partition 1
walletId-C → partition 2
...
walletId-N → partition N   ← millions of partitions, most always empty, Kafka collapses
```

Kafka is not designed for millions of partitions. This would be catastrophically expensive.

### Why not partition randomly (round robin)?

```
Request 1 for wallet-A → partition 0 → consumer 1
Request 2 for wallet-A → partition 1 → consumer 2  ← both processing same wallet simultaneously
```

Ordering guarantee lost. Two consumers can process the same wallet concurrently — correctness broken.

### Correct approach: partition by walletId % numberOfPartitions

```
numberOfPartitions = 100  (fixed, chosen based on throughput needs)

wallet-A → hash(wallet-A) % 100 → partition 42
wallet-B → hash(wallet-B) % 100 → partition 7
wallet-C → hash(wallet-C) % 100 → partition 42  ← same partition as wallet-A
```

- All requests for the same wallet always land on the same partition
- Kafka guarantees ordering within a partition
- 1 consumer per partition → no concurrent processing of the same wallet
- Fixed number of partitions → operationally manageable

**Remaining risk:** wallet-A and wallet-C share partition 42. wallet-C requests must wait behind wallet-A requests even though they are independent. This is acceptable — Redis lock inside the consumer handles same-wallet ordering, and different-wallet requests on the same partition process sequentially (minor latency, no correctness issue).

---

## Consumer design

Each consumer (one per partition) runs this loop:

```
poll message from Kafka
    │
    ▼
BEGIN SQL transaction
    ├── check transaction ledger for paymentId (idempotency)
    ├── if found → early return, commit
    ├── SELECT FOR UPDATE on wallet (DB row lock)
    ├── UPDATE wallet balance
    ├── INSERT transaction ledger entry
    └── COMMIT
    │
    ▼
invalidate Redis balance cache
    │
    ▼
push notification to user (success/failure)
    │
    ▼
commit Kafka offset  ← only after everything above succeeds
```

**Why commit Kafka offset last?**

If the consumer crashes after DB commit but before committing the Kafka offset, the message is redelivered. The idempotency check on `paymentId` (+ unique constraint on `payment_id` column in DB) ensures the redelivered message is a no-op. Safe to retry forever.

**Why no Redis distributed lock here?**

In the sync approach, Redis lock prevented multiple pods from processing the same wallet simultaneously. In the Kafka approach this is unnecessary:

- **Normal operation** — same wallet always lands on the same partition, processed by one consumer sequentially. No concurrency possible.
- **Rebalance edge case** — two consumers briefly own the same partition. The DB unique constraint on `payment_id` handles this: only one INSERT succeeds, the other transaction rolls back cleanly.

Every race condition is covered by Kafka ordering + DB constraints. The Redis lock would just be an extra network round trip on every message for a scenario already handled.

---

## Idempotency guarantees (two layers)

**Layer 1 — application check:**
```ts
const existing = await TransactionDomain.findTransactionByPaymentId(paymentId, t);
if (existing) return early;
```

**Layer 2 — DB unique constraint (safety net):**
```sql
UNIQUE KEY uk_payment_id (payment_id)
```

If two consumers somehow process the same `paymentId` simultaneously (e.g. rebalance edge case), the DB constraint ensures only one INSERT succeeds. The other transaction rolls back cleanly.

---

## Error handling and Dead Letter Queue (DLQ)

```
Consumer fails to process message
    │
    ├── retry N times (with backoff)
    │
    └── after N failures → publish to DLQ topic: wallet-transactions-dlq
                                │
                                ▼
                        alert oncall + push notification to user (transaction failed)
                        reconciliation job investigates
```

DLQ entries are investigated manually or via a reconciliation job that cross-checks the transaction ledger against the payment gateway's records.

---

## Response to user (async UX)

```
User initiates topup/deduct
    │
    ▼
API returns: 202 Accepted
{
  "paymentId": "pay_123",
  "status": "pending",
  "message": "Transaction is being processed"
}
    │
    ▼ (async, via push notification / websocket / polling)
User receives: "Your wallet has been topped up by ₹500. New balance: ₹1200."
```

User can also poll `GET /wallet/:walletId/transactions?paymentId=pay_123` to check status — idempotency key doubles as a status lookup key.

---

## What stays the same from current design

| Component | Current | Kafka approach |
|---|---|---|
| Redis distributed lock | yes | no (dropped — redundant) |
| SQL transaction (atomicity) | yes | yes |
| SELECT FOR UPDATE (DB row lock) | yes | yes |
| Idempotency via paymentId | yes | yes (stronger — offset commit last) |
| Redis balance cache invalidation | yes | yes |
| Unique constraint on payment_id | implied | explicit, critical |

---

## Tradeoffs

| | Sync (current) | Async (Kafka) |
|---|---|---|
| Latency to caller | full DB round trip | immediate 202 |
| User experience | blocking | push notification |
| Correctness | high | higher (retryable forever) |
| Complexity | low | high |
| Max throughput | bounded by pool (20) | bounded by partition count |
| Starvation | possible (5 retries) | eliminated |
| Ops overhead | low | Kafka cluster + consumer monitoring |
