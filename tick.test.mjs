// Run with `node --test`. Pure due-time logic only: no network, no secrets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDue, slotStartOf } from "./schedule.mjs";

// 2026-10-19 is a Monday, 2026-10-18 a Sunday (UTC).
const at = (iso) => new Date(iso);

test("slotStartOf rounds down to the 10-minute slot", () => {
  assert.equal(slotStartOf(at("2026-10-19T06:09:59Z")), 360);
  assert.equal(slotStartOf(at("2026-10-19T06:10:00Z")), 370);
  assert.equal(slotStartOf(at("2026-10-19T23:59:00Z")), 1430);
});

test("interval targets fire when the slot is a multiple of every", () => {
  const t = { name: "x", every: 60 };
  assert.equal(isDue(t, at("2026-10-19T07:00:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T07:09:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T07:10:00Z")), false);
  assert.equal(isDue({ name: "y", every: 20 }, at("2026-10-19T07:20:00Z")), true);
  assert.equal(isDue({ name: "y", every: 20 }, at("2026-10-19T07:30:00Z")), false);
});

test("weekdays and hours filters apply", () => {
  const t = { name: "x", every: 10, hours: [6, 19], weekdays: true };
  assert.equal(isDue(t, at("2026-10-19T06:00:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T05:50:00Z")), false);
  assert.equal(isDue(t, at("2026-10-19T19:50:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T20:00:00Z")), false);
  assert.equal(isDue(t, at("2026-10-18T10:00:00Z")), false); // Sunday
});

test("--only and --all bypass the schedule", () => {
  const t = { name: "x", every: 1440, at: "06:00", weekdays: true };
  assert.equal(isDue(t, at("2026-10-18T13:00:00Z"), { only: "x" }), true);
  assert.equal(isDue(t, at("2026-10-18T13:00:00Z"), { only: "other" }), false);
  assert.equal(isDue(t, at("2026-10-18T13:00:00Z"), { all: true }), true);
});

test("windowHours 0 keeps the narrow slot for endpoints that are not idempotent", () => {
  const t = { name: "x", every: 1440, at: "06:10", windowHours: 0 };
  assert.equal(isDue(t, at("2026-10-19T06:10:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T06:19:59Z")), true);
  assert.equal(isDue(t, at("2026-10-19T06:00:00Z")), false);
  assert.equal(isDue(t, at("2026-10-19T06:20:00Z")), false);
  assert.equal(isDue(t, at("2026-10-19T09:00:00Z")), false);
});

test("a daily at target is due on the first run after its time, default window 12 h", () => {
  const t = { name: "x", every: 1440, at: "06:10" };
  assert.equal(isDue(t, at("2026-10-19T06:00:00Z")), false); // before at
  assert.equal(isDue(t, at("2026-10-19T06:09:59Z")), false); // slot starts 06:00, but the target is not due yet
  assert.equal(isDue(t, at("2026-10-19T06:10:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T08:47:00Z")), true); // a throttled run that lands hours later
  assert.equal(isDue(t, at("2026-10-19T16:09:59Z")), true);
  assert.equal(isDue(t, at("2026-10-19T18:09:59Z")), true);
  assert.equal(isDue(t, at("2026-10-19T18:10:00Z")), false); // window closed
  assert.equal(isDue(t, at("2026-10-19T23:50:00Z")), false);
  assert.equal(isDue(t, at("2026-10-20T00:00:00Z")), false); // next day starts before at
});

test("windowHours is configurable per target", () => {
  const t = { name: "x", every: 1440, at: "06:00", windowHours: 4 };
  assert.equal(isDue(t, at("2026-10-19T09:59:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T10:00:00Z")), false);
});

test("the window never runs past the end of the UTC day", () => {
  const t = { name: "x", every: 1440, at: "20:00" }; // 12 h would reach 08:00 the next day
  assert.equal(isDue(t, at("2026-10-19T20:00:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T23:59:00Z")), true);
  assert.equal(isDue(t, at("2026-10-20T00:10:00Z")), false);
  assert.equal(isDue(t, at("2026-10-20T07:00:00Z")), false);
});

test("a weekday-only daily target skips the weekend inside its window", () => {
  const t = { name: "x", every: 1440, at: "06:00", weekdays: true };
  assert.equal(isDue(t, at("2026-10-19T11:00:00Z")), true); // Monday
  assert.equal(isDue(t, at("2026-10-17T11:00:00Z")), false); // Saturday
  assert.equal(isDue(t, at("2026-10-18T11:00:00Z")), false); // Sunday
  assert.equal(isDue(t, at("2026-10-23T11:00:00Z")), true); // Friday
});

test("a daily target is due once per day on a sparse schedule, and again on every later run inside the window", () => {
  const t = { name: "x", every: 1440, at: "06:00" };
  // Observed shape: about 5 runs a day with gaps of 1.6-9.9 h.
  const runs = ["00:40", "03:10", "08:20", "13:05", "21:30"].map((hm) => at(`2026-10-19T${hm}:00Z`));
  assert.deepEqual(runs.map((r) => isDue(t, r)), [false, false, true, true, false]);
});

test("the targets.json daily targets declare an at time within the day and a sane window", async () => {
  const { readFileSync } = await import("node:fs");
  const { targets } = JSON.parse(readFileSync(new URL("./targets.json", import.meta.url), "utf8"));
  for (const t of targets.filter((x) => x.at)) {
    assert.match(t.at, /^([01]\d|2[0-3]):[0-5]\d$/, t.name);
    assert.ok(t.windowHours === undefined || (t.windowHours >= 0 && t.windowHours <= 24), t.name);
  }
});

test("at targets fire only in their exact slot when the window is off", () => {
  const t = { name: "x", every: 1440, at: "06:10", windowHours: 0 };
  assert.equal(isDue(t, at("2026-10-19T06:10:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T06:20:00Z")), false);
});
