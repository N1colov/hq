// HQ entry point: wires state, the Kick engine, Spotify, the IMU, the glasses
// renderer and the phone-side UI together.
import './style.css'
import { ImuReportPace, OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { bridge, call, connect, isReal, storageGet, storageSet } from './bridge'
import { defaultState, hydrate } from './defaults'
import { act, MIN, tick, type Action, currentRun, needsLockIn, today, dateKey, pad } from './engine'
import { invalidate, isStarted, lastSpec, render, setImageSource } from './glasses'
import { artPng, placeholderArt } from './art'
import { getLyrics, lineIndex, setLyricsForTest } from './lyrics'
import { syncPlan } from './plan'
import { ART, type MusicView } from './view'
import { HeadTracker } from './imu'
import { push } from './notify'
import { beginLogin, completeLoginIfReturning, Spotify, type SpotifyHost } from './spotify'
import type { AppState, Nudge } from './types'
import { mountUI, type UIApp } from './ui'
import { buildPage, type ListAction, type Nav } from './view'

const STORE_KEY = 'hq.v1'

let state: AppState = defaultState()
let lastSaved = ''
let nav: Nav = { page: 'splash' }
let foreground = true
let wearing = true
let ui: ReturnType<typeof mountUI> | null = null
const log: string[] = []

function note(msg: string): void {
  const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  log.unshift(`${t}  ${msg}`)
  log.length = Math.min(log.length, 30)
}

// ---------------------------------------------------------------- persistence

async function load(): Promise<void> {
  const raw = await storageGet(STORE_KEY)
  if (raw) {
    try {
      state = hydrate(JSON.parse(raw))
    } catch {
      state = defaultState()
    }
  }
  lastSaved = JSON.stringify(state)
}

async function save(force = false): Promise<void> {
  const json = JSON.stringify(state)
  if (!force && json === lastSaved) return
  state.savedAt = Date.now()
  lastSaved = JSON.stringify(state)
  await storageSet(STORE_KEY, lastSaved)
}

// Host background migration hooks (headless WebView snapshot/restore).
const w = window as unknown as Record<string, unknown>
w.__getStateSnapshot = () => JSON.stringify({ hq: state })
w.__restoreState = (snap: unknown) => {
  try {
    const parsed = typeof snap === 'string' ? JSON.parse(snap) : snap
    const incoming = (parsed as { hq?: AppState })?.hq
    if (incoming && (incoming.savedAt ?? 0) >= (state.savedAt ?? 0)) {
      state = hydrate(incoming)
      head.cal = state.settings.imuCal
      void draw()
    }
  } catch (e) {
    console.warn('[hq] restore failed', e)
  }
}

// ---------------------------------------------------------------- services

const spotifyHost: SpotifyHost = {
  getClientId: () => state.settings.spotifyClientId,
  getAuth: () => state.spotify,
  setAuth: a => {
    state.spotify = a
    void save(true)
  },
  stash: (k, v) => storageSet(`stash.${k}`, v),
  unstash: k => storageGet(`stash.${k}`),
}
const spotify = new Spotify(spotifyHost)

const head = new HeadTracker()
head.onNod = () => {
  if (!state.settings.nodEnabled || (nav.page !== 'today' && nav.page !== 'quest')) return
  const now = Date.now()
  const run = currentRun(state, now)
  const prompt = needsLockIn(state, now) || run?.status === 'due' || !!run?.checkinPendingSince
  if (prompt) doAction({ type: 'primary' }, 'nod')
}

let imuMode = 'off'
async function syncImu(): Promise<void> {
  const st = state.settings
  const want = isReal() && isStarted() && ((st.doomscrollEnabled && !!st.imuCal) || (st.nodEnabled && !!st.imuCal) || calibrating)
  // Fast pace for nods/calibration, slow pace is plenty for doomscroll detection.
  const pace = st.nodEnabled || calibrating ? ImuReportPace.P200 : ImuReportPace.P1000
  const mode = want ? `on:${pace}` : 'off'
  if (mode === imuMode) return
  imuMode = mode
  await call(b => b.imuControl(want, pace), false)
}
let calibrating = false

// ---------------------------------------------------------------- music + lyrics

/** Now-playing view with the current lyric lines filled in. */
function musicNow(now: number): MusicView {
  const m = spotify.live(now)
  if (!m.connected || !m.trackId || !m.title) return m
  const ref = { id: m.trackId, title: m.title, artist: m.artist, album: m.album ?? '', durationMs: m.durationMs }
  const lyrics = lyricCache.get(m.trackId)
  if (lyrics === undefined) {
    void getLyrics(ref).then(l => lyricCache.set(m.trackId!, l))
    return m
  }
  if (!lyrics || !lyrics.synced.length) return m
  const i = lineIndex(lyrics.synced, m.progressMs + 300)
  m.lyric = i >= 0 ? lyrics.synced[i].text : ''
  m.lyricNext = lyrics.synced.slice(i + 1, i + 4).map(l => l.text).filter(Boolean)
  return m
}
const lyricCache = new Map<string, Awaited<ReturnType<typeof getLyrics>>>()

setImageSource(async box => {
  if (box.src === 'placeholder') return placeholderArt(ART.size)
  return artPng(box.src, ART.size)
})

// ---------------------------------------------------------------- render loop

async function draw(): Promise<void> {
  const now = Date.now()
  const spec = buildPage(nav, state, musicNow(now), now)
  ui?.preview(spec)
  if (foreground) await render(spec)
}

function deliver(nudges: Nudge[]): void {
  for (const n of nudges) {
    note(`${n.kind}: ${n.text}`)
    if (n.kind === 'scoreboard' && foreground && nav.page === 'today') nav = { page: 'score' }
    const offScreen = !foreground || !wearing
    if (state.settings.ntfyEnabled && (offScreen || state.settings.notifyWhenOpen)) void push(state.settings, n)
  }
}

let loops = 0
let planStatus = ''
let lastPlanSync = 0
async function doPlanSync(force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - lastPlanSync < 30 * MIN) return
  lastPlanSync = now
  planStatus = await syncPlan(state, now)
  note(planStatus)
  void save(true)
  void draw()
  ui?.refresh(true)
}

function loop(): void {
  const now = Date.now()
  if (++loops % 10 === 0) void syncImu()
  if (loops % 60 === 0) void doPlanSync()
  const nudges = tick(state, now, { headDownMs: head.downMs(state.settings.doomscrollMinutes * MIN, now) })
  if (nudges.length) {
    deliver(nudges)
    void save()
  }
  void draw()
  ui?.refresh()
}

// ---------------------------------------------------------------- input

function doAction(a: Action, source = 'glasses'): void {
  if (act(state, Date.now(), a)) {
    note(`${source}: ${a.type}`)
    void save()
    void draw()
    ui?.refresh(true)
  }
}

function go(next: Nav): void {
  nav = next
  void draw()
}

/** A button on the glasses was pressed. */
function press(a: ListAction): void {
  switch (a.t) {
    case 'open':
      return go({ page: 'quest', questId: a.questId })
    case 'start':
      doAction({ type: 'start', questId: a.questId })
      return go({ page: 'quest', questId: a.questId })
    case 'checkin':
      doAction({ type: 'checkin', questId: a.questId })
      return go({ page: 'quest', questId: a.questId })
    case 'step':
      doAction({ type: 'step', questId: a.questId, index: a.index })
      return
    case 'done':
      doAction({ type: 'done', questId: a.questId })
      return
    case 'pause':
      doAction({ type: 'pause', questId: a.questId })
      return
    case 'snooze':
      doAction({ type: 'snooze', questId: a.questId })
      return go({ page: 'today' })
    case 'askSkip':
      return go({ page: 'confirm', questId: a.questId })
    case 'skip':
      doAction({ type: 'skip', questId: a.questId })
      return go({ page: 'today' })
    case 'reopen':
      doAction({ type: 'reopen', questId: a.questId })
      return
    case 'lockin':
      doAction({ type: 'lockin' })
      return
    case 'music':
      return go({ page: 'music' })
    case 'playPause':
      void spotify.togglePlay().then(draw)
      return
    case 'next':
      void spotify.next().then(draw)
      return
    case 'prev':
      void spotify.previous().then(draw)
      return
    case 'score':
      return go({ page: 'score' })
    case 'exit':
      void call(b => b.shutDownPageContainer(1), false)
      return
    case 'today':
    case 'back':
      return go({ page: 'today' })
  }
}

/** Double tap = back. From Today it opens the system exit dialog. */
function back(): void {
  if (nav.page === 'today') void call(b => b.shutDownPageContainer(1), false)
  else go({ page: 'today' })
}

function handle(e: EvenHubEvent): void {
  if (e.audioEvent) return
  if (e.listEvent) {
    const t = e.listEvent.eventType ?? 0
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) back()
    else if (t === OsEventTypeList.CLICK_EVENT) {
      // Map the tapped row to the button that is actually on the glasses right now.
      const action = lastSpec?.list?.actions[e.listEvent.currentSelectItemIndex ?? 0]
      if (action) press(action)
    }
    return
  }
  // Swipes on text never do anything: only list buttons act.
  if (e.textEvent) {
    if ((e.textEvent.eventType ?? 0) === OsEventTypeList.DOUBLE_CLICK_EVENT) back()
    return
  }
  const sys = e.sysEvent
  if (!sys) return
  const t = sys.eventType ?? 0
  if (sys.imuData || t === OsEventTypeList.IMU_DATA_REPORT) {
    const d = sys.imuData
    if (d) head.sample([d.x ?? 0, d.y ?? 0, d.z ?? 0])
    return
  }
  switch (t) {
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      foreground = true
      invalidate()
      void doPlanSync()
      void spotify.poll().then(draw)
      return
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      foreground = false
      void save(true)
      return
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      void save(true)
      imuMode = 'off'
      void call(b => b.imuControl(false), false)
      return
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      back()
      return
  }
}

/** "Test drive": a one-off boss that is due right now, so you can try the loop. */
function spawnDemo(): void {
  const now = new Date()
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  state.quests = state.quests.filter(q => q.id !== 'demo')
  const day = today(state, now.getTime())
  delete day.runs.demo
  state.quests.push({
    id: 'demo',
    title: 'Test boss',
    step: 'Tap Start',
    checklist: ['Tap Start (it springs a 5-min trap)', 'Check this step off', 'Now hit Done for the K.O.'],
    time: hm,
    minutes: 10,
    days: [],
    once: dateKey(now.getTime()),
    active: true,
  })
  day.pinnedId = 'demo'
  nav = { page: 'quest', questId: 'demo' }
  note('Test drive started')
  loop()
  void save(true)
}

// ---------------------------------------------------------------- boot

async function boot(): Promise<void> {
  const connected = await connect()
  await load()
  head.cal = state.settings.imuCal

  const login = await completeLoginIfReturning(spotifyHost)
  if (login === 'ok') note('Spotify connected')
  else if (login !== 'none') note(login)

  const app: UIApp = {
    get state() {
      return state
    },
    connected,
    linked: () => isStarted(),
    spotify,
    head,
    log,
    act: (a: Action) => doAction(a, 'phone'),
    changed: () => {
      head.cal = state.settings.imuCal
      spotify.syncFlags()
      void save(true)
      void syncImu()
      void draw()
    },
    replaceState: (s: AppState) => {
      state = hydrate(s)
      head.cal = state.settings.imuCal
      void save(true)
      void draw()
    },
    testPush: () => push(state.settings, { kind: 'nudge', title: 'HQ: test', text: 'If you see this on your glasses, nudges will reach you anywhere.', priority: 3 }),
    connectSpotify: () => beginLogin(spotifyHost),
    syncPlan: () => doPlanSync(true),
    planStatus: () => planStatus,
    demo: () => spawnDemo(),
    startCalibration: async () => {
      calibrating = true
      await syncImu()
    },
    endCalibration: async () => {
      calibrating = false
      await syncImu()
    },
  }
  ui = mountUI(document.getElementById('app')!, app)

  if (connected) {
    const b = bridge()!
    b.onEvenHubEvent(handle)
    b.onDeviceStatusChanged(st => {
      wearing = st.isWearing ?? true
    })
  }
  // A QR like .../hq/#key=... sets the plan key once, then the hash is cleared.
  const hash = new URLSearchParams(location.hash.slice(1))
  if (hash.get('key')) {
    state.settings.planKey = hash.get('key')!
    history.replaceState({}, document.title, location.pathname + location.search)
    void save(true)
  }
  const qp = new URLSearchParams(location.search)
  if (qp.has('trap')) state.settings.trapMinutes = Number(qp.get('trap')) || 5 // testing aid
  if (qp.has('checkin')) state.settings.checkinEveryMin = Number(qp.get('checkin')) || 20 // testing aid
  if (qp.has('demo')) spawnDemo()
  else if (qp.get('page') === 'music') nav = { page: 'music' } // testing aid
  else setTimeout(() => nav.page === 'splash' && go({ page: 'today' }), 3500)
  if (qp.has('mockspotify')) {
    // Testing aid: fake track with placeholder lyric lines (no real lyrics).
    spotify.mockPlay('Demo Track', 'Demo Artist', 200_000, 'Another Demo - Demo Artist')
    if (!qp.has('nolyrics')) {
      const fake = Array.from({ length: 40 }, (_, i) => ({ ms: i * 4000, text: `Placeholder lyric line ${i + 1}` }))
      setLyricsForTest('mock', { synced: fake, plainOnly: false })
      lyricCache.set('mock', { synced: fake, plainOnly: false })
    }
  }
  loop()
  await draw()
  await syncImu()
  void spotify.poll().then(draw)
  void doPlanSync(true)

  setInterval(loop, 1000)
  setInterval(() => {
    if (foreground && spotify.view.connected) void spotify.poll()
  }, 3000)
  setInterval(() => void save(), 15_000)
  window.addEventListener('pagehide', () => void save(true))
}

void boot()
