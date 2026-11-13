// Plan pipeline: Python-encrypted plan decrypts in HQ and merges correctly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultState } from '../src/defaults'
import { act, questsForDay, tick, today, questLabel } from '../src/engine'
import { decryptPlan, mergePlan, type PlanFile } from '../src/plan'
import { lineIndex, parseLrc } from '../src/lyrics'

const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7)).toString('base64url')
const at = (h: number, m = 0, d = 13) => new Date(2026, 10, d, h, m).getTime()

const plan: PlanFile = {
  v: 1,
  generatedAt: '2026-11-13T06:48:00-05:00',
  days: {
    '2026-11-13': {
      brief: 'Exam Monday. Knock out the HW, then E&M.',
      quests: [
        { title: 'ME270 HW', step: 'Open Gradescope, read problem 1', time: '16:00', minutes: 60, kind: 'deadline', note: 'Due today' },
        { title: 'PHYS 272 exam prep', step: 'Do one Gauss law problem', time: '19:30', minutes: 90, kind: 'exam', note: 'Exam Mon 11/16' },
        { title: 'MechE: GD&T basics', step: 'Learn what MMC means', time: '21:30', minutes: 25, kind: 'growth' },
      ],
    },
    '2026-11-14': { brief: 'Day off. Go see your friends.', quests: [] },
  },
}

test('python-encrypted plan decrypts in HQ', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hqplan-'))
  mkdirSync(join(dir, 'tools'))
  copyFileSync('tools/publish_plan.py', join(dir, 'tools', 'publish_plan.py'))
  writeFileSync(join(dir, 'in.json'), JSON.stringify(plan))
  execFileSync('python3', [join(dir, 'tools', 'publish_plan.py'), join(dir, 'in.json')], { env: { ...process.env, HQ_PLAN_KEY: KEY } })
  const env = JSON.parse(readFileSync(join(dir, 'plan', 'plan.json'), 'utf8'))
  assert.equal(env.alg, 'A256GCM')
  assert.ok(!JSON.stringify(env).includes('PHYS'), 'ciphertext only')
  const out = await decryptPlan(env, KEY)
  assert.deepEqual(out, plan)
  await assert.rejects(decryptPlan(env, Buffer.alloc(32, 1).toString('base64url')))
})

test('publish script rejects a bad plan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hqplan-'))
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ v: 1, generatedAt: 'x', days: { '2026-11-13': { quests: [{ title: 'x', step: 'y', time: '7pm', minutes: 30 }] } } }))
  assert.throws(() => execFileSync('python3', ['tools/publish_plan.py', join(dir, 'bad.json')], { env: { ...process.env, HQ_PLAN_KEY: KEY }, stdio: 'pipe' }))
})

test('plan replaces growth habits on planned days, keeps manual quests', () => {
  const s = defaultState()
  s.quests.push({ id: 'lab', title: 'ECE lab', step: 'Grab the kit', time: '14:00', minutes: 60, days: [5], active: true, category: 'task' })
  const before = questsForDay(s, '2026-11-13').map(q => q.title)
  assert.ok(before.includes('Train (gym / tri)'))
  const n = mergePlan(s, plan, at(7))
  assert.equal(n, 3)
  const after = questsForDay(s, '2026-11-13')
  const titles = after.map(q => q.title)
  assert.ok(titles.includes('ECE lab'), 'manual quest kept')
  assert.ok(titles.includes('PHYS 272 exam prep'))
  assert.ok(!titles.includes('Train (gym / tri)'), 'growth habit replaced by plan')
  assert.equal(s.plan.briefs['2026-11-13'], plan.days['2026-11-13'].brief)
})

test('re-sync replaces unstarted plan quests but keeps one in progress', () => {
  const s = defaultState()
  mergePlan(s, plan, at(7))
  tick(s, at(16, 0))
  act(s, at(16, 1), { type: 'start', questId: 'plan-2026-11-13-me270-hw' })
  const updated: PlanFile = JSON.parse(JSON.stringify(plan))
  updated.days['2026-11-13'].quests[0].time = '17:00'
  updated.days['2026-11-13'].quests[1].time = '20:00'
  mergePlan(s, updated, at(16, 5))
  const q = s.quests.find(x => x.id === 'plan-2026-11-13-me270-hw')!
  assert.equal(q.time, '16:00', 'started quest untouched')
  assert.equal(s.quests.find(x => x.id === 'plan-2026-11-13-phys-272-exam-prep')!.time, '20:00')
  assert.equal(today(s, at(16, 5)).runs['plan-2026-11-13-me270-hw'].status, 'trap')
})

test('meche rotation gives a different topic each day', () => {
  const s = defaultState()
  const q = s.quests.find(x => x.rotate === 'meche')!
  const a = questLabel(q, '2026-11-13').title
  const b = questLabel(q, '2026-11-14').title
  assert.match(a, /^MechE: /)
  assert.notEqual(a, b)
})

test('LRC parsing and line lookup (placeholder text)', () => {
  const lines = parseLrc('[00:01.50] first placeholder\n[00:04.00] second placeholder\n[00:09.25]\n[01:02.3] later placeholder')
  assert.equal(lines.length, 4)
  assert.equal(lines[3].ms, 62_300)
  assert.equal(lineIndex(lines, 0), -1)
  assert.equal(lines[lineIndex(lines, 5000)].text, 'second placeholder')
  assert.equal(lineIndex(lines, 120_000), 3)
})

test('upgrade from v1 swaps placeholder quests for growth habits', async () => {
  const { hydrate } = await import('../src/defaults')
  const old = {
    quests: [
      { id: 'a', title: 'Z2 run', step: 'Put your running shoes on', time: '07:30', minutes: 45, days: [1], active: true },
      { id: 'b', title: 'Thermo HW', step: 'Open the PDF and read problem 1', time: '19:00', minutes: 60, days: [1], active: true },
      { id: 'demo', title: 'Test boss', step: 'Tap', time: '15:00', minutes: 10, days: [], once: '2026-11-13', active: true },
    ],
    settings: { buddyTopic: 'x', persona: 'drill' },
  }
  const s = hydrate(old)
  const titles = s.quests.map(q => q.title)
  assert.ok(!titles.includes('Z2 run') && !titles.includes('Thermo HW'))
  assert.ok(titles.includes('Test boss'))
  assert.ok(s.quests.some(q => q.rotate === 'meche'))
  assert.equal(s.settings.persona, 'drill')
  assert.ok(!('buddyTopic' in s.settings))
})
