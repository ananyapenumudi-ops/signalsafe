/**
 * Engine host. Runs the simulation off the main thread and streams snapshots
 * plus new log events to the UI. Simulated time advances at `speed` × wall
 * time, but every run is still a sequence of identical 100 ms ticks, so results
 * never depend on machine speed.
 */
import type { LogEvent } from './log'
import { DT } from './params'
import type { ScenarioInput } from './schema'
import { Simulation } from './sim'
import type { Snapshot } from './snapshot'

export type ToWorker =
  | { type: 'load'; scenario: ScenarioInput; seed?: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'speed'; speed: number }

export type FromWorker =
  | { type: 'update'; snapshot: Snapshot; events: LogEvent[]; reset: boolean; playing: boolean }
  | { type: 'error'; message: string }

let sim: Simulation | null = null
let sent = 0
let speed = 1
let playing = false
let timer: ReturnType<typeof setInterval> | null = null
let lastWall = 0
let carry = 0

const post = (msg: FromWorker) => self.postMessage(msg)

function publish(reset = false) {
  if (!sim) return
  const events = sim.log.since(sent)
  sent = sim.log.events.length
  post({ type: 'update', snapshot: sim.snapshot(), events, reset, playing })
}

function stop() {
  playing = false
  if (timer) clearInterval(timer)
  timer = null
}

function loop() {
  if (!sim) return
  const now = performance.now()
  carry += ((now - lastWall) / 1000) * speed
  lastWall = now
  // Cap work per frame so a background tab can't queue minutes of ticks.
  let budget = Math.ceil((2 * speed) / DT)
  while (carry >= DT && budget-- > 0 && !sim.ended) {
    sim.step()
    carry -= DT
  }
  if (sim.ended) stop()
  publish()
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'load':
        stop()
        sim = new Simulation(msg.scenario, msg.seed)
        sent = 0
        carry = 0
        publish(true)
        break
      case 'play':
        if (!sim || sim.ended || playing) return
        playing = true
        lastWall = performance.now()
        timer = setInterval(loop, 33)
        publish()
        break
      case 'pause':
        stop()
        publish()
        break
      case 'step':
        stop()
        sim?.step()
        publish()
        break
      case 'speed':
        speed = msg.speed
        break
    }
  } catch (err) {
    stop()
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
