// Report generation for ATracker — the interpretation layer.
//
// Storage holds raw facts only (the 3 persisted statuses). EVERYTHING
// interpretive happens here and is display-only, never written back:
//
//   - `dismissed`  → carry the previous activity forward  (← скопировано)
//   - gap in time  → infer the computer was asleep/off     (← компьютер спал)
//
// The same `intervalMinutes` that drives the timer also drives gap detection
// here, so reports line up with how records were produced.

import type { ActivityRecord, Config, ReportSlot } from "./types.js";

/** A real timestamp gap larger than this multiple of the interval is a gap. */
const GAP_FACTOR = 1.5;

/** `HH:MM` in the machine's local timezone for an ISO timestamp. */
function formatTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Local-day key (`YYYY-MM-DD`) for an ISO timestamp. */
function localDayKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Turn raw records into display slots, sorted by time.
 *
 * - `answered`  → the activity, as stored.
 * - `dismissed` → previous activity carried forward (status `copied`).
 * - `timeout`   → "no answer" slot, no activity.
 * - gap         → one `absent` slot per missing interval, inserted when the gap
 *                 between consecutive records exceeds `interval × 1.5`.
 */
export function buildReport(records: ActivityRecord[], config: Config): ReportSlot[] {
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const intervalMs = config.intervalMinutes * 60_000;
  const slots: ReportSlot[] = [];

  let prevMs: number | null = null;
  let lastActivity: string | undefined; // most recent known activity, for carry-forward

  for (const record of sorted) {
    const ms = new Date(record.timestamp).getTime();

    // Insert inferred "asleep" gaps before processing this record.
    if (prevMs !== null) {
      const delta = ms - prevMs;
      if (delta > intervalMs * GAP_FACTOR) {
        const missing = Math.round(delta / intervalMs) - 1;
        for (let k = 1; k <= missing; k++) {
          slots.push({ timestamp: new Date(prevMs + k * intervalMs).toISOString(), status: "absent" });
        }
      }
    }

    switch (record.status) {
      case "answered":
        slots.push({ timestamp: record.timestamp, status: "answered", activity: record.activity });
        lastActivity = record.activity;
        break;
      case "dismissed":
        // Carry forward — display only, nothing was written for this slot.
        slots.push({ timestamp: record.timestamp, status: "copied", activity: lastActivity });
        break;
      case "timeout":
        slots.push({ timestamp: record.timestamp, status: "timeout" });
        break;
    }

    prevMs = ms;
  }

  return slots;
}

/** Render one slot as `HH:MM ...` per the spec. */
function formatSlot(slot: ReportSlot): string {
  const time = formatTime(slot.timestamp);
  switch (slot.status) {
    case "answered":
      return `${time} ${slot.activity ?? ""}`;
    case "copied":
      return `${time} ${slot.activity ?? ""} ← скопировано (закрыл диалог)`;
    case "timeout":
      return `${time} нет ответа ← истёк таймаут`;
    case "absent":
      return `${time} отсутствует ← компьютер спал`;
  }
}

/** Render a list of slots as the multi-line report text block. */
export function formatReport(slots: ReportSlot[]): string {
  return slots.map(formatSlot).join("\n");
}

/**
 * Render a weekly report: records (spanning multiple days) grouped by local day,
 * each day under a `=== YYYY-MM-DD ===` header, days in chronological order.
 */
export function formatWeeklyReport(records: ActivityRecord[], config: Config): string {
  const byDay = new Map<string, ActivityRecord[]>();
  for (const r of records) {
    const key = localDayKey(r.timestamp);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(r);
    else byDay.set(key, [r]);
  }

  const days = [...byDay.keys()].sort();
  return days
    .map((day) => `=== ${day} ===\n${formatReport(buildReport(byDay.get(day)!, config))}`)
    .join("\n\n");
}
