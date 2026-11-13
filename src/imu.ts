// Head pose from the G2's IMU. The axes/units aren't documented, so instead of
// guessing we calibrate: record the gravity vector while looking ahead and
// while looking down at a phone, then classify samples by which one they're
// closer to (cosine similarity). Works whatever the axis convention is.
import type { ImuCalibration } from './types'

export type Vec = [number, number, number]

const WINDOW_MS = 30 * 60_000

function norm(v: Vec): Vec {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export class HeadTracker {
  latest: Vec | null = null
  lastSampleAt = 0
  /** Timeline of pose changes: [timestamp, isDown]. */
  private marks: Array<[number, boolean]> = []
  private smooth: Vec | null = null
  private recording: Vec[] | null = null
  private nodTimes: number[] = []
  private lastDown = false
  onNod: (() => void) | null = null

  constructor(public cal?: ImuCalibration) {}

  sample(raw: Vec, now = Date.now()): void {
    if (!raw.every(Number.isFinite)) return
    this.latest = raw
    this.lastSampleAt = now
    if (this.recording) this.recording.push(raw)
    // Light low-pass so a single jolt doesn't flip the pose.
    this.smooth = this.smooth
      ? [0.6 * this.smooth[0] + 0.4 * raw[0], 0.6 * this.smooth[1] + 0.4 * raw[1], 0.6 * this.smooth[2] + 0.4 * raw[2]]
      : raw
    const down = this.isDown(this.smooth)
    if (down === null) return
    const last = this.marks[this.marks.length - 1]
    if (!last || last[1] !== down) this.marks.push([now, down])
    this.detectNod(this.isDown(raw) ?? down, now)
    this.prune(now)
  }

  /** null when uncalibrated. */
  isDown(v: Vec): boolean | null {
    if (!this.cal) return null
    const n = norm(v)
    const a = dot(n, norm(this.cal.ahead))
    const d = dot(n, norm(this.cal.down))
    return d > a
  }

  /** Head-down time within the last `windowMs`. Stale data (no samples for 2 min) counts as 0. */
  downMs(windowMs: number, now = Date.now()): number {
    if (!this.cal || now - this.lastSampleAt > 2 * 60_000) return 0
    const from = now - windowMs
    let total = 0
    for (let i = 0; i < this.marks.length; i++) {
      const [t, down] = this.marks[i]
      const end = i + 1 < this.marks.length ? this.marks[i + 1][0] : now
      if (!down) continue
      const s = Math.max(t, from)
      if (end > s) total += end - s
    }
    return total
  }

  /** Double nod: two quick dips toward "down" and back within ~1.6 s. */
  private detectNod(down: boolean, now: number): void {
    if (down && !this.lastDown) this.nodTimes.push(now)
    this.lastDown = down
    this.nodTimes = this.nodTimes.filter(t => now - t < 1600)
    if (this.nodTimes.length >= 2) {
      this.nodTimes = []
      this.onNod?.()
    }
  }

  private prune(now: number): void {
    const from = now - WINDOW_MS
    while (this.marks.length > 1 && this.marks[1][0] < from) this.marks.shift()
  }

  /** Average the samples that arrive over `ms` (used for calibration). */
  async capture(ms = 1500): Promise<Vec | null> {
    this.recording = []
    await new Promise(r => setTimeout(r, ms))
    const got = this.recording
    this.recording = null
    if (!got.length) return null
    const sum = got.reduce<Vec>((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0])
    return [sum[0] / got.length, sum[1] / got.length, sum[2] / got.length]
  }
}
