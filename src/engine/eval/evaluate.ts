/**
 * Test Evaluation Tool (FRS 7.6.15). Offline: runs over the finished log.
 *
 *  7.6.15.1  compares logged data with the expected behaviour in the test case
 *  7.6.15.3  each observable is traced to a specific record in the log
 *  7.6.15.4  the comparison is a search for the observable in the correct
 *            time and location window
 *  7.6.15.5  duplicated matches are avoided (a matched record is consumed)
 *            and dependencies between consecutive steps are resolved
 *            (a step can be anchored to an earlier one)
 *
 * Also flags safety events nobody asked for (an EB, a SPAD, a trip, a
 * collision): they don't fail the run on their own, but a reviewer should see them.
 */
import type { LogEvent } from '../log'
import type { Observable, Scenario } from '../schema'

export type ResultStatus = 'pass' | 'fail' | 'blocked'

export interface ObservableResult {
  id: string
  label: string
  clause?: string
  expect: 'present' | 'absent'
  status: ResultStatus
  /** The record that satisfied (present) or violated (absent) the observable. */
  seq?: number
  tSim?: number
  /** Human-readable window, e.g. "6–8 s after radio-silent". */
  window: string
  detail: string
}

export interface EvaluationReport {
  scenario: string
  title: string
  seed: number
  durationSec: number
  events: number
  passed: number
  failed: number
  results: ObservableResult[]
  /** Safety events not accounted for by any present-observable. */
  unexpected: { seq: number; tSim: number; type: string; train?: string; text: string }[]
}

type Filter = unknown

const get = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)

function matchesValue(actual: unknown, want: Filter): boolean {
  if (want !== null && typeof want === 'object' && !Array.isArray(want) && ('gte' in want || 'lte' in want)) {
    const r = want as { gte?: number; lte?: number }
    return typeof actual === 'number' && (r.gte === undefined || actual >= r.gte) && (r.lte === undefined || actual <= r.lte)
  }
  if (Array.isArray(want)) return JSON.stringify(actual) === JSON.stringify(want)
  return actual === want
}

export function matchesFilters(e: LogEvent, filters: Record<string, Filter>): boolean {
  for (const [k, want] of Object.entries(filters)) {
    const actual = k === 'train' || k === 'source' ? (e as unknown as Record<string, unknown>)[k] : get(e.data, k)
    if (!matchesValue(actual, want)) return false
  }
  return true
}

const SAFETY = (e: LogEvent) =>
  (e.type === 'BRAKE' && e.data.level === 'EB') || e.type === 'SPAD' || e.type === 'COLLISION' || (e.type === 'OVK_MODE' && e.data.to === 'TRIP')

const fmtT = (t: number) => `${Math.round(t * 10) / 10} s`

export function evaluate(scenario: Scenario, events: LogEvent[]): EvaluationReport {
  const consumed = new Set<number>()
  const matched = new Map<string, LogEvent>()
  const failed = new Set<string>()
  const results: ObservableResult[] = []

  const anchorOf = (ob: Observable): { t: number; name: string } | 'blocked' | null => {
    const a = ob.at.after
    if (!a) return null
    if (a === 'start') return { t: 0, name: 'start' }
    if (a.startsWith('fault:')) {
      const id = a.slice(6)
      const ev = events.find((e) => e.type === 'FAULT_START' && e.data.fault === id)
      return ev ? { t: ev.tSim, name: `fault ${id}` } : 'blocked'
    }
    if (failed.has(a)) return 'blocked'
    const ev = matched.get(a)
    return ev ? { t: ev.tSim, name: a } : 'blocked'
  }

  for (const ob of scenario.expect) {
    const base = { id: ob.id, label: ob.label, clause: ob.clause, expect: ob.expect }
    const anchor = anchorOf(ob)
    if (anchor === 'blocked') {
      failed.add(ob.id)
      results.push({ ...base, status: 'blocked', window: `after ${ob.at.after}`, detail: `Depends on ${ob.at.after}, which did not happen` })
      continue
    }
    const anchorT = anchor?.t ?? 0
    const [lo, hi] = ob.at.sec ?? [anchor ? 0 : -Infinity, Infinity]
    const tLo = anchorT + lo
    const tHi = anchorT + hi
    const windowText = [
      ob.at.sec ? `${ob.at.sec[0]}–${ob.at.sec[1]} s after ${anchor?.name ?? 'start'}` : anchor ? `after ${anchor.name}` : 'any time',
      ob.at.locM ? `at ${ob.at.locM[0]}–${ob.at.locM[1]} m` : '',
    ]
      .filter(Boolean)
      .join(', ')
    const inWindow = (e: LogEvent) =>
      e.tSim >= tLo - 1e-9 &&
      e.tSim <= tHi + 1e-9 &&
      (!anchor || e.tSim >= anchorT) &&
      (!ob.at.locM || (e.locM !== undefined && e.locM >= ob.at.locM[0] && e.locM <= ob.at.locM[1]))
    const candidates = events.filter((e) => e.type === ob.event && matchesFilters(e, ob.filters))

    if (ob.expect === 'absent') {
      const hit = candidates.find(inWindow)
      if (hit) {
        failed.add(ob.id)
        results.push({ ...base, status: 'fail', seq: hit.seq, tSim: hit.tSim, window: windowText, detail: `Happened at ${fmtT(hit.tSim)} but must not` })
      } else results.push({ ...base, status: 'pass', window: windowText, detail: 'Did not happen' })
      continue
    }

    const hit = candidates.find((e) => !consumed.has(e.seq) && inWindow(e))
    if (hit) {
      consumed.add(hit.seq)
      matched.set(ob.id, hit)
      results.push({ ...base, status: 'pass', seq: hit.seq, tSim: hit.tSim, window: windowText, detail: `Seen at ${fmtT(hit.tSim)}${anchor ? ` (${fmtT(hit.tSim - anchorT)} after ${anchor.name})` : ''}` })
    } else {
      failed.add(ob.id)
      const near = candidates.filter((e) => !consumed.has(e.seq)).sort((a, b) => Math.abs(a.tSim - tLo) - Math.abs(b.tSim - tLo))[0]
      results.push({
        ...base,
        status: 'fail',
        seq: near?.seq,
        tSim: near?.tSim,
        window: windowText,
        detail: near ? `Nearest match at ${fmtT(near.tSim)}${anchor ? ` (${fmtT(near.tSim - anchorT)} after ${anchor.name})` : ''}: outside the window` : 'No matching event',
      })
    }
  }

  const unexpected = events
    .filter((e) => SAFETY(e) && !consumed.has(e.seq))
    .map((e) => ({
      seq: e.seq,
      tSim: e.tSim,
      type: e.type,
      train: e.train,
      text: e.type === 'BRAKE' ? `EB (${e.type === 'BRAKE' ? e.data.reason : ''})` : e.type,
    }))

  return {
    scenario: scenario.id,
    title: scenario.title,
    seed: scenario.seed,
    durationSec: scenario.durationSec,
    events: events.length,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status !== 'pass').length,
    results,
    unexpected,
  }
}
