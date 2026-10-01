# masen-cron

One 10-minute ticker for the scheduled jobs of the Masen apps (Reach, Lynk, Nexus, Vyson, Contyq).

**Why it exists.** GitHub Actions minutes are free and unlimited on public repositories, but the private repos only get 2,000
minutes a month. Each scheduled run is billed at one minute at least, so the per-app schedulers (every 10–60 min) used up the private
budget on their own and blocked CI. Here, one job calls whatever is due in its 10-minute slot.

**What is public.** Only this code, `targets.json` (URLs of apps that are public anyway) and the run logs, which print a name, an HTTP
status and a duration per call — never a response body. Tokens are repository secrets and are never printed.

| File | Role |
|---|---|
| `targets.json` | endpoints, cadence (`every` minutes, optional `hours` UTC window, `weekdays`, `at` HH:MM), secret name, expected status |
| `tick.mjs` | picks the due targets, calls them (3 tries on 5xx/network), exits 1 if one fails |
| `.github/workflows/tick.yml` | runs every 10 min; manual run can target one name (`only`) |
| `.github/workflows/keepalive.yml` | monthly heartbeat commit (GitHub pauses schedules of inactive public repos after 60 days) |
| `scripts/migrate.py` | one-off move from the private repos: rotates each app's `CRON_SECRET`, redeploys, verifies, disables the old schedule |

```bash
node tick.mjs --all                 # call every target once (needs the secrets in the environment)
node tick.mjs --only=nexus-routines
python scripts/migrate.py           # dry run
```

Rollback for one app: `gh workflow enable <workflow>.yml -R mrdahdah/<repo>` (its secret was updated too, so it works as before),
then remove the target from `targets.json`.
