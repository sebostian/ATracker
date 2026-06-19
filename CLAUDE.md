# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Plans

Save all plans in the `know/` folder (e.g. `know/plan_02.md`), following the existing `know/plan_01.md`.

## Project status

This repository currently contains **only a design spec** at `know/plan_01.md` (in Russian) — there is no source code, `package.json`, or build tooling yet. The plan is the source of truth for the architecture below; implement against it.

## What ATracker is

A small cross-platform (macOS + Windows) CLI that runs as a detached background process. Once per interval it pops a **native OS dialog** asking "Что ты делал последний час?" ("What were you doing the last hour?"), appends the answer to a log, and can render a daily/weekly report of where time went.

## Planned dependencies & commands

Per the spec, the only runtime deps are `commander` (CLI) and `tsx` (run TypeScript directly); everything else uses Node built-ins. Once implemented, the CLI surface is:

- `atracker start` — spawn the detached daemon (refuses if already running)
- `atracker stop` — kill the daemon, remove state file
- `atracker log "text" [--time 13:00]` — manual entry, `--time` backdates it
- `atracker report [--date YYYY-MM-DD | --week]` — today / specific date / last 7 days
- `atracker install` — register autostart (macOS LaunchAgent via `launchctl`; Windows task via `schtasks`, no admin)

## Architecture (planned module layout under `src/`)

- `index.ts` — entry point, commander CLI wiring
- `daemon.ts` — background process: timer loop, skip detection, drives the dialog
- `dialog.ts` — native dialog, branches on `process.platform`: macOS uses `osascript` `display dialog`, Windows uses a PowerShell InputBox
- `storage.ts` — read/write the JSONL log
- `report.ts` — interpret raw records into a human report
- `config.ts` — load/manage config

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
