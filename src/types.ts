// Shared data model for ATracker.
//
// The crux of the app is the four states a tracked hour can be in. Only THREE of
// them are ever written to disk (see `ActivityStatus`); the fourth — a missing
// hour because the computer was asleep/off — is never persisted and is inferred
// only at report time. Keep this file in lockstep with `storage.ts` (what we
// write) and `report.ts` (how we interpret it).

/**
 * The only statuses ever persisted to `activities.jsonl`.
 *
 * - `answered`   — user replied; the record also carries `activity`.
 * - `dismissed`  — user closed the dialog manually. The "carry forward previous
 *                  activity" behaviour shown in reports is display-only; nothing
 *                  extra is written here.
 * - `timeout`    — dialog was shown but ignored until it auto-closed, OR it
 *                  failed to launch (no permissions, headless).
 *
 * A fourth state — no record at all (machine asleep/off) — is intentionally NOT
 * part of this union: it is never stored, only inferred when building a report.
 */
export type ActivityStatus = "answered" | "dismissed" | "timeout";

/** One line in `activities.jsonl`. `activity` is present only when `answered`. */
export interface ActivityRecord {
  /** ISO 8601 timestamp of when the dialog fired. */
  timestamp: string;
  status: ActivityStatus;
  /** The user's answer; present only when `status === "answered"`. */
  activity?: string;
}

/** Contents of `~/.atracker/config.json` — the single source of truth for settings. */
export interface Config {
  /** Minutes between dialogs. Also drives gap detection and report bucketing. */
  intervalMinutes: number;
  /** Minutes a dialog waits before auto-closing as `timeout`. */
  dialogTimeoutMinutes: number;
  /** The question shown in the dialog. */
  question: string;
}

/**
 * Report-only display kinds. A rendered slot may show one of the persisted
 * statuses, or one of these two interpreted-at-render states:
 *
 * - `copied` — a `dismissed` slot displaying the previous slot's activity
 *              ("← скопировано").
 * - `absent` — an inferred gap where no record exists because the computer was
 *              asleep/off ("отсутствует ← компьютер спал").
 *
 * These NEVER appear in storage — they exist purely in `report.ts` output.
 */
export type DisplayStatus = ActivityStatus | "copied" | "absent";

/** A single rendered line in a report. */
export interface ReportSlot {
  /** ISO 8601 timestamp of the slot. */
  timestamp: string;
  status: DisplayStatus;
  /** Resolved activity text to show (carried forward for `copied`). */
  activity?: string;
}
