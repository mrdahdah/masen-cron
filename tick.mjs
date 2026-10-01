// Masen cron ticker. Runs every 10 minutes from .github/workflows/tick.yml and calls the targets that are due in this 10-minute
// slot (targets.json). Prints one line per call: name, HTTP status, duration. Response bodies are never printed (public logs).
// Exit 1 when a due target fails, so a broken endpoint shows as a red run. `node tick.mjs --all` calls every target once (manual check).
import { readFileSync } from "node:fs";

const SLOT = 10; // minutes between ticker runs
const { targets } = JSON.parse(readFileSync(new URL("./targets.json", import.meta.url), "utf8"));
const now = new Date(Number(process.env.TICK_AT_MS) || Date.now());
const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
const slotStart = minuteOfDay - (minuteOfDay % SLOT);
const all = process.argv.includes("--all");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7) || process.env.ONLY?.trim() || undefined;

function due(t) {
  if (only) return t.name === only;
  if (all) return true;
  const dow = now.getUTCDay();
  if (t.weekdays && (dow === 0 || dow === 6)) return false;
  if (t.hours && (now.getUTCHours() < t.hours[0] || now.getUTCHours() > t.hours[1])) return false;
  if (t.at) {
    const [h, m] = t.at.split(":").map(Number);
    const at = h * 60 + m;
    return at >= slotStart && at < slotStart + SLOT;
  }
  return slotStart % t.every === 0;
}

async function call(t) {
  const headers = { "user-agent": "masen-cron" };
  if (t.secret) {
    const v = process.env[t.secret];
    // not migrated yet (or secret removed): a visible warning, not a red run
    if (!v) return { name: t.name, ok: true, line: `::warning::${t.name} skipped: secret ${t.secret} not set` };
    headers.authorization = `Bearer ${v}`;
  }
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(t.url, { headers, signal: AbortSignal.timeout(120_000) });
      const body = t.contains ? await res.text() : (await res.arrayBuffer(), "");
      const okStatus = t.expect === "200" ? res.status === 200 : res.ok;
      const ok = okStatus && (!t.contains || body.includes(t.contains));
      if (ok || attempt === 3 || res.status < 500) return { name: t.name, ok, line: `${t.name} ${res.status} ${Date.now() - t0} ms${ok ? "" : " FAILED"}` };
    } catch (e) {
      if (attempt === 3) return { name: t.name, ok: false, line: `${t.name} error ${e instanceof Error ? e.name : "unknown"} FAILED` };
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

const list = targets.filter(due);
console.log(`${now.toISOString()} slot ${String(Math.floor(slotStart / 60)).padStart(2, "0")}:${String(slotStart % 60).padStart(2, "0")} UTC · ${list.length} due`);
const results = await Promise.all(list.map(call));
for (const r of results) console.log(r.line);
process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
