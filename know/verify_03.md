# Verification 03 — `atracker uninstall` (removes autostart)

Verifies the change from `plan_03.md` / commit `87c147f` by running the real CLI
surface on macOS, not by tests.

**Verdict:** PASS

## Claim

`uninstall` is the inverse of `install`. On macOS it should `launchctl unload` the
LaunchAgent and delete `~/Library/LaunchAgents/com.atracker.plist`, leaving
`~/.atracker/` and the daemon untouched. Missing plist → «Автозапуск не установлен.».
Matches `src/install.ts` `uninstallMac()`.

## Method

Drove the CLI via `npm run dev -- <cmd>`. Confirmed a clean starting state first
(no plist, nothing in `launchctl list`) so a real install wasn't clobbered, then
used `install` to set up the precondition and verified `uninstall` against the
live LaunchAgent registry.

## Steps

1. ✅ `install` → «Автозапуск установлен: …com.atracker.plist»; plist written
   (479 bytes); `launchctl list` showed `79852  0  com.atracker` (loaded).
2. ✅ `uninstall` → «Автозапуск удалён.»; plist gone (`No such file or directory`);
   `com.atracker` no longer in `launchctl list` (unloaded). **The change under
   test — both the file and the live registration removed.**
3. 🔍 `uninstall` again with nothing installed → «Автозапуск не установлен.»,
   exit 0, launchctl still clean. Double-uninstall is a graceful no-op.

## Findings

- Full round-trip works: install loads + writes, uninstall unloads **and** deletes,
  redundant uninstall is a clean no-op.
- ⚠️ Dev-mode artifact (not an uninstall bug): the generated plist hardcodes
  `node` + `src/index.ts` (`process.execPath` + `process.argv[1]`). `node` can't
  run a `.ts` file, so an install done via `npm run dev` wouldn't actually launch
  at login — only the built / `npm link`-ed binary would. Relevant when testing
  `install`'s autostart behavior, not `uninstall`.
- Left state clean; pre-existing `~/.atracker/process.json` untouched, as expected
  — `uninstall` stays out of the daemon's domain.
