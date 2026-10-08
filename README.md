# SignalSafe

A browser-based digital twin of the **Kavach Generic Test Bench**. Build a yard, run Onboard and Stationary Kavach through it, inject the faults the field throws at them, and get a clause-by-clause verdict on what the system did and why.

Grounded in RDSO's *System Requirements Specification of KAVACH* (RDSO/SPN/196/2020 v4.0 Amdt-3) and modelled on the July 2026 draft *Functional Requirement Specification for KAVACH Generic Test Facility*.

> **Not an approved test facility.** SignalSafe is a learning and pre-validation tool. Its reference models are an independent reading of the public SRS, not any OEM's implementation, and are not SIL-rated.

📄 **[Project documentation (PDF)](docs/SignalSafe-Documentation.pdf)**: scope, the 12 scenarios, architecture and build plan, written before any code.

The site has two pages: a scroll-driven **3D landing page** (`/`, three.js) that explains how Kavach and the bench work chapter by chapter, and the **workbench** (`/bench.html`).

## Status

Weeks 1–4 of the [8-week plan](docs/SignalSafe-Documentation.pdf) are complete:

- [x] Deterministic engine: fixed 100 ms tick, 2 s radio frame, seeded RNG (same scenario + seed → identical log)
- [x] Test Scenario Logger with a `causedBy` link on every event, plus causal-chain lookup
- [x] Yard graph (tracks, points, signals, RFID tags), route-building through points, Scenario Editor checks (SRS 3.4.2.2, 3.4.2.6)
- [x] Scenario schema (Zod), following FRS 8.2.1
- [x] Speed simulator: exact kinematics, gradient, brake levels (within FRS 7.6.5.5's 1%)
- [x] RFID simulator with swept-path detection: no unintended misses at any speed (FRS 7.6.6.3)
- [x] Reference OVK position logic: direction from two tag pairs (SRS 7.2–7.5), linking/odometry correction with the 5 m + 5% bound (SRS 3.4.2.4), TIN self-deduction (SRS 16.6)
- [x] Faults: RFID tag drop, pulse-generator over/under-read
- [x] First workbench screen: live yard, OVK belief vs. ground truth, fault list, event log with "why?" causal chains
- [x] Week 3: reference Stationary Kavach: aspect → MA (SRS 5.4), control-table route proving and most-restrictive rule (SRS 12.1–12.2), aspect-change/flicker hold (SRS 5.2, 18.8), registration (SRS 17.3); new faults: point not detected, signal flicker
- [x] 3D landing page: ten scroll-linked vignettes (tags, radio frames, MA + braking curve, faults, evaluation, architecture, determinism)
- [x] Week 4: Radio Message Simulator (reports up, MAs down, loss/drop faults); OVK supervision with braking curve from the max safe front end (SRS 11.5.1), FSB/EB interventions, hold at a stand, trip on passing the EOA; radio fallback per SRS 20.1 (blank at 6 s, failure at 30/10 s, ack within 15 s or FSB); SR/FS/TRIP modes; scenarios **S01** (stop short of a red) and **S05/S05b** (radio silent); DMI panel with Ack button and scenario picker
- [ ] Next: head-on / rear-end collision prevention (SRS 14), roll-back (SRS 13), LC auto-whistle (SRS 15), remaining scenarios
- [ ] Weeks 5–8: Scenario Editor, DMI and SMOCIP simulators, Evaluation Tool, reports

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (landing) · /bench.html (workbench)
npm test           # engine test suite (Vitest + fast-check property tests)
npm run build      # typecheck + production build
```

## Layout

```
src/engine/        simulation engine: pure TypeScript, no UI imports, runs in a Web Worker
  params.ts        every enforced number, with its SRS/FRS clause (single source of truth)
  schema.ts        scenario file format (Zod)
  sim.ts           tick loop and module order
  yard.ts          yard graph, routes, Scenario Editor checks
  dynamics.ts      Speed Simulator (FRS 7.6.5)
  rfid.ts          RFID Simulator, swept detection (FRS 7.6.6)
  ovk/position.ts  reference OVK: location, direction, TIN
  svk/svk.ts       reference SVK: movement authority, route proving, holds
  log.ts           Test Scenario Logger + causal chains (FRS 7.6.11)
  worker.ts        engine host for the browser
src/ui/            React workbench
src/landing/       3D landing page (three.js scene + chapters)
src/scenarios/     sample scenarios
docs/              project documentation (HTML source + PDF)
```

## Honest limits

S01 stops the train about 7 m short of the red signal: safe, but outside SRS 3.5.7.1's "≤ 5 m in 90% of cases". The 5 m tag accuracy plus a stand-in stop margin dominate; closing the gap needs the real braking algorithm (Annexure O).

Several SRS annexures aren't in our sources: A1 (mode transitions), B (DMI layout), C (radio protocol), D (tag format) and O (braking algorithm). Anything that depends on them uses a labelled **stand-in** (see `standIn: true` in [`params.ts`](src/engine/params.ts)), so it is never mistaken for the specification.
