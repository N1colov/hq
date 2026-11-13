// Layout checks: every card must fit the glasses card without wrapping past its lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext'
import { defaultState } from '../src/defaults'
import { act, tick, today } from '../src/engine'
import { buildPage, musicLine, type MusicView } from '../src/view'
import type { AppState } from '../src/types'

const at = (h: number, m = 0, sec = 0) => new Date(2026, 10, 11, h, m, sec).getTime()
const music: MusicView = {
  trackId: 't1', album: 'A Fairly Long Album Name, Deluxe Edition', artUrl: 'https://i.scdn.co/x',
  lyric: 'a long placeholder lyric line that should wrap across the narrow lyrics panel',
  lyricNext: ['placeholder next line one', 'placeholder next line two that is a bit longer than the rest', 'placeholder three'],
  connected: true, hasClientId: true, playing: true,
  title: 'A Really Long Song Title That Keeps Going (Extended Remix)', artist: 'Some Artist feat. Another Artist',
  progressMs: 61_000, durationMs: 245_000, device: 'iPhone', upNext: 'Stressed Out - twenty one pilots',
}

function fresh(): AppState {
  const s = defaultState()
  s.quests = [{ id: 'q', title: 'Thermodynamics homework set eleven', step: 'Open the PDF and read problem 1 out loud to yourself slowly', time: '19:00', minutes: 60, days: [0, 1, 2, 3, 4], active: true }]
  return s
}

function assertFits(s: AppState, now: number, label: string) {
  for (const page of ['kick', 'music', 'score'] as const) {
    const spec = buildPage(page, s, music, now)
    const card = spec.texts.find(t => t.capture)!
    const inner = card.w - 2 * ((card.pad ?? 0) + (card.border ?? 0))
    const maxLines = Math.floor((card.h - 2 * ((card.pad ?? 0) + (card.border ?? 0))) / 27)
    const lines = card.text.split('\n').reduce((n, l) => n + (l ? measureTextWrap(l, inner).lineCount : 1), 0)
    assert.ok(lines <= maxLines, `${label}/${page}: ${lines} lines > ${maxLines}\n${card.text}`)
    for (const t of spec.texts.filter(t => !t.capture)) {
      assert.ok(getTextWidth(t.text) <= t.w, `${label}/${page}/${t.name} too wide: ${getTextWidth(t.text)} > ${t.w}: ${t.text}`)
    }
  }
}

test('music line keeps the DisplayPlus shape and fits one line', () => {
  const l = musicLine(music)
  assert.match(l, /\( 1:01 - 4:05 \)$/)
  assert.ok(getTextWidth(l) <= 576)
})

test('music page without lyrics also fits', () => {
  const s = fresh()
  const { lyric, lyricNext, ...noLyrics } = music
  void lyric; void lyricNext
  const spec = buildPage('music', s, noLyrics, at(12))
  assert.equal(spec.images?.length, 1, 'album art box present')
  const panel = spec.texts.find(t => t.capture)!
  assert.ok(panel.text.includes('UP NEXT'))
})

test('every Kick state fits the card', () => {
  const s = fresh()
  assertFits(s, at(9), 'lockin')
  act(s, at(9), { type: 'lockin' })
  assertFits(s, at(18), 'waiting')
  for (const m of [0, 10, 20, 30, 45]) { tick(s, at(19, m)); assertFits(s, at(19, m), `due+${m}`) }
  act(s, at(19, 46), { type: 'snooze' }); assertFits(s, at(19, 46), 'snoozed')
  act(s, at(19, 50), { type: 'primary' }); assertFits(s, at(19, 50), 'trap')
  tick(s, at(19, 55)); assertFits(s, at(19, 55), 'focus')
  tick(s, at(20, 15)); assertFits(s, at(20, 15), 'checkin')
  act(s, at(20, 16), { type: 'primary' }); assertFits(s, at(20, 16), 'combo')
  act(s, at(20, 30), { type: 'done' }); assertFits(s, at(20, 30), 'ko')
  assert.equal(today(s, at(20, 30)).runs.q.status, 'done')
})
