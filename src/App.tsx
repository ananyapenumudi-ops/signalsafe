import { useMemo } from 'react'
import { Scenario } from './engine/schema'
import { checkYard } from './engine/yard'
import { twoStation } from './scenarios/twoStation'
import { EventFeed } from './ui/EventFeed'
import { TrainPanel } from './ui/TrainPanel'
import { YardView } from './ui/YardView'
import { useSimulation } from './ui/useSimulation'

const SPEEDS = [1, 4, 10, 20]

export default function App() {
  const scenario = useMemo(() => Scenario.parse(twoStation), [])
  const issues = useMemo(() => checkYard(scenario.yard), [scenario])
  const sim = useSimulation(twoStation)
  const snap = sim.snapshot
  const progress = snap ? snap.tSim / snap.durationSec : 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="badge" aria-hidden>
            S
          </span>
          <span className="wordmark">
            Signal<i>Safe</i>
          </span>
        </div>
        <span className="crumb">Test Bench Controller</span>
        <span className="crumb-sep">/</span>
        <span className="crumb strong">{scenario.title}</span>
        <span className="topbar-meta">Kavach SRS v4.0 Amdt-3 · FRS GTB draft 2026</span>
      </header>

      <div className="controls" role="toolbar" aria-label="Run controls">
        {sim.playing ? (
          <button type="button" className="btn primary" onClick={sim.pause}>
            ❚❚ Pause
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={sim.play} disabled={!snap || snap.ended}>
            ▶ Run
          </button>
        )}
        <button type="button" className="btn" onClick={sim.step} disabled={!snap || snap.ended}>
          Step 100 ms
        </button>
        <button type="button" className="btn" onClick={sim.reset}>
          ↺ Reset
        </button>
        <div className="speeds" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={`chip${sim.speed === s ? ' on' : ''}`} onClick={() => sim.setSpeed(s)}>
              ×{s}
            </button>
          ))}
        </div>
        <div className="clock">
          <span className="mono">t {snap ? snap.tSim.toFixed(1) : '0.0'} s</span>
          <span className="mono muted">frame {snap?.frame ?? 0}</span>
          <div className="progress" aria-hidden>
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <span className="seed mono">seed {scenario.seed}</span>
      </div>

      {sim.error && <div className="alert">Engine error: {sim.error}</div>}

      <main className="grid">
        <section className="panel yard-panel">
          <header className="panel-head">
            <h2>{scenario.yard.name}</h2>
            <span className="eyebrow">Yard · live</span>
            <span className="legend">
              <i className="lg-tag" /> RFID tag pair <i className="lg-belief" /> OVK belief <i className="lg-train" /> train
            </span>
          </header>
          <YardView yard={scenario.yard} snapshot={snap} />
          <p className="note">{scenario.description}</p>
        </section>

        <div className="side">
          {snap?.trains.map((t) => <TrainPanel key={t.locoId} t={t} />)}

          <section className="panel">
            <header className="panel-head">
              <h2>Faults</h2>
              <span className="eyebrow">Scheduled</span>
            </header>
            <ul className="faults">
              {scenario.faults.map((f) => {
                const on = snap?.activeFaults.includes(f.id)
                return (
                  <li key={f.id} className={on ? 'on' : ''}>
                    <span className="dot" />
                    <b>{f.id}</b>
                    <span className="mono">{f.kind === 'ODO_SCALE' ? `PG × ${f.factor}` : `drop ${f.tags.join(', ')}`}</span>
                    <span className="muted">from {f.startSec} s</span>
                  </li>
                )
              })}
            </ul>
            <h3 className="sub">Scenario checks</h3>
            {issues.length === 0 ? (
              <p className="ok">✓ Yard passes structural and SRS checks (tag pairing, ≤ 1000 m gaps).</p>
            ) : (
              <ul className="issues">
                {issues.map((i, k) => (
                  <li key={k} className={i.severity}>
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <EventFeed events={sim.events} />
      </main>

      <footer className="foot">
        <span>
          Clause refs: {scenario.clauseRefs.map((c) => (
            <span key={c} className="ref">
              {c}
            </span>
          ))}
        </span>
        <span className="standin">Train dynamics use labelled stand-in values: Annexure O (braking) not available.</span>
      </footer>
    </div>
  )
}
