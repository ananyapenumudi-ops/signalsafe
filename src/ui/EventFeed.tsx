import { useMemo, useState } from 'react'
import type { LogEvent } from '../engine/log'
import { describe, isNotable } from './describe'

/** Causal chain behind an event, oldest cause first (mirrors EventLog.chain). */
function chainOf(events: LogEvent[], seq: number): LogEvent[] {
  const bySeq = new Map(events.map((e) => [e.seq, e]))
  const seen = new Set<number>()
  const visit = (s: number) => {
    if (seen.has(s)) return
    seen.add(s)
    bySeq.get(s)?.causedBy.forEach(visit)
  }
  visit(seq)
  return [...seen].sort((a, b) => a - b).flatMap((s) => bySeq.get(s) ?? [])
}

function Row({ e, onSelect, selected }: { e: LogEvent; onSelect?: (seq: number) => void; selected?: boolean }) {
  const d = describe(e)
  const content = (
    <>
      <span className="ev-t">{e.tSim.toFixed(1)}</span>
      <span className={`ev-src tone-${d.tone}`}>{e.source}</span>
      <span className="ev-text">{d.text}</span>
      {d.clause && <span className="ref">{d.clause}</span>}
    </>
  )
  return (
    <li className={`ev tone-${d.tone}${selected ? ' selected' : ''}`}>
      {onSelect ? (
        <button type="button" onClick={() => onSelect(e.seq)} title="Show causal chain">
          {content}
          {e.causedBy.length > 0 && <span className="ev-why">why?</span>}
        </button>
      ) : (
        <div className="ev-static">{content}</div>
      )}
    </li>
  )
}

export function EventFeed({ events }: { events: LogEvent[] }) {
  const [showAll, setShowAll] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const visible = useMemo(() => (showAll ? events : events.filter(isNotable)).slice(-300).reverse(), [events, showAll])
  const chain = useMemo(() => (selected === null ? [] : chainOf(events, selected)), [events, selected])

  return (
    <section className="panel feed">
      <header className="panel-head">
        <h2>Event log</h2>
        <span className="eyebrow">TSL · FRS 7.6.11</span>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> periodic &amp; ground truth
        </label>
      </header>
      {selected !== null && (
        <div className="chain">
          <div className="chain-head">
            <b>Causal chain</b>
            <button type="button" className="link" onClick={() => setSelected(null)}>
              close
            </button>
          </div>
          <ol>
            {chain.map((e) => (
              <Row key={e.seq} e={e} />
            ))}
          </ol>
        </div>
      )}
      <ol className="events" aria-live="off">
        {visible.map((e) => (
          <Row key={e.seq} e={e} onSelect={setSelected} selected={e.seq === selected} />
        ))}
      </ol>
    </section>
  )
}
