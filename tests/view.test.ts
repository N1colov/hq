// Layout checks: every screen fits the glasses, and buttons map to the right actions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext'
import { defaultState } from '../src/defaults'
import { act, tick } from '../src/engine'
import { buildPage, musicLine, type MusicView, type Nav, type PageSpec } from '../src/view'
import type { AppState } from '../src/types'

const at = (h: number, m = 0, sec = 0) => new Date(2026, 10, 11, h, m, sec).getTime()
// Placeholder text only (no real song data).
const music: MusicView = {
  trackId: 't1', album: 'A Fairly Long Placeholder Album Name, Deluxe Edition', artUrl: 'https://i.scdn.co/x',
  lyric: 'a long placeholder line that should be cut to fit the narrow panel width',
  lyricNext: ['placeholder next line one', 'placeholder next line two that is a bit longer than the rest', 'placeholder three'],
  connected: true, hasClientId: true, playing: true,
  title: 'A Really Long Placeholder Title That Keeps Going (Extended Mix)', artist: 'Placeholder Artist feat. Another One',
  progressMs: 61_000, durationMs: 245_000, device: 'iPhone', upNext: 'Another Placeholder - Someone',
}

function fresh(): AppState {
  const s = defaultState()
  s.quests = [
    {
      id: 'q', title: 'Thermodynamics homework set eleven', step: 'Open the PDF and read problem 1 out loud slowly',
      checklist: ['Open the PDF', 'Write the givens for problem 1 and the property tables you need', 'Solve 1-3', 'Submit on Gradescope'],
      time: '19:00', minutes: 60, days: [0, 1, 2, 3, 4], active: true,
    },
    ...s.quests,
  ]
  return s
}

function assertFits(spec: PageSpec, label: string) {
  for (const t of spec.texts) {
    const inset = (t.pad ?? 0) + (t.border ?? 0)
    const inner = t.w - 2 * inset
    const maxLines = Math.floor((t.h - 2 * inset) / 27)
    const lines = t.text.split('\n').reduce((n, l) => n + (l ? measureTextWrap(l, inner).lineCount : 1), 0)
    assert.ok(lines <= Math.max(1, maxLines), `${label}/${t.name}: ${lines} lines > ${maxLines}\n${t.text}`)
    for (const l of t.text.split('\n')) assert.ok(getTextWidth(l) <= inner + 1, `${label}/${t.name} line too wide: ${l}`)
  }
  if (spec.list) {
    assert.equal(spec.list.items.length, spec.list.actions.length, `${label}: items/actions mismatch`)
    assert.ok(spec.list.items.length >= 1 && spec.list.items.length <= 20)
    for (const it of spec.list.items) assert.ok(it.length <= 63 && getTextWidth(it) <= spec.list.w - 32, `${label}: list item too wide: ${it}`)
  }
  const n = spec.texts.length + (spec.list ? 1 : 0) + (spec.images?.length ?? 0)
  assert.ok(n <= 12 && spec.texts.length + (spec.list ? 1 : 0) <= 8 && (spec.images?.length ?? 0) <= 4, `${label}: too many containers`)
  for (const b of [...spec.texts, ...(spec.images ?? [])]) assert.ok(b.x + b.w <= 576 && b.y + b.h <= 288, `${label}/${b.name} off screen`)
  if (spec.list) assert.ok(spec.list.y + spec.list.h <= 288)
}

function allPages(s: AppState, now: number, label: string) {
  const navs: Nav[] = [{ page: 'splash' }, { page: 'today' }, { page: 'quest', questId: 'q' }, { page: 'confirm', questId: 'q' }, { page: 'music' }, { page: 'score' }]
  for (const nav of navs) assertFits(buildPage(nav, s, music, now), `${label}/${nav.page}`)
}

test('music line keeps the DisplayPlus shape and fits one line', () => {
  const l = musicLine(music)
  assert.match(l, /\( 1:01 - 4:05 \)$/)
  assert.ok(getTextWidth(l) <= 576)
})

test('every screen fits through a full quest lifecycle', () => {
  const s = fresh()
  allPages(s, at(9), 'lockin')
  act(s, at(9), { type: 'lockin' })
  allPages(s, at(18), 'waiting')
  for (const m of [0, 10, 20, 30, 45]) { tick(s, at(19, m)); allPages(s, at(19, m), `due+${m}`) }
  act(s, at(19, 46), { type: 'snooze', questId: 'q' }); allPages(s, at(19, 46), 'snoozed')
  act(s, at(19, 50), { type: 'start', questId: 'q' }); allPages(s, at(19, 50), 'trap')
  tick(s, at(19, 55)); allPages(s, at(19, 55), 'focus')
  tick(s, at(20, 15)); allPages(s, at(20, 15), 'checkin')
  act(s, at(20, 16), { type: 'checkin', questId: 'q' }); allPages(s, at(20, 16), 'combo')
  act(s, at(20, 30), { type: 'done', questId: 'q' }); allPages(s, at(20, 30), 'ko')
})

test('today is a checklist whose buttons open quests; gestures are not actions', () => {
  const s = fresh()
  act(s, at(9), { type: 'lockin' })
  tick(s, at(19, 1))
  const spec = buildPage({ page: 'today' }, s, music, at(19, 1))
  const acts = spec.list!.actions
  assert.deepEqual(acts[0], { t: 'start', questId: 'q' }, 'first button starts the due quest')
  assert.ok(acts.some(a => a.t === 'open' && a.questId === 'q'))
  assert.ok(acts.some(a => a.t === 'music') && acts.some(a => a.t === 'exit'))
  assert.ok(!acts.some(a => a.t === 'done' || a.t === 'skip'), 'nothing destructive on Today')
})

test('quest page: start first, steps tickable, skip needs confirmation, undo after', () => {
  const s = fresh()
  tick(s, at(19, 1))
  let spec = buildPage({ page: 'quest', questId: 'q' }, s, music, at(19, 1))
  assert.equal(spec.list!.actions[0].t, 'start')
  assert.ok(spec.list!.items.some(i => i.startsWith('□ Open the PDF')))
  assert.ok(spec.list!.actions.some(a => a.t === 'askSkip'))
  assert.ok(!spec.list!.actions.some(a => a.t === 'skip'), 'skip only from the confirm page')
  const confirm = buildPage({ page: 'confirm', questId: 'q' }, s, music, at(19, 1))
  assert.equal(confirm.list!.actions[0].t, 'open', 'default button is "No, keep it"')
  // tick all steps -> K.O.
  for (let i = 0; i < 4; i++) act(s, at(19, 2 + i), { type: 'step', questId: 'q', index: i })
  spec = buildPage({ page: 'quest', questId: 'q' }, s, music, at(19, 10))
  assert.ok(spec.texts.find(t => t.name === 'head')!.text.includes('K.O.'))
  assert.ok(spec.list!.actions.some(a => a.t === 'reopen'))
})

test('music page has real buttons and album art', () => {
  const spec = buildPage({ page: 'music' }, fresh(), music, at(12))
  assert.deepEqual(spec.list!.actions.map(a => a.t), ['playPause', 'next', 'prev', 'today'])
  assert.equal(spec.list!.items[0], '|| Pause')
  assert.equal(spec.images?.length, 1)
})
