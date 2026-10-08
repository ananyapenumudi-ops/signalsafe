/**
 * Reference OVK — location, direction and TIN.
 *
 *  SRS 7.2  direction is undefined at start-up and derived after passing two
 *           different sets (pairs) of RFID tags
 *  SRS 7.3  absolute location and TIN stay undefined until then
 *  SRS 7.5  absolute location increasing → Nominal, decreasing → Reverse
 *  SRS 3.4.5.4 / 3.4.2.4(b)  between tags, location = last tag + odometry;
 *           each tag corrects the accumulated error, bounded by
 *           5 m tag accuracy + 5% of distance since the last tag
 *  SRS 16.6 TIN is self-deduced on changing TIN section
 *
 * Interfaces only: this model sees tag reads (RFID-A) and odometry (ODO-A),
 * never the simulator's ground truth.
 */
import type { EventDataMap } from '../log'
import { P } from '../params'
import type { Direction } from '../schema'

export interface TagReading {
  tag: string
  pair: string
  absLocM: number
  tin: number
}

export type OvkPositionEvent =
  | { type: 'OVK_DIRECTION'; data: EventDataMap['OVK_DIRECTION'] }
  | { type: 'OVK_TIN'; data: EventDataMap['OVK_TIN'] }
  | { type: 'OVK_LOCATION_CORRECTED'; data: EventDataMap['OVK_LOCATION_CORRECTED'] }

export class OvkPosition {
  direction: Direction | 'undefined' = 'undefined'
  tin: number | null = null
  lastTag: string | null = null

  /** OVK's own odometer (what the pulse generators report, errors included). */
  private odoM = 0
  private ref: { absLocM: number; odoAtM: number } | null = null
  private firstPair: (TagReading & { odoAtM: number }) | null = null
  private lastPair: string | null = null

  onOdometry(dxM: number): void {
    this.odoM += dxM
  }

  /** Distance travelled since the reference tag, per OVK odometry. */
  get sinceTagM(): number {
    return this.ref ? this.odoM - this.ref.odoAtM : 0
  }

  /** Estimated absolute location, or null while undefined (SRS 7.3). */
  get absLocM(): number | null {
    if (!this.ref || this.direction === 'undefined') return null
    return this.ref.absLocM + (this.direction === 'nominal' ? 1 : -1) * this.sinceTagM
  }

  /** Half-width of the location confidence interval (SRS 3.4.2.4(b)). */
  get uncertaintyM(): number {
    return P('tagLocationAccuracyM') + P('odometryErrorFraction') * Math.abs(this.sinceTagM)
  }

  onTag(r: TagReading): OvkPositionEvent[] {
    this.lastTag = r.tag
    // Second tag of a duplicated pair carries the same information.
    if (r.pair === this.lastPair) return []
    this.lastPair = r.pair
    const events: OvkPositionEvent[] = []

    if (this.direction === 'undefined') {
      if (!this.firstPair) {
        this.firstPair = { ...r, odoAtM: this.odoM }
        return events
      }
      this.direction = r.absLocM > this.firstPair.absLocM ? 'nominal' : 'reverse'
      events.push({ type: 'OVK_DIRECTION', data: { direction: this.direction, fromTags: [this.firstPair.tag, r.tag] } })
    } else {
      const predicted = this.absLocM!
      const boundM = this.uncertaintyM
      const errorM = predicted - r.absLocM
      events.push({
        type: 'OVK_LOCATION_CORRECTED',
        data: { tag: r.tag, errorM: round(errorM), boundM: round(boundM), withinBound: Math.abs(errorM) <= boundM },
      })
    }

    if (this.tin !== r.tin) {
      events.push({ type: 'OVK_TIN', data: { from: this.tin, to: r.tin } })
      this.tin = r.tin
    }
    this.ref = { absLocM: r.absLocM, odoAtM: this.odoM }
    return events
  }
}

const round = (x: number) => Math.round(x * 100) / 100
