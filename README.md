# HQ for Even G2

One app you open once and leave open. The top of the display is a DisplayPlus-style Spotify
bar (song, time, and the current lyric line); the rest is **Kick**, a nudge engine that makes starting
stupid easy and ignoring it annoying. Every morning an AI planner reads your Notion and plans the day.

```
Slowtown - twenty one pilots    ( 0:45 - 4:57 )
▶ ━━━━──────────────────────────────
┌──────────────────────────────────────────────┐
│ ◆ THERMO HW  Lv 3            HP ■■■■■■■■■■   │
│ 20 min on the bench. Get in the game.        │
│ ▶ Open the PDF and read problem 1            │
│ waiting 20 min · dodged 1x                   │
└──────────────────────────────────────────────┘
tap start · ↑ done · ↓ snooze        LV 4 · streak 6
```

## How Kick works

- **Quests** are your time blocks. Each one is a boss whose HP is the block length.
- **Growth habits (★)** come built in: train (gym / tri), exam prep, internship apps, and a **MechE topic of the day** that rotates through 32 core topics (Mohr's circle, GD&T, gear trains, PID, Rankine...).
- **Daily AI plan**: every morning a scheduled Claude run reads your Notion Schedule and Life Schedule, then plans today and tomorrow: blocks for anything due, exam prep that ramps up as the exam gets close, and the growth habits fitted around fixed events. See `plan/PLANNER.md`.
- **Morning lock-in**: the first tap of the day commits you to today's list (+20 XP).
- **Nudge ladder** when a quest is due and you haven't started, every 10 min:
  1. "Just 5 minutes. Tap."
  2. The tiny first step you wrote ("Open the PDF").
  3. The coach gets spicy (hype man / drill sergeant / disappointed robot).
  4. A final warning at 30 minutes late, then the nudges slow down but don't stop.
- **5-minute trap**: tap starts a 5-min timer. When it ends you roll straight into focus. Check-ins every 20 min ("still locked in?" tap = yes) build a combo. Ignore one for 5 min and focus pauses and the nudges start again.
- **K.O.**: swipe up when it's done, or the boss dies when focus reaches the block length. XP = 50 + focus minutes + 10 per combo + 25 if you didn't dodge.
- **Doomscroll catch** (after calibration): head tilted down for 15 min while a quest is due gets called out.
- **Scoreboard** at 10pm. **Saturdays are off**: no nudges and the streak is safe.

## Controls

| | Kick | Music |
|---|---|---|
| Tap | Start / check in / lock in | Play / pause |
| Swipe up | K.O. (done) | Next track |
| Swipe down | Snooze 10 min / pause focus | Previous track |
| Long press | Play / pause | Play / pause |
| Double tap | Menu: Kick, Music, Quests, Scoreboard, Exit | |

The **Music** screen shows the album art (dithered to the glasses' 16 greens) and synced lyrics from
LRCLIB when available; otherwise track, album and up next.

## Setup (about 15 minutes)

### 1. Put it on GitHub Pages

1. Create a new **public** repo called `hq` on GitHub (github.com/new).
2. Upload everything in this folder (or `git init && git add . && git commit -m "HQ" && git push`).
3. Repo **Settings → Pages → Source: GitHub Actions**. The included workflow tests, builds and deploys on every push.
4. After the first run (Actions tab, ~1 min) it's live at `https://n1colov.github.io/hq/`.

If you name the repo something else, the URL changes, and that's fine. HQ always shows you the right Spotify redirect URI for wherever it's running.

### 2. Load it on the glasses

Even Realities app → **Developer Center** → scan `hq-qr.png` (points at `https://n1colov.github.io/hq/`).
HQ shows up in your glasses menu. Open it on the phone to see the settings page and a live mirror of the display.

### 3. Spotify (needs Premium)

1. https://developer.spotify.com/dashboard → **Create app**.
2. Redirect URI: copy it from HQ's Spotify section (it will be `https://n1colov.github.io/hq/`). Tick **Web API**.
3. Copy the **Client ID** into HQ, then **User Management** → add your Spotify email.
4. Tap **Connect Spotify** in HQ and approve. No client secret is needed (PKCE).

### 4. Phone alerts (so nudges reach you when HQ isn't the open app)

1. Install the free **ntfy** app and subscribe to the topic HQ generated for you.
2. Even Realities app → **Notifications** → enable **ntfy**.
3. Tap **Send test** in HQ.

### 5. Daily plan from Notion

The plan is encrypted with a key only HQ and the planner know (the repo is public).
Scan the **setup QR** you were sent (it carries the key) or paste the key under **Daily plan → Plan key**.
The planner is a scheduled task in your Claude account that runs each morning and follows `plan/PLANNER.md`.
Add your class times to that file so it plans around them.

### 6. Optional

- **Head tracking**: tap **Calibrate**, look ahead, then look at your phone. That enables the doomscroll catch and the double-nod.
- **Test drive**: spawns a 10-minute boss that's due right now so you can try the whole loop.

## Things to know

- The Even platform only lets the **open** app draw on the glasses. When you switch to another feature, HQ keeps running and sends nudges as phone notifications (step 4).
- Spotify playback control needs Premium, both for the developer app owner and the listener.
- Head tracking can't be tested in the simulator. The calibration and thresholds are a first pass, so tune them on the real glasses.
- Data lives in the Even app's storage on your phone. Use **Copy backup** before reinstalling.

## Develop

```bash
npm install
npm test            # engine + layout tests
npm run dev         # http://<your-ip>:5173, then: npx evenhub qr --url http://<your-ip>:5173
npx @evenrealities/evenhub-simulator http://localhost:5173   # desktop simulator
```

Testing aids: `?demo` spawns the test boss, `?mockspotify` fakes a playing track with placeholder lyric lines, `?trap=0.25&checkin=0.5` shortens timers.

`npm run pack` builds an `hq.ehpk` for Even Hub submission. Spotify login in a packaged build will need the redirect pointed at a hosted page, so stick with the GitHub Pages route for now.

## Code map

| File | What |
|---|---|
| `src/engine.ts` | Kick logic: schedule, nudge ladder, trap, focus, check-ins, XP, streaks (pure, unit-tested) |
| `src/coach.ts` | Persona lines |
| `src/view.ts` | Glasses layouts, pixel-accurate with `@evenrealities/pretext` |
| `src/glasses.ts` | Renderer: rebuild on layout change, in-place text updates otherwise |
| `src/spotify.ts` | PKCE login, now playing, controls |
| `src/notify.ts` | ntfy pushes |
| `src/plan.ts` | Fetch, decrypt and merge the daily AI plan |
| `src/meche.ts` | MechE topic-of-the-day list |
| `src/lyrics.ts` | LRCLIB synced-lyrics client |
| `src/art.ts` | Album art: crop, greyscale, dither, PNG |
| `plan/PLANNER.md` | Instructions for the daily planner run |
| `tools/publish_plan.py` | Validates and encrypts a plan into `plan/plan.json` |
| `src/imu.ts` | Head pose from the G2 IMU (calibrated, axis-agnostic) |
| `src/ui.ts` | Phone-side settings page |
| `src/main.ts` | Wiring, input routing, lifecycle |
