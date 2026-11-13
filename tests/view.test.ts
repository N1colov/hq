// Layout checks: every card must fit the glasses card without wrapping past its lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext'
import { defaultState } from '../src/defaults'
import { act, tick, today } from '../src/engine'
import { buildPage, CARD_LINES, CARD_W, musicLine, type MusicView } from '../src/view'
import type { AppState } from '../src/types'

const at = (h: number, m = 0, sec = 0) => new Date(2026, 10, 11, h, m, sec).getTime()
const music: MusicView = {
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
    const card = spec.texts.find(t => t.name === 'card')!
    const lines = card.text.split('\n').reduce((n, l) => n + (l ? measureTextWrap(l, CARD_W).lineCount : 1), 0)
    assert.ok(lines <= CARD_LINES, `${label}/${page}: ${lines} lines > ${CARD_LINES}\n${card.text}`)
    for (const t of spec.texts.filter(t => t.name !== 'card')) {
      assert.ok(getTextWidth(t.text) <= t.w, `${label}/${page}/${t.name} too wide: ${getTextWidth(t.text)} > ${t.w}: ${t.text}`)
    }
  }
}

test('music line keeps the DisplayPlus shape and fits one line', () => {
  const l = musicLine(music)
  assert.match(l, /\( 1:01 - 4:05 \)$/)
  assert.ok(getTextWidth(l) <= 576)
})

test('every Kick state fits the card', () => {
  const s = fresh()
  s.settings.buddyTopic = 't'; s.settings.buddyName = 'Noah'
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
