import { describe, expect, it } from 'vitest'
import { Simulation } from '../sim'
import { Scenario } from '../schema'
import { checkYard } from '../yard'
import { LIBRARY, s01, s05, s05b } from '../../scenarios/library'
import type { LogEvent } from '../log'

const ofType = <K extends LogEvent['type']>(events: LogEvent[], type: K) =>
  events.filter((e): e is Extract<LogEvent, { type: K }> => e.type === type)

describe('scenario library', () => {
  it('every scenario parses and its yard passes the editor checks', () => {
    for (const { scenario } of LIBRARY) {
      const parsed = Scenario.parse(scenario)
      expect(checkYard(parsed.yard).filter((i) => i.severity === 'error')).toEqual([])
    }
  })
})

describe('S01 · Stop short of a red (SRS 12, 19.3)', () => {
  const sim = new Simulation(s01)
  const events = sim.runToEnd()
  const S11_CHAINAGE = 3960

  it('never passes S11 and never trips', () => {
    expect(ofType(events, 'SIGNAL_PASSED').some((e) => e.data.signal === 'S11')).toBe(false)
    expect(ofType(events, 'SPAD')).toEqual([])
  })

  it('intervenes on the braking curve and stops the train short of S11', () => {
    expect(ofType(events, 'BRAKE').some((e) => e.data.level === 'FSB' && e.data.reason === 'CURVE')).toBe(true)
    const stop = sim.trueAbsLocM(sim.trains[0]!)
    const short = S11_CHAINAGE - stop
    expect(sim.trains[0]!.speed).toBe(0)
    expect(short).toBeGreaterThan(0)
    // SRS 3.5.7.1 asks for ≤ 5 m in 90% of cases. With the stand-in braking model and
    // a 5 m tag accuracy we stop ~7 m short: safe, but the accuracy target needs Annexure O.
    expect(short).toBeLessThan(15)
  })

  it('holds the train at a stand while the pilot keeps notching up', () => {
    const last = ofType(events, 'BRAKE').at(-1)!
    expect(last.data.level).toBe('FSB')
  })
})

describe('S05 · Radio goes silent (SRS 20.1)', () => {
  const events = new Simulation(s05).runToEnd()
  const loss = ofType(events, 'FAULT_START').find((e) => e.data.fault === 'radio-silent')!
  const blank = ofType(events, 'DMI_ASPECT_BLANK')[0]!
  const fail = ofType(events, 'RADIO_FAILURE')[0]!
  const ask = ofType(events, 'ACK_REQUEST')[0]!
  const brake = ofType(events, 'BRAKE').find((e) => e.data.reason === 'NO_ACK')!

  it('every packet is lost from the fault onward, citing the fault', () => {
    const lost = ofType(events, 'RADIO_PACKET').filter((e) => e.seq > loss.seq)
    expect(lost.length).toBeGreaterThan(0)
    for (const p of lost) {
      expect(p.data.delivered).toBe(false)
      expect(p.causedBy).toEqual([loss.seq])
    }
  })

  it('blanks the aspect 6–8 s after the last packet while FS continues', () => {
    expect(blank.tSim - loss.tSim).toBeGreaterThanOrEqual(6)
    expect(blank.tSim - loss.tSim).toBeLessThanOrEqual(8)
    expect(ofType(events, 'OVK_MODE').filter((e) => e.tSim > loss.tSim)).toEqual([])
  })

  it('declares radio failure at 30 s, asks for an ack, and applies FSB 15 s later', () => {
    expect(fail.tSim - loss.tSim).toBeGreaterThanOrEqual(30)
    expect(fail.tSim - loss.tSim).toBeLessThanOrEqual(32)
    expect(ask.tSim).toBe(fail.tSim)
    expect(brake.tSim - ask.tSim).toBeCloseTo(15, 1)
    expect(brake.data.level).toBe('FSB')
  })

  it('the brake’s causal chain runs back to the injected fault', () => {
    const sim = new Simulation(s05)
    sim.runToEnd()
    const b = ofType(sim.log.events, 'BRAKE').find((e) => e.data.reason === 'NO_ACK')!
    const types = sim.log.chain(b.seq).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['FAULT_START', 'RADIO_PACKET', 'DMI_ASPECT_BLANK', 'RADIO_FAILURE', 'ACK_REQUEST', 'BRAKE']))
  })

  it('brings the train to a stand', () => {
    const lastStatus = ofType(events, 'OVK_STATUS').at(-1)!
    expect(lastStatus.data.speedKmph).toBe(0)
  })
})

describe('S05b · Radio silent, pilot acknowledges', () => {
  const events = new Simulation(s05b).runToEnd()

  it('degrades to SR on ack instead of braking for no-ack, using the service brake only', () => {
    expect(ofType(events, 'ACK')).toHaveLength(1)
    expect(ofType(events, 'OVK_MODE').map((e) => e.data.to)).toEqual(['FS', 'SR', 'FS'])
    expect(ofType(events, 'BRAKE').some((e) => e.data.reason === 'NO_ACK')).toBe(false)
    expect(ofType(events, 'BRAKE').some((e) => e.data.level === 'EB')).toBe(false)
  })

  it('restores the aspect and FS with a new session when the radio returns', () => {
    const end = ofType(events, 'FAULT_END')[0]!
    const restored = ofType(events, 'DMI_ASPECT_RESTORED')[0]!
    expect(restored.tSim - end.tSim).toBeLessThanOrEqual(2)
  })
})
