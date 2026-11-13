// Pure view model: turns app state into the text boxes drawn on the glasses.
// Kept free of SDK imports so it can be tested and previewed on the phone.
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
import { getTextWidth, measureTextWrap, pxTruncate } from '@evenrealities/pretext'
import type { AppState, QuestRun } from './types'

export type PageKey = 'kick' | 'music' | 'menu' | 'quests' | 'score'

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

export const MENU_ITEMS = ['◆ Kick', '▶ Music', '★ Quests', '■ Scoreboard', '○ Exit HQ'] as const

// Pixel-accurate layout using the official G2 font metrics (@evenrealities/pretext).
const SCREEN_W = 576
const CARD_PAD = 8
const CARD_BORDER = 1
const CARD_H = 188
/** Inner text width of the main card. */
export const CARD_W = SCREEN_W - 2 * (CARD_PAD + CARD_BORDER)
/** Text lines that fit in the card (27 px line height). */
export const CARD_LINES = Math.floor((CARD_H - 2 * (CARD_PAD + CARD_BORDER)) / 27)
const SPACE_W = getTextWidth(' ') || 5
const BAR_SEGMENTS = Math.floor((SCREEN_W - getTextWidth('|| ')) / (getTextWidth('━') || 20)) - 1

export function fit(text: string, px: number): string {
  return pxTruncate(text, px)
}

/** Left text, then spaces, then right text so the right side lands near the right edge. */
export function row(left: string, right: string, width = CARD_W): string {
  const rw = getTextWidth(right)
  const leftFit = fit(left, width - rw - 3 * SPACE_W)
  const gap = Math.max(2, Math.floor((width - getTextWidth(leftFit) - rw) / SPACE_W) - 1)
  return `${leftFit}${' '.repeat(gap)}${right}`
}

export function center(text: string, width = CARD_W): string {
  const t = fit(text, width)
  const pad = Math.max(0, Math.floor((width - getTextWidth(t)) / 2 / SPACE_W))
  return ' '.repeat(pad) + t
}

/** Trim a paragraph to at most `maxLines` wrapped lines inside `width`. */
export function clampLines(text: string, maxLines: number, width = CARD_W): string {
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

function lineCount(text: string, width = CARD_W): number {
  return text ? measureTextWrap(text, width).lineCount : 1
}

/** Assemble card lines; the `flex` line (coach text) gets whatever room is left. */
function card(lines: Array<string | { flex: string }>): string {
  const fixed = lines.reduce<number>((n, l) => n + (typeof l === 'string' ? lineCount(l) : 0), 0)
  const room = Math.max(1, CARD_LINES - fixed)
  return lines
    .map(l => (typeof l === 'string' ? l : clampLines(l.flex, room)))
    .join('\n')
}

export function hpBar(frac: number, n = 10): string {
  const filled = Math.round(Math.max(0, Math.min(1, frac)) * n)
  return '■'.repeat(filled) + '□'.repeat(n - filled)
}

/** DisplayPlus-style now-playing line: "Song - Artist    ( 0:41 - 4:00 )" */
export function musicLine(m: MusicView): string {
  if (!m.hasClientId) return 'Spotify: add your Client ID in HQ on your phone'
  if (!m.connected) return 'Spotify: tap Connect in HQ on your phone'
  if (m.error) return `Spotify: ${m.error}`
  if (!m.title) return 'Nothing playing'
  const right = `    ( ${fmtClock(m.progressMs)} - ${fmtClock(m.durationMs)} )`
  return `${fit(`${m.title} - ${m.artist}`, SCREEN_W - getTextWidth(right) - 4)}${right}`
}

export function musicBar(m: MusicView): string {
  if (!m.connected || !m.title || !m.durationMs) return ' '
  const frac = m.progressMs / m.durationMs
  const filled = Math.round(Math.max(0, Math.min(1, frac)) * BAR_SEGMENTS)
  return `${m.playing ? '▶' : '||'} ${'━'.repeat(filled)}${'─'.repeat(BAR_SEGMENTS - filled)}`
}

function statsLine(s: AppState, now: number): string {
  const lv = playerLevel(s.profile.xp)
  const streak = s.profile.streak + (Object.values(today(s, now).runs).some(r => r.status === 'done') ? 1 : 0)
  return `LV ${lv.level} · streak ${streak}`
}

function toastOr(s: AppState, now: number, fallback: string): string {
  return s.toast && s.toast.until > now ? s.toast.text : fallback
}

export interface KickCard {
  card: string
  hint: string
}

const HP = (s: AppState, run: QuestRun, now: number) => `HP ${hpBar(hpFrac(s, run, now))}`

export function kickCard(s: AppState, now: number): KickCard {
  const day = today(s, now)
  const run = currentRun(s, now)
  const st = s.settings

  if (run?.status === 'focus' && run.checkinPendingSince) {
    const q = questOf(s, run.questId)
    const left = st.checkinGraceMin * 60_000 - (now - run.checkinPendingSince)
    return {
      card: card([
        row(`◆ ${questLabel(q, day.date).title.toUpperCase()}`, `x${run.combo} COMBO`),
        '',
        center('STILL LOCKED IN?'),
        center('tap = yes'),
        '',
        center(`auto-pause in ${fmtClock(left)}`),
      ]),
      hint: 'tap yes · ↑ K.O. · ↓ pause',
    }
  }

  if (needsLockIn(s, now) && (!run || run.status === 'waiting')) {
    const runs = Object.values(day.runs).sort((a, b) => a.dueAt - b.dueAt)
    const brief = s.plan?.briefs?.[day.date]
    const rows = runs.slice(0, CARD_LINES - (brief ? 3 : 2)).map(r => {
      const q = questOf(s, r.questId)
      return row(`○ ${fmtHM(q?.time ?? '')}   ${questLabel(q, day.date).title}`, `${q?.minutes} min`)
    })
    const more = runs.length > rows.length ? ` (+${runs.length - rows.length} more)` : ''
    return {
      card: card([
        `TODAY: ${runs.length} QUEST${runs.length === 1 ? '' : 'S'}${more}`,
        ...(brief ? [fit(brief, CARD_W)] : []),
        ...rows,
        center('tap = lock in   (+20 XP)'),
      ]),
      hint: 'tap lock in · 2x menu',
    }
  }

  if (!run) {
    const sum = summary(s, now)
    return {
      card: card([
        '★ ALL CLEAR',
        '',
        sum.scheduled ? `${sum.kos}/${sum.scheduled} K.O. today · ${sum.focusMin} min focus · +${sum.xp} XP` : 'No quests today.',
        '',
        { flex: toastOr(s, now, line(st.persona, 'allclear', {}, 0)) },
      ]),
      hint: '2x menu',
    }
  }

  const q = questOf(s, run.questId)
  const label = questLabel(q, day.date)
  const title = label.title.toUpperCase()
  const step = label.step ? fit(`▶ ${label.step}`, CARD_W) : ''

  if (run.status === 'waiting') {
    return {
      card: card([
        row(`○ NEXT: ${title}`, `in ${fmtClock(run.dueAt - now)}`),
        fit(`${fmtHM(q?.time ?? '')} · ${q?.minutes} min block${q?.note ? ` · ${q.note}` : ''}`, CARD_W),
        '',
        { flex: toastOr(s, now, step) },
      ]),
      hint: 'tap start early · 2x menu',
    }
  }

  if (run.status === 'due') {
    const late = Math.max(0, Math.floor((now - run.dueAt) / 60_000))
    return {
      card: card([
        row(`◆ ${title}  Lv ${bossLevel(run)}`, HP(s, run, now)),
        '',
        { flex: toastOr(s, now, run.lastLine ?? '') },
        '',
        step,
        fit(`waiting ${late} min${run.dodges ? ` · dodged ${run.dodges}x` : ''}${q?.note ? ` · ${q.note}` : ''}`, CARD_W),
      ]),
      hint: 'tap start · ↑ done · ↓ snooze',
    }
  }

  if (run.status === 'trap') {
    const left = (run.trapEndsAt ?? now) - now
    return {
      card: card([
        row(`◆ ${title} · ${st.trapMinutes}-MIN TRAP`, HP(s, run, now)),
        center(`${fmtClock(left)} left`),
        trapBar(run, now, st.trapMinutes),
        { flex: toastOr(s, now, run.lastLine ?? '') },
        step,
      ]),
      hint: 'tap status · ↑ K.O. · ↓ pause',
    }
  }

  // focus
  const total = (q?.minutes ?? 30) * 60_000
  const nextCheck = run.nextCheckinAt && st.checkinEveryMin > 0 ? `next check-in in ${fmtClock(run.nextCheckinAt - now)}` : ''
  return {
    card: card([
      row(`◆ ${title} · LOCKED IN`, `x${run.combo} COMBO`),
      '',
      row(`focus ${fmtClock(focusTotal(run, now))} / ${fmtClock(total)}`, HP(s, run, now)),
      '',
      { flex: toastOr(s, now, run.lastLine ?? '') },
      nextCheck,
    ]),
    hint: 'tap status · ↑ K.O. · ↓ pause',
  }
}

function trapBar(run: QuestRun, now: number, trapMin: number): string {
  const total = trapMin * 60_000
  const elapsed = total - Math.max(0, (run.trapEndsAt ?? now) - now)
  const n = 20
  const filled = Math.round((elapsed / total) * n)
  return center(`${'━'.repeat(filled)}${'─'.repeat(n - filled)}`)
}

export function scoreCard(s: AppState, now: number): string {
  const sum = summary(s, now)
  const lv = playerLevel(s.profile.xp)
  return card([
    row('■ SCOREBOARD', `LV ${lv.level}  ${hpBar(lv.into / lv.span, 8)}`),
    '',
    row('K.O.s today', `${sum.kos} / ${sum.scheduled}`, 360),
    row('Focus', `${sum.focusMin} min`, 360),
    row('XP today', `+${sum.xp}`, 360),
    row('Streak', `${sum.streak} days  (best ${Math.max(s.profile.bestStreak, sum.streak)})`, 360),
  ])
}

const LIST_W = SCREEN_W - 2 * 4 - 2 * 12

export function questItems(s: AppState, now: number): string[] {
  const day = today(s, now)
  const runs = Object.values(day.runs).sort((a, b) => a.dueAt - b.dueAt)
  if (!runs.length) return ['No quests today. Add some in HQ on your phone.']
  const icon: Record<string, string> = { waiting: '○', due: '◆', trap: '▶', focus: '▶', done: '●', skipped: '-' }
  const tag: Record<string, string> = { waiting: '', due: 'DUE', trap: 'TRAP', focus: 'LOCKED IN', done: 'K.O.', skipped: 'skipped' }
  return runs.slice(0, 20).map(r => {
    const q = questOf(s, r.questId)
    return fit(row(`${icon[r.status]} ${fmtHM(q?.time ?? '')}   ${questLabel(q, day.date).title}`, tag[r.status], LIST_W), LIST_W).slice(0, 63)
  })
}

export function questIdAt(s: AppState, now: number, index: number): string | undefined {
  const day = today(s, now)
  return Object.values(day.runs).sort((a, b) => a.dueAt - b.dueAt)[index]?.questId
}

// ---------------------------------------------------------------- layouts

const W = 576

function topBoxes(m: MusicView, lyricLine: boolean): TextBox[] {
  // Like DisplayPlus: the current lyric sits under the song when available.
  const second = lyricLine && m.lyric ? fit(`  ${m.lyric}`, W - 4) : musicBar(m)
  return [
    { id: 1, name: 'music', x: 0, y: 0, w: W, h: 34, text: musicLine(m) },
    { id: 2, name: 'mbar', x: 0, y: 30, w: W, h: 30, text: second, dim: 2 },
  ]
}

/** Music page: album art on the left, lyrics (or track info) on the right. */
export const ART = { x: 8, y: 72, size: 128 }
const LYR_X = ART.x + ART.size + 12
const LYR_W = W - LYR_X
const LYR_INNER = LYR_W - 2 * 4

function musicPanel(m: MusicView): string {
  const lines: string[] = []
  if (!m.connected) {
    return clampLines('Set up Spotify in HQ on your phone (Spotify section).', 5, LYR_INNER)
  }
  if (!m.title) return 'Start something in Spotify.'
  if (m.lyric !== undefined && m.lyricNext) {
    // Current line in brackets, next lines indented (DisplayPlus style).
    const cur = clampLines(`[ ${m.lyric || '...'} ]`, 2, LYR_INNER)
    lines.push(cur)
    let used = cur.split('\n').length + measureTextWrap(cur, LYR_INNER).lineCount - 1
    for (const next of m.lyricNext) {
      if (used >= 5) break
      const l = clampLines(`   ${next}`, 1, LYR_INNER)
      lines.push(l)
      used += 1
    }
    return lines.join('\n')
  }
  lines.push(fit(m.title, LYR_INNER), fit(m.artist, LYR_INNER))
  if (m.album) lines.push(fit(m.album, LYR_INNER))
  lines.push('')
  if (m.upNext) lines.push(fit(`UP NEXT  ${m.upNext}`, LYR_INNER))
  return lines.join('\n')
}

export function buildPage(page: PageKey, s: AppState, m: MusicView, now: number): PageSpec {
  const stats = statsLine(s, now)
  if (page === 'menu') {
    return {
      page,
      texts: [{ id: 1, name: 'music', x: 0, y: 0, w: W, h: 34, text: musicLine(m) }],
      list: { id: 5, name: 'menu', x: 0, y: 40, w: W, h: 248, items: [...MENU_ITEMS] },
    }
  }
  if (page === 'quests') {
    return {
      page,
      texts: [{ id: 1, name: 'music', x: 0, y: 0, w: W, h: 34, text: musicLine(m) }],
      list: { id: 5, name: 'quests', x: 0, y: 40, w: W, h: 248, items: questItems(s, now) },
    }
  }
  let cardText: string
  let hint: string
  if (page === 'music') {
    return {
      page,
      texts: [
        ...topBoxes(m, false),
        { id: 3, name: 'lyrics', x: LYR_X, y: 64, w: LYR_W, h: CARD_H, text: musicPanel(m), pad: 4, capture: true },
        { id: 4, name: 'hint', x: 0, y: 254, w: 380, h: 34, text: fit('tap play/pause · ↑ next · ↓ prev', 376), dim: 2 },
        { id: 6, name: 'stats', x: 392, y: 254, w: 184, h: 34, text: fit(m.device ? `on ${m.device}` : stats, 180), dim: 3 },
      ],
      images: m.connected && m.artUrl ? [{ id: 7, name: 'art', x: ART.x, y: ART.y, w: ART.size, h: ART.size, src: m.artUrl }] : [],
    }
  }
  if (page === 'score') {
    cardText = scoreCard(s, now)
    hint = 'tap back · 2x menu'
  } else {
    const k = kickCard(s, now)
    cardText = k.card
    hint = k.hint
  }
  return {
    page,
    texts: [
      ...topBoxes(m, s.settings.lyricsOnKick),
      {
        id: 3,
        name: 'card',
        x: 0,
        y: 64,
        w: W,
        h: CARD_H,
        text: cardText!,
        border: 1,
        borderColor: 6,
        radius: 6,
        pad: 8,
        capture: true,
      },
      { id: 4, name: 'hint', x: 0, y: 254, w: 380, h: 34, text: fit(hint, 376), dim: 2 },
      { id: 6, name: 'stats', x: 392, y: 254, w: 184, h: 34, text: fit(stats, 180), dim: 3 },
    ],
  }
}

/** Structure signature: rebuild the page only when this changes. */
export function structureKey(p: PageSpec): string {
  const t = [
    ...p.texts.map(b => `${b.id}:${b.x},${b.y},${b.w},${b.h}`),
    ...(p.images ?? []).map(b => `i${b.id}:${b.x},${b.y},${b.w},${b.h}`),
  ].join('|')
  const l = p.list ? `L${p.list.id}:${p.list.items.join('\u0001')}` : ''
  return `${p.page}#${t}#${l}`
}
