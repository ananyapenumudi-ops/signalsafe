import { useMemo } from 'react'
import { evaluate } from '../engine/eval/evaluate'
import type { LogEvent } from '../engine/log'
import type { Scenario } from '../engine/schema'

/** Test Evaluation Tool view (FRS 7.6.15): runs once the scenario has finished. */
export function EvaluationPanel({
  scenario,
  events,
  ended,
  onShow,
}: {
  scenario: Scenario
  events: LogEvent[]
  ended: boolean
  onShow: (seq: number) => void
}) {
  const report = useMemo(() => (ended ? evaluate(scenario, events) : null), [ended, scenario, events])

  const download = () => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${scenario.id}-seed${scenario.seed}-report.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const allPass = report && report.failed === 0

  return (
    <section className="panel evaluation">
      <header className="panel-head">
        <h2>Evaluation</h2>
        <span className="eyebrow">TET · FRS 7.6.15</span>
        {report && (
          <button type="button" className="link" onClick={download}>
            export JSON
          </button>
        )}
      </header>

      {report ? (
        <div className={`verdict ${allPass ? 'ok' : 'bad'}`}>
          <b>
            {report.passed} of {report.results.length} passed
          </b>
          <span className="mono">
            seed {report.seed} · {report.durationSec} s sim · {report.events.toLocaleString('en-IN')} events
          </span>
        </div>
      ) : (
        <p className="note" style={{ marginTop: 0 }}>
          {scenario.expect.length
            ? 'Runs when the scenario completes. Expected:'
            : 'This scenario has no expected observables yet.'}
        </p>
      )}

      <ol className="results">
        {(report?.results ?? scenario.expect.map((o) => ({ id: o.id, label: o.label, clause: o.clause, expect: o.expect, status: 'pending' as const, window: '', detail: '' }))).map((r) => (
          <li key={r.id} className={`res res-${r.status}`}>
            <span className="dot" aria-label={r.status} />
            <span className="res-label">
              {r.expect === 'absent' && <span className="never">never</span>}
              {r.label}
              {r.status !== 'pending' && <small>{r.detail}</small>}
            </span>
            {r.clause && <span className="ref">{r.clause}</span>}
            {'seq' in r && typeof r.seq === 'number' && (
              <button type="button" className="link" onClick={() => onShow(r.seq as number)} title="Show this record and its causal chain">
                why?
              </button>
            )}
          </li>
        ))}
      </ol>

      {report && report.unexpected.length > 0 && (
        <div className="unexpected">
          <b>Unexpected safety events</b>
          <ul>
            {report.unexpected.map((u) => (
              <li key={u.seq}>
                <span className="mono">{u.tSim.toFixed(1)} s</span> {u.train ?? ''} {u.text}
                <button type="button" className="link" onClick={() => onShow(u.seq)}>
                  why?
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
