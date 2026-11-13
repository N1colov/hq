// Coach personas. Lines are kept short so they fit the HUD card, and only use
// glyphs the G2 firmware font can render (no emoji).
import type { Persona } from './types'

export type LineKey =
  | 'due'
  | 'step'
  | 'spicy'
  | 'final'
  | 'snooze'
  | 'trapStart'
  | 'trapDone'
  | 'checkin'
  | 'paused'
  | 'ko'
  | 'doom'
  | 'lockin'
  | 'allclear'
  | 'buddy'

type Lines = Record<LineKey, string[]>

const hype: Lines = {
  due: [
    '{t} time. Just {k} minutes. Tap and we roll.',
    'Clock says {t}. You only owe it {k} min.',
    '{t} is up. Tiny start, big W. Tap.',
  ],
  step: [
    "Smallest move: {s}. That's it.",
    "Don't do {t}. Just: {s}.",
    'Step one only: {s}. Go.',
  ],
  spicy: [
    '{m} min on the bench. Get in the game.',
    "{t} has been waiting {m} min. Let's cook.",
    "You're better than this scroll. {t}. Now.",
  ],
  final: [
    'Last call before {b} hears about this.',
    '{m} min. One tap and nobody has to know.',
  ],
  snooze: ["Ten minutes. I'm coming back.", 'Fine. 10 min. Boss gets stronger though.'],
  trapStart: ['Trap set. {k} minutes. Go go go.', "{k} min on the clock. You're moving."],
  trapDone: ["{k} min down. Momentum is real. Keep going?"],
  checkin: ['Still locked in? Tap if yes.'],
  paused: ['Lost you there. Tap to jump back in.'],
  ko: ['K.O.! {t} is done. +{x} XP', "{t} destroyed. +{x} XP. Who's next?"],
  doom: ['{m} min looking down. {t} is still waiting.', 'Phone down. {t} up.'],
  lockin: ["Locked in. Let's get it."],
  allclear: ['All clear. Go live a little.'],
  buddy: ['{n} has been dodging {t} for {m} min. Hype them up.'],
}

const drill: Lines = {
  due: ['{t}. Now. {k} minutes, recruit.', 'Time for {t}. Move.'],
  step: ['You will {s}. That is the entire order.', 'Objective: {s}. Nothing else.'],
  spicy: [
    '{m} minutes of nothing. Unacceptable.',
    '{t} is still standing. Fix that.',
    'Did I say scroll? I said {t}.',
  ],
  final: ['Final warning. {b} gets the report next.', '{m} minutes AWOL. Last chance.'],
  snooze: ['Ten minutes. Then no more excuses.', 'Granted. Boss levels up. Your call.'],
  trapStart: ["Clock's running. {k} minutes. Execute."],
  trapDone: ["{k} down. Don't you dare stop now."],
  checkin: ['Status report. Tap if still working.'],
  paused: ['You went quiet. Tap and get back in line.'],
  ko: ['Target down. {t} complete. +{x} XP'],
  doom: ['Eyes up, recruit. {m} min on the phone.'],
  lockin: ['Orders received. Execute.'],
  allclear: ['At ease. Nothing left today.'],
  buddy: ['{n} has gone AWOL on {t} for {m} min. Report in.'],
}

const robot: Lines = {
  due: [
    'Scheduled task: {t}. Estimated pain: minimal.',
    "{t} is due. I've lowered expectations to {k} minutes.",
  ],
  step: [
    'Required action: {s}. Even you can do that.',
    'Breaking it down further: {s}. Proceed.',
  ],
  spicy: [
    '{m} minutes idle. Logging this for science.',
    'Fascinating. {t} remains undone after {m} minutes.',
    'I calculated your odds of starting. Prove me wrong.',
  ],
  final: [
    'Notifying {b} shortly. I am sure they will be thrilled.',
    "I'll let {b} know you are 'resting'.",
  ],
  snooze: ['Snooze accepted. Disappointment recorded.', '10 minutes granted. The boss thanks you.'],
  trapStart: ['{k} minute test initiated. Try not to fail.'],
  trapDone: ["{k} minutes complete. Statistically, you'll keep going."],
  checkin: ['Confirm you are still a functioning human. Tap.'],
  paused: ['Activity not detected. Focus paused. Tap to resume.'],
  ko: ['Task terminated. +{x} XP. Mildly impressive.'],
  doom: ['Detected {m} minutes of downward gaze. Phone, I presume.'],
  lockin: ['Commitment logged. I will remember this.'],
  allclear: ['No tasks remain. Enjoy your unsupervised time.'],
  buddy: ['{n} has avoided {t} for {m} min. Intervention suggested.'],
}

const PERSONAS: Record<Persona, Lines> = { hype, drill, robot }

export const PERSONA_LABELS: Record<Persona, string> = {
  hype: 'Hype man',
  drill: 'Drill sergeant',
  robot: 'Disappointed robot',
}

export interface LineVars {
  t?: string
  s?: string
  m?: number
  b?: string
  x?: number
  n?: string
  /** trap minutes */
  k?: number
}

/** Pick a line. `seed` keeps the choice stable for a given nudge (no flicker on re-render). */
export function line(persona: Persona, key: LineKey, vars: LineVars, seed = 0): string {
  const pool = PERSONAS[persona]?.[key] ?? hype[key]
  const raw = pool[Math.abs(seed) % pool.length]
  return raw
    .replace(/\{t\}/g, vars.t ?? 'it')
    .replace(/\{s\}/g, lowerFirst(vars.s ?? 'start'))
    .replace(/\{m\}/g, String(vars.m ?? 0))
    .replace(/\{b\}/g, vars.b || 'your buddy')
    .replace(/\{x\}/g, String(vars.x ?? 0))
    .replace(/\{n\}/g, vars.n || 'Your friend')
    .replace(/\{k\}/g, String(vars.k ?? 5))
}

function lowerFirst(s: string): string {
  if (!s) return s
  // Keep acronyms ("PDF") intact, only lower a normal capitalised first word.
  if (s.length > 1 && s[1] === s[1].toUpperCase() && /[A-Z]/.test(s[1])) return s
  return s[0].toLowerCase() + s.slice(1)
}
