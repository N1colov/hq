// Pure view model: turns app state into what's drawn on the glasses.
// Every screen is a header + a list of on-screen buttons. Swiping only moves
// the highlight (native list scroll); tapping presses the highlighted button.
// No gesture ever completes or removes a task by itself.
import { getTextWidth, measureTextWrap, pxTruncate } from '@evenrealities/pretext'
import { line } from './coach'
import {
  bossLevel,
  currentRun,
  fmtClock,
  fmtHM,
  focusTotal,
  hpFrac,
  needsLockIn,
  playerLevel,
  questLabel,
  questOf,
  summary,
  today,
} from './engine'
import type { AppState, QuestRun } from './types'

// ---------------------------------------------------------------- types

export type PageKey = 'splash' | 'today' | 'quest' | 'confirm' | 'music' | 'score'

export interface Nav {
  page: PageKey
  questId?: string
}

/** What a list button does when tapped. */
export type ListAction =
  | { t: 'open'; questId: string }
  | { t: 'start'; questId: string }
  | { t: 'checkin'; questId: string }
  | { t: 'step'; questId: string; index: number }
  | { t: 'done'; questId: string }
  | { t: 'pause'; questId: string }
  | { t: 'snooze'; questId: string }
  | { t: 'askSkip'; questId: string }
  | { t: 'skip'; questId: string }
  | { t: 'reopen'; questId: string }
  | { t: 'lockin' }
  | { t: 'music' }
  | { t: 'playPause' }
  | { t: 'next' }
  | { t: 'prev' }
  | { t: 'score' }
  | { t: 'today' }
  | { t: 'back' }
  | { t: 'exit' }

export interface TextBox {
  id: number
  name: string
  x: number
  y: number
  w: number
  h: number
  text: string
  border?: number
  borderColor?: number
  radius?: number
  pad?: number
  capture?: boolean
  /** Firmware text brightness 0..4 (omit for default). */
  dim?: number
}

export interface ListBox {
  id: number
  name: string
  x: number
  y: number
  w: number
  h: number
  items: string[]
  actions: ListAction[]
}

export interface ImageBox {
  id: number
  name: string
  x: number
  y: number
  w: number
  h: number
  /** What should be drawn (cache key, e.g. album art URL). */
  src: string
}

export interface PageSpec {
  page: PageKey
  texts: TextBox[]
  list?: ListBox
  images?: ImageBox[]
}

export interface MusicView {
  trackId?: string
  album?: string
  artUrl?: string
  /** Current lyric line (synced), if available. */
  lyric?: string
  /** Next lyric lines, for the music page. */
  lyricNext?: string[]
  connected: boolean
  hasClientId: boolean
  playing: boolean
  title: string
  artist: string
  progressMs: number
  durationMs: number
  device: string
  upNext: string
  error?: string
}

// ---------------------------------------------------------------- layout helpers
// Pixel-accurate layout using the official G2 font metrics (@evenrealities/pretext).

const W = 576
const LINE_H = 27
const SPACE_W = getTextWidth(' ') || 5
const BAR_SEGMENTS = Math.floor((W - getTextWidth('|| ')) / (getTextWidth('━') || 20)) - 1

/** Header card: 3 text lines inside a rounded border. */
const HEAD = { x: 0, y: 58, w: W, h: 3 * LINE_H + 2 * 5 + 1, pad: 4, border: 1 }
export const HEAD_W = HEAD.w - 2 * (HEAD.pad + HEAD.border)
/** Button list under the header (40 px per item, ~3 visible, scrolls). */
const LIST = { x: 0, y: HEAD.y + HEAD.h + 2, w: W, pad: 4 }
const LIST_H = 288 - LIST.y
/** Usable text width of a list item (padding + firmware item inset). */
const itemW = (w: number) => w - 2 * LIST.pad - 2 * 12

export function fit(text: string, px: number): string {
  return pxTruncate(text, px)
}

/** Left text, then spaces, then right text so the right side lands near the right edge. */
export function row(left: string, right: string, width = HEAD_W): string {
  const rw = getTextWidth(right)
  const leftFit = fit(left, width - rw - 3 * SPACE_W)
  const gap = Math.max(2, Math.floor((width - getTextWidth(leftFit) - rw) / SPACE_W) - 1)
  return `${leftFit}${' '.repeat(gap)}${right}`
}

export function center(text: string, width = HEAD_W): string {
  const t = fit(text, width)
  const pad = Math.max(0, Math.floor((width - getTextWidth(t)) / 2 / SPACE_W))
  return ' '.repeat(pad) + t
}

/** Trim a paragraph to at most `maxLines` wrapped lines inside `width`. */
export function clampLines(text: string, maxLines: number, width = HEAD_W): string {
  if (maxLines <= 0 || !text) return ''
  if (measureTextWrap(text, width).lineCount <= maxLines) return text
  const words = text.split(' ')
  while (words.length > 1) {
    words.pop()
    const t = `${words.join(' ')}...`
    if (measureTextWrap(t, width).lineCount <= maxLines) return t
  }
  return fit(text, width)
}

export function hpBar(frac: number, n = 10): string {
  const filled = Math.round(Math.max(0, Math.min(1, frac)) * n)
  return '■'.repeat(filled) + '□'.repeat(n - filled)
}

function thinBar(frac: number, n: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, frac)) * n)
  return '━'.repeat(filled) + '─'.repeat(n - filled)
}

/** A recent toast, but only if it isn't about some other quest than the one on screen. */
function toastOr(s: AppState, now: number, fallback: string, questId?: string): string {
  const t = s.toast
  if (!t || t.until <= now) return fallback
  if (t.questId && t.questId !== questId) return fallback
  return t.text
}

const DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// ---------------------------------------------------------------- music strip

/** DisplayPlus-style now-playing line: "Song - Artist    ( 0:41 - 4:00 )" */
export function musicLine(m: MusicView): string {
  if (!m.hasClientId) return 'Spotify: add your Client ID in HQ on your phone'
  if (!m.connected) return 'Spotify: tap Connect in HQ on your phone'
  if (m.error) return `Spotify: ${m.error}`
  if (!m.title) return 'Nothing playing'
  const right = `    ( ${fmtClock(m.progressMs)} - ${fmtClock(m.durationMs)} )`
  return `${fit(`${m.title} - ${m.artist}`, W - getTextWidth(right) - 4)}${right}`
}

export function musicBar(m: MusicView): string {
  if (!m.connected || !m.title || !m.durationMs) return ' '
  return `${m.playing ? '▶' : '||'} ${thinBar(m.progressMs / m.durationMs, BAR_SEGMENTS)}`
}

function topBoxes(m: MusicView, lyricLine: boolean): TextBox[] {
  // Like DisplayPlus: the current lyric sits under the song when available.
  const second = lyricLine && m.lyric ? fit(`  ${m.lyric}`, W - 4) : musicBar(m)
  return [
    { id: 1, name: 'music', x: 0, y: 0, w: W, h: 30, text: musicLine(m) },
    { id: 2, name: 'mbar', x: 0, y: 28, w: W, h: 28, text: second, dim: 2 },
  ]
}

function header(lines: string[]): TextBox {
  return {
    id: 3,
    name: 'head',
    x: HEAD.x,
    y: HEAD.y,
    w: HEAD.w,
    h: HEAD.h,
    text: lines.slice(0, 3).map(l => fit(l, HEAD_W)).join('\n'),
    border: HEAD.border,
    borderColor: 9,
    radius: 8,
    pad: HEAD.pad,
  }
}

function list(name: string, items: Array<[string, ListAction]>, x = LIST.x, y = LIST.y, w = LIST.w, h = LIST_H): ListBox {
  const safe = items.length ? items.slice(0, 20) : [['← Back', { t: 'back' }] as [string, ListAction]]
  return {
    id: 5,
    name,
    x,
    y,
    w,
    h,
    items: safe.map(([label]) => fit(label, itemW(w)).slice(0, 63)),
    actions: safe.map(([, a]) => a),
  }
}

// ---------------------------------------------------------------- today (checklist)

const ICON: Record<string, string> = { waiting: '□', due: '◆', trap: '▶', focus: '▶', done: '■', skipped: '-' }

function statusLine(s: AppState, now: number): string {
  const lv = playerLevel(s.profile.xp)
  const sum = summary(s, now)
  return `LV ${lv.level} · ${s.profile.xp} XP · streak ${sum.streak}`
}

export function todayPage(s: AppState, m: MusicView, now: number): PageSpec {
  const day = today(s, now)
  const runs = Object.values(day.runs).sort((a, b) => a.dueAt - b.dueAt)
  const done = runs.filter(r => r.status === 'done').length
  const live = runs.filter(r => r.status !== 'skipped').length
  const d = new Date(now)
  const run = currentRun(s, now)
  const label = (r: QuestRun) => questLabel(questOf(s, r.questId), day.date)

  // Line 2: what matters right now.
  let nowLine: string
  if (run?.status === 'trap') nowLine = row(`▶ ${label(run).title}`, `trap ${fmtClock((run.trapEndsAt ?? now) - now)}`)
  else if (run?.status === 'focus' && run.checkinPendingSince) nowLine = row(`▶ ${label(run).title}`, 'still on it?')
  else if (run?.status === 'focus') nowLine = row(`▶ ${label(run).title}`, `locked in ${fmtClock(focusTotal(run, now))}`)
  else if (run?.status === 'due') nowLine = row(`◆ ${label(run).title}`, `${Math.max(0, Math.floor((now - run.dueAt) / 60_000))} min late`)
  else if (run) nowLine = row(`○ NEXT  ${label(run).title}`, `in ${fmtClock(run.dueAt - now)}`)
  else nowLine = live ? '★ ALL CLEAR. Go live a little.' : '★ Nothing on the list today.'

  const coach = run?.status === 'due' ? run.lastLine : undefined
  const third = toastOr(s, now, coach ?? s.plan?.briefs?.[day.date] ?? statusLine(s, now), run?.questId)

  const items: Array<[string, ListAction]> = []
  if (run?.status === 'focus' && run.checkinPendingSince) items.push([`▶ Yes, still on ${label(run).title}`, { t: 'checkin', questId: run.questId }])
  else if (run?.status === 'trap' || run?.status === 'focus') items.push([`▶ Open ${label(run).title}`, { t: 'open', questId: run.questId }])
  else if (run?.status === 'due') items.push([`▶ Start ${label(run).title}`, { t: 'start', questId: run.questId }])
  else if (needsLockIn(s, now)) items.push(['▶ Lock in today (+20 XP)', { t: 'lockin' }])
  for (const r of runs) {
    const tag = r.status === 'done' ? '  K.O.' : r.status === 'skipped' ? '  skipped' : ''
    items.push([`${ICON[r.status]} ${fmtHM(questOf(s, r.questId)?.time ?? '')}   ${label(r).title}${tag}`, { t: 'open', questId: r.questId }])
  }
  items.push(['♥ Music', { t: 'music' }], ['★ Scoreboard', { t: 'score' }], ['○ Exit HQ', { t: 'exit' }])

  return {
    page: 'today',
    texts: [
      ...topBoxes(m, s.settings.lyricsOnKick),
      header([row(`TODAY · ${DAY[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`, `${done}/${live}  ${hpBar(live ? done / live : 0, 8)}`), nowLine, third]),
    ],
    list: list('today', items.slice(0, 20)),
  }
}

// ---------------------------------------------------------------- quest detail

export function questPage(s: AppState, m: MusicView, now: number, questId: string): PageSpec {
  const day = today(s, now)
  const run = day.runs[questId]
  const q = questOf(s, questId)
  if (!run || !q) return todayPage(s, m, now)
  const st = s.settings
  const lab = questLabel(q, day.date)
  const note = q.note ? ` · ${q.note}` : ''

  let state: string
  switch (run.status) {
    case 'waiting':
      state = `starts ${fmtHM(q.time)} · ${q.minutes} min${note}`
      break
    case 'due': {
      const late = Math.max(0, Math.floor((now - run.dueAt) / 60_000))
      state = `due ${fmtHM(q.time)} · ${late} min late${run.dodges ? ` · dodged ${run.dodges}x` : ''}${note}`
      break
    }
    case 'trap': {
      const total = st.trapMinutes * 60_000
      const left = Math.max(0, (run.trapEndsAt ?? now) - now)
      state = row(`${st.trapMinutes}-MIN TRAP  ${fmtClock(left)} left`, thinBar(1 - left / total, 10))
      break
    }
    case 'focus':
      state = run.checkinPendingSince
        ? row('STILL ON IT?', `auto-pause ${fmtClock(st.checkinGraceMin * 60_000 - (now - run.checkinPendingSince))}`)
        : row(`LOCKED IN  ${fmtClock(focusTotal(run, now))} / ${fmtClock(q.minutes * 60_000)}`, `x${run.combo} combo`)
      break
    case 'done':
      state = `K.O.  +${run.koXp ?? run.xp} XP${note}`
      break
    default:
      state = 'Skipped today. No penalty.'
  }
  const checks = run.checks ?? []
  const nextStep = lab.checklist.find((_, i) => !checks[i]) ?? lab.step
  const third = toastOr(s, now, run.status === 'due' && run.lastLine ? run.lastLine : nextStep ? `▶ ${nextStep}` : '', questId)

  const items: Array<[string, ListAction]> = []
  const open = run.status !== 'done' && run.status !== 'skipped'
  if (run.status === 'focus' && run.checkinPendingSince) items.push(['▶ Yes, still on it', { t: 'checkin', questId }])
  if (run.status === 'waiting' || run.status === 'due') items.push([`▶ Start (${st.trapMinutes}-min trap)`, { t: 'start', questId }])
  // The list can't keep its highlight across a rebuild, so the next thing to do is
  // always first: tap, tap, tap walks down the checklist.
  const todo = lab.checklist.map((step, i) => [step, i] as const).filter(([, i]) => !checks[i])
  const ticked = lab.checklist.map((step, i) => [step, i] as const).filter(([, i]) => checks[i])
  if (open) todo.forEach(([step, i]) => items.push([`□ ${step}`, { t: 'step', questId, index: i }]))
  if (run.status === 'waiting' || run.status === 'due') {
    items.push(['■ Mark done', { t: 'done', questId }], ['○ Snooze 10 min', { t: 'snooze', questId }], ['- Skip today...', { t: 'askSkip', questId }])
  } else if (open) {
    items.push(['■ Done (K.O.)', { t: 'done', questId }], ['|| Pause', { t: 'pause', questId }])
  } else {
    items.push(['○ Undo (put it back)', { t: 'reopen', questId }])
  }
  if (open) ticked.forEach(([step, i]) => items.push([`■ ${step}`, { t: 'step', questId, index: i }]))
  items.push(['← Back', { t: 'today' }])

  return {
    page: 'quest',
    texts: [
      ...topBoxes(m, s.settings.lyricsOnKick),
      header([row(`◆ ${lab.title.toUpperCase()}  Lv ${bossLevel(run)}`, `HP ${hpBar(hpFrac(s, run, now))}`), state, third]),
    ],
    list: list('quest', items),
  }
}

export function confirmPage(s: AppState, m: MusicView, now: number, questId: string): PageSpec {
  const day = today(s, now)
  const lab = questLabel(questOf(s, questId), day.date)
  return {
    page: 'confirm',
    texts: [
      ...topBoxes(m, s.settings.lyricsOnKick),
      header([`SKIP ${lab.title.toUpperCase()}?`, 'It comes off today. No XP, no penalty.', 'Streak is safe. You can undo it later.']),
    ],
    list: list('confirm', [
      ['← No, keep it', { t: 'open', questId }],
      ['- Yes, skip it today', { t: 'skip', questId }],
    ]),
  }
}

// ---------------------------------------------------------------- music

/** Music page: album art on the left, lyrics or track info + buttons on the right. */
export const ART = { x: 8, y: 62, size: 128 }
const RX = ART.x + ART.size + 10
const RW = W - RX
const PANEL_INNER = RW - 2 * 4

function musicPanel(m: MusicView): string {
  if (!m.connected) return clampLines('Set up Spotify in HQ on your phone (Spotify section).', 3, PANEL_INNER)
  if (!m.title) return 'Start something in Spotify.'
  if (m.lyric !== undefined && m.lyricNext) {
    // Current line in brackets, next lines indented (DisplayPlus style).
    const out = [fit(`[ ${m.lyric || '...'} ]`, PANEL_INNER)]
    for (const next of m.lyricNext.slice(0, 2)) out.push(fit(`   ${next}`, PANEL_INNER))
    return out.join('\n')
  }
  return [fit(m.title, PANEL_INNER), fit(m.artist, PANEL_INNER), fit(m.upNext ? `UP NEXT  ${m.upNext}` : m.album ?? '', PANEL_INNER)].join('\n')
}

export function musicPage(m: MusicView): PageSpec {
  const items: Array<[string, ListAction]> = m.connected
    ? [
        [m.playing ? '|| Pause' : '▶ Play', { t: 'playPause' }],
        ['▶▶ Skip', { t: 'next' }],
        ['◀◀ Previous', { t: 'prev' }],
        ['← Back', { t: 'today' }],
      ]
    : [['← Back', { t: 'today' }]]
  const state = !m.connected ? 'NOT\nCONNECTED' : m.title ? `${m.playing ? 'PLAYING' : 'PAUSED'}\n${fit(m.device, 128)}` : 'IDLE'
  return {
    page: 'music',
    texts: [
      ...topBoxes(m, false),
      { id: 3, name: 'panel', x: RX, y: 58, w: RW, h: 3 * LINE_H + 8, text: musicPanel(m), pad: 4 },
      { id: 4, name: 'mstate', x: ART.x, y: ART.y + ART.size + 6, w: ART.size + 4, h: 2 * LINE_H + 4, text: state, dim: 2 },
    ],
    list: list('music', items, RX, 152, RW, 288 - 152),
    images: m.connected && m.artUrl ? [{ id: 7, name: 'art', x: ART.x, y: ART.y, w: ART.size, h: ART.size, src: m.artUrl }] : [],
  }
}

// ---------------------------------------------------------------- scoreboard + splash

export function scorePage(s: AppState, m: MusicView, now: number): PageSpec {
  const sum = summary(s, now)
  const lv = playerLevel(s.profile.xp)
  const tomorrow = s.plan?.briefs?.[`${today(s, now).date}:tomorrow`]
  const lines = [
    row('■ SCOREBOARD', `LV ${lv.level}  ${hpBar(lv.into / lv.span, 8)}`),
    row('K.O.s today', `${sum.kos} / ${sum.scheduled}`, 340),
    row('Focus', `${sum.focusMin} min`, 340),
    row('XP today', `+${sum.xp}`, 340),
    row('Streak', `${sum.streak} days  (best ${Math.max(s.profile.bestStreak, sum.streak)})`, 340),
  ]
  if (tomorrow) lines.push(fit(`TOMORROW  ${tomorrow}`, HEAD_W))
  return {
    page: 'score',
    texts: [
      { id: 1, name: 'music', x: 0, y: 0, w: W, h: 30, text: musicLine(m) },
      { id: 3, name: 'head', x: 0, y: 34, w: W, h: 6 * LINE_H + 10, text: lines.join('\n'), border: 1, borderColor: 9, radius: 8, pad: 4 },
    ],
    list: list('score', [['← Back', { t: 'today' }]], 0, 34 + 6 * LINE_H + 12, W, 288 - (34 + 6 * LINE_H + 12)),
  }
}

export function splashPage(s: AppState, now: number): PageSpec {
  const day = today(s, now)
  const runs = Object.values(day.runs).filter(r => r.status !== 'skipped')
  const d = new Date(now)
  const lv = playerLevel(s.profile.xp)
  const brief = s.plan?.briefs?.[day.date] ?? line(s.settings.persona, runs.length ? 'lockin' : 'allclear', {}, 0)
  const text = [
    '',
    center('H Q   ·   O N L I N E', W - 16),
    center(`${DAY[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}  ·  ${runs.length} QUEST${runs.length === 1 ? '' : 'S'}  ·  LV ${lv.level}`, W - 16),
    center(thinBar(1, 20), W - 16),
    clampLines(brief, 2, W - 16),
  ].join('\n')
  return {
    page: 'splash',
    texts: [{ id: 3, name: 'splash', x: 0, y: 8, w: W, h: 200, text, border: 1, borderColor: 9, radius: 10, pad: 7 }],
    list: list('splash', [['▶ Enter HQ', { t: 'today' }]], 140, 214, 296, 288 - 214),
  }
}

// ---------------------------------------------------------------- router

export function buildPage(nav: Nav, s: AppState, m: MusicView, now: number): PageSpec {
  switch (nav.page) {
    case 'splash':
      return splashPage(s, now)
    case 'quest':
      return nav.questId ? questPage(s, m, now, nav.questId) : todayPage(s, m, now)
    case 'confirm':
      return nav.questId ? confirmPage(s, m, now, nav.questId) : todayPage(s, m, now)
    case 'music':
      return musicPage(m)
    case 'score':
      return scorePage(s, m, now)
    default:
      return todayPage(s, m, now)
  }
}

/** Structure signature: rebuild the page only when this changes (lists can't update in place). */
export function structureKey(p: PageSpec): string {
  const t = [
    ...p.texts.map(b => `${b.id}:${b.x},${b.y},${b.w},${b.h}`),
    ...(p.images ?? []).map(b => `i${b.id}:${b.x},${b.y},${b.w},${b.h}`),
  ].join('|')
  const l = p.list ? `L${p.list.id}:${p.list.x},${p.list.y},${p.list.w},${p.list.h}:${p.list.items.join('\u0001')}` : ''
  return `${p.page}#${t}#${l}`
}
