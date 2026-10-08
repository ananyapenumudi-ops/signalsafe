import { useEffect, useRef, useState } from 'react'
import { World } from './scene/World'

const REPO = 'https://github.com/ananyapenumudi-ops/signalsafe'
const DOCS = `${REPO}/blob/main/docs/SignalSafe-Documentation.pdf`

type Status = 'live' | 'building' | 'planned'
interface Chapter {
  n: string
  eyebrow: string
  title: [string, string]
  side: 'left' | 'right'
  status: { kind: Status; text: string }
  body: string[]
  facts: { k: string; v: string; ref: string }[]
}

const CHAPTERS: Chapter[] = [
  {
    n: '01',
    eyebrow: 'Kavach, in one breath',
    title: ['Two computers, ', 'one conversation'],
    side: 'right',
    status: { kind: 'live', text: 'Live in the bench' },
    body: [
      'At every station a Stationary Kavach reads the interlocking: signals, points, track circuits. Every loco carries an Onboard Kavach that reads RFID tags in the track, talks to the station over UHF radio, and brakes if the loco pilot doesn’t.',
      'SignalSafe simulates both, plus everything around them: the yard, the tags, the radio, the brakes.',
    ],
    facts: [
      { k: 'Vital computers', v: '2-out-of-2', ref: 'SRS 3.4.4 · 3.5.2' },
      { k: 'RFID tags', v: 'duplicated, ≤ 1000 m apart', ref: 'SRS 3.4.2' },
      { k: 'Radio', v: 'UHF, hot standby', ref: 'SRS 3.4.5' },
    ],
  },
  {
    n: '02',
    eyebrow: 'Location',
    title: ['Tags tell the train ', 'where it is'],
    side: 'left',
    status: { kind: 'live', text: 'Live in the bench' },
    body: [
      'Between tags, the Onboard Kavach counts wheel pulses, and drift creeps in. Every tag snaps it back. The error must stay inside 5 m plus 5% of the distance since the last tag.',
      'Direction isn’t assumed: it’s derived only after two different tag pairs have been read. The sage bar above the loco is its uncertainty. It grows as the loco runs, then snaps small at each tag.',
    ],
    facts: [
      { k: 'Linking bound', v: '5 m + 5% of distance', ref: 'SRS 3.4.2.4' },
      { k: 'Direction', v: 'after two tag sets', ref: 'SRS 7.2 · 7.5' },
      { k: 'TIN', v: 'self-deduced', ref: 'SRS 16.6' },
    ],
  },
  {
    n: '03',
    eyebrow: 'Radio',
    title: ['Every two seconds, ', 'a conversation'],
    side: 'right',
    status: { kind: 'live', text: 'Live in the bench · try S05' },
    body: [
      'Each frame, the loco reports where it is. The station replies with what lies ahead: the next signal, its aspect, its distance, and how far the train may go.',
      'If the radio goes quiet for 6 s, the aspect on the driver’s display blanks. After 30 s it’s declared a radio failure. If there’s no acknowledgement within 15 s, the brakes go on.',
    ],
    facts: [
      { k: 'Frame cycle', v: '2 s', ref: 'SRS 17.11' },
      { k: 'Aspect blanks', v: 'after 6 s', ref: 'SRS 20.1.2' },
      { k: 'Radio failure', v: '30 s · ack in 15 s', ref: 'SRS 20.1.1–3' },
    ],
  },
  {
    n: '04',
    eyebrow: 'Movement authority',
    title: ['Authority, and the ', 'curve that guards it'],
    side: 'left',
    status: { kind: 'live', text: 'Live in the bench · try S01' },
    body: [
      'The station works out how far the train may go: up to the first signal at danger. If anything disagrees, it treats the signal as red. A point not proved, or a berthing line occupied, is enough. A flickering signal stays red until it is stable.',
      'The Onboard Kavach then draws a braking curve to that point, and brakes if the train would cross it.',
    ],
    facts: [
      { k: 'MA packet', v: 'aspect · distance · authority', ref: 'SRS 5.4' },
      { k: 'On conflict', v: 'most restrictive aspect', ref: 'SRS 12.1' },
      { k: 'Flicker', v: 'held until stable', ref: 'SRS 5.2 · 18.8' },
    ],
  },
  {
    n: '05',
    eyebrow: 'Fault injection',
    title: ['Break it ', 'on purpose'],
    side: 'right',
    status: { kind: 'live', text: '6 faults live · more coming' },
    body: [
      'A fault is a scheduled change to what the equipment sees through its interfaces, never an edit to its logic. This is exactly how a hardware bench works.',
      'Drop a tag pair. Make the pulse generators under-read. Lose point detection under a cleared signal. Make a signal chatter. Silence the radio, or drop a share of its packets. Next come packet delay, GPS failure and brake-feedback loss.',
    ],
    facts: [
      { k: 'Tags', v: 'drop one, both, or plant a wrong one', ref: 'FRS 7.6.6.2' },
      { k: 'Radio', v: 'loss, delay, holes', ref: 'FRS 7.6.7.4–10' },
      { k: 'Yard', v: 'flicker, point not detected', ref: 'SRS 18.8 · 12.1' },
    ],
  },
  {
    n: '06',
    eyebrow: 'Evaluation',
    title: ['Judged, ', 'clause by clause'],
    side: 'left',
    status: { kind: 'building', text: 'Causal chains live · evaluator week 7' },
    body: [
      'Every event remembers what caused it. In the bench, click “why?” on any event to walk back to the fault that started it.',
      'Each scenario carries the outcomes it expects. The evaluator finds each one in its time and location window, then reports pass or fail with the clause it tested. The cards in the scene are an illustrative report.',
    ],
    facts: [
      { k: 'Logger', v: 'every event, caused-by links', ref: 'FRS 7.6.11' },
      { k: 'Evaluation', v: 'time + location windows', ref: 'FRS 7.6.15' },
      { k: 'Scenarios', v: '12, each tied to a clause', ref: 'docs §04' },
    ],
  },
  {
    n: '07',
    eyebrow: 'Architecture',
    title: ['Built like ', 'the RDSO bench'],
    side: 'right',
    status: { kind: 'live', text: 'Live in the bench' },
    body: [
      'SignalSafe uses the same four layers as RDSO’s draft test-bench specification: the bench, the simulation, the adapters, and the equipment under test.',
      'The reference Kavach models talk to the bench only through adapters. So one day, the same scenarios could drive real equipment over serial or Ethernet.',
    ],
    facts: [
      { k: 'Bench modules', v: '14, named as in the FRS', ref: 'FRS 7.6' },
      { k: 'Engine', v: 'TypeScript in a Web Worker', ref: 'docs §07' },
      { k: 'Adapters', v: 'one generic contract', ref: 'FRS 7.5' },
    ],
  },
  {
    n: '08',
    eyebrow: 'Engineering',
    title: ['Deterministic ', 'to the byte'],
    side: 'left',
    status: { kind: 'live', text: '81 tests · CI on every push' },
    body: [
      'Time moves in 100 ms ticks and 2 s frames, and all randomness comes from one seeded stream. The same scenario with the same seed gives the same log, every run, on every machine.',
      'Every number the engine enforces lives in one file, next to the clause it comes from. Property tests run thousands of random yards and speeds through it.',
    ],
    facts: [
      { k: 'Tag detection', v: 'swept path, no misses to 250 km/h', ref: 'FRS 7.6.6.3' },
      { k: 'Speed simulator', v: 'exact, inside 1%', ref: 'FRS 7.6.5.5' },
      { k: 'Stand-ins', v: 'labelled, never hidden', ref: 'docs §09' },
    ],
  },
]

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const STATUS_LABEL: Record<Status, string> = { live: '●', building: '◐', planned: '○' }

export default function Landing() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sectionsRef = useRef<(HTMLElement | null)[]>([])
  const [active, setActive] = useState(0)
  const [webgl] = useState(hasWebGL)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !webgl) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let world: World
    try {
      world = new World(canvas, { reducedMotion })
    } catch {
      return // the page still reads fine without the 3D layer
    }
    world.start()

    const onScroll = () => {
      const mid = window.scrollY + window.innerHeight / 2
      const secs = sectionsRef.current.filter((s): s is HTMLElement => !!s)
      let f = 0
      for (let i = 0; i < secs.length; i++) {
        const top = secs[i]!.offsetTop
        const h = secs[i]!.offsetHeight
        if (mid >= top) f = i + Math.min((mid - top) / h, 1) - 0.5
      }
      f = Math.max(0, f)
      world.setChapter(f)
      setActive(Math.round(f))
    }
    const onResize = () => {
      world.resize()
      onScroll()
    }
    const onPointer = (e: PointerEvent) => world.setPointer(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onPointer, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onPointer)
      world.dispose()
    }
  }, [webgl])

  const goTo = (i: number) => sectionsRef.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const reg = (i: number) => (el: HTMLElement | null) => {
    sectionsRef.current[i] = el
  }

  return (
    <>
      <canvas ref={canvasRef} className={`world${webgl ? '' : ' hidden'}`} aria-hidden />
      <div className="vignette" aria-hidden />

      <nav className="nav">
        <a className="brand" href="#top" onClick={(e) => (e.preventDefault(), goTo(0))}>
          <span className="badge">S</span>
          <span className="wordmark">
            Signal<i>Safe</i>
          </span>
        </a>
        <div className="nav-links">
          <a href="#how" onClick={(e) => (e.preventDefault(), goTo(1))}>
            How it works
          </a>
          <a href={DOCS} target="_blank" rel="noreferrer">
            Spec (PDF)
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className="cta" href="./bench.html">
            Open the bench →
          </a>
        </div>
      </nav>

      <ol className="rail" aria-label="Chapters">
        {['Intro', ...CHAPTERS.map((c) => c.eyebrow), 'Start'].map((name, i) => (
          <li key={name}>
            <button type="button" className={i === active ? 'on' : ''} onClick={() => goTo(i)} aria-label={name} aria-current={i === active ? 'step' : undefined}>
              <span>{name}</span>
            </button>
          </li>
        ))}
      </ol>

      <main>
        <section className="hero" id="top" ref={reg(0)}>
          <p className="kicker">Kavach · Indian Railway ATP · the test bench, in your browser</p>
          <h1>
            Signal<i>Safe</i>
          </h1>
          <p className="lede">
            A digital twin of the Kavach Generic Test Bench. Lay out a yard, run Onboard and Stationary Kavach through it, break things on purpose, and see
            exactly which clause held, and why.
          </p>
          <div className="actions">
            <a className="btn primary" href="./bench.html">
              Open the bench
            </a>
            <a className="btn ghost" href="#how" onClick={(e) => (e.preventDefault(), goTo(1))}>
              See how it works ↓
            </a>
          </div>
          <dl className="stats">
            <div>
              <dt>14</dt>
              <dd>bench modules</dd>
            </div>
            <div>
              <dt>12</dt>
              <dd>clause-grounded scenarios</dd>
            </div>
            <div>
              <dt>2 s</dt>
              <dd>radio frames</dd>
            </div>
            <div>
              <dt>100%</dt>
              <dd>deterministic replays</dd>
            </div>
          </dl>
          <div className="scroll-cue" aria-hidden>
            <span />
            scroll
          </div>
        </section>

        {CHAPTERS.map((c, i) => (
          <section key={c.n} className={`chapter ${c.side}`} id={i === 0 ? 'how' : undefined} ref={reg(i + 1)}>
            <article className="card">
              <header>
                <span className="num">{c.n}</span>
                <span className="eyebrow">{c.eyebrow}</span>
                <span className={`status ${c.status.kind}`}>
                  {STATUS_LABEL[c.status.kind]} {c.status.text}
                </span>
              </header>
              <h2>
                {c.title[0]}
                <i>{c.title[1]}</i>
              </h2>
              {c.body.map((p, k) => (
                <p key={k}>{p}</p>
              ))}
              <dl className="facts">
                {c.facts.map((f) => (
                  <div key={f.k}>
                    <dt>{f.k}</dt>
                    <dd>
                      {f.v} <span className="ref">{f.ref}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          </section>
        ))}

        <section className="finale" ref={reg(CHAPTERS.length + 1)}>
          <p className="kicker">End of the line</p>
          <h2>
            Take the <i>controls</i>
          </h2>
          <p className="lede">Run the demo yard, watch the station hand out authority, and click “why?” on anything that looks wrong.</p>
          <div className="actions">
            <a className="btn primary" href="./bench.html">
              Open the bench
            </a>
            <a className="btn ghost" href={DOCS} target="_blank" rel="noreferrer">
              Read the spec
            </a>
          </div>
          <footer className="fine">
            <p>
              SignalSafe is an independent project. It is not affiliated with RDSO or Indian Railways, and it is not an approved test facility. Its reference
              models are a reading of the public Kavach SRS (RDSO/SPN/196/2020 v4.0 Amdt-3) and the draft Generic Test Bench FRS (July 2026). Logic that
              depends on annexures we don’t have is labelled as a stand-in.
            </p>
            <p>© 2026 Ananya Penumudi. All rights reserved.</p>
          </footer>
        </section>
      </main>
    </>
  )
}
