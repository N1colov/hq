// Kick: the nudge engine. Pure logic over AppState + a timestamp, so it can be
// unit-tested with a fake clock. Rendering and delivery live elsewhere.
import { line } from './coach'
import type { AppState, DayLog, Nudge, Quest, QuestRun, Settings } from './types'

export const MIN = 60_000
const TOAST_MS = 8_000
const KEEP_DAYS = 14

// ---------------------------------------------------------------- time utils

export function dateKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function atTime(dayMs: number, hm: string): number {
  const d = new Date(dayMs)
  const [h, m] = parseHM(hm)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime()
}

export function parseHM(hm: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm || '').trim())
  if (!m) return [9, 0]
  return [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))]
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function fmtHM(hm: string): string {
  const [h, m] = parseHM(hm)
  const ap = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${ap}` : `${h12}:${pad(m)}${ap}`
}

function addDays(key: string, n: number): string {
  const [y, mo, d] = key.split('-').map(Number)
  return dateKey(new Date(y, mo - 1, d + n, 12).getTime())
}

function weekday(key: string): number {
  const [y, mo, d] = key.split('-').map(Number)
  return new Date(y, mo - 1, d, 12).getDay()
}

// ---------------------------------------------------------------- scheduling

export function isOffDay(settings: Settings, key: string): boolean {
  return settings.daysOff.includes(weekday(key))
}

export function questsForDay(s: AppState, key: string): Quest[] {
  const off = isOffDay(s.settings, key)
  const wd = weekday(key)
  return s.quests
    .filter(q => q.active)
    .filter(q => (q.days.length ? !off && q.days.includes(wd) : q.once === key))
    .sort((a, b) => a.time.localeCompare(b.time))
}

function newRun(q: Quest, dueAt: number): QuestRun {
  return {
    questId: q.id,
    status: 'waiting',
    dueAt,
    level: 0,
    nextNudgeAt: dueAt,
    focusMs: 0,
    combo: 0,
    dodges: 0,
    buddyPinged: false,
    xp: 0,
  }
}

export function today(s: AppState, now: number): DayLog {
  ensureDay(s, now)
  return s.days[dateKey(now)]
}

/** Create/refresh today's log, roll the streak over, and prune old days. */
export function ensureDay(s: AppState, now: number): void {
  const key = dateKey(now)
  if (!s.days[key]) {
    rollStreak(s, key)
    s.days[key] = { date: key, lockedIn: false, runs: {}, xp: 0, scoreboardSent: false }
  }
  const day = s.days[key]
  const scheduled = questsForDay(s, key)
  const ids = new Set(scheduled.map(q => q.id))
  for (const q of scheduled) {
    const dueAt = atTime(now, q.time)
    const run = day.runs[q.id]
    if (!run) {
      day.runs[q.id] = newRun(q, dueAt)
    } else if (run.dueAt !== dueAt && (run.status === 'waiting' || (run.status === 'due' && run.level === 0))) {
      // Quest time was edited before it got going: follow the new time.
      run.dueAt = dueAt
      run.nextNudgeAt = dueAt
      run.status = 'waiting'
    }
  }
  // Drop runs for quests that were deleted/deactivated, unless they were played.
  for (const [id, run] of Object.entries(day.runs)) {
    if (!ids.has(id) && (run.status === 'waiting' || run.status === 'due')) delete day.runs[id]
  }
  // Prune history.
  const cutoff = addDays(key, -KEEP_DAYS)
  for (const k of Object.keys(s.days)) if (k < cutoff) delete s.days[k]
}

/** Fold finished days into the streak. Off days never break it. */
function rollStreak(s: AppState, todayKey: string): void {
  const p = s.profile
  const yesterday = addDays(todayKey, -1)
  if (!p.lastRolled) {
    p.lastRolled = yesterday
    return
  }
  let k = addDays(p.lastRolled, 1)
  let guard = 0
  while (k <= yesterday && guard++ < 400) {
    if (!isOffDay(s.settings, k)) {
      const log = s.days[k]
      const runs = log ? Object.values(log.runs) : []
      const kos = runs.filter(r => r.status === 'done').length
      if (kos > 0) {
        p.streak += 1
        p.bestStreak = Math.max(p.bestStreak, p.streak)
      } else if (runs.length > 0 || (!log && questsForDay(s, k).length > 0)) {
        p.streak = 0
      }
    }
    k = addDays(k, 1)
  }
  p.lastRolled = yesterday
}

// ---------------------------------------------------------------- queries

export function questOf(s: AppState, id: string): Quest | undefined {
  return s.quests.find(q => q.id === id)
}

export function focusTotal(run: QuestRun, now: number): number {
  return run.focusMs + (run.focusStartedAt ? Math.max(0, now - run.focusStartedAt) : 0)
}

export function hpFrac(s: AppState, run: QuestRun, now: number): number {
  const q = questOf(s, run.questId)
  const total = Math.max(1, (q?.minutes ?? 30) * MIN)
  return Math.max(0, 1 - focusTotal(run, now) / total)
}

export function bossLevel(run: QuestRun): number {
  return Math.max(1, run.level + run.dodges)
}

export function playerLevel(xp: number): { level: number; into: number; span: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1
  const base = (level - 1) ** 2 * 100
  const next = level ** 2 * 100
  return { level, into: xp - base, span: next - base }
}

const ACTIVE: QuestRun['status'][] = ['trap', 'focus']
const OPEN: QuestRun['status'][] = ['waiting', 'due', 'trap', 'focus']

/** The run the HUD should be about right now. */
export function currentRun(s: AppState, now: number): QuestRun | null {
  const day = today(s, now)
  const runs = Object.values(day.runs).filter(r => OPEN.includes(r.status))
  if (!runs.length) return null
  if (day.pinnedId) {
    const pinned = day.runs[day.pinnedId]
    if (pinned && OPEN.includes(pinned.status)) return pinned
  }
  const active = runs.filter(r => ACTIVE.includes(r.status)).sort((a, b) => a.dueAt - b.dueAt)
  if (active.length) return active[0]
  const due = runs.filter(r => r.status === 'due').sort((a, b) => a.dueAt - b.dueAt)
  if (due.length) return due[0]
  return runs.sort((a, b) => a.dueAt - b.dueAt)[0]
}

export function needsLockIn(s: AppState, now: number): boolean {
  const day = today(s, now)
  if (day.lockedIn) return false
  if (now < atTime(now, s.settings.morningTime)) return false
  return Object.values(day.runs).some(r => OPEN.includes(r.status))
}

export interface DaySummary {
  kos: number
  scheduled: number
  focusMin: number
  xp: number
  streak: number
  level: number
  dodges: number
}

export function summary(s: AppState, now: number): DaySummary {
  const day = today(s, now)
  const runs = Object.values(day.runs)
  return {
    kos: runs.filter(r => r.status === 'done').length,
    scheduled: runs.length,
    focusMin: Math.round(runs.reduce((a, r) => a + focusTotal(r, now), 0) / MIN),
    xp: day.xp,
    streak: s.profile.streak + (runs.some(r => r.status === 'done') ? 1 : 0),
    level: playerLevel(s.profile.xp).level,
    dodges: runs.reduce((a, r) => a + r.dodges, 0),
  }
}

// ---------------------------------------------------------------- tick

export interface TickContext {
  /** Milliseconds of head-down time in the recent window (IMU), 0 if unknown. */
  headDownMs: number
}

function toast(s: AppState, now: number, text: string, ms = TOAST_MS): void {
  s.toast = { text, until: now + ms }
}

function minsLate(run: QuestRun, now: number): number {
  return Math.max(0, Math.floor((now - run.dueAt) / MIN))
}

/** Advance the engine to `now` and return any nudges that should be delivered. */
export function tick(s: AppState, now: number, ctx: TickContext = { headDownMs: 0 }): Nudge[] {
  const day = today(s, now)
  const st = s.settings
  const out: Nudge[] = []
  const runs = Object.values(day.runs).sort((a, b) => a.dueAt - b.dueAt)
  const every = Math.max(1, st.escalateEveryMin) * MIN
  let doomChecked = false

  for (const run of runs) {
    const q = questOf(s, run.questId)
    if (!q) continue
    const title = q.title
    const vars = { t: title, s: q.step, b: st.buddyName, n: st.userName, k: st.trapMinutes }

    if (run.status === 'waiting' && now >= run.dueAt) {
      run.status = 'due'
      run.nextNudgeAt = run.dueAt
    }

    if (run.status === 'due') {
      // Give up quietly on blocks that are long gone (e.g. opened the app at night).
      const expireAt = run.dueAt + (Math.max(q.minutes, 60) + 120) * MIN
      if (now > expireAt && !run.focusMs) {
        run.status = 'skipped'
        continue
      }
      if (now >= run.nextNudgeAt) {
        const late = minsLate(run, now)
        const idx = run.level
        let key: 'due' | 'step' | 'spicy' | 'final' = idx === 0 ? 'due' : idx === 1 ? 'step' : 'spicy'
        const buddyReady = !!st.buddyTopic && late >= st.buddyAfterMin
        if (buddyReady && !run.finalWarned) {
          key = 'final'
          run.finalWarned = true
        } else if (buddyReady && run.finalWarned && !run.buddyPinged) {
          run.buddyPinged = true
          out.push({
            kind: 'buddy',
            questId: q.id,
            title: `HQ: ${st.userName || 'Your friend'} needs a push`,
            text: line(st.persona, 'buddy', { ...vars, m: late }, idx),
            priority: 4,
            toBuddy: true,
          })
        }
        const text = line(st.persona, key, { ...vars, m: late }, idx + q.id.length)
        run.lastLine = text
        out.push({ kind: 'nudge', questId: q.id, title: `HQ: ${title}`, text, priority: Math.min(5, 3 + idx) })
        toast(s, now, text, 20_000)
        run.level += 1
        run.lastNudgeAt = now
        run.nextNudgeAt = now + (idx >= 3 ? every * 1.5 : every)
      }
      // Doomscroll catch: head down while dodging the most urgent quest.
      if (!doomChecked && st.doomscrollEnabled && st.imuCal) {
        doomChecked = true
        const windowMs = st.doomscrollMinutes * MIN
        if (ctx.headDownMs >= windowMs && (!run.lastDoomAt || now - run.lastDoomAt >= windowMs)) {
          run.lastDoomAt = now
          const text = line(st.persona, 'doom', { ...vars, m: st.doomscrollMinutes }, run.dodges)
          run.lastLine = text
          out.push({ kind: 'doomscroll', questId: q.id, title: `HQ: ${title}`, text, priority: 4 })
          toast(s, now, text, 20_000)
        }
      }
      continue
    }

    if (run.status === 'trap' && run.trapEndsAt && now >= run.trapEndsAt) {
      run.status = 'focus'
      run.trapDone = true
      run.combo = Math.max(run.combo, 1)
      run.nextCheckinAt = now + st.checkinEveryMin * MIN
      const text = line(st.persona, 'trapDone', vars, run.combo)
      run.lastLine = text
      out.push({ kind: 'trapdone', questId: q.id, title: `HQ: ${title}`, text, priority: 3 })
      toast(s, now, text)
    }

    if (run.status === 'focus') {
      // Boss out of HP: automatic K.O.
      if (hpFrac(s, run, now) <= 0) {
        finish(s, run, now)
        out.push({ kind: 'nudge', questId: q.id, title: `HQ: ${title}`, text: run.lastLine ?? 'K.O.', priority: 3 })
        continue
      }
      if (st.checkinEveryMin > 0) {
        if (!run.checkinPendingSince && run.nextCheckinAt && now >= run.nextCheckinAt) {
          run.checkinPendingSince = now
          const text = line(st.persona, 'checkin', vars, run.combo)
          run.lastLine = text
          out.push({ kind: 'checkin', questId: q.id, title: `HQ: ${title}`, text, priority: 3 })
          toast(s, now, text, st.checkinGraceMin * MIN)
        } else if (run.checkinPendingSince && now - run.checkinPendingSince >= st.checkinGraceMin * MIN) {
          // No answer: stop counting focus from the moment we asked.
          stopFocus(run, run.checkinPendingSince)
          run.status = 'due'
          run.level = Math.max(run.level, 1)
          run.nextNudgeAt = now + every
          const text = line(st.persona, 'paused', vars, run.combo)
          run.lastLine = text
          out.push({ kind: 'paused', questId: q.id, title: `HQ: ${title}`, text, priority: 4 })
          toast(s, now, text, 20_000)
        }
      }
    }
  }

  // Evening scoreboard.
  if (!day.scoreboardSent && runs.length && now >= atTime(now, st.scoreboardTime)) {
    day.scoreboardSent = true
    const sum = summary(s, now)
    s.showScoreboardUntil = now + 10 * MIN
    out.push({
      kind: 'scoreboard',
      title: 'HQ: scoreboard',
      text: `${sum.kos}/${sum.scheduled} K.O. | ${sum.focusMin} min focus | +${sum.xp} XP | streak ${sum.streak}`,
      priority: 2,
    })
  }
  return out
}

// ---------------------------------------------------------------- actions

function stopFocus(run: QuestRun, at: number): void {
  if (run.focusStartedAt) run.focusMs += Math.max(0, at - run.focusStartedAt)
  run.focusStartedAt = undefined
  run.checkinPendingSince = undefined
  run.nextCheckinAt = undefined
}

function award(s: AppState, run: QuestRun, now: number, xp: number): void {
  run.xp += xp
  s.profile.xp += xp
  today(s, now).xp += xp
}

function finish(s: AppState, run: QuestRun, now: number): void {
  const q = questOf(s, run.questId)
  stopFocus(run, now)
  run.status = 'done'
  run.doneAt = now
  const focusMin = Math.floor(run.focusMs / MIN)
  // No free XP for tap-then-swipe: the full reward needs at least one trap's worth of focus.
  const real = focusMin >= s.settings.trapMinutes
  const xp = (real ? 50 : 10) + focusMin + run.combo * 10 + (real && run.dodges === 0 && run.level <= 1 ? 25 : 0)
  award(s, run, now, xp)
  s.profile.totalKOs += 1
  const day = today(s, now)
  if (day.pinnedId === run.questId) day.pinnedId = undefined
  const text = line(s.settings.persona, 'ko', { t: q?.title, x: xp }, s.profile.totalKOs)
  run.lastLine = text
  toast(s, now, text, 12_000)
}

export function startTrap(s: AppState, run: QuestRun, now: number): void {
  const q = questOf(s, run.questId)
  const day = today(s, now)
  if (!day.lockedIn) {
    day.lockedIn = true
    award(s, run, now, 20)
  }
  run.status = 'trap'
  run.trapEndsAt = now + s.settings.trapMinutes * MIN
  run.focusStartedAt = now
  run.checkinPendingSince = undefined
  award(s, run, now, 10)
  const text = line(s.settings.persona, 'trapStart', { t: q?.title, k: s.settings.trapMinutes }, run.dodges)
  run.lastLine = text
  toast(s, now, text)
}

export type Action =
  | { type: 'primary' }
  | { type: 'done'; questId?: string }
  | { type: 'snooze' }
  | { type: 'start'; questId: string }
  | { type: 'skip'; questId: string }
  | { type: 'pin'; questId: string }
  | { type: 'lockin' }

/** Apply a user action. Returns true if state changed. */
export function act(s: AppState, now: number, a: Action): boolean {
  const day = today(s, now)
  const st = s.settings
  const pick = (id?: string) => (id ? day.runs[id] : currentRun(s, now))

  switch (a.type) {
    case 'lockin': {
      if (day.lockedIn) return false
      day.lockedIn = true
      const anyRun = Object.values(day.runs)[0]
      if (anyRun) award(s, anyRun, now, 20)
      else s.profile.xp += 20
      toast(s, now, line(st.persona, 'lockin', {}, 0))
      return true
    }
    case 'primary': {
      const run = currentRun(s, now)
      if (run?.status === 'focus' && run.checkinPendingSince) {
        run.checkinPendingSince = undefined
        run.combo += 1
        run.nextCheckinAt = now + st.checkinEveryMin * MIN
        award(s, run, now, 5 * run.combo)
        run.lastLine = `Combo x${run.combo}. Keep swinging.`
        toast(s, now, `Combo x${run.combo}! +${5 * run.combo} XP`)
        return true
      }
      if (needsLockIn(s, now) && (!run || run.status === 'waiting')) {
        return act(s, now, { type: 'lockin' })
      }
      if (!run) return false
      if (run.status === 'due' || run.status === 'waiting') {
        startTrap(s, run, now)
        return true
      }
      if (run.status === 'trap' && run.trapEndsAt) {
        toast(s, now, `Stay on it. ${fmtClock(run.trapEndsAt - now)} left in the trap.`)
        return true
      }
      if (run.status === 'focus') {
        toast(s, now, `Locked in ${fmtClock(focusTotal(run, now))}. Swipe up when it's dead.`)
        return true
      }
      return false
    }
    case 'done': {
      const run = pick(a.questId)
      if (!run || run.status === 'done' || run.status === 'skipped') return false
      finish(s, run, now)
      return true
    }
    case 'snooze': {
      const run = currentRun(s, now)
      if (!run) return false
      const q = questOf(s, run.questId)
      if (run.status === 'trap' || run.status === 'focus') {
        stopFocus(run, now)
        run.status = 'due'
        run.level = Math.max(run.level, 1)
        run.nextNudgeAt = now + 10 * MIN
        run.lastLine = 'Paused. I will check back in 10.'
        toast(s, now, run.lastLine)
        return true
      }
      if (run.status === 'waiting') return false
      run.dodges += 1
      run.nextNudgeAt = now + 10 * MIN
      const text = line(st.persona, 'snooze', { t: q?.title }, run.dodges)
      run.lastLine = text
      toast(s, now, text)
      return true
    }
    case 'start': {
      const run = day.runs[a.questId]
      if (!run || !(run.status === 'due' || run.status === 'waiting')) return false
      day.pinnedId = a.questId
      startTrap(s, run, now)
      return true
    }
    case 'skip': {
      const run = day.runs[a.questId]
      if (!run || run.status === 'done') return false
      stopFocus(run, now)
      run.status = 'skipped'
      if (day.pinnedId === a.questId) day.pinnedId = undefined
      return true
    }
    case 'pin': {
      const run = day.runs[a.questId]
      if (!run || !OPEN.includes(run.status)) return false
      day.pinnedId = a.questId
      return true
    }
  }
}
