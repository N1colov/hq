// Phone notifications through ntfy (https://ntfy.sh). The Even app forwards
// phone notifications to the glasses, so this is how HQ reaches you when it
// isn't the app on screen.
import type { Nudge, Settings } from './types'

const TAGS: Record<string, string> = {
  nudge: 'crossed_swords',
  buddy: 'rotating_light',
  checkin: 'eyes',
  trapdone: 'stopwatch',
  scoreboard: 'trophy',
  doomscroll: 'iphone',
  paused: 'pause_button',
}

export async function push(settings: Settings, n: Nudge): Promise<boolean> {
  const topic = (n.toBuddy ? settings.buddyTopic : settings.ntfyTopic).trim()
  if (!topic) return false
  const server = (settings.ntfyServer || 'https://ntfy.sh').replace(/\/+$/, '')
  // Title/tags/priority go in the query string so this stays a "simple" CORS
  // request (no preflight); the body is plain text.
  const qs = new URLSearchParams({
    title: n.title,
    tags: TAGS[n.kind] ?? 'bell',
    priority: String(Math.max(1, Math.min(5, n.priority))),
  })
  const url = `${server}/${encodeURIComponent(topic)}?${qs}`
  try {
    await fetch(url, { method: 'POST', body: n.text, mode: 'no-cors' })
    return true
  } catch (e) {
    console.warn('[hq] ntfy push failed', e)
    return false
  }
}
