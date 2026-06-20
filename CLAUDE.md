# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Plans

Save all plans in the `know/` folder (e.g. `know/plan_02.md`), following the existing `know/plan_01.md`.

## Project status

The CLI is **implemented** (Steps 0–10 of `know/plan_02.md`). Source lives under `src/`, with unit tests in `tests/`. The original Russian design spec is `know/plan_01.md` and the phased build plan is `know/plan_02.md` — both remain the source of truth for intended behaviour.

## Build & test

- `npm install` — install deps.
- `npm run build` — compile TypeScript to `dist/` (`tsc`).
- `npm run dev -- <args>` — run the CLI from source via `tsx` (e.g. `npm run dev -- report`).
- `npm test` — run unit tests (`node:test` via `tsx`); tests live in **`tests/`**, never alongside `src/`.
- `npm link` — expose the global `atracker` binary.

## What ATracker is

A small cross-platform (macOS + Windows) CLI that runs as a detached background process. Once per interval it pops a **native OS dialog** asking "Что ты делал последний час?" ("What were you doing the last hour?"), appends the answer to a log, and can render a daily/weekly report of where time went.

## Dependencies & commands

The only runtime dependency is `commander` (CLI); everything else uses Node built-ins. `tsx`, `typescript`, and `@types/node` are devDependencies. The CLI surface:

- `atracker start` — spawn the detached daemon (refuses if already running)
- `atracker stop` — kill the daemon, remove state file
- `atracker log "text" [--time 13:00]` — manual entry, `--time` backdates it
- `atracker report [--date YYYY-MM-DD | --week]` — today / specific date / last 7 days
- `atracker install` — register autostart (macOS LaunchAgent via `launchctl`; Windows task via `schtasks`, no admin)

## Architecture (module layout under `src/`)

- `index.ts` — entry point, commander CLI wiring; also exposes a hidden `__daemon` subcommand the detached child runs
- `types.ts` — shared data model: `ActivityStatus`, `ActivityRecord`, `Config`, and the report-only `RenderStatus`/`ReportSlot`
- `config.ts` — paths under `~/.atracker/`, `DEFAULT_CONFIG`, `loadConfig`
- `daemon.ts` — background loop: timer → dialog → storage, with drift/gap realignment (no backfill)
- `dialog.ts` — native dialog, branches on `process.platform`: macOS uses `osascript` `display dialog`, Windows uses a PowerShell InputBox; any failure degrades to `timeout`
- `storage.ts` — read/write the JSONL log (the only file-touching module for activities)
- `report.ts` — interpret raw records into a human report (carry-forward, gap-filling, weekly grouping)
- `process.ts` — daemon lifecycle: `startDaemon`/`stopDaemon` and the double-start guard; owns `process.json`
- `install.ts` — autostart registration (macOS LaunchAgent, Windows schtasks)

Data flow: `timer → skip-interval check → dialog.ts → user answers/dismisses → storage.ts → activities.jsonl`.

## User data files (`~/.atracker/`)

- `config.json` — **single source of truth** for settings, read by every part of the app: `intervalMinutes` (default 60), `dialogTimeoutMinutes` (default 10), `question`. The same `intervalMinutes` drives the timer, gap detection, and report bucketing — keep these consistent.
- `process.json` — daemon state: `{ pid, startedAt (ISO 8601) }`. Double-start guard reads this, checks the PID is alive, and compares `startedAt`.
- `activities.jsonl` — append-only, one JSON object per line.

## Core data model — the four states

This is the crux of the whole app. Each record carries a `timestamp` and a `status`:

- `answered` — user replied; record also has `activity`
- `dismissed` — user closed the dialog manually. **No copy is written to disk.** The "carry forward previous activity" behavior shown in reports (`12:00 код ревью ← скопировано`) exists *only at the report-rendering layer*, never in storage.
- `timeout` — dialog shown but ignored until `dialogTimeoutMinutes` elapsed and it auto-closed. A dialog that fails to launch (no permissions, headless) is also recorded as `timeout`.
- **no record at all** — computer was asleep/off or the tracker wasn't running. Detected when actual fire time exceeds expected by `delta > interval × 1.5`; reports render these slots as "отсутствует ← компьютер спал". Missing hours are never written; they are inferred only when building the report.

When changing report output or storage, preserve this separation: storage records raw facts (only the three explicit statuses are ever persisted), and all interpretation/carry-forward/gap-filling happens in `report.ts`.

## Conventions

- The spec and dialog/report strings are in Russian; match existing language for user-facing text.
- Background process is created with `{ detached: true, stdio: "ignore" }` followed by `child.unref()`.
