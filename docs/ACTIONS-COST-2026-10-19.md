# GitHub Actions cost of masen-cron (2026-10-19)

Question from the owner: do not burn GitHub Actions credits. Short answer: masen-cron burns none, because the repo is public. The real credit risk sits in a private repo (Vyson), and the real problem here is that the 10-minute ticker does not run every 10 minutes.

## 1. Facts measured today

| Check | Result |
|---|---|
| `gh repo view mrdahdah/masen-cron --json visibility,isPrivate` | `PUBLIC`, `isPrivate: false` |
| Billing rule | Standard GitHub-hosted runners are free and unlimited on public repos. Private repos draw on the plan's included minutes (2,000 on Free, 3,000 on Pro) and then pay per minute. |
| Workflows | `tick` (cron `*/10 * * * *`, `timeout-minutes: 8`), `keepalive` (cron `0 3 1 * *`, `timeout-minutes: 3`). Both active. |
| Runs on record | 94 `tick` runs, 2026-10-01 17:10 UTC to 2026-10-19 01:34 UTC (one manual, 93 scheduled), all successful. No `keepalive` run yet (first one is due 2026-11-01). |
| Duration per run (created to updated) | mean 40 s, max 305 s, total 3,771 s (about 63 min wall-clock over 18 days) |

## 2. Minutes consumed

GitHub rounds each job up to a whole minute, so every `tick` run bills 1 minute (Linux, 1x multiplier) if the repo were private.

| Scenario | Runs/day | Billed min/day | Billed min/month |
|---|---|---|---|
| Nominal schedule if GitHub honoured it (144 slots/day) | 144 | 144 | about 4,320 (2.2x the Free allowance; about 2,320 min overage, roughly $14 at $0.006/min or $19 at $0.008/min) |
| Observed (93 scheduled runs in 17.3 days) | about 5.4 | about 5.4 | about 163 |
| keepalive | 1/month | n/a | 1 |

Actual cost today: 0 minutes of paid or included credit, since the repo is public. If it were private: about 163 min/month as observed, up to 4,320 min/month if the schedule were reliable.

## 3. Finding: the ticker runs about 5 times a day, not 144

GitHub's scheduled workflows are best-effort and heavily throttled on busy slots. Observed gaps between scheduled runs: min 1.6 h, mean 4.5 h, max 9.9 h. Consequences (not credit-related, but important):

- `reach-autopilot` (every 10 min, 06-19 UTC weekdays), `vyson-projections` (30 min), `lynk-research` and `nexus-routines` (60 min) and `contyq-ingest` (120 min) are called a few times a day at most, not at their stated cadence.
- Targets with `at` (`reach-ai-check` 06:10, `vyson-reminders` 06:00) are called only if a run lands inside that exact 10-minute slot. With about 5 runs a day this is mostly a miss, so each is unreliable as a daily job.
- The old per-app schedulers are disabled (`disabled_manually`): Lynk research, Reach ai-check / autopilot / uptime, Nexus agents-scheduler, Vyson scheduler and Contyq ingest-scheduler. So these jobs now depend on the throttled ticker plus whatever daily Vercel cron each app has.

## 4. Where credits are actually being spent

Checked read-only with `gh api repos/mrdahdah/<repo>/actions/workflows` and run lists since 2026-10-12:

- `mrdahdah/vyson` (private): workflow "Ship when main is not live" has `cron: "17 * * * *"` (hourly), `timeout-minutes: 5`. It had 37 scheduled runs in the last 7 days (about 5.3/day observed, 24/day nominal, so up to about 720 billed min/month), and the latest run failed. This is the only active private-repo schedule found among Lynk, Reach, Nexus, Vyson and Contyq.
- The other four apps have 0 scheduled runs since 2026-10-12.
- The account's billing usage could not be read (it needs `gh auth refresh -s user`), so this month's total is unverified.

## 5. Alternatives that cost nothing

| Option | Cost | Reliability | Fit |
|---|---|---|---|
| A. Keep masen-cron public (status quo) | 0 | Poor cadence (about 5 runs/day) | OK for daily jobs only if they tolerate a miss; bad for 10-60 min jobs |
| B. Vercel Cron in each app's `vercel.json` | 0 extra (counted against Vercel's cron quota) | Fires on time (Hobby: once per day only, hour-level precision; Pro: per-minute) | Best for the daily jobs. The team plan is not visible through the API here, so confirm it before moving sub-daily jobs (the existing crons are all daily, which is consistent with Hobby). |
| C. Windows Task Scheduler on this machine | 0 | Only while the PC is on and online | Fine as a manual catch-up, not for production |
| D. Make a repo public | 0 | n/a | Not needed, masen-cron is already public. Do not make app repos public. |
| E. External pinger (cron-job.org or similar) | 0 on free tiers | 1-minute cadence, on time | Calls the same endpoints with a Bearer header, but a third party then holds the secret. |

### Coverage of targets.json by each app's own `vercel.json`

| Target | Wanted cadence | App's `vercel.json` crons | Covered? |
|---|---|---|---|
| reach-uptime | 20 min, `/api/health` | none | no |
| reach-autopilot | 10 min, 06-19 UTC weekdays | `/api/cron/autopilot` daily 06:00 | partly (daily only) |
| reach-ai-check | daily 06:10 | `/api/cron/ai-check` daily 05:30 | yes (about 40 min earlier) |
| lynk-research | 60 min, `/api/cron` | `/api/cron` daily 06:17 (in `Masen-CRM/vercel.json`) | partly (daily only) |
| nexus-routines | 60 min | `/api/cron/routines` daily 05:00 | partly (daily only) |
| vyson-projections | 30 min | `/api/cron/projections` daily 05:00 | partly (daily only) |
| vyson-reminders | daily 06:00 weekdays | `/api/cron/reminders` daily 07:00 (weekends too) | yes |
| contyq-ingest | 120 min, `/api/cron/ingest` | `/api/cron/daily` weekdays 06:00 (a different route) | no |

Four of the five apps already have a daily Vercel cron, so a daily floor exists for free and on time regardless of masen-cron. Before relying on it, confirm that each route accepts Vercel's own cron call (Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set on the project).

## 6. Recommended change (not applied)

1. Leave masen-cron public and the workflows as they are. Cost is 0, which satisfies the "no credits" rule.
2. Do not tighten the `tick` cron or add workflows: it cannot beat GitHub's throttling, and 144 nominal runs/day would be 4,320 min/month if the repo ever went private.
3. Treat Vercel Cron as the source of truth for daily jobs (already present for Reach, Nexus, Vyson, Lynk). For Contyq, add `/api/cron/ingest` or confirm that `/api/cron/daily` replaces it.
4. Decide per job whether sub-daily cadence is really needed. If yes, either upgrade to a Vercel plan that allows per-minute crons and move them there, or use a free external pinger for the few jobs that need minute-level timing (Reach autopilot, Reach uptime). Keep masen-cron as a backup caller, and widen the `at` logic so a daily job still fires on the first run after its due time (with a last-run marker) instead of only inside one 10-minute slot.
5. Fix the Vyson private-repo hourly workflow "Ship when main is not live" (latest run failed, billed against private minutes): lower the frequency, or move it to a push or `workflow_run` trigger. It is the one real consumer of included minutes.
6. A Windows Task Scheduler entry running `node tick.mjs --only=<name>` is worth it only as a manual fallback.
