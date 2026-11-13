// Run with: TZ=America/Indiana/Indianapolis npx tsx --test tests/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultState } from '../src/defaults'
import { act, currentRun, MIN, tick, today, summary, hpFrac, needsLockIn } from '../src/engine'
import type { AppState } from '../src/types'

// Wed 2026-11-11, quests: Thermo HW 19:00 (Sun-Thu, 60m)
const at = (h: number, m = 0, d = 11) => new Date(2026, 10, d, h, m, 0, 0).getTime()

function fresh(): AppState {
  const s = defaultState()
  s.quests = [
    { id: 'thermo', title: 'Thermo HW', step: 'Open the PDF', time: '19:00', minutes: 60, days: [0, 1, 2, 3, 4], active: true },
  ]
  return s
}

test('nudge ladder escalates every 10 min with a final warning at 30', () => {
  const s = fresh()
  assert.equal(tick(s, at(18, 59)).length, 0)
  let n = tick(s, at(19, 0))
  assert.equal(n.length, 1)
  assert.equal(n[0].kind, 'nudge')
  assert.equal(tick(s, at(19, 5)).length, 0, 'no nudge between rungs')
  n = tick(s, at(19, 10))
  assert.match(n[0].text, /open the PDF/i, 'second rung shows the tiny first step')
  n = tick(s, at(19, 20))
  assert.equal(n[0].kind, 'nudge')
  n = tick(s, at(19, 30))
  assert.equal(today(s, at(19, 30)).runs.thermo.finalWarned, true, 'final warning at 30 min late')
  assert.equal(tick(s, at(19, 40)).length, 0, 'ladder slows down after the 4th rung')
  assert.equal(tick(s, at(19, 45)).length, 1)
})

test('snooze pushes the next nudge 10 min out and levels up the boss', () => {
  const s = fresh()
  tick(s, at(19, 0))
  assert.ok(act(s, at(19, 2), { type: 'snooze' }))
  assert.equal(tick(s, at(19, 10)).length, 0)
  assert.equal(tick(s, at(19, 12)).length, 1)
  assert.equal(today(s, at(19, 12)).runs.thermo.dodges, 1)
})

test('5-minute trap rolls into focus, check-ins build combo, unanswered check-in pauses', () => {
  const s = fresh()
  tick(s, at(19, 0))
  act(s, at(19, 1), { type: 'primary' })
  const run = today(s, at(19, 1)).runs.thermo
  assert.equal(run.status, 'trap')
  let n = tick(s, at(19, 6))
  assert.equal(n[0].kind, 'trapdone')
  assert.equal(run.status, 'focus')
  n = tick(s, at(19, 26))
  assert.equal(n[0].kind, 'checkin')
  act(s, at(19, 27), { type: 'primary' })
  assert.equal(run.combo, 2)
  n = tick(s, at(19, 47))
  assert.equal(n[0].kind, 'checkin')
  n = tick(s, at(19, 53))
  assert.equal(n[0].kind, 'paused')
  assert.equal(run.status, 'due')
  // focus counted only up to when we asked (19:01 -> 19:47 = 46 min)
  assert.equal(Math.round(run.focusMs / MIN), 46)
})

test('K.O. awards XP, streak counts, off-day (Saturday) does not break it', () => {
  const s = fresh()
  tick(s, at(19, 0))
  act(s, at(19, 0), { type: 'primary' })
  act(s, at(19, 40), { type: 'done' })
  const run = today(s, at(19, 40)).runs.thermo
  assert.equal(run.status, 'done')
  assert.ok(s.profile.xp > 100, `xp ${s.profile.xp}`)
  assert.equal(summary(s, at(20)).streak, 1)
  // Thu 12: done again
  tick(s, at(19, 0, 12)); act(s, at(19, 0, 12), { type: 'primary' }); act(s, at(19, 30, 12), { type: 'done' })
  // Fri 13: quest not scheduled (days Sun-Thu) -> no change; Sat 14 off day; Sun 15 roll
  tick(s, at(10, 0, 15))
  assert.equal(s.profile.streak, 2)
  // Mon 16 opened, Sun 15 had Thermo but nothing done -> breaks on roll into Tue 17
  tick(s, at(10, 0, 17))
  assert.equal(s.profile.streak, 0)
})

test('boss auto K.O. when focus reaches the block length', () => {
  const s = fresh()
  s.settings.checkinEveryMin = 0
  tick(s, at(19, 0))
  act(s, at(19, 0), { type: 'primary' })
  tick(s, at(19, 30))
  const run = today(s, at(19, 30)).runs.thermo
  assert.ok(hpFrac(s, run, at(19, 30)) > 0.45 && hpFrac(s, run, at(19, 30)) < 0.55)
  tick(s, at(20, 1))
  assert.equal(run.status, 'done')
})

test('stale blocks expire instead of nagging late at night', () => {
  const s = fresh()
  s.quests[0].time = '07:30'
  const n = tick(s, at(23, 0))
  assert.equal(n.filter(x => x.kind === 'nudge').length, 0)
  assert.equal(currentRun(s, at(23, 0)), null)
})

test('doomscroll fires only while dodging and only when calibrated', () => {
  const s = fresh()
  tick(s, at(19, 0))
  let n = tick(s, at(19, 3), { headDownMs: 16 * MIN })
  assert.ok(!n.some(x => x.kind === 'doomscroll'), 'needs calibration')
  s.settings.imuCal = { ahead: [0, 0, 1], down: [0, 1, 0] }
  n = tick(s, at(19, 4), { headDownMs: 16 * MIN })
  assert.ok(n.some(x => x.kind === 'doomscroll'))
  n = tick(s, at(19, 6), { headDownMs: 16 * MIN })
  assert.ok(!n.some(x => x.kind === 'doomscroll'), 'rate limited')
})

test('morning lock-in and scoreboard', () => {
  const s = fresh()
  assert.ok(needsLockIn(s, at(9)))
  act(s, at(9), { type: 'primary' })
  assert.ok(!needsLockIn(s, at(9, 1)))
  assert.equal(s.profile.xp, 20)
  const n = tick(s, at(22, 0))
  assert.ok(n.some(x => x.kind === 'scoreboard'))
  assert.ok(!tick(s, at(22, 5)).some(x => x.kind === 'scoreboard'))
})

test('saturday is off: no nudges', () => {
  const s = fresh()
  s.quests[0].days = [0, 1, 2, 3, 4, 5, 6]
  const n = tick(s, at(19, 0, 14))
  assert.equal(n.length, 0)
})

test('checklist steps start the trap, finishing all of them is a K.O., undo restores', () => {
  const s = fresh()
  s.quests[0].checklist = ['a', 'b', 'c']
  tick(s, at(19, 0))
  act(s, at(19, 1), { type: 'step', questId: 'thermo', index: 0 })
  const run = today(s, at(19, 1)).runs.thermo
  assert.equal(run.status, 'trap', 'ticking a step springs the trap')
  act(s, at(19, 20), { type: 'step', questId: 'thermo', index: 1 })
  act(s, at(19, 30), { type: 'step', questId: 'thermo', index: 2 })
  assert.equal(run.status, 'done')
  const xp = s.profile.xp
  assert.ok(act(s, at(19, 31), { type: 'reopen', questId: 'thermo' }))
  assert.equal(run.status, 'due')
  assert.ok(s.profile.xp < xp, 'K.O. XP taken back')
})

test('skip is reversible', () => {
  const s = fresh()
  tick(s, at(19, 0))
  act(s, at(19, 1), { type: 'skip', questId: 'thermo' })
  assert.equal(today(s, at(19, 1)).runs.thermo.status, 'skipped')
  act(s, at(19, 2), { type: 'reopen', questId: 'thermo' })
  assert.equal(today(s, at(19, 2)).runs.thermo.status, 'due')
})
