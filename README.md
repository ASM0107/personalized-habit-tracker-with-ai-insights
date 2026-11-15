# Personalized Habit Tracker

An intelligent, local-first habit tracking application designed to improve consistency through behavioural analytics, adaptive momentum scoring, and AI-powered insights.

## Overview

Traditional habit trackers rely heavily on binary streak systems, often discouraging users after a single missed day. This project takes a different approach.

The application focuses on measuring long-term consistency rather than enforcing perfection. It combines deterministic behavioural analysis with AI-generated recommendations to help users understand their habits, identify recurring obstacles, and make sustainable adjustments.

### Core Principles

- **Consistency over perfection:** Replace fragile streak counters with continuous momentum metrics.
- **Local-first architecture:** Prioritise offline functionality and local data persistence.
- **Intelligent adaptation:** Identify behavioural patterns and recommend achievable adjustments.
- **AI as an enhancement:** Keep essential application functionality independent of external AI services.
- **Modular engineering:** Maintain strict feature boundaries and independently testable components.

## Key Features

### 1. Habit Management

Create and manage habits with configurable targets and recurrence schedules.

Supported habit types:
- Boolean completion.
- Numeric targets.
- Duration-based targets.

Supported scheduling:
- Daily habits.
- Custom weekday schedules.
- X-times-per-week recurrence.

Additional functionality includes editing, archiving, deletion, and historical habit tracking.

### 2. Momentum & Resilience Engine

Traditional streak counters penalise missed days disproportionately.

This application introduces an EMA-based momentum score ranging from 0 to 100.

The mathematical model:

$$M_t = \alpha C_t + (1-\alpha)M_{t-1}$$

Where:
- $M_t$: Current momentum.
- $M_{t-1}$: Previous momentum.
- $C_t$: Completion score.
- $\alpha$: Smoothing factor, approximately 0.15.

Completion scores:

| Event | Score |
|---|---:|
| Completed | 1.0 |
| Partial / Shielded | 0.5 |
| Missed | 0.0 |

The system also introduces streak shields to protect consistency during exceptional circumstances such as illness, travel, and planned rest.

### 3. Behavioural Analytics

The application uses deterministic, locally executed heuristics to identify behavioural patterns.

Examples include:
- Recurring missed habits.
- Day-of-week performance variations.
- Habit consistency trends.
- Potential adherence problems.
- Relationships between recorded behavioural variables.

### 4. AI-Powered Insights

An asynchronous AI inference engine powered by Google's Gemini API provides contextual recommendations.

Capabilities include:
- Habit lapse diagnostics.
- Potential root-cause hypotheses.
- Drop-off risk identification.
- Adaptive target recommendations.
- Habit scheduling adjustments.
- Weekly performance retrospectives.

AI recommendations follow structured JSON contracts to ensure predictable application-side parsing.

Example recommendation categories:
- `downscale_target`
- `shift_time`
- `split_habit`
- `pause`

The AI subsystem is optional. Core habit tracking and local analytics remain functional without network connectivity.

### 5. Offline-First Experience

The application prioritises local persistence and immediate interactions.

Key capabilities:
- Local database persistence.
- Optimistic UI updates.
- Offline check-ins.
- Queued synchronisation.
- Background synchronisation.
- Graceful AI service degradation.

## Architecture

The project follows a modular architecture based on vertical feature slicing adhering to the Dune framework.

```text
src/
├── core/
│   ├── ai-client/
│   ├── database/
│   ├── event-bus/
│   ├── navigation/
│   └── sync/
│
└── features/
    ├── habits/
    │   ├── components/
    │   ├── logic/
    │   ├── state/
    │   ├── types/
    │   ├── tests/
    │   └── index.ts
    │
    ├── streaks/
    │   ├── logic/
    │   ├── state/
    │   ├── types/
    │   ├── tests/
    │   └── index.ts
    │
    ├── insights/
    │   ├── logic/
    │   ├── prompts/
    │   ├── state/
    │   ├── types/
    │   ├── tests/
    │   └── index.ts
    │
    └── analytics/
        ├── components/
        ├── logic/
        ├── types/
        ├── tests/
        └── index.ts
```

### Architectural Principles

* **Vertical Feature Isolation**: Each feature owns its internal implementation and exposes functionality through a public API (`index.ts`).
* **Strict Import Boundaries**: Cross-feature access to private implementation modules is prohibited. Communication occurs through public contracts and domain events.
* **Core Infrastructure Separation**: Shared infrastructure (navigation, storage, sync, event bus, AI client) is maintained independently of feature-specific business logic in `core/`.
* **Zero Comments in Source Code**: Code is written with strict types, precise naming, and clean modular functions rather than inline commentary.
* **No Quick Fixes**: All bug fixes and extensions must solve root causes and preserve system invariants.

## Technology & Infrastructure

| Component | Technology |
|---|---|
| Application architecture | Dune Framework for Agents |
| Language | TypeScript |
| Local persistence | SQLite / IndexedDB |
| Browser storage | OPFS |
| AI inference | Google Gemini API |
| Data validation | TypeScript contracts and JSON Schema |
| Synchronisation | Event-based synchronisation with conflict resolution |
| Architecture enforcement | ESLint / dependency-cruiser |
| Testing | Feature-level automated tests |

## Reliability & Performance Targets

| Metric | Target |
|---|---:|
| Check-in mutation latency | < 50 ms (p99) |
| Offline-to-online synchronisation | < 1.5 seconds |
| AI insight generation | < 2 seconds |
| Crash-free sessions | > 99.9% |
| AI suggestion acceptance | > 45% |
| Storage footprint | < 25 MB over two years |

## Development Roadmap

### Phase 1 — Foundation
- Establish core project structure.
- Implement local persistence.
- Build navigation and event infrastructure.
- Establish feature import boundaries.

### Phase 2 — Habit Engine
- Implement habit creation and management.
- Implement recurrence scheduling.
- Build check-in and micro-logging functionality.
- Establish historical data management.

### Phase 3 — Resilience Engine
- Implement EMA-based momentum.
- Introduce streak shields.
- Implement recovery and consistency metrics.

### Phase 4 — Intelligence Engine
- Implement deterministic pattern detection.
- Integrate Gemini API.
- Introduce structured insight generation.
- Implement caching and inference throttling.

### Phase 5 — Analytics & Hardening
- Implement behavioural analytics.
- Build visualisation components.
- Validate offline functionality.
- Test synchronisation and conflict resolution.
- Enforce architectural boundaries.
- Conduct performance and reliability testing.

### Phase 6 — Interactive Frontend
- Build React 19 + Vite web dashboard exposing engine capabilities.
- Implement vertical feature UI slices (Habit Cards/Modal, Momentum Dashboard, Insights, Analytics Heatmap).
- Provide BrowserLocalStoragePort for offline persistent state across page reloads.
- Implement date navigator, sample data seeding, and micro-logging check-ins.
- Ensure strict separation between presentation and engine logic with zero comments in code.

### Phase 7 — Production Hardening, PWA & Cloud Synchronization
- **Progressive Web App (PWA)**: Auto-updating Service Worker generated via `vite-plugin-pwa` with `workbox` offline precaching and web manifest.
- **Remote Cloud & Peer Synchronization**: Implemented `HttpRemoteSyncAdapter`, `BroadcastChannelSyncAdapter`, and `SyncCoordinator` with Lamport logical clocks and Last-Write-Wins (LWW) conflict resolution.
- **Live Gemini API Configuration**: Full `.env` and `.env.example` setup, UI settings dialog for entering keys, and runtime switching between live Gemini 2.0 Flash inference and deterministic rule-based coaching.

## Getting Started

### Environment Setup
```bash
cp .env.example .env
# Edit .env and insert your Google Gemini API key:
# GEMINI_API_KEY=AIzaSy...
# VITE_GEMINI_API_KEY=AIzaSy...
```

### Development Server
```bash
npm install
npm run dev
```

### Production Build & PWA Generation
```bash
npm run build       # TypeScript type validation (tsc --noEmit)
npm run build:app   # Vite production bundle & service worker (dist/)
```

### Automated Testing & Architecture Verification
```bash
npm test            # 46 unit, integration, sync, and benchmark tests across 12 suites
npm run test:arch   # Dune architecture boundary & zero-comment enforcement
```
