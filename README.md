# Wallet Service

A wallet microservice built with Node.js, TypeScript, Express, Sequelize (MySQL), and Redis. Supports wallet creation, balance management, and transaction history with idempotency, race condition protection, and horizontal scaling.

---

## Table of Contents

- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Key Design Decisions](#key-design-decisions)
- [Scaling Strategy](#scaling-strategy)
- [Setup & Running](#setup--running)
- [Environment Variables](#environment-variables)

---

## Architecture

The service follows **Domain-Driven Design (DDD)** with three clear layers:

```
┌─────────────────────────────────────────┐
│              API Layer                  │
│   src/api/<domain>/                     │
│   Routes + Controllers (HTTP only)      │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│           Application Layer             │
│   src/application/                      │
│   Orchestrates domain calls,            │
│   handles idempotency & locking         │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│             Domain Layer                │
│   src/domain/<domain>/                  │
│   Business logic, models, DB queries    │
└─────────────────────────────────────────┘
```

<img width="1266" height="450" alt="Screenshot 2026-06-06 at 8 28 50 PM" src="https://github.com/user-attachments/assets/70225faf-f9c6-46f7-b0cf-3d040f4c1633" />

<img width="1457" height="486" alt="Screenshot 2026-06-06 at 8 35 28 PM" src="https://github.com/user-attachments/assets/38419cc4-af53-42cd-9b70-c982aa711601" />

**Infrastructure:**
- **MySQL** — persistent storage for wallets and transactions
- **Redis** — distributed locking + balance caching
- **Node.js Cluster** — one worker per CPU core for horizontal scaling

---

## Project Structure

```
src/
├── index.ts                        # Express app bootstrap + DB connect
├── cluster.ts                      # Node.js cluster for multi-core
├── database.ts                     # Sequelize MySQL connection + pool
├── redis.ts                        # Redis client + cache helpers
│
├── api/
│   └── wallet/
│       ├── wallet.routes.ts        # Route definitions
│       └── wallet.controller.ts    # HTTP handlers
│
├── application/
│   ├── create_wallet.ts            # Create wallet use case
│   ├── get_wallet_balance.ts       # Get balance (with cache)
│   ├── get_wallet_transactions.ts  # Paginated transaction history
│   ├── topup_wallet.ts             # Credit wallet use case
│   └── deduct_wallet.ts            # Debit wallet use case
│
├── domain/
│   ├── wallet/
│   │   ├── wallet.model.ts         # Sequelize model
│   │   ├── wallet.schema.sql       # MySQL table definition
│   │   └── index.ts                # Domain functions (repository)
│   └── transaction/
│       ├── transaction.model.ts    # Sequelize model
│       ├── transaction.schema.sql  # MySQL table definition
│       └── index.ts                # Domain functions (repository)
│
└── utils/
    └── wallet_queue.ts             # Redis distributed lock with retry
```

---

## Database Schema

### wallets

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PRIMARY KEY, NOT NULL |
| user_id | CHAR(36) | NOT NULL |
| balance | BIGINT | NOT NULL, DEFAULT 0 |
| created_at | DATETIME | NOT NULL, DEFAULT NOW |
| updated_at | DATETIME | NOT NULL, ON UPDATE NOW |

> **Balance is stored in paise** (smallest unit of INR). ₹1 = 100 paise. This avoids floating point precision issues entirely. BIGINT supports up to ~92 quadrillion paise.

### transactions

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PRIMARY KEY, NOT NULL |
| wallet_id | CHAR(36) | NOT NULL, INDEX |
| payment_id | CHAR(36) | NOT NULL, UNIQUE |
| type | ENUM('credit','debit') | NOT NULL |
| amount | BIGINT | NOT NULL |
| created_at | DATETIME | NOT NULL, DEFAULT NOW |
| updated_at | DATETIME | NOT NULL, ON UPDATE NOW |

> **Relationship:** One wallet has many transactions (1:N).

---

## API Reference

### POST /wallets
Create a new wallet for a user.

**Request:**
```json
{ "userId": "uuid" }
```
**Response:**
```json
{ "data": { "id": "uuid", "userId": "uuid", "balance": 0 } }
```

---

### GET /wallets/:id/balance
Get current wallet balance.

**Response:**
```json
{ "data": { "id": "uuid", "balance": 1000 } }
```
> Balance is served from Redis cache (5 min TTL). Falls back to MySQL on cache miss.

---

### POST /wallets/:id/topup
Credit the wallet. Idempotent via `paymentId`.

**Request:**
```json
{ "paymentId": "uuid", "amount": 10000 }
```
**Response:**
```json
{ "data": { "walletId": "uuid", "balance": 11000, "transactionId": "uuid" } }
```
> `amount` in paise. ₹100 = `10000`.

---

### POST /wallets/:id/deduct
Debit the wallet. Fails if balance is insufficient. Idempotent via `paymentId`.

**Request:**
```json
{ "paymentId": "uuid", "amount": 5000 }
```
**Response:**
```json
{ "data": { "walletId": "uuid", "balance": 6000, "transactionId": "uuid" } }
```

---

### GET /wallets/:id/transactions?page=1&limit=10
Paginated transaction history, ordered by latest first.

**Response:**
```json
{
  "data": {
    "transactions": [
      { "id": "uuid", "paymentId": "uuid", "type": "credit", "amount": 10000, "createdAt": "..." }
    ],
    "total": 42,
    "page": 1,
    "limit": 10
  }
}
```

---

## Key Design Decisions

### 1. Idempotency via `payment_id`

<img width="1326" height="642" alt="Screenshot 2026-06-06 at 8 52 15 PM" src="https://github.com/user-attachments/assets/c8f3785b-4f14-4726-a56d-fd965617725b" />

Every topup/deduct carries a `paymentId`. Before processing, the service checks if a transaction with that `paymentId` already exists and returns the existing result instead of processing again.

This handles retries from clients (e.g. network timeouts) without double-charging.

### 2. Race Condition Protection

Two parallel deduct requests for the same wallet could both read the same balance and both pass the balance check — resulting in a negative balance.

**Solution: Redis distributed lock + DB transaction**

```
Request A → Redis SET lock:wallet:id NX → acquired → SELECT FOR UPDATE → deduct → COMMIT → DEL lock
Request B → Redis SET lock:wallet:id NX → waiting (retrying) → lock released → idempotency check finds A's txn → returns
```

- `SET ... NX` is atomic in Redis — only one request can acquire the lock
- `SELECT FOR UPDATE` inside the DB transaction ensures the DB row is also locked
- Both wallet update and transaction creation share the same DB transaction — if either fails, both are rolled back

### 3. Retry with Exponential Backoff

When the Redis lock is held, the request retries up to 5 times with exponential backoff:

```
Attempt 0 → wait ~50ms
Attempt 1 → wait ~100ms
Attempt 2 → wait ~200ms
Attempt 3 → wait ~400ms
Attempt 4 → wait ~800ms
Attempt 5 → throw "wallet is busy"
```

### 4. Atomic Rollback

Both `updateWalletBalance` and `createTransaction` are executed inside a single `sequelize.transaction()`. If the transaction record fails to insert for any reason, the wallet balance update is automatically rolled back.

### 5. Balance in Paise

Storing monetary values as integers (paise) avoids all floating point arithmetic issues. `BIGINT` is used to handle large balances safely.

---

## Scaling Strategy

### 1. Connection Pooling
Sequelize is configured with a pool of 5–20 connections to avoid connection exhaustion under load.

### 2. Database Index
`wallet_id` on the `transactions` table is indexed (`idx_wallet_id`), making paginated transaction queries fast even with millions of rows.

### 3. Redis Balance Cache
`GET /wallets/:id/balance` reads from Redis (TTL: 5 min) instead of hitting MySQL on every request. Cache is invalidated immediately after every topup or deduct.

### 4. Node.js Clustering
`cluster.ts` forks one worker process per CPU core. If a worker crashes, it is automatically restarted. All workers share the same MySQL pool and Redis connection.

### 5. Redis Distributed Lock
Serializes writes to the same wallet at the application level using Redis, removing contention from the MySQL layer. Different wallets lock independently — no cross-wallet contention.

---

## Setup & Running

### Prerequisites
- Node.js 14+
- MySQL 8+
- Redis

### Install
```bash
npm install
```

### Create Database & Tables
```bash
mysql -u root -e "CREATE DATABASE wallet_service_db;"
mysql -u root wallet_service_db < src/domain/wallet/wallet.schema.sql
mysql -u root wallet_service_db < src/domain/transaction/transaction.schema.sql
```

### Run
```bash
# Development (auto-reload)
npm run dev

# Production (clustered)
npm start
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | HTTP server port |
| NODE_ENV | development | Environment |
| DB_HOST | localhost | MySQL host |
| DB_PORT | 3306 | MySQL port |
| DB_NAME | wallet_service_db | Database name |
| DB_USER | root | MySQL user |
| DB_PASSWORD | | MySQL password |
| REDIS_HOST | localhost | Redis host |
| REDIS_PORT | 6379 | Redis port |
