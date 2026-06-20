// Native OS dialog — the only platform-specific surface in ATracker.
//
// `askActivity` pops a native dialog asking the configured question and resolves
// to an `ActivityRecord` with one of the three persisted statuses:
//
//   - answered   — user typed an answer and confirmed.
//   - dismissed  — user cancelled / closed the dialog (or left it empty on Win).
//   - timeout    — dialog auto-closed after `dialogTimeoutMinutes`, OR it could
//                  not be shown at all (no permissions, headless, unsupported OS).
//
// macOS uses `osascript display dialog`; Windows uses a PowerShell InputBox.

import { spawn } from "node:child_process";
import type { ActivityRecord, Config } from "./types.js";

interface RunResult {
  stdout: string;
  timedOut: boolean;
}

/**
 * Spawn a command, collect stdout. If `timeoutMs` is set and elapses, kill the
 * child and resolve with `timedOut: true`. Rejects on spawn error or non-zero
 * exit (so callers can map failure to a `timeout` record).
 */
function run(cmd: string, args: string[], timeoutMs?: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
    }

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        resolve({ stdout, timedOut: true });
        return;
      }
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}`));
        return;
      }
      resolve({ stdout, timedOut: false });
    });
  });
}

/** Escape a string for embedding in an AppleScript double-quoted literal. */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Escape a string for embedding in a PowerShell single-quoted literal. */
function escapePowerShell(s: string): string {
  return s.replace(/'/g, "''");
}

async function askMac(config: Config, timestamp: string): Promise<ActivityRecord> {
  const seconds = config.dialogTimeoutMinutes * 60;
  const q = escapeAppleScript(config.question);
  // The script normalises every outcome to a single stdout token so we don't
  // depend on the order of AppleScript record fields. Cancel raises -128, which
  // we catch and report as DISMISSED (keeping the exit code 0).
  const script = [
    `try`,
    `  set r to display dialog "${q}" default answer "" with title "ATracker" giving up after ${seconds}`,
    `on error number -128`,
    `  return "DISMISSED"`,
    `end try`,
    `if gave up of r then return "TIMEOUT"`,
    `return "ANSWERED:" & (text returned of r)`,
  ].join("\n");

  const { stdout } = await run("osascript", ["-e", script]);
  const text = stdout.replace(/\n$/, "");
  if (text === "DISMISSED") return { timestamp, status: "dismissed" };
  if (text === "TIMEOUT") return { timestamp, status: "timeout" };
  if (text.startsWith("ANSWERED:")) {
    return { timestamp, status: "answered", activity: text.slice("ANSWERED:".length) };
  }
  return { timestamp, status: "timeout" };
}

async function askWindows(config: Config, timestamp: string): Promise<ActivityRecord> {
  const q = escapePowerShell(config.question);
  // InputBox has no built-in timeout, so we enforce it by killing the process.
  // It returns "" for both Cancel and an empty OK — both count as dismissed.
  const script = [
    `Add-Type -AssemblyName Microsoft.VisualBasic`,
    `$r = [Microsoft.VisualBasic.Interaction]::InputBox('${q}','ATracker','')`,
    `[Console]::Out.Write($r)`,
  ].join("; ");

  const timeoutMs = config.dialogTimeoutMinutes * 60_000;
  const { stdout, timedOut } = await run(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    timeoutMs,
  );
  if (timedOut) return { timestamp, status: "timeout" };
  if (stdout.length === 0) return { timestamp, status: "dismissed" };
  return { timestamp, status: "answered", activity: stdout };
}

/**
 * Show the dialog and resolve to a record. Any failure to display it (missing
 * permissions, headless session, unsupported platform) degrades to `timeout`.
 */
export async function askActivity(config: Config): Promise<ActivityRecord> {
  const timestamp = new Date().toISOString();
  try {
    if (process.platform === "darwin") return await askMac(config, timestamp);
    if (process.platform === "win32") return await askWindows(config, timestamp);
    return { timestamp, status: "timeout" };
  } catch {
    return { timestamp, status: "timeout" };
  }
}
