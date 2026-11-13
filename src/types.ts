// Core data types for HQ. Everything here is plain JSON so it can be persisted
// through the Even bridge storage and the background-state snapshot.

export type Persona = 'hype' | 'drill' | 'robot'

export type QuestCategory = 'task' | 'growth' | 'deadline' | 'exam'

export interface Quest {
  id: string
  title: string
  /** growth = daily self-improvement habit; the AI plan replaces these on days it covers. */
  category?: QuestCategory
  /** 'plan' = written by the daily AI planner from Notion. */
  source?: 'manual' | 'plan'
  /** Rotate the title through a topic list (MechE topic of the day). */
  rotate?: 'meche'
  /** Extra context shown under the step (e.g. "Due today", "Exam Mon"). */
  note?: string
  /** The tiniest possible first step, shown when you stall. */
  step: string
  /** Start time, "HH:MM" 24h local. */
  time: string
  /** Length of the block in minutes (boss HP). */
  minutes: number
  /** Weekdays it repeats on, 0 = Sunday ... 6 = Saturday. Empty = one-off. */
  days: number[]
  /** One-off date "YYYY-MM-DD" (used when days is empty). */
  once?: string
  active: boolean
}

export type RunStatus =
  | 'waiting' // not due yet
  | 'due' // due, not started — the nudge ladder is running
  | 'trap' // inside the 5-minute trap
  | 'focus' // locked in after the trap
  | 'done'
  | 'skipped'

export interface QuestRun {
  questId: string
  status: RunStatus
  dueAt: number
  /** Escalation level reached on the nudge ladder (0..3). */
  level: number
  nextNudgeAt: number
  /** Last time a nudge was actually delivered. */
  lastNudgeAt?: number
  trapEndsAt?: number
  trapDone?: boolean
  focusMs: number
  focusStartedAt?: number
  nextCheckinAt?: number
  checkinPendingSince?: number
  combo: number
  dodges: number
  lastDoomAt?: number
  finalWarned?: boolean
  /** Latest coach line for this quest, shown on the card. */
  lastLine?: string
  doneAt?: number
  xp: number
}

export interface DayLog {
  date: string
  lockedIn: boolean
  runs: Record<string, QuestRun>
  xp: number
  scoreboardSent: boolean
  pinnedId?: string
}

export interface Profile {
  xp: number
  streak: number
  bestStreak: number
  /** Last day that was folded into the streak. */
  lastRolled?: string
  totalKOs: number
}

export interface ImuCalibration {
  ahead: [number, number, number]
  down: [number, number, number]
}

export interface Settings {
  userName: string
  persona: Persona
  daysOff: number[]
  trapMinutes: number
  escalateEveryMin: number
  /** Minutes late before the coach's final warning. */
  finalAfterMin: number
  /** 0 disables check-ins during focus. */
  checkinEveryMin: number
  checkinGraceMin: number
  morningTime: string
  scoreboardTime: string
  ntfyServer: string
  ntfyTopic: string
  ntfyEnabled: boolean
  /** Also push to the phone while HQ is open on the glasses. */
  notifyWhenOpen: boolean
  /** Show the current lyric line under the song on the Kick screen. */
  lyricsOnKick: boolean
  /** Encrypted daily plan written by the AI planner. */
  planUrl: string
  /** AES-256-GCM key (base64url) for the plan file. */
  planKey: string
  doomscrollEnabled: boolean
  doomscrollMinutes: number
  nodEnabled: boolean
  imuCal?: ImuCalibration
  spotifyClientId: string
}

export interface SpotifyAuth {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

export interface PlanMeta {
  syncedAt?: number
  generatedAt?: string
  /** Morning briefing per date from the planner. */
  briefs: Record<string, string>
  /** Dates the plan covers (growth habits are replaced on these days). */
  dates: string[]
  error?: string
}

export interface AppState {
  version: 1
  savedAt: number
  quests: Quest[]
  settings: Settings
  profile: Profile
  /** Day logs keyed by date, only the last ~14 days are kept. */
  days: Record<string, DayLog>
  spotify: SpotifyAuth
  plan: PlanMeta
  /** Short message shown on the HUD (coach line, feedback). */
  toast?: { text: string; until: number }
  /** Scoreboard overlay requested by the engine. */
  showScoreboardUntil?: number
}

export type NudgeKind =
  | 'nudge'
  | 'checkin'
  | 'trapdone'
  | 'scoreboard'
  | 'doomscroll'
  | 'paused'

export interface Nudge {
  kind: NudgeKind
  questId?: string
  title: string
  text: string
  /** ntfy priority 1..5 */
  priority: number
}
