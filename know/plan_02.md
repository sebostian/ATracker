# ATracker — Implementation Plan

## Context

The repo currently holds only a Russian design spec (`know/plan_01.md`) — no code, no
`package.json`. ATracker is a small cross-platform CLI that runs as a detached background
daemon, pops a **native OS dialog** once per interval ("Что ты делал последний час?"),
appends the answer to a JSONL log, and renders daily/weekly reports of where time went.

Goal: turn the spec into a working, compiled TypeScript CLI installable as a global
`atracker` binary, with unit tests on the pure logic. We build in dependency order
(config → storage → report → dialog → daemon → CLI → install) so each layer can be
reasoned about and tested before the next depends on it.

Decisions (confirmed with user):
- **Compile + global bin**: `tsc` → `dist/`, `bin.atracker` → `dist/index.js` (shebang).
- **Tests**: unit-test the pure logic (storage parse/append, report interpretation).
  Skip OS-dialog/daemon integration tests (they touch real processes/UI).
- **Phased build**, explained step by step.

Stack: TypeScript, ESM (`"type": "module"`), Node built-ins everywhere except
`commander` (CLI). Tests use Node's built-in `node:test` runner executed via `tsx`
(no extra test-framework dependency).

---

## Step 0 — Project scaffolding

**Why:** nothing exists; we need a compilable TS project before writing modules.

Files: `package.json`, `tsconfig.json`, `.gitignore`, `src/` dir.

- `package.json`: `"type": "module"`, `bin: { "atracker": "dist/index.js" }`,
  scripts — `build` (`tsc`), `dev` (`tsx src/index.ts`), `test` (`tsx --test src/**/*.test.ts`),
  `prepare`/`prepublishOnly` → `build`. Deps: `commander`. DevDeps: `tsx`, `typescript`,
  `@types/node`.
- `tsconfig.json`: target `ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`,
  `outDir: dist`, `rootDir: src`, `strict: true`, `declaration: false`.
- `.gitignore`: `node_modules`, `dist`.
- `src/index.ts` gets `#!/usr/bin/env node` shebang (so the compiled bin is executable).

**Verify:** `npm install`, `npm run build` produces `dist/`, `node dist/index.js --help` runs.

---

## Step 1 — `src/types.ts` (shared model)

**Why:** the four-state record is the crux of the whole app; defining it once keeps
storage and report in lockstep.

- `ActivityStatus = "answered" | "dismissed" | "timeout"` (the only **persisted** statuses).
- `ActivityRecord` = `{ timestamp: string /*ISO*/; status: ActivityStatus; activity?: string }`
  (`activity` present only when `answered`).
- `Config` = `{ intervalMinutes: number; dialogTimeoutMinutes: number; question: string }`.
- Report-only display types (a slot may also be `"copied"` or `"absent"` — see Step 3).

---

## Step 2 — `src/config.ts`

**Why:** config is the single source of truth read by daemon, gap detection, and report;
build it first so everything else can depend on it.

- Path helper: `~/.atracker/` resolved via `os.homedir()`; export `dataDir`, `configPath`,
  `processPath`, `activitiesPath`.
- `DEFAULT_CONFIG` = `{ intervalMinutes: 60, dialogTimeoutMinutes: 10, question: "Чем ты занимался?" }`.
  (Originally `"Что ты делал последний час?"`; shortened once the dialog began appending the
  concrete period — see the Post-implementation changes addendum.)
- `loadConfig()`: ensure dir exists (`fs.mkdirSync(..., { recursive: true })`); if
  `config.json` missing, write defaults and return them; else parse and merge over defaults
  (so new fields get defaults).

**Verify:** unit-testable indirectly; manual — delete `~/.atracker`, run any command, confirm
`config.json` is created with defaults.

---

## Step 3 — `src/storage.ts` (pure, tested)

**Why:** isolate all file I/O for the JSONL log behind a tiny API; pure parsing logic is unit-tested.

- `appendRecord(record: ActivityRecord)`: ensure dir, append `JSON.stringify(record) + "\n"`
  to `activities.jsonl`.
- `readRecords(): ActivityRecord[]`: read file (return `[]` if missing), split on `\n`,
  drop blanks, `JSON.parse` each line; tolerate/skip malformed lines.
- `readRecordsForDate(date)` / `readRecordsForRange(from, to)`: filter by local-day of
  `timestamp`.

**Tests** (`src/storage.test.ts`): round-trip append→read; malformed-line tolerance;
date filtering boundaries. Use a temp dir (`fs.mkdtempSync`) so tests don't touch `~/.atracker`
— factor the path so tests can point storage at a temp file (e.g. functions accept an
optional path arg defaulting to `activitiesPath`).

---

## Step 4 — `src/report.ts` (pure, tested) — the heart

**Why:** all interpretation lives here. Storage only ever holds the 3 explicit statuses;
carry-forward and gap-filling are **display-only** and must never be written back.

- `buildReport(records, config, day)`: bucket records into interval slots; for each slot emit
  a display line:
  - `answered` → show `activity`.
  - `dismissed` → carry forward previous slot's activity, label `← скопировано (закрыл диалог)`.
    (Display only — no new record.)
  - `timeout` → `нет ответа ← истёк таймаут`.
  - **gap** (expected slot with no record) → detect via `delta > interval × 1.5` between
    consecutive timestamps; emit `отсутствует ← компьютер спал`.
- `formatReport(lines)`: render the `HH:MM  text  ← note` text block as in the spec.
- Support today / specific date / last-7-days (`--week`) by selecting the record set;
  weekly groups by day.

**Tests** (`src/report.test.ts`): the four-state matrix — answered shows activity; dismissed
carries previous forward without persisting; timeout label; gap inserted when
`delta > interval×1.5`; week grouping.

---

## Step 5 — `src/dialog.ts`

**Why:** the only OS-specific surface; branch on `process.platform` and degrade gracefully.

- `askActivity(config, period?): Promise<ActivityRecord>` returning a record with status
  `answered`/`dismissed`/`timeout`. `period` is `{ start: Date; end: Date }`; when present,
  `composeQuestion` appends a concrete range to the question (`\n(с HH:MM:SS по HH:MM:SS)`)
  so the user knows exactly which slice is being asked about — see the addendum.
- **macOS**: `osascript -e 'display dialog ...'` with `giving up after <timeout>`; parse
  `text returned:` for answer, detect cancel button → `dismissed`, "gave up:true" → `timeout`.
- **Windows**: PowerShell `InputBox` (`Microsoft.VisualBasic.Interaction::InputBox`); empty/
  cancel → `dismissed`. Enforce timeout by killing the child after
  `dialogTimeoutMinutes` → `timeout`. **Encoding:** force `[Console]::OutputEncoding = UTF8`
  and pass the script via `-EncodedCommand` (UTF-16LE Base64) so Cyrillic round-trips instead
  of becoming `????` — see the addendum.
- Any spawn error / non-zero exit (no perms, headless) → record `timeout`.
- Use `child_process.execFile`/`spawn` with a timeout guard.

**Verify (manual, macOS here):** a temp script calling `askActivity` shows the native dialog;
answering, cancelling, and letting it time out yield the three statuses respectively.

---

## Step 6 — `src/daemon.ts`

**Why:** the long-running loop that ties timer → skip detection → dialog → storage.

- `runDaemon()`: loop — on each tick compute the interval that just ended
  (`{ start: now - interval, end: now }`), call `dialog.askActivity(config, period)`,
  `storage.appendRecord` the result, then schedule the next tick at `intervalMinutes`.
- On startup and each tick, compute drift; if `delta > interval × 1.5` since last expected
  fire, treat the gap as machine-unavailable (don't backfill records — the gap is inferred at
  report time per Step 4).
- Writes `process.json` `{ pid, startedAt }` on start (see Step 7 guard).

---

## Step 7 — `src/process.ts` (daemon lifecycle helpers)

**Why:** start/stop and the double-start guard are shared between the CLI and daemon.

- `isRunning(): boolean`: read `process.json`, `process.kill(pid, 0)` liveness check;
  stale file (pid dead) → treat as not running and clean up.
- `startDaemon()`: if `isRunning()`, print message and exit. Else spawn detached child
  (`spawn(process.execPath, [daemonEntry], { detached: true, stdio: "ignore" })`),
  `child.unref()`, write `process.json` with `{ pid: child.pid, startedAt: new Date().toISOString() }`.
- `stopDaemon()`: read `process.json`, `process.kill(pid)`, delete the file.

Note: the detached child must launch the **daemon loop**, not the CLI — index.ts exposes a
hidden `__daemon` subcommand (or a separate `dist/daemon.js` entry) that calls `runDaemon()`.

---

## Step 8 — `src/index.ts` (CLI wiring with commander)

**Why:** the user-facing surface; thin layer delegating to the modules above.

Commands (per spec):
- `start` → `startDaemon()`
- `stop` → `stopDaemon()`
- `log <text> [--time HH:MM]` → build an `answered` record (timestamp = today at `--time`,
  else now) → `appendRecord`.
- `report [--date YYYY-MM-DD] [--week]` → select records → `buildReport` → print `formatReport`.
- `install` → Step 9.
- hidden `__daemon` → `runDaemon()` (entry point for the detached child).

Shebang at top; `program.parseAsync`.

---

## Step 9 — `install` (autostart, optional)

**Why:** convenience; isolated so failure here doesn't affect core commands.

- **macOS**: write a LaunchAgent plist to `~/Library/LaunchAgents/com.atracker.plist`
  (RunAtLoad, program args = node + daemon entry), `launchctl load` it.
- **Windows**: `schtasks /create` at logon, no admin.
- Print clear next-steps; tolerate the platform not matching.

---

## Step 10 — `README.md`

Document install/build (`npm install && npm run build && npm link`), the commands, the
four-state semantics table, and config fields. Keep user-facing strings in Russian to match
the spec.

---

## Critical files (new)

`package.json`, `tsconfig.json`, `src/{types,config,storage,report,dialog,daemon,process,index}.ts`,
`src/{storage,report}.test.ts`, `README.md`.

## End-to-end verification

1. `npm install && npm run build` — compiles clean to `dist/`.
2. `npm test` — storage + report unit tests pass (the four-state matrix).
3. `node dist/index.js log "код ревью" --time 11:00` then `node dist/index.js report` —
   shows the entry; add a `dismissed` line by hand to `~/.atracker/activities.jsonl` and
   confirm the report carries the previous activity forward (display-only).
4. `node dist/index.js start` → native dialog appears on next tick (lower `intervalMinutes`
   in `config.json` to test quickly); answer it, confirm a record lands in the JSONL;
   `node dist/index.js stop` removes `process.json`.
5. `npm link` → `atracker --help` works as a global binary.

---

## Post-implementation changes

Changes made after Steps 0–10 were merged. They refine the dialog only; storage, report, and
the four-state model are untouched.

### A. Windows Cyrillic corruption fix (`src/dialog.ts`)

**Symptom:** on Windows, Russian answers were saved as `????` in `activities.jsonl`.

**Cause:** PowerShell emitted the typed answer through the active OEM code page (e.g. CP866/
CP1251), not UTF-8. Characters it couldn't represent were replaced with literal `?` *inside
PowerShell, before Node read the bytes* — so `storage.ts` faithfully persisted already-broken
text.

**Fix (`askWindows`):**
- Prepend `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` so the answer comes back
  as UTF-8 bytes (Node's default `.toString()` then decodes it correctly).
- Pass the whole script as a UTF-16LE Base64 blob via `-EncodedCommand` (instead of
  `-Command`), so the Cyrillic *question* also survives the command line regardless of the
  console code page.

macOS (`osascript`) is already UTF-8 and was left unchanged.

### B. Show the asked period in the dialog (`src/dialog.ts`, `src/daemon.ts`, `src/config.ts`)

**Goal:** the dialog should name the concrete interval it asks about, e.g.
`(с 13:05:20 по 14:05:20)`, not just a generic "last hour".

**Changes:**
- `src/dialog.ts`: add `Period { start: Date; end: Date }`, a `formatTime` helper (local
  `HH:MM:SS`), and `composeQuestion(config, period?)` that appends `\n(с … по …)` to
  `config.question`. `askActivity` gains an optional `period` argument and threads the composed
  text through both platform paths.
- `src/daemon.ts`: each tick passes `{ start: now - intervalMs, end: now }` — the interval that
  just ended.
- `src/config.ts`: default `question` shortened from `"Что ты делал последний час?"` to
  `"Чем ты занимался?"` (the period now conveys the timeframe). Existing `~/.atracker/config.json`
  files keep their own `question`; they were updated manually.

`README.md` was updated to match (intro + config table).
