# SignalSafe

A browser-based digital twin of the **Kavach Generic Test Bench**. Build a yard, run Onboard and Stationary Kavach through it, inject the faults the field throws at them, and get a clause-by-clause verdict on what the system did and why.

Grounded in RDSO's *System Requirements Specification of KAVACH* (RDSO/SPN/196/2020 v4.0 Amdt-3) and modelled on the July 2026 draft *Functional Requirement Specification for KAVACH Generic Test Facility*.

> **Not an approved test facility.** SignalSafe is a learning and pre-validation tool. Its reference models are an independent reading of the public SRS, not any OEM's implementation, and are not SIL-rated.

📄 **[Project documentation (PDF)](docs/SignalSafe-Documentation.pdf)**: scope, the 12 scenarios, architecture and build plan, written before any code.

## Status

Week 1–2 of the [8-week plan](docs/SignalSafe-Documentation.pdf) are complete:

- [x] Deterministic engine: fixed 100 ms tick, 2 s radio frame, seeded RNG (same scenario + seed → identical log)
- [x] Test Scenario Logger with a `causedBy` link on every event, plus causal-chain lookup
- [x] Yard graph (tracks, points, signals, RFID tags), route-building through points, Scenario Editor checks (SRS 3.4.2.2, 3.4.2.6)
- [x] Scenario schema (Zod), following FRS 8.2.1
- [x] Speed simulator: exact kinematics, gradient, brake levels (within FRS 7.6.5.5's 1%)
- [x] RFID simulator with swept-path detection: no unintended misses at any speed (FRS 7.6.6.3)
- [x] Reference OVK position logic: direction from two tag pairs (SRS 7.2–7.5), linking/odometry correction with the 5 m + 5% bound (SRS 3.4.2.4), TIN self-deduction (SRS 16.6)
- [x] Faults: RFID tag drop, pulse-generator over/under-read
- [x] First workbench screen: live yard, OVK belief vs. ground truth, fault list, event log with "why?" causal chains
- [ ] Week 3: reference Stationary Kavach (aspect → MA, control table, most-restrictive rule, flicker hold)
- [ ] Week 4: OVK supervision + radio (brake curve, SPAD, collisions, RMS, radio-failure fallback)
- [ ] Weeks 5–8: Scenario Editor, DMI and SMOCIP simulators, Evaluation Tool, reports

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
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
  log.ts           Test Scenario Logger + causal chains (FRS 7.6.11)
  worker.ts        engine host for the browser
src/ui/            React workbench
src/scenarios/     sample scenarios
docs/              project documentation (HTML source + PDF)
```

## Honest limits

Several SRS annexures aren't in our sources: A1 (mode transitions), B (DMI layout), C (radio protocol), D (tag format) and O (braking algorithm). Anything that depends on them uses a labelled **stand-in** (see `standIn: true` in [`params.ts`](src/engine/params.ts)), so it is never mistaken for the specification.
