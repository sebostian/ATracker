import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, formatReport, formatWeeklyReport } from "../src/report.js";
import type { ActivityRecord, Config } from "../src/types.js";

const config: Config = { intervalMinutes: 60, dialogTimeoutMinutes: 10, question: "?" };

/** ISO timestamp for a given local date/time — tz-independent for assertions. */
function localIso(y: number, m: number, d: number, h: number): string {
  return new Date(y, m - 1, d, h).toISOString();
}

test("answered slot shows the stored activity", () => {
  const records: ActivityRecord[] = [
    { timestamp: localIso(2026, 6, 1, 10), status: "answered", activity: "написал письма" },
  ];
  assert.deepEqual(buildReport(records, config), [
    { timestamp: localIso(2026, 6, 1, 10), status: "answered", activity: "написал письма" },
  ]);
});

test("dismissed carries the previous activity forward without persisting", () => {
  const records: ActivityRecord[] = [
    { timestamp: localIso(2026, 6, 1, 11), status: "answered", activity: "код ревью" },
    { timestamp: localIso(2026, 6, 1, 12), status: "dismissed" },
  ];
  const slots = buildReport(records, config);

  // The dismissed slot becomes a display-only "copied" of the prior activity.
  assert.equal(slots[1].status, "copied");
  assert.equal(slots[1].activity, "код ревью");
  // No extra record was invented — still exactly two slots.
  assert.equal(slots.length, 2);
});

test("timeout slot has no activity and the timeout label", () => {
  const records: ActivityRecord[] = [
    { timestamp: localIso(2026, 6, 1, 13), status: "timeout" },
  ];
  const slots = buildReport(records, config);
  assert.equal(slots[0].status, "timeout");
  assert.equal(slots[0].activity, undefined);
  assert.equal(formatReport(slots), "13:00 нет ответа ← истёк таймаут");
});

test("a gap larger than interval × 1.5 inserts an absent slot", () => {
  const records: ActivityRecord[] = [
    { timestamp: localIso(2026, 6, 1, 13), status: "timeout" },
    // jump from 13:00 to 15:00 → 120 min > 90 min (60 × 1.5) → one missing slot at 14:00
    { timestamp: localIso(2026, 6, 1, 15), status: "answered", activity: "звонок с командой" },
  ];
  const slots = buildReport(records, config);

  assert.equal(slots.length, 3);
  assert.equal(slots[1].status, "absent");
  assert.equal(formatTimeOf(slots[1].timestamp), "14:00");
  assert.equal(slots[2].status, "answered");
});

test("a gap at exactly interval × 1.5 is not treated as absent", () => {
  const records: ActivityRecord[] = [
    { timestamp: localIso(2026, 6, 1, 13), status: "answered", activity: "a" },
    // 13:00 → 14:30 = 90 min = 60 × 1.5, not strictly greater → no gap
    { timestamp: new Date(2026, 5, 1, 14, 30).toISOString(), status: "answered", activity: "b" },
  ];
  const slots = buildReport(records, config);
  assert.equal(slots.length, 2);
  assert.ok(slots.every((s) => s.status !== "absent"));
});

test("full spec sequence renders as expected", () => {
  const records: ActivityRecord[] = [
    { timestamp: localIso(2026, 6, 1, 10), status: "answered", activity: "написал письма" },
    { timestamp: localIso(2026, 6, 1, 11), status: "answered", activity: "код ревью" },
    { timestamp: localIso(2026, 6, 1, 12), status: "dismissed" },
    { timestamp: localIso(2026, 6, 1, 13), status: "timeout" },
    { timestamp: localIso(2026, 6, 1, 15), status: "answered", activity: "звонок с командой" },
  ];
  const expected = [
    "10:00 написал письма",
    "11:00 код ревью",
    "12:00 код ревью ← скопировано (закрыл диалог)",
    "13:00 нет ответа ← истёк таймаут",
    "14:00 отсутствует ← компьютер спал",
    "15:00 звонок с командой",
  ].join("\n");
  assert.equal(formatReport(buildReport(records, config)), expected);
});

test("weekly report groups records by day under date headers", () => {
  const records: ActivityRecord[] = [
    { timestamp: localIso(2026, 6, 2, 9), status: "answered", activity: "вторник" },
    { timestamp: localIso(2026, 6, 1, 9), status: "answered", activity: "понедельник" },
  ];
  const out = formatWeeklyReport(records, config);
  assert.equal(
    out,
    ["=== 2026-06-01 ===", "09:00 понедельник", "", "=== 2026-06-02 ===", "09:00 вторник"].join("\n"),
  );
});

/** Local HH:MM helper for assertions on generated absent-slot timestamps. */
function formatTimeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
