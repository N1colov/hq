// Spotify Web API: PKCE login (no client secret), now-playing polling, controls.
// Requires Spotify Premium (both for the developer app owner and for playback control).
import type { SpotifyAuth } from './types'
import type { MusicView } from './view'

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing'
const API = 'https://api.spotify.com/v1'
const VERIFIER_KEY = 'hq-spotify-verifier'
const STATE_KEY = 'hq-spotify-state'

export interface SpotifyHost {
  getClientId(): string
  getAuth(): SpotifyAuth
  setAuth(a: SpotifyAuth): void
  /** Persist a value across the Spotify redirect (bridge storage + browser storage). */
  stash(key: string, value: string): Promise<void>
  unstash(key: string): Promise<string>
}

export function redirectUri(): string {
  return `${location.origin}${location.pathname}`
}

function rand(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => chars[b % chars.length]).join('')
}

async function challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function beginLogin(host: SpotifyHost): Promise<void> {
  const clientId = host.getClientId().trim()
  if (!clientId) throw new Error('Add your Spotify Client ID first')
  const verifier = rand(64)
  const state = rand(16)
  try {
    sessionStorage.setItem(VERIFIER_KEY, verifier)
    sessionStorage.setItem(STATE_KEY, state)
  } catch {
    /* ignore */
  }
  await host.stash(VERIFIER_KEY, verifier)
  await host.stash(STATE_KEY, state)
  const url = new URL('https://accounts.spotify.com/authorize')
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challenge(verifier),
    state,
  }).toString()
  location.href = url.toString()
}

/** Call on startup: if we just came back from Spotify, trade the code for tokens. */
export async function completeLoginIfReturning(host: SpotifyHost): Promise<'ok' | 'none' | string> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const err = params.get('error')
  if (!code && !err) return 'none'
  history.replaceState({}, document.title, location.pathname)
  if (err) return `Spotify said: ${err}`
  const read = async (k: string) => {
    try {
      const v = sessionStorage.getItem(k)
      if (v) return v
    } catch {
      /* ignore */
    }
    return host.unstash(k)
  }
  const verifier = await read(VERIFIER_KEY)
  const state = await read(STATE_KEY)
  if (state && params.get('state') !== state) return 'Login state mismatch, try again'
  if (!verifier) return 'Lost the login verifier, try again'
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code ?? '',
      redirect_uri: redirectUri(),
      client_id: host.getClientId().trim(),
      code_verifier: verifier,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) return `Token exchange failed (${data.error_description ?? res.status})`
  host.setAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  })
  return 'ok'
}

async function refresh(host: SpotifyHost): Promise<boolean> {
  const a = host.getAuth()
  if (!a.refreshToken) return false
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: a.refreshToken,
      client_id: host.getClientId().trim(),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') host.setAuth({})
    return false
  }
  host.setAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? a.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  })
  return true
}

export class Spotify {
  view: MusicView = {
    connected: false,
    hasClientId: false,
    playing: false,
    title: '',
    artist: '',
    progressMs: 0,
    durationMs: 0,
    device: '',
    upNext: '',
  }
  /** Testing aid: fake now-playing data, no network. */
  mock = false
  private fetchedAt = 0
  private backoffUntil = 0
  private lastTrackId = ''

  constructor(private host: SpotifyHost) {
    this.syncFlags()
  }

  syncFlags(): void {
    this.view.hasClientId = !!this.host.getClientId().trim()
    this.view.connected = !!this.host.getAuth().refreshToken
  }

  /** Progress interpolated between polls so the clock ticks smoothly. */
  live(now = Date.now()): MusicView {
    const v = { ...this.view }
    if (v.playing && this.fetchedAt) v.progressMs = Math.min(v.durationMs, v.progressMs + (now - this.fetchedAt))
    return v
  }

  private async req(method: string, path: string, retry = true): Promise<Response | null> {
    if (Date.now() < this.backoffUntil) return null
    let a = this.host.getAuth()
    if (!a.refreshToken) return null
    if (!a.accessToken || !a.expiresAt || Date.now() > a.expiresAt) {
      if (!(await refresh(this.host))) return null
      a = this.host.getAuth()
    }
    const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${a.accessToken}` } })
    if (res.status === 401 && retry) {
      if (await refresh(this.host)) return this.req(method, path, false)
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After') ?? 5)
      this.backoffUntil = Date.now() + wait * 1000
    }
    return res
  }

  mockPlay(title: string, artist: string, durationMs: number, upNext: string): void {
    this.mock = true
    Object.assign(this.view, { connected: true, hasClientId: true, playing: true, title, artist, durationMs, progressMs: 41_000, device: 'iPhone', upNext })
    this.fetchedAt = Date.now()
  }

  async poll(): Promise<void> {
    if (this.mock) return
    this.syncFlags()
    if (!this.view.connected) return
    try {
      const res = await this.req('GET', '/me/player?additional_types=episode')
      if (!res) return
      if (res.status === 204) {
        Object.assign(this.view, { playing: false, title: '', artist: '', progressMs: 0, durationMs: 0, device: '', error: undefined })
        this.fetchedAt = Date.now()
        return
      }
      if (res.status === 403) {
        this.view.error = 'Premium required'
        return
      }
      if (!res.ok) return
      const d = await res.json()
      const item = d.item ?? {}
      const artist = (item.artists ?? []).map((x: { name: string }) => x.name).join(', ') || item.show?.name || ''
      Object.assign(this.view, {
        playing: !!d.is_playing,
        title: item.name ?? '',
        artist,
        progressMs: d.progress_ms ?? 0,
        durationMs: item.duration_ms ?? 0,
        device: d.device?.name ?? '',
        error: undefined,
      })
      this.fetchedAt = Date.now()
      if (item.id && item.id !== this.lastTrackId) {
        this.lastTrackId = item.id
        void this.pollQueue()
      }
    } catch (e) {
      console.warn('[hq] spotify poll failed', e)
    }
  }

  private async pollQueue(): Promise<void> {
    try {
      const res = await this.req('GET', '/me/player/queue')
      if (!res?.ok) return
      const d = await res.json()
      const n = d.queue?.[0]
      this.view.upNext = n ? `${n.name} - ${(n.artists ?? []).map((x: { name: string }) => x.name).join(', ') || n.show?.name || ''}` : ''
    } catch {
      this.view.upNext = ''
    }
  }

  async togglePlay(): Promise<void> {
    const wasPlaying = this.view.playing
    this.view.progressMs = this.live().progressMs
    this.view.playing = !wasPlaying // optimistic
    this.fetchedAt = Date.now()
    if (this.mock) return
    await this.req('PUT', wasPlaying ? '/me/player/pause' : '/me/player/play')
    setTimeout(() => void this.poll(), 600)
  }

  async next(): Promise<void> {
    await this.req('POST', '/me/player/next')
    setTimeout(() => void this.poll(), 600)
  }

  async previous(): Promise<void> {
    await this.req('POST', '/me/player/previous')
    setTimeout(() => void this.poll(), 600)
  }

  disconnect(): void {
    this.host.setAuth({})
    this.syncFlags()
  }
}
