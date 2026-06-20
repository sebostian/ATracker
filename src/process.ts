// Daemon lifecycle: start, stop, and the double-start guard.
//
// This module owns `process.json` (`{ pid, startedAt }`) entirely. The daemon
// loop itself (daemon.ts) is launched as a detached child via the hidden
// `__daemon` subcommand wired up in index.ts.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { ensureDataDir, processPath } from "./config.js";

interface ProcessState {
  pid: number;
  /** ISO 8601 timestamp of when the daemon was started. */
  startedAt: string;
}

/** Read `process.json`, or `null` if missing/corrupt. */
function readState(): ProcessState | null {
  try {
    return JSON.parse(fs.readFileSync(processPath, "utf8")) as ProcessState;
  } catch {
    return null;
  }
}

/** Remove `process.json` (no error if absent). */
function clearState(): void {
  fs.rmSync(processPath, { force: true });
}

/** Is the given pid a live process? `EPERM` means it exists but we can't signal it. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Is the daemon currently running? A `process.json` whose pid is dead is treated
 * as not running and cleaned up, so a crashed daemon doesn't block a restart.
 */
export function isRunning(): boolean {
  const state = readState();
  if (!state) return false;
  if (isAlive(state.pid)) return true;
  clearState();
  return false;
}

/**
 * Spawn the detached daemon. Refuses if one is already running. The child runs
 * the hidden `__daemon` subcommand of this same CLI entry, fully detached so it
 * outlives the launching shell.
 */
export function startDaemon(): void {
  if (isRunning()) {
    console.log("ATracker уже запущен.");
    return;
  }

  ensureDataDir();
  const entry = process.argv[1];
  const child = spawn(process.execPath, [entry, "__daemon"], {
    detached: true,
    stdio: "ignore",
  });

  if (child.pid === undefined) {
    console.error("Не удалось запустить ATracker.");
    return;
  }

  child.unref();
  const state: ProcessState = { pid: child.pid, startedAt: new Date().toISOString() };
  fs.writeFileSync(processPath, JSON.stringify(state, null, 2) + "\n");
  console.log(`ATracker запущен (pid ${child.pid}).`);
}

/** Stop the daemon and remove its state file. */
export function stopDaemon(): void {
  const state = readState();
  if (!state) {
    console.log("ATracker не запущен.");
    return;
  }

  try {
    process.kill(state.pid);
  } catch {
    // Already gone — fall through to clean up the stale state file.
  }
  clearState();
  console.log("ATracker остановлен.");
}
