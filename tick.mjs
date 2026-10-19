// Masen cron ticker. Runs every 10 minutes from .github/workflows/tick.yml and calls the targets that are due in this 10-minute
// slot (targets.json). Prints one line per call: name, HTTP status, duration. Response bodies are never printed (public logs).
// Exit 1 when a due target fails, so a broken endpoint shows as a red run. `node tick.mjs --all` calls every target once (manual check).
// Dry run: `TICK_AT_MS=<epoch ms> node tick.mjs --dry` prints the targets due at that instant without calling anything.
import { readFileSync } from "node:fs";
import { SLOT, isDue, slotStartOf } from "./schedule.mjs";

const { targets } = JSON.parse(readFileSync(new URL("./targets.json", import.meta.url), "utf8"));
const now = new Date(Number(process.env.TICK_AT_MS) || Date.now());
const slotStart = slotStartOf(now);
const envOnly = process.env.ONLY?.trim();
const all = process.argv.includes("--all") || envOnly === "*";
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7) || (envOnly !== "*" ? envOnly : "") || undefined;

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

const list = targets.filter((t) => isDue(t, now, { only, all }));
console.log(`${now.toISOString()} slot ${String(Math.floor(slotStart / 60)).padStart(2, "0")}:${String(slotStart % 60).padStart(2, "0")} UTC · ${list.length} due`);
if (process.argv.includes("--dry")) {
  for (const t of list) console.log(`${t.name} (dry run, not called)`);
  process.exit(0);
}
const results = await Promise.all(list.map(call));
for (const r of results) console.log(r.line);
process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
