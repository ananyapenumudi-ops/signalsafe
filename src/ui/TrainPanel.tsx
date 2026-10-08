import type { TrainSnapshot } from '../engine/snapshot'

const BRAKE_TEXT = {
  CURVE: 'over the braking curve',
  OVERSPEED_EB: 'well over the braking curve',
  SR_CEILING: 'over the SR ceiling',
  NO_ACK: 'radio failure not acknowledged',
  TRIP: 'trip: passed end of authority',
} as const

const fmt = (m: number) => `${Math.round(m).toLocaleString('en-IN')} m`

const ASPECT_COLOUR = { R: 'var(--sig-red)', Y: 'var(--sig-yel)', YY: 'var(--sig-yel)', G: 'var(--sig-grn)' } as const

/** DMI (LP-OCIP) view plus the OVK's beliefs next to ground truth. */
export function TrainPanel({ t, onAck }: { t: TrainSnapshot; onAck: () => void }) {
  const d = t.dmi
  const maxKmph = 120
  const frac = Math.min(t.speedKmph / maxKmph, 1)
  const angle = -220 + 260 * frac
  const permFrac = d.permittedKmph === null ? null : Math.min(d.permittedKmph / maxKmph, 1)
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
        <span className="eyebrow">DMI · OVK reference model</span>
      </header>
      <div className="dmi">
        <span className={`mode mode-${d.mode.toLowerCase()}`} title="Kavach mode">
          {d.mode}
        </span>
        <span className="lamp" title={d.aspect ? `Aspect ${d.aspect}` : 'Aspect blank'}>
          {d.aspect ? (
            <>
              <i style={{ background: ASPECT_COLOUR[d.aspect] }} />
              {d.aspect === 'YY' && <i style={{ background: ASPECT_COLOUR.YY }} />}
            </>
          ) : (
            <em>{d.signal ? 'BLANK' : '—'}</em>
          )}
        </span>
        <span className="dmi-k">
          {d.signal ?? 'no signal'}
          {d.nextAspect && <small> · next {d.nextAspect}</small>}
        </span>
        <span className={`radio${d.radioFailure ? ' bad' : d.lastPacketAgeSec !== null && d.lastPacketAgeSec > 2.5 ? ' warn' : ''}`} title="Age of the last SVK packet">
          📡 {d.lastPacketAgeSec === null ? '—' : `${d.lastPacketAgeSec.toFixed(1)} s`}
        </span>
      </div>
      {d.targetDistM !== null && (
        <div className="target" title="Distance to end of authority (max safe front end)">
          <span className="dmi-k">Target</span>
          <div className="bar">
            <span style={{ width: `${Math.min(Math.max(d.targetDistM, 0) / 2000, 1) * 100}%` }} />
          </div>
          <b>{fmt(Math.max(d.targetDistM, 0))}</b>
        </div>
      )}
      {(d.brake || d.ackPending) && (
        <div className={`alertbar${d.brake === 'EB' ? ' eb' : ''}`}>
          {d.brake && (
            <span>
              <b>{d.brake}</b> {BRAKE_TEXT[d.brakeReason ?? 'CURVE']}
            </span>
          )}
          {d.ackPending && (
            <button type="button" className="ack" onClick={onAck}>
              Ack radio failure
            </button>
          )}
        </div>
      )}
      <div className="train-grid">
        <svg viewBox="0 0 120 112" className="dial" role="img" aria-label={`Speed ${t.speedKmph.toFixed(0)} km/h`}>
          <path d={arc(-220, 40)} className="dial-track" />
          {permFrac !== null && permFrac > 0.005 && <path d={arc(-220, -220 + 260 * permFrac)} className="dial-permitted" />}
          {frac > 0.001 && <path d={arc(-220, angle)} className={`dial-value${d.brake ? ' braking' : ''}`} />}
          <text x="60" y="64" textAnchor="middle" className="dial-num">
            {t.speedKmph.toFixed(0)}
          </text>
          <text x="60" y="80" textAnchor="middle" className="dial-unit">
            {d.permittedKmph === null ? 'km/h' : `km/h · permitted ${Math.round(d.permittedKmph)}`}
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
      <div className={`ma-box${t.ma?.restricted.length ? ' restricted' : ''}`}>
        {t.ma ? (
          <>
            <div>
              <span className="k">MA from {t.ma.svk}</span>
              <b>{fmt(t.ma.maM)}</b> to {t.ma.eoa === 'route-end' ? 'end of known route' : t.ma.eoa}
            </div>
            <div>
              <span className="k">Approaching</span>
              {t.ma.signal ? (
                <>
                  <b>{t.ma.signal}</b> {t.ma.aspect} in {fmt(t.ma.signalDistM ?? 0)}
                  {t.ma.nextAspect && <> · next {t.ma.nextAspect}</>}
                </>
              ) : (
                '—'
              )}
            </div>
            {t.ma.restricted.map((r) => (
              <div key={r.signal} className="why">
                {r.signal} shown at R: {r.reason === 'HOLD' ? 'aspect-change hold' : r.reason === 'ROUTE_MISMATCH' ? 'route not proved' : 'route occupied'}{' '}
                <span className="ref">{r.reason === 'HOLD' ? 'SRS 5.2' : 'SRS 12.1'}</span>
              </div>
            ))}
          </>
        ) : (
          <span className="muted">No MA yet: the SVK serves a loco only after it reports a valid location and direction <span className="ref">SRS 17.3</span></span>
        )}
      </div>
      <p className="note">
        The sage band on the yard is where the OVK <i>thinks</i> it is: last tag + odometry, ± 5 m + 5% of distance since that tag{' '}
        <span className="ref">SRS 3.4.2.4</span>.
      </p>
    </section>
  )
}
