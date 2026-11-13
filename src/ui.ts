// Phone-side UI: what you see when you open HQ in the Even Realities app.
// Settings, quest editor, Spotify/ntfy setup, head calibration and a live
// preview of the glasses display.
import { PERSONA_LABELS } from './coach'
import { uid } from './defaults'
import { fmtClock, fmtHM, playerLevel, questOf, today, type Action } from './engine'
import type { HeadTracker } from './imu'
import { redirectUri, type Spotify } from './spotify'
import type { AppState, Persona, Quest, Settings } from './types'
import type { PageSpec } from './view'

export interface UIApp {
  readonly state: AppState
  connected: boolean
  linked(): boolean
  spotify: Spotify
  head: HeadTracker
  log: string[]
  act(a: Action): void
  changed(): void
  replaceState(s: AppState): void
  testPush(): Promise<boolean>
  testBuddyPush(): Promise<boolean>
  startCalibration(): Promise<void>
  connectSpotify(): Promise<void>
  demo(): void
  endCalibration(): Promise<void>
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function daysText(q: Quest): string {
  if (!q.days.length) return q.once ? `once · ${q.once}` : 'once'
  if (q.days.length === 7) return 'every day'
  const sorted = [...q.days].sort()
  if (sorted.join() === '1,2,3,4,5') return 'weekdays'
  return sorted.map(d => DAY_NAMES[d]).join(' ')
}

async function copy(text: string, btn?: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  if (btn) {
    const old = btn.textContent
    btn.textContent = 'Copied'
    setTimeout(() => (btn.textContent = old), 1200)
  }
}

export function mountUI(root: HTMLElement, app: UIApp) {
  let editing: Quest | null = null
  let calStep: 0 | 1 | 2 | 3 = 0
  let lastSpec: PageSpec | null = null
  const S = () => app.state.settings

  root.innerHTML = `
    <header class="top">
      <div>
        <div class="label">EVEN G2</div>
        <h1>HQ</h1>
      </div>
      <div class="chips" id="chips"></div>
    </header>

    <section class="card preview-card">
      <div class="preview" id="preview"><div class="screen" id="screen"></div></div>
      <div class="caption" id="previewCaption"></div>
    </section>

    <section class="card">
      <div class="row-head"><h2>Today</h2><span class="dim" id="todayMeta"></span></div>
      <div id="today"></div>
    </section>

    <section class="card">
      <div class="row-head"><h2>Quests</h2><div class="q-actions"><button class="btn small ghost" data-action="demo">Test drive</button><button class="btn small" data-action="new-quest">+ Add</button></div></div>
      <p class="dim">Each quest is a boss. Its HP is the block length. Starting is the only hard part, so every quest has a tiny first step.</p>
      <div id="quests"></div>
      <div id="questForm"></div>
    </section>

    <section class="card">
      <h2>Coach</h2>
      <div class="personas" id="personas"></div>
      <div class="grid2">
        <label>Nudge every (min)<input type="number" min="1" max="60" data-setting="escalateEveryMin"></label>
        <label>Trap length (min)<input type="number" min="1" max="30" data-setting="trapMinutes"></label>
        <label>Check-ins (min, 0 = off)<input type="number" min="0" max="120" data-setting="checkinEveryMin"></label>
        <label>Check-in grace (min)<input type="number" min="1" max="30" data-setting="checkinGraceMin"></label>
      </div>
    </section>

    <section class="card">
      <h2>Alerts when HQ isn't open</h2>
      <p class="dim">HQ can only draw on the glasses while it's the open app. Everything else goes out as a phone notification through <b>ntfy</b>, and the Even app forwards it to your glasses.</p>
      <ol class="steps">
        <li>Install the free <b>ntfy</b> app (App Store / Play Store).</li>
        <li>In ntfy, tap <b>+</b> and subscribe to your topic below.</li>
        <li>Even Realities app → <b>Notifications</b> → turn on <b>ntfy</b>.</li>
        <li>Tap <b>Send test</b>.</li>
      </ol>
      <label class="switch"><input type="checkbox" data-setting="ntfyEnabled"> Send nudges to my phone</label>
      <label>Your topic (keep it secret, anyone with it can message you)
        <div class="inline"><input type="text" data-setting="ntfyTopic"><button class="btn small ghost" data-action="copy-topic">Copy</button><button class="btn small ghost" data-action="new-topic">New</button></div>
      </label>
      <label class="switch"><input type="checkbox" data-setting="notifyWhenOpen"> Also push while HQ is open on the glasses</label>
      <div class="inline"><button class="btn" data-action="test-push">Send test</button><span class="dim" id="pushResult"></span></div>
      <details><summary>Self-hosted ntfy server</summary>
        <label>Server<input type="url" data-setting="ntfyServer"></label>
      </details>
    </section>

    <section class="card">
      <h2>Accountability buddy</h2>
      <p class="dim">Optional. If you dodge a quest past the limit, you get a final warning, then your buddy gets a ping. Only add someone who said yes. They install ntfy and send you their topic.</p>
      <div class="grid2">
        <label>Your name<input type="text" data-setting="userName"></label>
        <label>Buddy's name<input type="text" data-setting="buddyName"></label>
        <label>Buddy's ntfy topic<input type="text" data-setting="buddyTopic" placeholder="leave empty to disable"></label>
        <label>Ping after (min late)<input type="number" min="5" max="240" data-setting="buddyAfterMin"></label>
      </div>
      <div class="inline"><button class="btn ghost" data-action="test-buddy">Send buddy a test</button><span class="dim" id="buddyResult"></span></div>
    </section>

    <section class="card">
      <h2>Spotify</h2>
      <div id="spotifyStatus" class="status-line"></div>
      <details id="spotifySetup">
        <summary>One-time setup (needs Spotify Premium)</summary>
        <ol class="steps">
          <li>Go to <b>developer.spotify.com/dashboard</b> → <b>Create app</b>.</li>
          <li>Redirect URI: paste this exactly, then tick <b>Web API</b>.
            <div class="inline"><code id="redirect"></code><button class="btn small ghost" data-action="copy-redirect">Copy</button></div></li>
          <li>Save, open the app's <b>Settings</b>, copy the <b>Client ID</b> below.</li>
          <li>Under <b>User Management</b>, add the email of your Spotify account.</li>
        </ol>
      </details>
      <label>Client ID<input type="text" data-setting="spotifyClientId" autocomplete="off" spellcheck="false"></label>
      <div class="inline">
        <button class="btn" data-action="spotify-connect">Connect Spotify</button>
        <button class="btn ghost" data-action="spotify-disconnect">Disconnect</button>
      </div>
    </section>

    <section class="card">
      <h2>Head tracking</h2>
      <p class="dim">Uses the glasses' motion sensor. Calibrate once so HQ knows what "looking at your phone" looks like for you.</p>
      <label class="switch"><input type="checkbox" data-setting="doomscrollEnabled"> Doomscroll catch: head down while dodging a quest</label>
      <label>Trigger after (min of head-down)<input type="number" min="3" max="60" data-setting="doomscrollMinutes"></label>
      <label class="switch"><input type="checkbox" data-setting="nodEnabled"> Double-nod = tap (beta)</label>
      <div id="cal"></div>
    </section>

    <section class="card">
      <h2>Schedule</h2>
      <label>Days off (no nudges, streak is safe)</label>
      <div class="daypick" id="daysOff"></div>
      <div class="grid2">
        <label>Morning lock-in from<input type="time" data-setting="morningTime"></label>
        <label>Scoreboard at<input type="time" data-setting="scoreboardTime"></label>
      </div>
    </section>

    <section class="card">
      <h2>Controls on the glasses</h2>
      <table class="controls">
        <tr><th></th><th>Kick</th><th>Music</th></tr>
        <tr><td>Tap</td><td>Start / check in</td><td>Play / pause</td></tr>
        <tr><td>Swipe up</td><td>K.O. (done)</td><td>Next track</td></tr>
        <tr><td>Swipe down</td><td>Snooze 10 / pause</td><td>Previous</td></tr>
        <tr><td>Long press</td><td>Play / pause</td><td>Play / pause</td></tr>
        <tr><td>Double tap</td><td colspan="2">Menu (Kick, Music, Quests, Scoreboard, Exit)</td></tr>
      </table>
    </section>

    <section class="card">
      <h2>Data</h2>
      <div class="inline">
        <button class="btn ghost" data-action="export">Copy backup</button>
        <button class="btn ghost" data-action="import">Restore backup</button>
        <button class="btn ghost danger" data-action="reset-progress">Reset XP & streak</button>
      </div>
      <details><summary>Activity log</summary><pre id="log"></pre></details>
    </section>
    <footer class="dim">HQ v1 · made for Nicolov</footer>
  `

  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!

  // ------------------------------------------------------------ bindings

  function fillSettings(): void {
    root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(el => {
      const key = el.dataset.setting as keyof Settings
      const v = S()[key]
      if (el.type === 'checkbox') el.checked = !!v
      else if (document.activeElement !== el) el.value = String(v ?? '')
    })
    ;($('redirect') as HTMLElement).textContent = redirectUri()
    renderPersonas()
    renderDaysOff()
  }

  root.addEventListener('change', ev => {
    const el = ev.target as HTMLInputElement
    const key = el.dataset?.setting as keyof Settings | undefined
    if (!key) return
    const s = S() as unknown as Record<string, unknown>
    if (el.type === 'checkbox') s[key] = el.checked
    else if (el.type === 'number') s[key] = Math.max(Number(el.min || 0), Number(el.value) || 0)
    else s[key] = el.value.trim()
    app.changed()
    refresh(true)
  })

  function renderPersonas(): void {
    $('personas').innerHTML = (Object.keys(PERSONA_LABELS) as Persona[])
      .map(
        p =>
          `<button class="persona ${S().persona === p ? 'on' : ''}" data-action="persona" data-v="${p}">${esc(PERSONA_LABELS[p])}</button>`,
      )
      .join('')
  }

  function renderDaysOff(): void {
    $('daysOff').innerHTML = DAYS.map(
      (d, i) =>
        `<button class="day ${S().daysOff.includes(i) ? 'on' : ''}" data-action="day-off" data-v="${i}" title="${DAY_NAMES[i]}">${d}</button>`,
    ).join('')
  }

  // ------------------------------------------------------------ quests

  function renderQuests(): void {
    const qs = [...app.state.quests].sort((a, b) => a.time.localeCompare(b.time))
    $('quests').innerHTML = qs.length
      ? qs
          .map(
            q => `
        <div class="quest ${q.active ? '' : 'off'}">
          <div class="q-main">
            <div class="q-title">${esc(q.title)}</div>
            <div class="dim small">${fmtHM(q.time)} · ${q.minutes} min · ${esc(daysText(q))}</div>
            <div class="small step">▶ ${esc(q.step)}</div>
          </div>
          <div class="q-actions">
            <button class="btn small ghost" data-action="edit-quest" data-v="${q.id}">Edit</button>
          </div>
        </div>`,
          )
          .join('')
      : '<p class="dim">No quests yet.</p>'
  }

  function renderForm(): void {
    if (!editing) {
      $('questForm').innerHTML = ''
      return
    }
    const q = editing
    const isNew = !app.state.quests.some(x => x.id === q.id)
    $('questForm').innerHTML = `
      <div class="form">
        <h3>${isNew ? 'New quest' : 'Edit quest'}</h3>
        <label>Name<input id="f-title" type="text" maxlength="40" value="${esc(q.title)}" placeholder="Thermo HW"></label>
        <label>Tiny first step<input id="f-step" type="text" maxlength="70" value="${esc(q.step)}" placeholder="Open the PDF and read problem 1"></label>
        <div class="grid2">
          <label>Start<input id="f-time" type="time" value="${esc(q.time)}"></label>
          <label>Block (min)<input id="f-min" type="number" min="5" max="480" value="${q.minutes}"></label>
        </div>
        <label>Repeats on (none = one-off)</label>
        <div class="daypick" id="f-days">${DAYS.map(
          (d, i) => `<button class="day ${q.days.includes(i) ? 'on' : ''}" data-action="f-day" data-v="${i}">${d}</button>`,
        ).join('')}</div>
        <label id="f-once-wrap" class="${q.days.length ? 'hidden' : ''}">One-off date<input id="f-once" type="date" value="${esc(q.once ?? today(app.state, Date.now()).date)}"></label>
        <label class="switch"><input id="f-active" type="checkbox" ${q.active ? 'checked' : ''}> Active</label>
        <div class="inline">
          <button class="btn" data-action="save-quest">Save</button>
          <button class="btn ghost" data-action="cancel-quest">Cancel</button>
          ${isNew ? '' : '<button class="btn ghost danger" data-action="delete-quest">Delete</button>'}
        </div>
      </div>`
    $('questForm').scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function readForm(): Quest | null {
    if (!editing) return null
    const val = (id: string) => (root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '').trim()
    const days = [...root.querySelectorAll<HTMLElement>('#f-days .day.on')].map(b => Number(b.dataset.v))
    return {
      ...editing,
      title: val('f-title') || 'Quest',
      step: val('f-step') || 'Just start',
      time: val('f-time') || '09:00',
      minutes: Math.max(5, Number(val('f-min')) || 30),
      days,
      once: days.length ? undefined : val('f-once'),
      active: root.querySelector<HTMLInputElement>('#f-active')?.checked ?? true,
    }
  }

  // ------------------------------------------------------------ today

  function renderToday(): void {
    const now = Date.now()
    const day = today(app.state, now)
    const runs = Object.values(day.runs).sort((a, b) => a.dueAt - b.dueAt)
    const lv = playerLevel(app.state.profile.xp)
    $('todayMeta').textContent = `LV ${lv.level} · ${app.state.profile.xp} XP · +${day.xp} today`
    if (!runs.length) {
      $('today').innerHTML = `<p class="dim">${S().daysOff.includes(new Date().getDay()) ? 'Day off. Go live a little.' : 'Nothing scheduled today.'}</p>`
      return
    }
    const label: Record<string, string> = { waiting: 'Up next', due: 'DUE', trap: '5-min trap', focus: 'Locked in', done: 'K.O.', skipped: 'Skipped' }
    $('today').innerHTML =
      (!day.lockedIn ? `<button class="btn wide" data-action="lockin">Lock in today (+20 XP)</button>` : '') +
      runs
        .map(r => {
          const q = questOf(app.state, r.questId)
          const open = r.status !== 'done' && r.status !== 'skipped'
          const startable = r.status === 'due' || r.status === 'waiting'
          let extra = ''
          if (r.status === 'trap' && r.trapEndsAt) extra = ` · ${fmtClock(r.trapEndsAt - now)} left`
          if (r.status === 'due') extra = ` · ${Math.floor((now - r.dueAt) / 60000)} min late`
          if (r.status === 'done') extra = ` · +${r.xp} XP`
          return `
          <div class="run s-${r.status}">
            <div>
              <div class="q-title">${esc(q?.title ?? '?')}</div>
              <div class="dim small">${fmtHM(q?.time ?? '')} · ${label[r.status]}${extra}</div>
            </div>
            <div class="q-actions">
              ${startable ? `<button class="btn small" data-action="start" data-v="${r.questId}">Start</button>` : ''}
              ${open && !startable ? `<button class="btn small" data-action="done" data-v="${r.questId}">K.O.</button>` : ''}
              ${open ? `<button class="btn small ghost" data-action="skip" data-v="${r.questId}">Skip</button>` : ''}
            </div>
          </div>`
        })
        .join('')
  }

  // ------------------------------------------------------------ status bits

  function renderChips(): void {
    const sp = app.spotify.view
    $('chips').innerHTML = [
      `<span class="chip ${app.linked() ? 'ok' : ''}">${app.linked() ? 'Glasses linked' : 'Preview mode'}</span>`,
      `<span class="chip ${sp.connected ? 'ok' : ''}">Spotify ${sp.connected ? 'on' : 'off'}</span>`,
    ].join('')
  }

  function renderSpotify(): void {
    const v = app.spotify.live()
    let html: string
    if (!v.hasClientId) html = '<span class="dot"></span> Add your Client ID to get started.'
    else if (!v.connected) html = '<span class="dot"></span> Not connected yet. Tap Connect Spotify.'
    else if (v.error) html = `<span class="dot warn"></span> ${esc(v.error)}`
    else if (!v.title) html = '<span class="dot ok"></span> Connected. Nothing playing right now.'
    else html = `<span class="dot ok"></span> ${v.playing ? 'Playing' : 'Paused'}: <b>${esc(v.title)}</b> · ${esc(v.artist)} <span class="dim">(${fmtClock(v.progressMs)} / ${fmtClock(v.durationMs)})</span>`
    $('spotifyStatus').innerHTML = html
    ;($('spotifySetup') as HTMLDetailsElement).open ||= !v.hasClientId
  }

  function renderCal(): void {
    const h = app.head
    const v = h.latest
    const reading = v ? v.map(n => n.toFixed(2)).join(', ') : app.linked() ? 'waiting for sensor...' : 'open HQ on the glasses to read the sensor'
    const pose = v && S().imuCal ? (h.isDown(v) ? 'looking DOWN' : 'looking ahead') : ''
    const calibrated = !!S().imuCal
    let body = ''
    if (calStep === 0) {
      body = `<div class="inline"><button class="btn ${calibrated ? 'ghost' : ''}" data-action="cal-start">${calibrated ? 'Recalibrate' : 'Calibrate'}</button>
        <span class="dim">${calibrated ? 'Calibrated.' : 'Not calibrated yet.'}</span></div>`
    } else if (calStep === 1) {
      body = `<p><b>Step 1.</b> Wear the glasses and look straight ahead, like at a whiteboard. Then tap.</p>
        <button class="btn" data-action="cal-ahead">I'm looking ahead</button>`
    } else if (calStep === 2) {
      body = `<p><b>Step 2.</b> Now hold your phone and look down at it like you're scrolling. Then tap.</p>
        <button class="btn" data-action="cal-down">I'm looking at my phone</button>`
    } else {
      body = `<p class="dim">Recording...</p>`
    }
    $('cal').innerHTML = `${body}<div class="sensor dim small">Sensor: ${esc(reading)} ${pose ? `· <b>${pose}</b>` : ''}</div>`
  }

  // ------------------------------------------------------------ preview

  function renderPreview(spec: PageSpec | null): void {
    if (!spec) return
    const boxes = spec.texts
      .map(
        b => `<div class="box ${b.border ? 'bordered' : ''} ${b.dim !== undefined ? `dim${b.dim}` : ''}"
          style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;padding:${b.pad ?? 0}px">${esc(b.text)}</div>`,
      )
      .join('')
    const list = spec.list
      ? `<div class="box list" style="left:${spec.list.x}px;top:${spec.list.y}px;width:${spec.list.w}px;height:${spec.list.h}px">${spec.list.items
          .map((it, i) => `<div class="item ${i === 0 ? 'sel' : ''}">${esc(it)}</div>`)
          .join('')}</div>`
      : ''
    $('screen').innerHTML = boxes + list
    $('previewCaption').textContent = app.linked()
      ? 'Live mirror of your glasses'
      : 'Preview: open HQ from Even Hub to put this on your glasses'
  }

  function fitPreview(): void {
    const wrap = $('preview')
    const scale = wrap.clientWidth / 576
    ;($('screen') as HTMLElement).style.transform = `scale(${scale})`
    wrap.style.height = `${288 * scale}px`
  }
  window.addEventListener('resize', fitPreview)

  // ------------------------------------------------------------ actions

  root.addEventListener('click', async ev => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]')
    if (!btn) return
    const v = btn.dataset.v ?? ''
    switch (btn.dataset.action) {
      case 'persona':
        S().persona = v as Persona
        app.changed()
        renderPersonas()
        break
      case 'day-off': {
        const d = Number(v)
        const set = new Set(S().daysOff)
        set.has(d) ? set.delete(d) : set.add(d)
        S().daysOff = [...set].sort()
        app.changed()
        renderDaysOff()
        refresh(true)
        break
      }
      case 'demo':
        app.demo()
        renderQuests()
        refresh(true)
        break
      case 'new-quest':
        editing = { id: uid(), title: '', step: '', time: '19:00', minutes: 30, days: [1, 2, 3, 4, 5], active: true }
        renderForm()
        break
      case 'edit-quest':
        editing = { ...app.state.quests.find(q => q.id === v)! }
        renderForm()
        break
      case 'f-day': {
        btn.classList.toggle('on')
        const any = root.querySelectorAll('#f-days .day.on').length > 0
        $('f-once-wrap').classList.toggle('hidden', any)
        break
      }
      case 'save-quest': {
        const q = readForm()
        if (!q) break
        const i = app.state.quests.findIndex(x => x.id === q.id)
        if (i >= 0) app.state.quests[i] = q
        else app.state.quests.push(q)
        editing = null
        app.changed()
        renderForm()
        renderQuests()
        refresh(true)
        break
      }
      case 'cancel-quest':
        editing = null
        renderForm()
        break
      case 'delete-quest':
        if (editing && confirm(`Delete "${editing.title}"?`)) {
          app.state.quests = app.state.quests.filter(q => q.id !== editing!.id)
          editing = null
          app.changed()
          renderForm()
          renderQuests()
          refresh(true)
        }
        break
      case 'lockin':
        app.act({ type: 'lockin' })
        break
      case 'start':
        app.act({ type: 'start', questId: v })
        break
      case 'done':
        app.act({ type: 'done', questId: v })
        break
      case 'skip':
        app.act({ type: 'skip', questId: v })
        break
      case 'copy-topic':
        await copy(S().ntfyTopic, btn)
        break
      case 'new-topic':
        S().ntfyTopic = `hq-${uid(12)}`
        app.changed()
        fillSettings()
        break
      case 'test-push':
        $('pushResult').textContent = (await app.testPush()) ? 'Sent. Check your glasses.' : 'Could not send (no topic?)'
        break
      case 'test-buddy':
        $('buddyResult').textContent = S().buddyTopic ? ((await app.testBuddyPush()) ? 'Sent.' : 'Failed.') : 'Add their topic first.'
        break
      case 'copy-redirect':
        await copy(redirectUri(), btn)
        break
      case 'spotify-connect':
        try {
          await app.connectSpotify()
        } catch (e) {
          alert((e as Error).message)
        }
        break
      case 'spotify-disconnect':
        app.spotify.disconnect()
        app.changed()
        break
      case 'cal-start':
        calStep = 1
        await app.startCalibration()
        renderCal()
        break
      case 'cal-ahead': {
        calStep = 3
        renderCal()
        const vec = await app.head.capture()
        if (!vec) {
          alert('No sensor data. Make sure HQ is open on the glasses.')
          calStep = 0
          await app.endCalibration()
        } else {
          ;(window as unknown as { __hqAhead: unknown }).__hqAhead = vec
          calStep = 2
        }
        renderCal()
        break
      }
      case 'cal-down': {
        calStep = 3
        renderCal()
        const down = await app.head.capture()
        const ahead = (window as unknown as { __hqAhead?: [number, number, number] }).__hqAhead
        if (down && ahead) {
          S().imuCal = { ahead, down }
          app.changed()
        } else {
          alert('No sensor data. Try again.')
        }
        calStep = 0
        await app.endCalibration()
        renderCal()
        break
      }
      case 'export':
        await copy(JSON.stringify(app.state), btn)
        break
      case 'import': {
        const raw = prompt('Paste your HQ backup:')
        if (!raw) break
        try {
          app.replaceState(JSON.parse(raw))
          fillSettings()
          renderQuests()
          refresh(true)
        } catch {
          alert("That doesn't look like an HQ backup.")
        }
        break
      }
      case 'reset-progress':
        if (confirm('Reset XP, level and streak? Quests and settings stay.')) {
          app.state.profile = { xp: 0, streak: 0, bestStreak: 0, totalKOs: 0, lastRolled: app.state.profile.lastRolled }
          app.changed()
          refresh(true)
        }
        break
    }
  })

  // ------------------------------------------------------------ refresh

  let tickN = 0
  function refresh(force = false): void {
    tickN++
    renderChips()
    renderSpotify()
    if (calStep !== 3) renderCal()
    if (force || tickN % 2 === 0) renderToday()
    $('log').textContent = app.log.join('\n') || 'Nothing yet.'
    if (lastSpec) renderPreview(lastSpec)
  }

  fillSettings()
  renderQuests()
  refresh(true)
  requestAnimationFrame(fitPreview)

  return {
    refresh,
    preview(spec: PageSpec) {
      lastSpec = spec
      renderPreview(spec)
      fitPreview()
    },
  }
}
