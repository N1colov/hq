// Daily plan from the AI planner (reads Notion every morning).
// The planner commits an AES-256-GCM encrypted plan.json to the repo; HQ
// fetches it, decrypts it with the key from settings and merges the quests.
import { dateKey, today } from './engine'
import type { AppState, Quest, QuestCategory } from './types'

export interface PlanQuest {
  title: string
  step: string
  time: string
  minutes: number
  kind?: QuestCategory
  note?: string
  /** 3-6 sub-steps; the first is the tiny first step. */
  checklist?: string[]
}

export interface PlanDay {
  brief?: string
  /** Shown with the evening scoreboard: a heads-up about tomorrow. */
  tomorrow?: string
  quests: PlanQuest[]
}

export interface PlanFile {
  v: 1
  generatedAt: string
  days: Record<string, PlanDay>
}

interface Envelope {
  v: 1
  alg: 'A256GCM'
  iv: string
  ct: string
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const bin = atob(b64)
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

export async function decryptPlan(envelope: Envelope, keyB64: string): Promise<PlanFile> {
  const raw = b64urlToBytes(keyB64.trim())
  if (raw.length !== 32) throw new Error('Plan key should be 32 bytes (base64url)')
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['decrypt'])
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlToBytes(envelope.iv) as BufferSource },
    key,
    b64urlToBytes(envelope.ct) as BufferSource,
  )
  const plan = JSON.parse(new TextDecoder().decode(pt)) as PlanFile
  if (!plan || plan.v !== 1 || typeof plan.days !== 'object') throw new Error('Unexpected plan format')
  return plan
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Merge the plan into state. Plan quests become one-off quests for their date.
 * Anything already started or finished is left alone; unstarted plan quests are
 * replaced by the new version. Returns the number of quests added.
 */
export function mergePlan(s: AppState, plan: PlanFile, now: number): number {
  const todayKey = dateKey(now)
  const day = today(s, now)
  const dates = Object.keys(plan.days)
    .filter(d => d >= todayKey)
    .sort()
    .slice(0, 4)
  let added = 0
  for (const d of dates) {
    const pd = plan.days[d]
    if (!pd || !Array.isArray(pd.quests)) continue
    const runs = d === todayKey ? day.runs : {}
    const started = (id: string) => {
      const r = runs[id]
      return !!r && r.status !== 'waiting' && !(r.status === 'due' && r.level === 0)
    }
    // Drop the previous unstarted plan quests for this date.
    s.quests = s.quests.filter(q => !(q.source === 'plan' && q.once === d && !started(q.id)))
    const manualTitles = new Set(
      s.quests.filter(q => q.source !== 'plan' && q.category !== 'growth').map(q => norm(q.title)),
    )
    for (const pq of pd.quests.slice(0, 12)) {
      if (!pq?.title || !/^\d{1,2}:\d{2}$/.test(pq.time ?? '')) continue
      if (manualTitles.has(norm(pq.title))) continue
      const id = `plan-${d}-${slug(pq.title)}`
      if (s.quests.some(q => q.id === id)) continue // kept because it's in progress
      const q: Quest = {
        id,
        title: pq.title.slice(0, 40),
        step: (pq.step || 'Just start').slice(0, 80),
        time: pq.time.padStart(5, '0'),
        minutes: Math.max(5, Math.min(240, Math.round(pq.minutes || 30))),
        days: [],
        once: d,
        category: pq.kind ?? 'task',
        source: 'plan',
        note: pq.note?.slice(0, 40),
        checklist: Array.isArray(pq.checklist)
          ? pq.checklist.filter(x => typeof x === 'string' && x.trim()).map(x => x.slice(0, 48)).slice(0, 6)
          : undefined,
        active: true,
      }
      s.quests.push(q)
      added++
    }
    if (pd.brief) s.plan.briefs[d] = pd.brief.slice(0, 160)
    if (pd.tomorrow) s.plan.briefs[`${d}:tomorrow`] = pd.tomorrow.slice(0, 160)
  }
  // Remember which days are planned (growth habits are replaced on those days).
  const keep = new Set([...s.plan.dates.filter(d => d >= todayKey), ...dates])
  s.plan.dates = [...keep].sort()
  for (const k of Object.keys(s.plan.briefs)) if (k.slice(0, 10) < todayKey) delete s.plan.briefs[k]
  // Old plan quests from past days are just clutter.
  s.quests = s.quests.filter(q => !(q.source === 'plan' && q.once && q.once < todayKey))
  s.plan.generatedAt = plan.generatedAt
  return added
}

export async function syncPlan(s: AppState, now = Date.now()): Promise<string> {
  const st = s.settings
  if (!st.planKey.trim()) return 'Add your plan key to turn on Notion sync'
  try {
    const res = await fetch(`${st.planUrl}?t=${Math.floor(now / 60_000)}`, { cache: 'no-store' })
    if (res.status === 404) return 'No plan published yet'
    if (!res.ok) return `Plan fetch failed (${res.status})`
    const env = (await res.json()) as Envelope
    const plan = await decryptPlan(env, st.planKey)
    const added = mergePlan(s, plan, now)
    s.plan.syncedAt = now
    s.plan.error = undefined
    return `Synced: ${added} quest${added === 1 ? '' : 's'} from your plan`
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    s.plan.error = /operation|decrypt/i.test(msg) ? 'Wrong plan key' : msg
    return s.plan.error
  }
}
