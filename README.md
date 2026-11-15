# Personalized Habit Tracker & Resilience Engine

An intelligent, local-first habit tracking application with adaptive EMA momentum scoring, streak shields, behavioral analytics, PWA offline support, multi-user identity (local profiles and cloud accounts), and server-side Gemini AI insights.

---

## Overview

Traditional habit trackers rely heavily on binary streak systems, penalising users disproportionately after a single missed day and discouraging long-term consistency. 

This application focuses on measuring sustainable momentum rather than enforcing fragile perfection. It combines deterministic behavioural heuristics with AI-powered coaching to help users understand adherence patterns, identify friction, and adapt targets responsibly.

### Core Principles

- **Consistency Over Perfection:** Replace binary streaks with continuous exponential moving average (EMA) momentum metrics and streak rest shields.
- **Local-First & Multi-User Flexibility:** Users can immediately track habits with zero sign-up using partitioned local profiles, or link a cloud account for cross-device synchronisation.
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
Designed to serve both privacy-focused guest users and users needing multi-device synchronisation:
- **Local Profile Switcher (Zero Sign-Up):**
  - Switch instantly between profiles (e.g. *Personal*, *Work*, *Fitness*, *Family Member*).
  - Each profile operates within an isolated `localStorage` database partition (`habit_tracker_<profileId>_*`).
  - Supports profile creation, switching, renaming, and custom profile deletion without cloud registration.
- **Cloud Accounts (Cross-Device Access):**
  - Optional account registration and authentication via email and password.
  - Cryptographically secure: passwords hashed with `scrypt` using unique random 16-byte salts.
  - Stateless HMAC-SHA256 bearer tokens, allowing seamless authentication across distributed serverless microVMs without session stickiness issues.

### 6. Cloud & Peer Synchronisation Engine
- **Sync Endpoints:** Backed by serverless endpoints (`POST /api/sync/push` and `GET /api/sync/pull`).
- **Conflict-Free Resolution:** Uses **Lamport logical clocks** and **Last-Write-Wins (LWW)** deterministic conflict resolution.
- **Cross-Device Parity:** Habit updates committed on a phone automatically propagate to desktop sessions when logged into the same cloud account.

### 7. Progressive Web App (PWA) Offline Experience
- **Precached Assets:** Workbox service worker precaches all core application assets (`dist/`), ensuring instant startup.
- **Offline Mutations:** Habit check-ins and edits are saved locally to IndexedDB/`localStorage` and queued for background synchronisation when connectivity resumes.
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
│   │   ├── sync/                       # LamportClock, LastWriteWins, HttpRemoteSyncAdapter
│   │   └── ui/                         # AppContext, shared components & settings
│   │
│   ├── features/                       # Vertically Sliced Domain Features
│   │   ├── analytics/                  # Behavioral heatmaps, consistency aggregator
│   │   ├── habits/                     # Habit lifecycle, scheduling & check-in micro-logging
│   │   ├── identity/                   # ProfileStore, ProfileSwitcher, AuthModal
│   │   ├── insights/                   # Heuristic detection, AI coaching & schema contracts
│   │   └── streaks/                    # EMA momentum scoring, streak shields
│   │
│   └── tests/                          # Automated Verification Suite (14 files, 57 tests)
│       ├── alpha_simulation.test.ts     # 30-day multi-persona cohort simulation
│       ├── analytics.test.ts           # Correlation matrices & heatmap logic
│       ├── architecture.test.ts        # Dune architectural boundary & comment enforcement
│       ├── core.test.ts                # EventBus, navigation & storage tests
│       ├── e2e_verification.test.ts    # PWA, offline sync & AI fallback E2E tests
│       ├── frontend.test.ts            # View rendering & interactive state
│       ├── habits.test.ts              # Habit scheduling & entry mutations
│       ├── hardening_and_performance.test.ts # Latency benchmarks & input sanitisation
│       ├── insights.test.ts            # Pattern detection & recommendation schemas
│       ├── integration_workflows.test.ts # End-to-end multi-feature workflows
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

| Layer | Technology | Purpose |
|---|---|---|
| **Architecture** | Dune Framework for Agents | Vertical feature slicing with zero comments |
| **Frontend Runtime** | React 19, TypeScript 5.7, Vite 7 | UI rendering, type safety, and fast bundling |
| **Offline Engine** | Workbox, `vite-plugin-pwa` | Service worker asset precaching and offline support |
| **Local Storage** | Partitioned `localStorage` / IndexedDB | Local-first persistence isolated per profile |
| **Server Gateway** | Node.js Serverless (`@vercel/node`) | Stateless API proxy for AI and authentication |
| **Authentication** | Cryptographic `scrypt` & HMAC-SHA256 | Salting, password hashing, and stateless bearer tokens |
| **Cloud Sync** | Lamport Clocks & Last-Write-Wins | Deterministic multi-device conflict resolution |
| **AI Inference** | Google Gemini 3.5 Flash Lite | Sub-2-second structured behavioral coaching |
| **Test Suite** | Vitest 3.0 | 57 automated tests across 14 test files |

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
| `POST` | `/api/sync/push` | Yes (`Bearer <token>`) | Commits a batch of sync envelopes and returns the latest server Lamport timestamp. |
| `GET` | `/api/sync/pull?since=<ts>` | Yes (`Bearer <token>`) | Pulls all envelopes committed since the given Lamport timestamp for the authenticated user. |
| `GET` | `/api/ai/health` | No | Diagnostic endpoint verifying server gateway status and presence of `GEMINI_API_KEY`. |
| `POST` | `/api/ai/infer` | No | Proxies structured prompt requests to Gemini with JSON schema validation. |

---

## Deployment

### 1. Vercel Deployment (Recommended)

The project includes a pre-configured [`vercel.json`](file:///d:/Development/Aether%20Archive/vibing%203/projects/001-personalized-habit-tracker-with-ai-insights/vercel.json) that automatically handles SPA routing while preserving serverless API routes:

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

For Docker or self-hosted virtual machines, run the built-in HTTP server:

```bash
# 1. Build TypeScript and Vite frontend
npm run build && npm run build:app

# 2. Start standalone server on PORT 3000
npm start
```

---

## Known Limitations

> [!WARNING]
> **Ephemeral Serverless Cloud Storage:**
> In the current serverless implementation on Vercel, cloud user accounts and sync envelopes are maintained in memory and backed by `/tmp/habit_tracker_cloud_storage.json`. 
> 
> Because serverless environments spin up ephemeral microVM instances across regions, data written to `/tmp` on one instance is not shared with cold-started instances in other regions. For long-term production deployments across multi-region serverless clusters, connect a managed persistent database (such as Neon PostgreSQL, Supabase, or Upstash Redis).

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
# Runs 57 unit, integration, sync, multi-user, and benchmark tests across 14 test files
npm test

# Enforces Dune architectural invariants (0 comments, strict vertical feature boundaries)
npm run test:arch
```
