// Autostart registration. Isolated so a failure here never affects core commands.
//
// On login we run the installed CLI's `start` command (not the daemon loop
// directly), so the spawn + `process.json` bookkeeping in process.ts stays the
// single source of truth — `atracker stop` keeps working afterwards.
//
//   - macOS:   a LaunchAgent plist + `launchctl load`
//   - Windows: a per-user logon task via `schtasks` (no admin needed)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LABEL = "com.atracker";
const TASK_NAME = "ATracker";

/** Escape a string for use as XML text/attribute content. */
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function installMac(node: string, entry: string): void {
  const dir = path.join(os.homedir(), "Library", "LaunchAgents");
  fs.mkdirSync(dir, { recursive: true });
  const plistPath = path.join(dir, `${LABEL}.plist`);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(node)}</string>
    <string>${xmlEscape(entry)}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
  fs.writeFileSync(plistPath, plist);

  // Reload so re-running install picks up a changed path.
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {
    // Wasn't loaded yet — fine.
  }
  try {
    execFileSync("launchctl", ["load", plistPath], { stdio: "ignore" });
  } catch (err) {
    console.error("Не удалось загрузить LaunchAgent:", (err as Error).message);
    return;
  }

  console.log(`Автозапуск установлен: ${plistPath}`);
  console.log("ATracker будет запускаться при входе в систему.");
}

function installWindows(node: string, entry: string): void {
  const tr = `"${node}" "${entry}" start`;
  try {
    execFileSync(
      "schtasks",
      ["/create", "/tn", TASK_NAME, "/tr", tr, "/sc", "onlogon", "/f"],
      { stdio: "ignore" },
    );
  } catch (err) {
    console.error("Не удалось создать задачу автозапуска:", (err as Error).message);
    return;
  }

  console.log(`Автозапуск установлен: задача "${TASK_NAME}" (запуск при входе).`);
}

/** Register autostart for the current platform. */
export function installAutostart(): void {
  const node = process.execPath;
  const entry = process.argv[1];

  if (process.platform === "darwin") return installMac(node, entry);
  if (process.platform === "win32") return installWindows(node, entry);
  console.error("Автозапуск поддерживается только на macOS и Windows.");
}

function uninstallMac(): void {
  const plistPath = path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${LABEL}.plist`,
  );

  if (!fs.existsSync(plistPath)) {
    console.log("Автозапуск не установлен.");
    return;
  }

  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {
    // Wasn't loaded — fine, still remove the file below.
  }
  fs.rmSync(plistPath, { force: true });

  console.log("Автозапуск удалён.");
}

function uninstallWindows(): void {
  try {
    execFileSync("schtasks", ["/delete", "/tn", TASK_NAME, "/f"], {
      stdio: "ignore",
    });
  } catch {
    console.log("Автозапуск не установлен.");
    return;
  }

  console.log("Автозапуск удалён.");
}

/** Remove autostart registration for the current platform. */
export function uninstallAutostart(): void {
  if (process.platform === "darwin") return uninstallMac();
  if (process.platform === "win32") return uninstallWindows();
  console.error("Автозапуск поддерживается только на macOS и Windows.");
}
