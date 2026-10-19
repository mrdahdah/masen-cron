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

test("at targets fire only in their exact slot", () => {
  const t = { name: "x", every: 1440, at: "06:10" };
  assert.equal(isDue(t, at("2026-10-19T06:10:00Z")), true);
  assert.equal(isDue(t, at("2026-10-19T06:19:59Z")), true);
  assert.equal(isDue(t, at("2026-10-19T06:00:00Z")), false);
  assert.equal(isDue(t, at("2026-10-19T06:20:00Z")), false);
});
