# masen-cron

One 10-minute ticker for the scheduled jobs of the Masen apps (Reach, Lynk, Nexus, Vyson, Contyq).

**Why it exists.** GitHub Actions minutes are free and unlimited on public repositories, but the private repos only get 2,000
minutes a month. Each scheduled run is billed at one minute at least, so the per-app schedulers (every 10–60 min) used up the private
budget on their own and blocked CI. Here, one job calls whatever is due in its 10-minute slot.

**What is public.** Only this code, `targets.json` (URLs of apps that are public anyway) and the run logs, which print a name, an HTTP
status and a duration per call — never a response body. Tokens are repository secrets and are never printed.

| File | Role |
|---|---|
| `targets.json` | endpoints, cadence (`every` minutes, optional `hours` UTC window, `weekdays`, `at` HH:MM with optional `windowHours`), secret name, expected status |
| `schedule.mjs` | the due-time rules (pure functions, no I/O), covered by `tick.test.mjs` |
| `tick.mjs` | picks the due targets, calls them (3 tries on 5xx/network), exits 1 if one fails |
| `.github/workflows/tick.yml` | runs every 10 min; manual run can target one name (`only`) |
| `.github/workflows/keepalive.yml` | monthly heartbeat commit (GitHub pauses schedules of inactive public repos after 60 days) |
| `scripts/migrate.py` | one-off move from the private repos: rotates each app's `CRON_SECRET`, redeploys, verifies, disables the old schedule |

```bash
node tick.mjs --all                 # call every target once (needs the secrets in the environment)
node tick.mjs --only=nexus-routines
node --test                         # due-time tests
TICK_AT_MS=$(node -e "console.log(Date.parse('2026-10-19T13:20:00Z'))") node tick.mjs --dry   # list what is due at that instant, call nothing
python scripts/migrate.py           # dry run
```

### Daily targets (`at`)
GitHub throttles the `*/10` schedule to about five runs a day (gaps of 1.6 to 9.9 h), so a daily target cannot rely on a run landing in
its exact 10-minute slot. A target with `at` is therefore due on **every run from its `at` time (UTC) until `windowHours` later**
(default 12, never past the end of the UTC day), and not before it. Runs are stateless (no cache, no committed state file), so "once a
day" is not enforced here: with several runs inside the window the endpoint is called each time, and it must tolerate that. Set
`"windowHours": 0` for a target that is not idempotent to keep the old exact-slot rule. Interval targets (`every`) are unchanged.

| Target | `at` | Window | Same-day repeat is safe because |
|---|---|---|---|
| `reach-ai-check` | 06:10 | 12 h | `/api/cron/ai-check` is a read-only provider probe (two tiny model calls at most); its failure notice carries a per-day `dedupeKey` |
| `vyson-reminders` | 06:00, Mon-Fri | 12 h | `/api/cron/reminders` drains a queue: only unsent, uncancelled rows that are due are processed and each is marked `sentAt`; "overdue" marking is idempotent |

Routes read on 2026-10-19: Reach `src/app/api/cron/ai-check/route.ts` and `src/server/ai/health.ts`; Vyson
`src/app/api/cron/reminders/route.ts` and the `notify.run_reminders` action in `src/server/actions/notify.ts`.

Rollback for one app: `gh workflow enable <workflow>.yml -R mrdahdah/<repo>` (its secret was updated too, so it works as before),
then remove the target from `targets.json`.

## Knowledge MCP servers
`.mcp.json` wires two read-only servers for coding agents: `ux-ui-library` (UI work) and `stackwise` (backend, data, AI). See `CLAUDE.md`.

## Handoff
### 2026-10-19 daily window (`fix/daily-window-2026-10-19`)
- Daily `at` targets are due from their time until `windowHours` later (default 12) instead of only in one 10-minute slot; due-time rules moved to `schedule.mjs` with `node --test` coverage, `--dry` flag added. Workflow schedules untouched. Not pushed.

### 2026-10-19 fleet pass
- Simplified the `ONLY` / `--only=` parsing in `tick.mjs` (same behaviour).
- Added `.mcp.json` and `CLAUDE.md` (knowledge MCP servers).
- Added `docs/ACTIONS-COST-2026-10-19.md`: Actions-minutes analysis. The repo is public (0 billed minutes), but scheduled runs fire about 5 times a day instead of every 10 minutes. Recommendations are in that file; no schedule or workflow was changed.
