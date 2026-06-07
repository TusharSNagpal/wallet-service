# Multi-Core Node.js + Single-Threaded Redis — How They Work Together

## The Node.js cluster model

Node.js is single-threaded by design — one process runs one event loop, handling I/O concurrently but never executing JavaScript in parallel. To use all CPU cores, `cluster.ts` uses Node's built-in `cluster` module:

```ts
// src/cluster.ts
const numCPUs = os.cpus().length;

if (cluster.isMaster) {
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();   // spawns a new OS process per core
  }
}
```

`fork()` creates a **separate OS process** for each CPU. Each worker is a completely independent copy of the application with its own:

- V8 heap (memory is NOT shared between workers)
- Event loop
- In-process variable state
- TCP connections to Redis and MySQL

```
┌─────────────────────────────────────────────────────────────┐
│  OS (e.g. 8-core machine)                                   │
│                                                             │
│  Master Process (PID 100)                                   │
│    forks ──► Worker 1 (PID 101)  — own event loop, own heap │
│    forks ──► Worker 2 (PID 102)  — own event loop, own heap │
│    forks ──► Worker 3 (PID 103)  — own event loop, own heap │
│    forks ──► Worker 4 (PID 104)  — own event loop, own heap │
│    ...                                                      │
│    forks ──► Worker 8 (PID 108)  — own event loop, own heap │
│                                                             │
│  All workers share port 3000 (OS round-robins TCP accepts)  │
└─────────────────────────────────────────────────────────────┘
```

The master process only manages worker lifecycle (fork, restart on crash). It does not handle HTTP requests.

---

## Each worker opens its own Redis connection

`src/redis.ts` is `require()`d by every worker process independently:

```ts
const redis = new Redis({ host: '...', port: 6379 });
```

This executes once per worker process, establishing a **dedicated TCP socket** from that worker to the Redis server. With 8 workers there are 8 persistent TCP connections to Redis.

```
Worker 1 (PID 101) ──── TCP socket 1 ────┐
Worker 2 (PID 102) ──── TCP socket 2 ────┤
Worker 3 (PID 103) ──── TCP socket 3 ────┤──► Redis Server :6379
Worker 4 (PID 104) ──── TCP socket 4 ────┤    (single process, single thread)
...                                       │
Worker 8 (PID 108) ──── TCP socket 8 ────┘
```

All workers talk to the same Redis server. Redis multiplexes incoming data from all 8 sockets into a single command queue.

---

## How Redis's single thread makes `SET NX` safe

Redis processes commands on a **single thread**, one at a time, with no context switching between commands. Its event loop reads commands from the network buffer and executes them sequentially:

```
Redis event loop (single thread):
  ┌──────────────────────────────────────────────────────────┐
  │  network buffer (commands arriving from all sockets):    │
  │                                                          │
  │  [SET lock:wallet:W1 1 NX PX 5000]  ← from Worker 3     │
  │  [SET lock:wallet:W1 1 NX PX 5000]  ← from Worker 7     │
  │  [GET wallet:W2:balance]            ← from Worker 1     │
  │  [SET lock:wallet:W1 1 NX PX 5000]  ← from Worker 5     │
  │                                                          │
  │  Processes one command at a time ─────────────────────►  │
  └──────────────────────────────────────────────────────────┘
```

When `SET key value NX` is processed:

- **Check** — does `key` already exist?
- **Set** — if not, write it and return `"OK"`; if yes, do nothing and return `null`

These two steps are **indivisible** because nothing else can execute between them — Redis is single-threaded. There is no moment where two workers can both observe "key does not exist" and both write it.

### Concrete race scenario with 8 workers

Suppose 8 workers all receive a deduct request for wallet `W1` at the same millisecond and all send `SET lock:wallet:W1 1 NX PX 5000` nearly simultaneously.

```
All 8 workers send SET NX at ~same time
         │
         ▼
Redis network buffer receives 8 commands (order determined by TCP arrival):

  Slot 1: SET lock:wallet:W1 NX  ← Worker 3 arrived first
  Slot 2: SET lock:wallet:W1 NX  ← Worker 7
  Slot 3: SET lock:wallet:W1 NX  ← Worker 1
  Slot 4: SET lock:wallet:W1 NX  ← Worker 5
  Slot 5: SET lock:wallet:W1 NX  ← Worker 2
  Slot 6: SET lock:wallet:W1 NX  ← Worker 8
  Slot 7: SET lock:wallet:W1 NX  ← Worker 6
  Slot 8: SET lock:wallet:W1 NX  ← Worker 4

Redis processes slot 1: key absent → write → reply "OK"    ✓ Worker 3 wins
Redis processes slot 2: key exists → skip → reply null      ✗ Worker 7 waits
Redis processes slot 3: key exists → skip → reply null      ✗ Worker 1 waits
Redis processes slot 4: key exists → skip → reply null      ✗ Worker 5 waits
Redis processes slot 5: key exists → skip → reply null      ✗ Worker 2 waits
Redis processes slot 6: key exists → skip → reply null      ✗ Worker 8 waits
Redis processes slot 7: key exists → skip → reply null      ✗ Worker 6 waits
Redis processes slot 8: key exists → skip → reply null      ✗ Worker 4 waits
```

Exactly one worker gets `"OK"`. The other 7 get `null` and enter the retry back-off loop. The winner of the next round is determined by whichever worker's retry arrives at Redis after `Worker 3` sends `DEL lock:wallet:W1`.

---

## Why in-process JS locks would not work here

A naive approach might be to use a JavaScript `Map` to track which wallets are "busy":

```ts
const inFlight = new Set<string>();

if (inFlight.has(walletId)) throw new Error('busy');
inFlight.add(walletId);
```

This only works within **one process**. Worker 1's `inFlight` Set is completely invisible to Worker 2. Two workers can both add the same `walletId` without either knowing about the other. Redis is the shared memory that all workers can see and coordinate through.

```
Worker 1 heap          Worker 2 heap
┌──────────────┐       ┌──────────────┐
│ inFlight:    │       │ inFlight:    │
│   { W1 }     │       │   { W1 }     │  ← both added W1, no conflict detected
└──────────────┘       └──────────────┘
        ↕ not shared ↕
```

vs.

```
Worker 1              Redis (shared)        Worker 2
                  ┌──────────────────┐
SET W1 NX ──────► │ lock:wallet:W1=1 │ ◄── SET W1 NX
    OK ◄───────── │                  │ ──► null
                  └──────────────────┘
```

---

## The full picture — 8 workers, one Redis, one wallet under load

```
                    ┌─ Worker 1 (PID 101) ── event loop ──┐
                    │                                      │ SET NX → null → retry
                    ├─ Worker 2 (PID 102) ── event loop ──┤ SET NX → null → retry
  HTTP requests     │                                      │
  (round-robined ──►├─ Worker 3 (PID 103) ── event loop ──┤ SET NX → OK  → runs DB txn
  by the OS)        │                                      │              → DEL lock
                    ├─ Worker 4 (PID 104) ── event loop ──┤ SET NX → null → retry
                    │                                      │
                    ├─ Worker 5 (PID 105) ── event loop ──┤ SET NX → null → retry
                    │                                      │
                    ├─ Worker 6 (PID 106) ── event loop ──┤ SET NX → null → retry
                    │                                      │
                    ├─ Worker 7 (PID 107) ── event loop ──┤ SET NX → null → retry
                    │                                      │
                    └─ Worker 8 (PID 108) ── event loop ──┘ SET NX → null → retry
                               │
                               │  8 TCP sockets
                               ▼
                    ┌──────────────────────┐
                    │  Redis (PID 200)      │
                    │  single thread        │
                    │  processes commands   │
                    │  one at a time        │
                    │                       │
                    │  lock:wallet:W1 = 1   │ ← only Worker 3's SET succeeded
                    └──────────────────────┘
```

After Worker 3 commits and calls `DEL`, whichever retry arrives first wins the next round. The exponential back-off with jitter ensures they don't all retry at the same instant.

---

## Summary

| Question | Answer |
|---|---|
| How do multiple cores run? | Each core is a separate OS process (`cluster.fork()`), with its own event loop and heap |
| Do workers share memory? | No. In-process state (variables, Maps, Sets) is invisible across workers |
| How does each worker talk to Redis? | Each worker opens its own persistent TCP connection on startup |
| Why does `SET NX` work atomically across workers? | Redis's single thread processes commands one at a time — the check-and-set is indivisible |
| What happens when 8 workers all send `SET NX`? | Redis processes them sequentially; exactly one gets `"OK"`, the rest get `null` |
| Is Redis slow because it's single-threaded? | No — it processes hundreds of thousands of commands/sec because commands are in-memory operations, not disk I/O |
