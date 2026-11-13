import type { AppState, Quest, Settings } from './types'

export function uid(len = 8): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  const buf = new Uint8Array(len)
  globalThis.crypto.getRandomValues(buf)
  for (const b of buf) out += chars[b % chars.length]
  return out
}

export function defaultSettings(): Settings {
  return {
    userName: 'Nicolov',
    persona: 'hype',
    daysOff: [6], // Saturday
    trapMinutes: 5,
    escalateEveryMin: 10,
    finalAfterMin: 30,
    checkinEveryMin: 20,
    checkinGraceMin: 5,
    morningTime: '08:00',
    scoreboardTime: '22:00',
    ntfyServer: 'https://ntfy.sh',
    ntfyTopic: `hq-${uid(12)}`,
    ntfyEnabled: true,
    notifyWhenOpen: false,
    lyricsOnKick: true,
    planUrl: 'https://raw.githubusercontent.com/N1colov/hq/main/plan/plan.json',
    planKey: '',
    doomscrollEnabled: true,
    doomscrollMinutes: 15,
    nodEnabled: false,
    spotifyClientId: '',
  }
}

/** Daily "be a better person" habits. The AI planner replaces these on days it plans. */
export function sampleQuests(): Quest[] {
  return [
    {
      id: uid(),
      title: 'Train (gym / tri)',
      step: 'Put your gym clothes on',
      time: '16:30',
      minutes: 60,
      days: [1, 2, 4, 5],
      category: 'growth',
      active: true,
    },
    {
      id: uid(),
      title: 'Internship apps',
      step: 'Open Handshake and pick one posting',
      time: '13:00',
      minutes: 30,
      days: [1, 3, 5],
      category: 'growth',
      note: 'Goal: 2 applications',
      active: true,
    },
    {
      id: uid(),
      title: 'Exam prep',
      step: 'Do one practice problem from your weakest topic',
      time: '19:00',
      minutes: 60,
      days: [0, 1, 2, 3, 4],
      category: 'growth',
      active: true,
    },
    {
      id: uid(),
      title: 'MechE topic of the day',
      step: 'Learn one core idea',
      time: '21:00',
      minutes: 30,
      days: [0, 1, 2, 3, 4, 5],
      category: 'growth',
      rotate: 'meche',
      active: true,
    },
  ]
}

/** v1 placeholder quests (title + original step), removed on upgrade if untouched. */
const OLD_SAMPLES = new Set([
  'Z2 run|Put your running shoes on',
  'Statics review|Open your notes to the last lecture',
  'Thermo HW|Open the PDF and read problem 1',
])

export function defaultState(): AppState {
  return {
    version: 1,
    savedAt: 0,
    quests: sampleQuests(),
    settings: defaultSettings(),
    profile: { xp: 0, streak: 0, bestStreak: 0, totalKOs: 0 },
    days: {},
    spotify: {},
    plan: { briefs: {}, dates: [] },
  }
}

/** Merge a loaded (possibly older) state over defaults so new fields always exist. */
export function hydrate(raw: unknown): AppState {
  const base = defaultState()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<AppState>
  let quests = Array.isArray(r.quests) ? r.quests : base.quests
  // v1 shipped with placeholder quests: drop the untouched ones, add the growth habits once.
  const hadOld = quests.some(q => OLD_SAMPLES.has(`${q.title}|${q.step}`))
  if (hadOld) {
    quests = quests.filter(q => !OLD_SAMPLES.has(`${q.title}|${q.step}`))
    if (!quests.some(q => q.category === 'growth')) quests = [...base.quests, ...quests]
  }
  const settings = { ...base.settings, ...(r.settings ?? {}) } as Record<string, unknown>
  for (const k of ['buddyName', 'buddyTopic', 'buddyAfterMin']) delete settings[k]
  return {
    ...base,
    ...r,
    version: 1,
    quests,
    settings: settings as unknown as AppState['settings'],
    profile: { ...base.profile, ...(r.profile ?? {}) },
    days: r.days && typeof r.days === 'object' ? r.days : {},
    spotify: r.spotify && typeof r.spotify === 'object' ? r.spotify : {},
    plan: { ...base.plan, ...(r.plan ?? {}) },
  }
}
