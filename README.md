# Personalized Habit Tracker & Resilience Engine

An intelligent, local-first habit tracking application with adaptive EMA momentum scoring, streak shields, behavioral analytics, PWA offline support, multi-user identity (local profiles and cloud accounts), and server-side Gemini AI insights.

---

## Overview

Traditional habit trackers rely heavily on binary streak systems, penalising users disproportionately after a single missed day and discouraging long-term consistency. 

This application focuses on measuring sustainable momentum rather than enforcing fragile perfection. It combines deterministic behavioural heuristics with AI-powered coaching to help users understand adherence patterns, identify friction, and adapt targets responsibly.

### Operational Status & Architectural Maturity

To clearly distinguish **implementation completeness** from **operational reliability**:

- **Production-Ready (Local-First Core):** The core habit tracking engine, multi-profile switcher, EMA momentum calculations, streak rest shields, behavioral analytics heatmaps, PWA offline service workers, and the server-side Gemini AI gateway (`/api/ai/*`) are fully production-ready. They rely on durable client-side storage (`localStorage`/IndexedDB) and stateless upstream API execution.
- **Architectural Milestone / Preview (Cloud Sync):** The cryptographic authentication routines, stateless token verification, Lamport clocks, and Last-Write-Wins (LWW) conflict-resolution logic are fully implemented and verified by automated test suites. However, because the serverless backend currently uses ephemeral instance-local storage, cloud accounts and cross-device synchronisation are **not yet reliable for production use** until backed by a shared, durable PostgreSQL database.

### Core Principles

- **Consistency Over Perfection:** Replace binary streaks with continuous exponential moving average (EMA) momentum metrics and streak rest shields.
- **Local-First & Multi-User Flexibility:** Users can immediately track habits with zero sign-up using partitioned local profiles, or test cloud accounts for cross-device synchronisation.
- **Zero Client-Side Secret Exposure:** AI credentials (`GEMINI_API_KEY`) and password hashes remain strictly server-side, eliminating credential leakage in multi-user deployments.
- **Deterministic Offline Resilience:** Core habit tracking, momentum calculations, and behavioral analytics operate 100% offline via Progressive Web App (PWA) service workers.
- **Dune Architectural Foundation:** Strict vertical feature slicing, zero comments in source code, strict import boundaries, and principled root-cause resolution.

---

## Key Features

### 1. Habit Management
Create and track habits with configurable targets, categories, and recurrence schedules:
- **Target Types:** Duration-based (minutes), numeric quantities (glasses, pages), and binary completion.
- **Recurrence Models:** Daily cadences, specific weekdays, or flexible X-times-per-week targets.
- **Lifecycle Management:** Edit targets, adjust schedules, archive habits, and view historical completions.

### 2. Adaptive Momentum & Resilience Engine
Rather than resetting progress to zero upon a missed day, consistency is measured via an Exponential Moving Average (EMA) momentum score ranging from 0 to 100:

$$M_t = \alpha C_t + (1 - \alpha) M_{t-1}$$

Where:
- $M_t$: Current momentum score.
- $M_{t-1}$: Previous momentum score.
- $C_t$: Completion score ($1.0$ for full target, $0.5$ for partial or shielded completion, $0.0$ for missed).
- $\alpha$: Adaptive smoothing factor ($\approx 0.15$).

**Streak Shields:** Automatically earned consistency shields that protect streaks during planned rest, sickness, or travel without penalising momentum.

### 3. Behavioural Analytics & Heatmaps
Deterministic client-side analytics uncover adherence dynamics without requiring cloud computation:
- **14-Day Completion Heatmaps:** Visual consistency grids across all active habits.
- **Day-of-Week Performance:** Identifies high-friction and peak-performance days.
- **Cross-Habit Correlation Matrix:** Computes Pearson co-occurrence coefficients ($r = -1.0$ to $+1.0$) to highlight habit synergies and codependencies.

### 4. Server-Side AI Insights & Coaching
Contextual habit modification suggestions powered by Google's Gemini 3.5 Flash Lite engine:
- **Friction Diagnostics:** Identifies recurring failure patterns and proposes root-cause hypotheses.
- **Structured Recommendation Contracts:** AI responses conform to strictly validated JSON schemas (`downscale_target`, `shift_time`, `split_habit`, `pause`).
- **Resilient Fallback:** Automatically degrades to local heuristic rules if the network is disconnected or serverless upstream quotas are reached.

### 5. Multi-User Identity: Local Profiles & Cloud Accounts
Designed to serve both privacy-focused guest users and users testing multi-device synchronisation:
- **Local Profile Switcher (Zero Sign-Up — Production-Ready):**
  - Switch instantly between profiles (e.g. *Personal*, *Work*, *Fitness*, *Family Member*).
  - Each profile operates within an isolated, persistent `localStorage` database partition (`habit_tracker_<profileId>_*`).
  - Supports profile creation, switching, renaming, and custom profile deletion without cloud registration or external dependencies.
- **Cloud Accounts (Cross-Device Access — Preview):**
  - Optional account registration and authentication via email and password.
  - Cryptographically hardened: asynchronous `crypto.scrypt` hashing with OWASP baseline parameters ($N = 131,072 = 2^{17}$, $r = 8$, $p = 1$, $\text{maxmem} = 256\text{MB}$) using random 16-byte cryptographic salts.
  - **Stateless Authentication vs. Persistence Decoupling:** Stateless HMAC-SHA256 bearer tokens eliminate the need for server-side session affinity (any serverless instance with `AUTH_SECRET` can verify the token). However, stateless tokens do **not** eliminate the need for shared persistent storage; serverless instances do not share local filesystem state, making a durable database necessary for reliable synchronisation across multiple instances.

### 6. Cloud & Peer Synchronisation Engine
- **Canonical Conflict Comparator (Project 001.3):** Eliminates comparator discrepancy by sharing a single deterministic comparator contract (`isIncomingWinner` in `src/core/sync/comparator.ts`) between client and server. Ties are broken in order: Lamport timestamp $\to$ `deviceId` $\to$ `operationId`.
- **Durable Client Tombstones & Anti-Resurrection (`LocalTombstoneStore`):** Client-side deletion tombstones are durably persisted in partitioned local storage (`habit_tracker_${partitionKey}_tombstones`). They survive client reboots and browser page reloads, guaranteeing that delayed or out-of-order peer edits can never resurrect a deleted entity as a zombie.
- **Failure-Safe Inbound Cursor Progression:** Inbound sync application halts immediately if any entity applier fails. The client cursor advances only up to the last successfully applied sequence, ensuring that unapplied operations are never skipped on subsequent sync pulls.
- **Empty Page Infinite Loop Guard:** Protects the coordinator pull loop against server anomalies by terminating gracefully when a page returns zero changes even if `hasMore` is flagged.
- **Observable Queue & Cursor Persistence:** Storage write failures in `SyncCoordinator` (for both outbound mutation queues and inbound server cursors) trigger immediate rollbacks and raise observable errors rather than silently swallowing exceptions.
- **Dual-State Model (Log & Materialized View):** The synchronization backend maintains both an append-only change log (`changeLogs[userId]`) with monotonic sequence numbers (`serverCursor`) and a deterministic materialized entity state (`materializedState[userId]`), ensuring incremental pull streaming without stale entity regression.
- **Idempotent Mutations & Server-Side Deduplication:** Every mutation carries a globally unique `operationId`. The server validates incoming operations against `processedOperations[userId]`, guaranteeing that at-least-once network retries never produce duplicate entries or phantom cursor increments.
- **Application Store Integration (`bindStorageToSync`):** Directly wires the `SyncCoordinator` to live `StoragePort` partitions and `LocalTombstoneStore`, ensuring that remote sync changes update domain stores reactively while respecting Lamport causality and deletion tombstones.
- **Property-Based Convergence Proof:** Verified across arbitrary operation delivery permutations that all nodes deterministically converge to the exact same materialized state:
  $$\forall \pi \in \operatorname{Permutations}(O), \quad \operatorname{Converge}(\pi(O)) = S^*$$

### 7. Progressive Web App (PWA) Offline Experience
- **Precached Assets:** Workbox service worker precaches all core application assets (`dist/`), ensuring instant startup.
- **Network-Only API Routing:** Explicitly isolates `/api/*` routes with `NetworkOnly` and `navigateFallbackDenylist`, completely preventing cross-tenant caching.
- **Offline Mutations:** Habit check-ins and edits are saved locally to `localStorage` and queued for background synchronisation when connectivity resumes.
- **Installable:** Installable as a standalone app on macOS, Windows, Linux, iOS, and Android without an app store.

---

## System Architecture

The codebase adheres strictly to the **Dune Framework for Agents**, enforcing vertical feature isolation, declared core abstractions, zero inline comments, and strict boundary rules.

```text
personalized-habit-tracker-with-ai-insights/
├── api/                                # Vercel Serverless Functions
│   ├── ai/
│   │   ├── health.ts                   # GET /api/ai/health (gateway diagnostics)
│   │   └── infer.ts                    # POST /api/ai/infer (secure Gemini proxy)
│   ├── auth/
│   │   ├── login.ts                    # POST /api/auth/login
│   │   ├── me.ts                       # GET /api/auth/me
│   │   └── register.ts                 # POST /api/auth/register
│   └── sync/
│       ├── pull.ts                     # GET /api/sync/pull
│       └── push.ts                     # POST /api/sync/push
│
├── server/                             # Server-side Business Logic & Standalone Runtime
│   ├── auth.d.ts                       # Type definitions for server auth
│   ├── auth.js                         # Cryptographic hashing, token signing & sync storage
│   ├── gateway.js                      # Gemini API gateway with JSON schema enforcement
│   └── index.js                        # Standalone Node.js HTTP server (Docker / production)
│
├── src/                                # Frontend Application (Vite + React 19 + TypeScript)
│   ├── core/                           # Centralized Foundation Modules
│   │   ├── ai-client/                  # Gemini client with server gateway delegation
│   │   ├── database/                   # StoragePort & partitioned BrowserLocalStoragePort
│   │   ├── event-bus/                  # Domain event broker (InMemoryEventBus)
│   │   ├── navigation/                 # Navigation router (StackNavigationRouter)
│   │   ├── sync/                       # LamportClock, LastWriteWins, comparator, tombstones, coordinator
│   │   └── ui/                         # AppContext, shared components & settings
│   │
│   ├── features/                       # Vertically Sliced Domain Features
│   │   ├── analytics/                  # Behavioral heatmaps, consistency aggregator
│   │   ├── habits/                     # Habit lifecycle, scheduling & check-in micro-logging
│   │   ├── identity/                   # ProfileStore, ProfileSwitcher, AuthModal
│   │   ├── insights/                   # Heuristic detection, AI coaching & schema contracts
│   │   └── streaks/                    # EMA momentum scoring, streak shields
│   │
│   └── tests/                          # Automated Verification Suite (18 files, 98 tests)
│       ├── ai_gateway_security.test.ts # AI gateway payload constraints, rate limiting & header isolation
│       ├── alpha_simulation.test.ts     # 30-day multi-persona cohort simulation
│       ├── analytics.test.ts           # Correlation matrices & heatmap logic
│       ├── architecture.test.ts        # Dune architectural boundary & comment enforcement
│       ├── cloud_auth_security.test.ts # Token signature tampering, 7-day expiration & brute-force protection
│       ├── core.test.ts                # EventBus, navigation & storage tests
│       ├── distributed_sync_simulation.test.ts # Idempotent deduplication, materialized state & 3-device convergence
│       ├── e2e_verification.test.ts    # PWA, offline sync & AI fallback E2E tests
│       ├── frontend.test.ts            # View rendering & interactive state
│       ├── habits.test.ts              # Habit scheduling & entry mutations
│       ├── hardening_and_performance.test.ts # Latency benchmarks & input sanitisation
│       ├── insights.test.ts            # Pattern detection & recommendation schemas
│       ├── integration_workflows.test.ts # End-to-end multi-feature workflows
│       ├── local_profile_lifecycle.test.ts # Corruption recovery, profile namespaces & rapid check-in determinism
│       ├── multi_user.test.ts          # Local profile isolation & cryptographic cloud sync
│       ├── streaks.test.ts             # Momentum calculations & streak shield depletion
│       ├── sync_and_pwa.test.ts        # Lamport synchronisation & service worker precaching
│       └── unit_edge_cases.test.ts     # Boundary conditions & error recovery
│
├── vercel.json                         # Vercel deployment configuration & SPA rewrites
└── package.json
```

---

## Technology Stack

| Layer | Technology | Purpose | Operational Status |
|---|---|---|---|
| **Architecture** | Dune Framework for Agents | Vertical feature slicing with zero comments | Production-Ready |
| **Frontend Runtime** | React 19, TypeScript 5.7, Vite 7 | UI rendering, type safety, and fast bundling | Production-Ready |
| **Offline Engine** | Workbox, `vite-plugin-pwa` | Service worker asset precaching and offline support | Production-Ready |
| **Local Storage** | Partitioned `localStorage` | Local-first persistence isolated per profile (IndexedDB on roadmap) | Production-Ready |
| **Server Gateway** | Node.js Serverless (`@vercel/node`) | Stateless API proxy for AI and authentication | Production-Ready |
| **AI Inference** | Google Gemini 3.5 Flash Lite | Sub-2-second structured behavioral coaching | Production-Ready |
| **Authentication** | Cryptographic `scrypt` & HMAC-SHA256 | Salting, password hashing, and stateless bearer tokens | Implemented (Requires DB for prod) |
| **Cloud Sync** | Lamport Clocks & Last-Write-Wins | Deterministic multi-device conflict resolution | Implemented (Requires DB for prod) |
| **Test Suite** | Vitest 3.0 | 98 automated tests across 18 test files | Production-Ready |

---

## Environment Configuration & Security

The application uses a server-side AI gateway. The Google Gemini API key is configured **only** in the server environment.

### 1. Environment Variables

Create a `.env` file in the project root:

```bash
# Server-side Gemini API key (Required for AI Insights)
# NEVER prefix this with VITE_ to prevent leaking credentials to browser bundles
GEMINI_API_KEY=AIzaSy...

# Optional secret for signing cloud authentication tokens
AUTH_SECRET=your_custom_secret_key_here

# Optional remote synchronization endpoint for peer-to-peer sync
VITE_REMOTE_SYNC_URL=
```

> [!IMPORTANT]
> **Credential Security Invariant:**
> `GEMINI_API_KEY` must **never** be prefixed with `VITE_`. Vercel serverless functions (`api/ai/infer.ts`) read `process.env.GEMINI_API_KEY` directly on the server. The client application calls `/api/ai/infer` without ever exposing API keys in browser network requests or bundle artifacts.

---

## Cloud Authentication & Sync API Specification

The server gateway exposes RESTful endpoints for cloud multi-tenancy and data synchronisation:

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | No | Creates a cloud account (`{ name, email, password }`), hashes password with `scrypt`, and returns a signed bearer token. |
| `POST` | `/api/auth/login` | No | Validates credentials (`{ email, password }`) and returns a signed bearer token. |
| `GET` | `/api/auth/me` | Yes (`Bearer <token>`) | Returns authenticated cloud user metadata. |
| `POST` | `/api/sync/push` | Yes (`Bearer <token>`) | Commits a batch of sync envelopes to the append-only log and returns the latest monotonic `serverCursor`. |
| `GET` | `/api/sync/pull?since=<cursor>&limit=<limit>` | Yes (`Bearer <token>`) | Pulls paginated change records committed since the given server cursor (`changes`, `nextCursor`, `hasMore`). |
| `GET` | `/api/ai/health` | No | Diagnostic endpoint verifying server gateway status and presence of `GEMINI_API_KEY`. |
| `POST` | `/api/ai/infer` | No | Proxies structured prompt requests to Gemini with JSON schema validation. |

---

## Known Limitations & Production Database Requirement

> [!WARNING]
> **Ephemeral Serverless Cloud Persistence:**
> Cloud persistence is currently backed by instance-local ephemeral filesystem storage. Data is not guaranteed to survive function-instance replacement or remain consistent across serverless instances. Consequently, cloud registration, authentication, and synchronisation are not yet reliable for production use. A shared, durable database is required.

### Stateless Authentication vs. Shared Persistence

It is important to separate authentication mechanics from persistence guarantees:
- **Stateless Tokens:** HMAC-SHA256 bearer tokens eliminate the need for server-side session affinity. Any serverless instance configured with `AUTH_SECRET` can cryptographically verify incoming requests without contacting an auth database.
- **The Persistence Challenge:** Stateless tokens do *not* solve data persistence. Because serverless microVMs maintain isolated in-memory and `/tmp` filesystems, an account created on one instance or envelopes pushed to one instance will not exist on another instance.

### Recommended Production Architecture

To promote cloud accounts and multi-device synchronisation from preview status to production reliability, connect a managed **PostgreSQL** database:
- **Neon** (Serverless PostgreSQL): Ideal for auto-scaling relational user accounts and transactional synchronisation envelope writes.
- **Supabase** (Managed PostgreSQL): Provides durable relational storage, row-level security (RLS), and database backups.

*(Note: Key-value stores such as Redis are suitable for ephemeral caching or ephemeral pub/sub queues, but PostgreSQL is strongly recommended as the authoritative relational datastore for user accounts and versioned synchronisation logs).*

---

## Deployment

### 1. Vercel Deployment (Recommended)

The project includes a pre-configured [`vercel.json`](./vercel.json) that automatically handles SPA routing while preserving serverless API routes:

```json
{
  "buildCommand": "npm run build && npm run build:app",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/((?!api/).*)",
      "destination": "/index.html"
    }
  ]
}
```

#### Deploy via Vercel CLI:
```bash
# Link project
npx vercel

# Configure the secret Gemini API key
npx vercel env add GEMINI_API_KEY production

# Deploy to production
npx vercel --prod
```

### 2. Standalone Container / Node.js Production Server

For Docker or self-hosted virtual machines with a persistent mounted volume, run the built-in HTTP server:

```bash
# 1. Build TypeScript and Vite frontend
npm run build && npm run build:app

# 2. Start standalone server on PORT 3000
npm start
```

---

## Getting Started & Verification

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```

### Production Build & Verification
```bash
npm run build       # Validates TypeScript compilation (tsc --noEmit)
npm run build:app   # Generates production bundle with PWA service worker (dist/)
```

### Automated Test Suite
```bash
# Runs 98 unit, integration, sync, multi-user, and benchmark tests across 18 test files
npm test

# Enforces Dune architectural invariants (0 comments, strict vertical feature boundaries)
npm run test:arch
```
