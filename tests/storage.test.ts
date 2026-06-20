import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendRecord,
  readRecords,
  readRecordsForDate,
  readRecordsForRange,
} from "../src/storage.js";
import type { ActivityRecord } from "../src/types.js";

/** Create a fresh temp file path inside a temp dir for one test. */
function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atracker-test-"));
  return path.join(dir, "activities.jsonl");
}

/** ISO timestamp for a given local date/time — tz-independent for assertions. */
function localIso(y: number, m: number, d: number, h = 12): string {
  return new Date(y, m - 1, d, h).toISOString();
}

test("append then read round-trips records in order", () => {
  const file = tempFile();
  const a: ActivityRecord = { timestamp: localIso(2026, 6, 1, 9), status: "answered", activity: "код ревью" };
  const b: ActivityRecord = { timestamp: localIso(2026, 6, 1, 10), status: "timeout" };
  const c: ActivityRecord = { timestamp: localIso(2026, 6, 1, 11), status: "dismissed" };

  appendRecord(a, file);
  appendRecord(b, file);
  appendRecord(c, file);

  assert.deepEqual(readRecords(file), [a, b, c]);
});

test("readRecords returns [] when the file is missing", () => {
  const missing = path.join(os.tmpdir(), "atracker-does-not-exist", "x.jsonl");
  assert.deepEqual(readRecords(missing), []);
});

test("malformed and blank lines are skipped, valid ones kept", () => {
  const file = tempFile();
  const good: ActivityRecord = { timestamp: localIso(2026, 6, 1, 9), status: "answered", activity: "a" };
  fs.writeFileSync(
    file,
    [
      JSON.stringify(good),
      "",
      "not json at all",
      "{ broken",
      "   ",
    ].join("\n") + "\n",
  );

  assert.deepEqual(readRecords(file), [good]);
});

test("readRecordsForDate filters to a single local day", () => {
  const file = tempFile();
  const day1 = { timestamp: localIso(2026, 6, 1, 23), status: "answered", activity: "late" } as ActivityRecord;
  const day2 = { timestamp: localIso(2026, 6, 2, 0), status: "answered", activity: "early" } as ActivityRecord;
  appendRecord(day1, file);
  appendRecord(day2, file);

  assert.deepEqual(readRecordsForDate("2026-06-01", file), [day1]);
  assert.deepEqual(readRecordsForDate("2026-06-02", file), [day2]);
});

test("readRecordsForRange is inclusive of both endpoints", () => {
  const file = tempFile();
  const r1 = { timestamp: localIso(2026, 6, 1, 12), status: "timeout" } as ActivityRecord;
  const r2 = { timestamp: localIso(2026, 6, 2, 12), status: "timeout" } as ActivityRecord;
  const r3 = { timestamp: localIso(2026, 6, 3, 12), status: "timeout" } as ActivityRecord;
  const r4 = { timestamp: localIso(2026, 6, 4, 12), status: "timeout" } as ActivityRecord;
  for (const r of [r1, r2, r3, r4]) appendRecord(r, file);

  assert.deepEqual(readRecordsForRange("2026-06-02", "2026-06-03", file), [r2, r3]);
});
