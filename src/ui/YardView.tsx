import { useMemo } from 'react'
import type { Aspect, Yard } from '../engine/schema'
import type { Snapshot } from '../engine/snapshot'
import { at, layoutYard, pathD, slice } from './geometry'

const ASPECT_LAMPS: Record<Aspect, string[]> = {
  R: ['var(--sig-red)'],
  Y: ['var(--sig-yel)'],
  YY: ['var(--sig-yel)', 'var(--sig-yel)'],
  G: ['var(--sig-grn)'],
}

export function YardView({ yard, snapshot }: { yard: Yard; snapshot: Snapshot | null }) {
  const layout = useMemo(() => layoutYard(yard), [yard])
  const tracks = useMemo(() => new Map(yard.tracks.map((t) => [t.id, t])), [yard])

  return (
    <svg className="yard" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={`Live yard: ${yard.name}`}>
      {/* tracks */}
      {yard.tracks.map((t) => {
        const poly = layout.polylines.get(t.id)!
        const mid = at(layout, t, t.lengthM / 2)
        return (
          <g key={t.id}>
            <path d={pathD(poly)} className="track" />
            <text x={mid[0]} y={mid[1] + 20} className="track-label" textAnchor="middle">
              {t.id} · TIN {t.tin}
            </text>
          </g>
        )
      })}

      {/* points */}
      {yard.points.map((p) => {
        const toe = tracks.get(p.toe)!
        const pos = at(layout, toe, toe.a === p.node ? 0 : toe.lengthM)
        const setTo = snapshot?.points[p.id] ?? p.initial
        return (
          <g key={p.id}>
            <circle cx={pos[0]} cy={pos[1]} r={4.5} className={`point point-${setTo}`} />
            <text x={pos[0]} y={pos[1] + 34} className="point-label" textAnchor="middle">
              {p.id} {setTo === 'normal' ? 'N' : 'R'}
            </text>
          </g>
        )
      })}

      {/* RFID tags */}
      {yard.tags.map((g) => {
        const [x, y] = at(layout, tracks.get(g.track)!, g.offsetM)
        return <rect key={g.id} x={x - 1.4} y={y - 3.5} width={2.8} height={7} className="tag" />
      })}

      {/* signals */}
      {yard.signals.map((s) => {
        const [x, y] = at(layout, tracks.get(s.track)!, s.offsetM)
        const up = s.facing === 'nominal'
        const aspect = snapshot?.aspects[s.id] ?? s.initialAspect
        const lamps = ASPECT_LAMPS[aspect]
        const headY = up ? y - 30 : y + 30
        return (
          <g key={s.id}>
            <title>{`${s.id} · ${s.kind} · ${aspect}`}</title>
            <line x1={x} y1={y} x2={x} y2={headY} className="mast" />
            <rect x={x - 6} y={headY - 9 - (lamps.length - 1) * 6} width={12} height={18 + (lamps.length - 1) * 12} rx={4} className="head" />
            {lamps.map((c, i) => (
              <circle key={i} cx={x} cy={headY - (lamps.length - 1) * 6 + i * 12} r={4} fill={c} />
            ))}
            <text x={x + 10} y={headY - 8} className="signal-label">
              {s.id}
            </text>
          </g>
        )
      })}

      {/* trains */}
      {snapshot?.trains.map((t) => {
        const track = tracks.get(t.track)!
        const front = at(layout, track, t.offsetM)
        const est = t.ovk.absLocM
        // OVK's belief: estimated position ± uncertainty, drawn on the train's current track
        const band =
          est === null
            ? null
            : (() => {
                const sign = t.ovk.direction === 'reverse' ? -1 : 1
                const estOffset = t.offsetM + sign * (est - t.trueAbsLocM)
                const lo = (estOffset - t.ovk.uncertaintyM) / track.lengthM
                const hi = (estOffset + t.ovk.uncertaintyM) / track.lengthM
                return { pts: slice(layout.polylines.get(track.id)!, lo, hi), mid: at(layout, track, Math.min(Math.max(estOffset, 0), track.lengthM)) }
              })()
        return (
          <g key={t.locoId}>
            {t.maSpans.map((s) => {
              const tr = tracks.get(s.track)!
              return <path key={`ma-${s.track}`} d={pathD(slice(layout.polylines.get(s.track)!, s.fromM / tr.lengthM, s.toM / tr.lengthM))} className="ma" transform="translate(0 -9)" />
            })}
            {t.ma && t.maSpans.length > 0 && (() => {
              const lastSpan = t.maSpans[t.maSpans.length - 1]!
              const tr = tracks.get(lastSpan.track)!
              const [x, y] = at(layout, tr, lastSpan.toM)
              return (
                <g className="eoa">
                  <line x1={x} y1={y - 16} x2={x} y2={y - 3} />
                  <text x={x} y={y - 19} textAnchor="middle">EOA</text>
                </g>
              )
            })()}
            {t.body.map((b) => (
              <path key={b.track} d={pathD(slice(layout.polylines.get(b.track)!, b.fromM / tracks.get(b.track)!.lengthM, b.toM / tracks.get(b.track)!.lengthM))} className="train-body" />
            ))}
            {band && (
              <g className="ovk-belief" transform="translate(0 13)">
                <path d={pathD(band.pts)} />
                <line x1={band.mid[0]} y1={band.mid[1] - 6} x2={band.mid[0]} y2={band.mid[1] + 6} />
              </g>
            )}
            <circle cx={front[0]} cy={front[1]} r={5.5} className="train-head" />
            <text x={front[0]} y={front[1] - 14} className="train-label" textAnchor="middle">
              {t.locoId} · {t.speedKmph.toFixed(0)} km/h
            </text>
          </g>
        )
      })}
    </svg>
  )
}
