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

/** The interval the dialog is asking about: `[start, end]`. */
export interface Period {
  start: Date;
  end: Date;
}

interface RunResult {
  stdout: string;
  timedOut: boolean;
}

/** Local `HH:MM:SS` for a Date, in the machine's timezone. */
function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * The full dialog text: the configured question, plus a concrete time range so
 * the user knows exactly which slice of the day is being asked about.
 */
function composeQuestion(config: Config, period?: Period): string {
  if (!period) return config.question;
  return `${config.question}\n(с ${formatTime(period.start)} по ${formatTime(period.end)})`;
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

async function askMac(config: Config, question: string, timestamp: string): Promise<ActivityRecord> {
  const seconds = config.dialogTimeoutMinutes * 60;
  const q = escapeAppleScript(question);
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

async function askWindows(config: Config, question: string, timestamp: string): Promise<ActivityRecord> {
  const q = escapePowerShell(question);
  // InputBox has no built-in timeout, so we enforce it by killing the process.
  // It returns "" for both Cancel and an empty OK — both count as dismissed.
  //
  // Two encoding safeguards keep Cyrillic intact:
  //   - `[Console]::OutputEncoding = UTF8` makes the typed answer come back as
  //     UTF-8 bytes; without it PowerShell emits the active OEM code page and
  //     Cyrillic turns into literal "????" before Node can read it.
  //   - The whole script is passed as a UTF-16LE Base64 blob via
  //     `-EncodedCommand`, so the question survives the command line regardless
  //     of the console code page.
  const script = [
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
    `Add-Type -AssemblyName Microsoft.VisualBasic`,
    `$r = [Microsoft.VisualBasic.Interaction]::InputBox('${q}','ATracker','')`,
    `[Console]::Out.Write($r)`,
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");

  const timeoutMs = config.dialogTimeoutMinutes * 60_000;
  const { stdout, timedOut } = await run(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
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
export async function askActivity(config: Config, period?: Period): Promise<ActivityRecord> {
  const timestamp = new Date().toISOString();
  const question = composeQuestion(config, period);
  try {
    if (process.platform === "darwin") return await askMac(config, question, timestamp);
    if (process.platform === "win32") return await askWindows(config, question, timestamp);
    return { timestamp, status: "timeout" };
  } catch {
    return { timestamp, status: "timeout" };
  }
}
