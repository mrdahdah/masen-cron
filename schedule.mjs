// Due-time logic of the ticker, kept free of I/O so `node --test` can exercise it (see tick.test.mjs).
export const SLOT = 10; // minutes between ticker runs
export const DEFAULT_WINDOW_HOURS = 12; // how long after its `at` time a daily target stays due

export function slotStartOf(now) {
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minuteOfDay - (minuteOfDay % SLOT);
}

// Is target `t` due on a run that happens at `now`?
// opts.only / opts.all mirror `--only=<name>` and `--all` (manual runs): they bypass the schedule.
export function isDue(t, now, { only, all } = {}) {
  if (only) return t.name === only;
  if (all) return true;
  const dow = now.getUTCDay();
  if (t.weekdays && (dow === 0 || dow === 6)) return false;
  if (t.hours && (now.getUTCHours() < t.hours[0] || now.getUTCHours() > t.hours[1])) return false;
  const slotStart = slotStartOf(now);
  if (t.at) {
    const [h, m] = t.at.split(":").map(Number);
    const at = h * 60 + m;
    const windowHours = t.windowHours ?? DEFAULT_WINDOW_HOURS;
    if (windowHours <= 0) return at >= slotStart && at < slotStart + SLOT; // narrow slot, for endpoints that are not idempotent
    // GitHub throttles the schedule to a handful of runs a day, so a daily target is due on every run from its `at` time until the
    // window closes (never past the end of the UTC day). Runs are stateless, so the endpoint must tolerate a repeat the same day.
    const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    return minuteOfDay >= at && minuteOfDay < Math.min(at + windowHours * 60, 1440);
  }
  return slotStart % t.every === 0;
}
