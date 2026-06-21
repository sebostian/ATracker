// Config and path resolution for ATracker.
//
// `config.json` is the single source of truth read by the daemon, gap detection,
// and the report layer. The same `intervalMinutes` drives the timer, gap
// detection, and report bucketing — keep them consistent by always reading from
// here.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Config } from "./types.js";

/** Root directory for all user data: `~/.atracker/`. */
export const dataDir = path.join(os.homedir(), ".atracker");

/** Settings file — single source of truth. */
export const configPath = path.join(dataDir, "config.json");
/** Daemon state: `{ pid, startedAt }`. */
export const processPath = path.join(dataDir, "process.json");
/** Append-only activity log, one JSON object per line. */
export const activitiesPath = path.join(dataDir, "activities.jsonl");

export const DEFAULT_CONFIG: Config = {
  intervalMinutes: 60,
  dialogTimeoutMinutes: 10,
  question: "Чем ты занимался?",
};

/** Create `~/.atracker/` if it doesn't exist. */
export function ensureDataDir(): void {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Load config, creating it with defaults on first run. Existing config is merged
 * over the defaults so that fields added in newer versions get sane values
 * without the user having to edit the file.
 */
export function loadConfig(): Config {
  ensureDataDir();

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    // Corrupt/unreadable config: fall back to defaults rather than crash.
    return { ...DEFAULT_CONFIG };
  }
}
