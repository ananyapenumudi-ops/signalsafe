import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogEvent } from '../engine/log'
import type { ScenarioInput } from '../engine/schema'
import type { Snapshot } from '../engine/snapshot'
import type { FromWorker, ToWorker } from '../engine/worker'

/** Keeps the full run log (needed for causal chains) up to a safety cap. */
const MAX_EVENTS = 50_000

export function useSimulation(scenario: ScenarioInput) {
  const worker = useRef<Worker | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [events, setEvents] = useState<LogEvent[]>([])
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [speed, setSpeedState] = useState(4)

  const send = useCallback((msg: ToWorker) => worker.current?.postMessage(msg), [])

  useEffect(() => {
    const w = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data
      if (msg.type === 'error') {
        setError(msg.message)
        setPlaying(false)
        return
      }
      setSnapshot(msg.snapshot)
      setPlaying(msg.playing)
      if (msg.reset) setEvents(msg.events)
      else if (msg.events.length) setEvents((prev) => [...prev, ...msg.events].slice(-MAX_EVENTS))
    }
    w.postMessage({ type: 'speed', speed: 4 } satisfies ToWorker)
    w.postMessage({ type: 'load', scenario } satisfies ToWorker)
    return () => w.terminate()
  }, [scenario])

  return {
    snapshot,
    events,
    playing,
    error,
    speed,
    play: () => send({ type: 'play' }),
    pause: () => send({ type: 'pause' }),
    step: () => send({ type: 'step' }),
    ack: (locoId: string) => send({ type: 'ack', locoId }),
    reset: () => {
      setError(null)
      send({ type: 'load', scenario })
    },
    setSpeed: (s: number) => {
      setSpeedState(s)
      send({ type: 'speed', speed: s })
    },
  }
}
