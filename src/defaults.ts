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
    buddyAfterMin: 30,
    checkinEveryMin: 20,
    checkinGraceMin: 5,
    morningTime: '08:00',
    scoreboardTime: '22:00',
    ntfyServer: 'https://ntfy.sh',
    ntfyTopic: `hq-${uid(12)}`,
    ntfyEnabled: true,
    notifyWhenOpen: false,
    buddyName: '',
    buddyTopic: '',
    doomscrollEnabled: true,
    doomscrollMinutes: 15,
    nodEnabled: false,
    spotifyClientId: '',
  }
}

export function sampleQuests(): Quest[] {
  return [
    {
      id: uid(),
      title: 'Z2 run',
      step: 'Put your running shoes on',
      time: '07:30',
      minutes: 45,
      days: [1, 3, 5],
      active: true,
    },
    {
      id: uid(),
      title: 'Statics review',
      step: 'Open your notes to the last lecture',
      time: '16:00',
      minutes: 30,
      days: [2, 4],
      active: true,
    },
    {
      id: uid(),
      title: 'Thermo HW',
      step: 'Open the PDF and read problem 1',
      time: '19:00',
      minutes: 60,
      days: [0, 1, 2, 3, 4],
      active: true,
    },
  ]
}

export function defaultState(): AppState {
  return {
    version: 1,
    savedAt: 0,
    quests: sampleQuests(),
    settings: defaultSettings(),
    profile: { xp: 0, streak: 0, bestStreak: 0, totalKOs: 0 },
    days: {},
    spotify: {},
  }
}

/** Merge a loaded (possibly older) state over defaults so new fields always exist. */
export function hydrate(raw: unknown): AppState {
  const base = defaultState()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<AppState>
  return {
    ...base,
    ...r,
    version: 1,
    quests: Array.isArray(r.quests) ? r.quests : base.quests,
    settings: { ...base.settings, ...(r.settings ?? {}) },
    profile: { ...base.profile, ...(r.profile ?? {}) },
    days: r.days && typeof r.days === 'object' ? r.days : {},
    spotify: r.spotify && typeof r.spotify === 'object' ? r.spotify : {},
  }
}
