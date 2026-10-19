// Due-time logic of the ticker, kept free of I/O so `node --test` can exercise it (see tick.test.mjs).
export const SLOT = 10; // minutes between ticker runs

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
    return at >= slotStart && at < slotStart + SLOT; // only the run that lands inside the exact 10-minute slot
  }
  return slotStart % t.every === 0;
}
