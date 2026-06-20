// JSONL log I/O for ATracker.
//
// This is the ONLY module that reads/writes `activities.jsonl`. It records raw
// facts only — the three persisted statuses (`answered`, `dismissed`,
// `timeout`). All interpretation (carry-forward, gap-filling) lives in
// `report.ts`, never here.
//
// Every function takes an optional `file` path defaulting to `activitiesPath`,
// so tests can point at a temp file instead of `~/.atracker/`.

import fs from "node:fs";
import path from "node:path";
import { activitiesPath } from "./config.js";
import type { ActivityRecord } from "./types.js";

/** Append one record as a JSON line. Creates the parent dir if needed. */
export function appendRecord(
  record: ActivityRecord,
  file: string = activitiesPath,
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
}

/**
 * Read all records. Returns `[]` if the file is missing. Blank and malformed
 * lines are skipped rather than throwing, so a single corrupt line can't break
 * a report.
 */
export function readRecords(file: string = activitiesPath): ActivityRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }

  const records: ActivityRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as ActivityRecord);
    } catch {
      // Skip malformed line.
    }
  }
  return records;
}

/** Local-day key (`YYYY-MM-DD`) for an ISO timestamp, in the machine's tz. */
function localDayKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Records whose timestamp falls on the given local day.
 * @param day a `YYYY-MM-DD` string or a `Date`.
 */
export function readRecordsForDate(
  day: string | Date,
  file: string = activitiesPath,
): ActivityRecord[] {
  const key = typeof day === "string" ? day : localDayKey(day.toISOString());
  return readRecords(file).filter((r) => localDayKey(r.timestamp) === key);
}

/**
 * Records whose timestamp falls within `[from, to]`, inclusive of both
 * endpoints (compared by local day).
 */
export function readRecordsForRange(
  from: string | Date,
  to: string | Date,
  file: string = activitiesPath,
): ActivityRecord[] {
  const fromKey = typeof from === "string" ? from : localDayKey(from.toISOString());
  const toKey = typeof to === "string" ? to : localDayKey(to.toISOString());
  return readRecords(file).filter((r) => {
    const key = localDayKey(r.timestamp);
    return key >= fromKey && key <= toKey;
  });
}
