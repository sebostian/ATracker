// The background loop: timer → dialog → storage.
//
// Once per `intervalMinutes` it pops the dialog and appends whatever the user
// did (answered / dismissed / timeout). It NEVER writes records for intervals it
// missed — if the machine slept through several, those gaps are inferred later
// by report.ts (the `delta > interval × 1.5` rule). The daemon only enforces the
// matching half of that rule: on wake it realigns instead of firing a burst of
// catch-up dialogs.
//
// Process-lifecycle concerns (process.json, the double-start guard, spawning the
// detached child) live in process.ts — this module is just the loop.

import { loadConfig } from "./config.js";
import { askActivity } from "./dialog.js";
import { appendRecord } from "./storage.js";

/**
 * Run the tracking loop forever. The pending timer keeps the Node process alive,
 * so callers just invoke this and let it run.
 */
export async function runDaemon(): Promise<void> {
  const config = loadConfig();
  const intervalMs = config.intervalMinutes * 60_000;
  const gapThreshold = intervalMs * 1.5;

  // Wall-clock time the *next* tick is anchored to. Anchoring to scheduled times
  // (not to when each dialog closes) keeps a steady cadence even though a dialog
  // can stay open for up to `dialogTimeoutMinutes`.
  let nextFire = Date.now() + intervalMs;

  const scheduleNext = (): void => {
    const now = Date.now();
    if (now - nextFire > gapThreshold) {
      // We're far behind — the machine was asleep/off. Realign to now rather
      // than replaying every missed interval; the gap is inferred at report time.
      nextFire = now + intervalMs;
    } else {
      nextFire += intervalMs;
    }
    setTimeout(tick, Math.max(0, nextFire - now));
  };

  const tick = async (): Promise<void> => {
    try {
      appendRecord(await askActivity(config));
    } catch {
      // A single failed tick must never kill the loop.
    }
    scheduleNext();
  };

  setTimeout(tick, Math.max(0, nextFire - Date.now()));
}
