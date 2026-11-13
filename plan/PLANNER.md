# HQ daily planner

Instructions for the AI run that builds Nicolov's daily plan for HQ (his Even G2 glasses app).
It runs every morning. Edit this file to change how days are planned. The next run picks it up.

## 1. Read Notion

Two databases (properties: `Name`, `Date`, `Tags`):

| Database | Data source | What's in it |
|---|---|---|
| Schedule (ASMSA/Purdue Study Group) | `collection://2e7bcde9-f335-80a2-8d1c-000b2ac5e43d` | Homework, reports, exams. Usually a date with no time = due that day. |
| Life Schedule | `collection://ffb212cf-83a7-4d31-96a8-1a3cd8988279` | Events and errands, often with a time in the title or a datetime. |

- Query both for dates from **today through 10 days out** (rows mode, `Date` on or after today).
- Skip rows whose `Name` starts with `DONE`, `WAIVED`, `CANCELLED` or `CANCELED`.
- `URGENT` in the name means top priority.
- A time written in the title (e.g. "1:30-2:00 Academic Advising", "6:00PM") is a **fixed event**. Never put a quest on top of it; leave 15 min on each side.

## 2. Plan today and tomorrow

Output both days, using the date keys `YYYY-MM-DD` in America/Indiana/Indianapolis time.
If tomorrow is Saturday, also plan Sunday.

### Midday re-plan (any run after 12:00)

First read what's already published: `HQ_PLAN_KEY=... python3 tools/read_plan.py`.
HQ keeps anything he already started or finished, matched by **exact title**, so:
- Keep every quest whose time has passed exactly as it is (same title, time, minutes).
- Keep upcoming quests unchanged unless Notion changed. Never rename a quest that's staying.
- Add new Notion items, drop ones that are now DONE, and move unstarted ones only to times at least 15 min from now.

**Saturday is his day off for friends.** No quests on Saturday unless something is due Saturday or by Sunday 12:00. Then plan at most one 60-min block and say so in the brief.

Build the day in this order, max **7 quests per day**, all between **08:00 and 22:30**, no overlaps:

1. **Deadlines.** Anything due today: a block that ends at least 1 h before midnight (60 min default, 90 for labs/reports). Due tomorrow: a block today. `kind: "deadline"`, `note: "Due today"` or `"Due Mon"`.
2. **Exams within 7 days.** One prep block per day (60 min if 5-7 days out, 90 if 2-4 days, 120 the day before). `kind: "exam"`, note like `"Exam Mon 11/16"`. The step names a specific topic or practice exam problem for that course.
3. **Growth habits** (`kind: "growth"`), on non-Saturday days:
   - **Train (gym / tri)**: 45-60 min, Mon, Tue, Thu, Fri, ideally 16:00-18:30. On a heavy deadline day, cut to 30 min and don't skip.
   - **MechE topic of the day**: 25-30 min, every day. Pick ONE specific topic and title it `MechE: <topic>`. Rotate (don't repeat within 2 weeks; check git history of this plan if you can't remember). Favor design & manufacturing and robotics (GD&T, DFM, mechanisms, motors, kinematics, controls), plus whatever his courses are hitting right now (ME 200 thermodynamics, ME 270 statics, PHYS 272 E&M, ECE 20001 circuits).
   - **Internship apps**: 30 min, Mon, Wed, Fri, step "Open Handshake and pick one posting", note "Goal: 2 apps".
   - If an exam is within 2 days, drop the internship block and shorten the MechE topic to 20 min.

### Fixed weekly commitments

Not known yet. Assume weekday mornings before 12:00 are classes, so prefer **12:00-22:30** on weekdays.
Nicolov can list classes, tutoring and team meetings here and future runs will plan around them:

- (add here, e.g. "Mon/Wed/Fri 10:30-11:20 ME 270 lecture")

## 3. Write each quest

```json
{
  "title": "PHYS 272 exam prep", "step": "Open practice Exam 2, do problem 1", "time": "19:30", "minutes": 90,
  "kind": "exam", "note": "Exam Mon 11/16",
  "checklist": ["Open practice Exam 2, do #1", "Do the next 2 problems, timed", "Check against the solutions", "Write the 3 formulas you missed", "Redo the hardest one"]
}
```

- `title` ≤ 28 characters, plain ASCII (the glasses font has no emoji).
- `step` is the **tiniest physical first action**, under 2 minutes, ≤ 60 characters. Good: "Open the PDF and read problem 1". Bad: "Study chapter 5".
- `time` is 24-hour `HH:MM`. `minutes` 5-240.
- `checklist` **always**: 3-6 concrete, in-order steps, each ≤ 36 characters. The first one is the tiny step. These are the buttons he taps through on the glasses, so each must be a clear physical action ("Draw the FBD for problem 1", "Submit on Gradescope"), never vague ("Work on it").
- For the **MechE topic**, the checklist is a mini-lesson he reads on the glasses: the tiny start, then 2-3 key facts as short statements (e.g. "MMC = most material (smallest hole)"), then "Work one example", then "Explain it out loud in 60 s".

Each day also gets:
- `brief`: ≤ 140 characters, direct and motivating, naming the single most important thing. For example: "Exam 2 is Monday. Tonight is E&M problems, then the gym clears your head."
- `tomorrow`: ≤ 120 characters, shown with the 22:00 scoreboard. A heads-up about the next day ("Saturday off. Sunday is a full PHYS 272 practice exam.").

## 4. Publish

```bash
cat > /tmp/plan.json <<'JSON'
{ "v": 1, "generatedAt": "<ISO timestamp with offset>", "days": { "<today>": { "brief": "...", "tomorrow": "...", "quests": [ ... ] }, "<tomorrow>": { ... } } }
JSON
HQ_PLAN_KEY="$HQ_PLAN_KEY" python3 tools/publish_plan.py /tmp/plan.json
git add plan/plan.json
git commit -m "plan: <today>"
git push origin main
```

The script validates the plan and encrypts it (the repo is public; the plan never is).
If validation fails, fix the JSON and run it again. HQ fetches the new plan within ~30 minutes, or right away with **Sync now**.
