import type { TrainSnapshot } from '../engine/snapshot'

const fmt = (m: number) => `${Math.round(m).toLocaleString('en-IN')} m`

/** Speed arc + the OVK's beliefs next to ground truth. */
export function TrainPanel({ t }: { t: TrainSnapshot }) {
  const maxKmph = 120
  const frac = Math.min(t.speedKmph / maxKmph, 1)
  const angle = -220 + 260 * frac
  const r = 46
  const arc = (from: number, to: number) => {
    const p = (a: number) => [60 + r * Math.cos((a * Math.PI) / 180), 60 + r * Math.sin((a * Math.PI) / 180)]
    const [x0, y0] = p(from)
    const [x1, y1] = p(to)
    return `M${x0} ${y0} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`
  }
  const err = t.ovk.absLocM === null ? null : t.ovk.absLocM - t.trueAbsLocM

  return (
    <section className="panel train">
      <header className="panel-head">
        <h2>Loco {t.locoId}</h2>
        <span className="eyebrow">OVK · reference model</span>
      </header>
      <div className="train-grid">
        <svg viewBox="0 0 120 112" className="dial" role="img" aria-label={`Speed ${t.speedKmph.toFixed(0)} km/h`}>
          <path d={arc(-220, 40)} className="dial-track" />
          {frac > 0.001 && <path d={arc(-220, angle)} className="dial-value" />}
          <text x="60" y="64" textAnchor="middle" className="dial-num">
            {t.speedKmph.toFixed(0)}
          </text>
          <text x="60" y="80" textAnchor="middle" className="dial-unit">
            km/h · target {t.targetKmph}
          </text>
        </svg>
        <dl className="facts">
          <div>
            <dt>Direction</dt>
            <dd className={t.ovk.direction === 'undefined' ? 'muted' : ''}>{t.ovk.direction}</dd>
          </div>
          <div>
            <dt>TIN</dt>
            <dd className={t.ovk.tin === null ? 'muted' : ''}>{t.ovk.tin ?? 'undefined'}</dd>
          </div>
          <div>
            <dt>OVK location</dt>
            <dd className={t.ovk.absLocM === null ? 'muted' : ''}>
              {t.ovk.absLocM === null ? 'undefined' : `${fmt(t.ovk.absLocM)} ± ${t.ovk.uncertaintyM.toFixed(0)}`}
            </dd>
          </div>
          <div>
            <dt>True location</dt>
            <dd>{fmt(t.trueAbsLocM)}</dd>
          </div>
          <div>
            <dt>Belief error</dt>
            <dd className={err !== null && Math.abs(err) > t.ovk.uncertaintyM ? 'bad' : ''}>{err === null ? '—' : `${err > 0 ? '+' : ''}${err.toFixed(1)} m`}</dd>
          </div>
          <div>
            <dt>Last tag</dt>
            <dd>{t.ovk.lastTag ?? '—'}</dd>
          </div>
        </dl>
      </div>
      <p className="note">
        The sage band on the yard is where the OVK <i>thinks</i> it is: last tag + odometry, ± 5 m + 5% of distance since that tag{' '}
        <span className="ref">SRS 3.4.2.4</span>.
      </p>
    </section>
  )
}
