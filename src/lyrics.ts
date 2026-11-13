// Synced lyrics from LRCLIB (https://lrclib.net), fetched at runtime on the
// phone for whatever is playing. HQ ships no lyrics of its own.

export interface LyricLine {
  ms: number
  text: string
}

export interface Lyrics {
  synced: LyricLine[]
  /** True when only unsynced text exists (we don't scroll those). */
  plainOnly: boolean
}

const cache = new Map<string, Lyrics | null>()
const inflight = new Map<string, Promise<Lyrics | null>>()

/** Parse LRC text ("[01:23.45] line") into timed lines. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0
      out.push({ ms: Number(m[1]) * 60_000 + Number(m[2]) * 1000 + frac, text })
    }
  }
  return out.sort((a, b) => a.ms - b.ms)
}

/** Index of the line being sung at `ms`, or -1 before the first line. */
export function lineIndex(lines: LyricLine[], ms: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].ms <= ms) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export interface TrackRef {
  id: string
  title: string
  artist: string
  album: string
  durationMs: number
}

async function fetchJson(url: string): Promise<any | null> {
  const res = await fetch(url, { headers: { 'Lrclib-Client': 'HQ for Even G2 (https://github.com/N1colov/hq)' } })
  if (!res.ok) return null
  return res.json()
}

async function lookup(t: TrackRef): Promise<Lyrics | null> {
  const firstArtist = t.artist.split(',')[0].trim()
  const qs = new URLSearchParams({
    track_name: t.title,
    artist_name: firstArtist,
    album_name: t.album,
    duration: String(Math.round(t.durationMs / 1000)),
  })
  let hit = await fetchJson(`https://lrclib.net/api/get?${qs}`).catch(() => null)
  if (!hit?.syncedLyrics) {
    const results = await fetchJson(
      `https://lrclib.net/api/search?${new URLSearchParams({ track_name: t.title, artist_name: firstArtist })}`,
    ).catch(() => null)
    if (Array.isArray(results)) {
      const dur = t.durationMs / 1000
      hit =
        results.find((r: any) => r.syncedLyrics && Math.abs((r.duration ?? 0) - dur) < 4) ??
        results.find((r: any) => r.syncedLyrics) ??
        hit
    }
  }
  if (hit?.syncedLyrics) return { synced: parseLrc(hit.syncedLyrics), plainOnly: false }
  if (hit?.plainLyrics) return { synced: [], plainOnly: true }
  return null
}

/** Cached per track; resolves null when nothing is available. */
export function getLyrics(t: TrackRef): Promise<Lyrics | null> {
  if (cache.has(t.id)) return Promise.resolve(cache.get(t.id)!)
  let p = inflight.get(t.id)
  if (!p) {
    p = lookup(t)
      .catch(() => null)
      .then(l => {
        cache.set(t.id, l)
        inflight.delete(t.id)
        return l
      })
    inflight.set(t.id, p)
  }
  return p
}

/** Testing aid: inject lyrics for a track id. */
export function setLyricsForTest(id: string, l: Lyrics | null): void {
  cache.set(id, l)
}
