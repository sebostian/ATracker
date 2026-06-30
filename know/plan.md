# ATracker — Design, Build & Change Log

Consolidated source-of-truth document. Combines what were previously four files:
the Russian design spec, the phased implementation plan, the `uninstall` feature
plan, and its verification.

- **Part I — Design spec** (RU): intended behaviour, the four-state model.
- **Part II — Implementation plan**: phased build, Steps 0–10.
- **Part III — Post-implementation changes**: dialog refinements.
- **Part IV — `uninstall` command**: plan + verification.

---
---

# Part I — Design spec (Russian)

## Обзор

Простое CLI-приложение для отслеживания своей активности в течение дня.

Раз в час показывает нативный диалог:

> Что ты делал последний час?

Ответ сохраняется в файл. В конце дня можно посмотреть отчёт и понять, куда ушло время.

Работает на macOS и Windows. Запускается как фоновый процесс и не мешает работе.

## 1. Архитектура

```text
atracker/
├── src/
│   ├── index.ts       # точка входа, CLI команды
│   ├── daemon.ts      # фоновый процесс
│   ├── dialog.ts      # нативный диалог (Mac / Windows)
│   ├── storage.ts     # чтение/запись данных
│   ├── report.ts      # генерация отчётов
│   └── config.ts      # работа с конфигом
├── package.json
├── tsconfig.json
└── README.md
```

Пользовательские данные:

```text
~/.atracker/
├── config.json
├── process.json
└── activities.jsonl
```

Поток данных:

```text
таймер
  → проверка пропуска интервала
      → dialog.ts
          → пользователь отвечает или закрывает окно
              → storage.ts
                  → activities.jsonl
```

## 2. Зависимости

| Пакет | Назначение |
|-------|-----------|
| commander | CLI команды |
| tsx | запуск TypeScript |

Всё остальное использует встроенные возможности Node.js.

## 3. Команды

### Запуск фонового процесса

```bash
atracker start
```

Запускает фоновый процесс. Если уже работает — выводит сообщение и завершает работу.

### Остановка

```bash
atracker stop
```

Останавливает фоновый процесс.

### Ручная запись

```bash
atracker log "код ревью"
atracker log "код ревью" --time 13:00
```

Добавляет запись вручную. `--time` позволяет указать время задним числом.

### Отчёт за сегодня

```bash
atracker report
```

Пример:

```text
10:00 написал письма
11:00 код ревью
12:00 код ревью  ← скопировано (закрыл диалог)
13:00 нет ответа ← истёк таймаут
14:00 отсутствует ← компьютер спал
15:00 звонок с командой
```

### Отчёт за конкретную дату

```bash
atracker report --date 2026-06-18
```

### Отчёт за неделю

```bash
atracker report --week
```

Показывает последние 7 дней.

## 4. Логика обработки пропусков

### Сценарий 1: пользователь закрыл диалог

Автоматическое копирование в файл не выполняется.

Сохраняется запись:

```json
{
  "timestamp": "2026-06-19T12:00:00Z",
  "status": "dismissed"
}
```

Во время построения отчёта такая запись отображается как повтор предыдущей активности:

```text
11:00 код ревью
12:00 код ревью  ← скопировано (закрыл диалог)
```

Копирование существует только на уровне отображения.

### Сценарий 2: компьютер спал или был выключен

Никакая запись не создаётся.

Если фактическое время срабатывания значительно превышает ожидаемое:

```text
delta > interval × 1.5
```

считаем, что компьютер был недоступен.

В отчёте отображается пропуск:

```text
14:00 отсутствует ← компьютер спал
```

### Сценарий 3: истёк таймаут ожидания ответа

После показа диалога запускается таймер ожидания.

Если пользователь в течение времени, указанного в конфигурации, не:

- ввёл ответ;
- нажал кнопку подтверждения;
- закрыл окно вручную;

диалог автоматически закрывается.

Сохраняется запись:

```json
{
  "timestamp": "2026-06-19T13:00:00Z",
  "status": "timeout"
}
```

Это означает, что вопрос был показан пользователю, но ответа получено не было.

## 5. Определение ОС

Используется встроенный API:

```ts
process.platform
```

Применяется в `dialog.ts` для выбора реализации диалога.

## 6. Диалоговые окна

### macOS

Через `osascript`. Используется стандартный `display dialog`.

### Windows

Через `PowerShell`. Используется нативный InputBox.

Если диалог завершился с ошибкой (нет прав, headless-режим и т.д.) — запись сохраняется со статусом `timeout`.

## 7. Фоновый процесс

Фоновый режим реализован через встроенный модуль `child_process`.

### Запуск

```bash
atracker start
```

Создаёт detached child process:

```ts
{ detached: true, stdio: "ignore" }
```

После запуска: `child.unref()`

### Состояние процесса

Файл: `~/.atracker/process.json`

```json
{
  "pid": 12345,
  "startedAt": "2026-06-19T10:00:00Z"
}
```

`startedAt` хранится в формате ISO 8601.

### Защита от двойного запуска

При старте:

1. читается `process.json`;
2. проверяется существование процесса;
3. сравнивается `startedAt`.

Если процесс уже работает — запуск отменяется.

### Остановка

```bash
atracker stop
```

Читает `process.json`, завершает процесс и удаляет файл состояния.

### Автозапуск (опционально)

```bash
atracker install
```

**macOS** — создаёт LaunchAgent в `~/Library/LaunchAgents/` и регистрирует через `launchctl load`.

**Windows** — создаёт задачу через `schtasks`, без прав администратора.

См. также `atracker uninstall` (Part IV) — обратная операция.

## 8. Формат хранилища

Файл: `~/.atracker/activities.jsonl`

Каждая строка — отдельный JSON-объект.

### Пользователь ответил

```json
{
  "timestamp": "2026-06-19T11:00:00Z",
  "status": "answered",
  "activity": "код ревью"
}
```

### Диалог закрыт

```json
{
  "timestamp": "2026-06-19T12:00:00Z",
  "status": "dismissed"
}
```

### Истёк таймаут ожидания

```json
{
  "timestamp": "2026-06-19T13:00:00Z",
  "status": "timeout"
}
```

Отсутствующие часы не записываются.

Причины отсутствия записи:

- компьютер был выключен;
- компьютер находился в sleep;
- трекер не работал.

Интерпретация выполняется при построении отчёта.

## 9. Конфигурация

Файл: `~/.atracker/config.json`

Единственный источник правды для настроек.

```json
{
  "intervalMinutes": 60,
  "dialogTimeoutMinutes": 10,
  "question": "Что ты делал последний час?"
}
```

| Поле | Назначение |
|------|-----------|
| intervalMinutes | интервал между вопросами |
| dialogTimeoutMinutes | время ожидания ответа |
| question | текст вопроса |

Интервал используется для таймера, определения пропусков и генерации отчётов. Все части приложения используют одни и те же настройки.

## Семантика данных

```text
answered   → пользователь ответил
dismissed  → пользователь закрыл окно
timeout    → пользователь проигнорировал окно
нет записи → компьютер был недоступен или трекер не работал
```

---
---

# Part II — Implementation plan

## Context

ATracker is a small cross-platform CLI that runs as a detached background daemon,
pops a **native OS dialog** once per interval ("Что ты делал последний час?"),
appends the answer to a JSONL log, and renders daily/weekly reports of where time
went.

Goal: turn the spec (Part I) into a working, compiled TypeScript CLI installable as
a global `atracker` binary, with unit tests on the pure logic. We build in
dependency order (config → storage → report → dialog → daemon → CLI → install) so
each layer can be reasoned about and tested before the next depends on it.

Decisions (confirmed with user):
- **Compile + global bin**: `tsc` → `dist/`, `bin.atracker` → `dist/index.js` (shebang).
- **Tests**: unit-test the pure logic (storage parse/append, report interpretation).
  Skip OS-dialog/daemon integration tests (they touch real processes/UI).
- **Phased build**, explained step by step.

Stack: TypeScript, ESM (`"type": "module"`), Node built-ins everywhere except
`commander` (CLI). Tests use Node's built-in `node:test` runner executed via `tsx`
(no extra test-framework dependency).

> Note: tests live in the top-level `tests/` directory, never alongside `src/`.
> (The original plan referenced `src/**/*.test.ts`; the project moved them to `tests/`.)

## Step 0 — Project scaffolding

**Why:** nothing exists; we need a compilable TS project before writing modules.

Files: `package.json`, `tsconfig.json`, `.gitignore`, `src/` dir.

- `package.json`: `"type": "module"`, `bin: { "atracker": "dist/index.js" }`,
  scripts — `build` (`tsc`), `dev` (`tsx src/index.ts`), `test` (node:test via `tsx`),
  `prepare`/`prepublishOnly` → `build`. Deps: `commander`. DevDeps: `tsx`, `typescript`,
  `@types/node`.
- `tsconfig.json`: target `ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`,
  `outDir: dist`, `rootDir: src`, `strict: true`, `declaration: false`.
- `.gitignore`: `node_modules`, `dist`.
- `src/index.ts` gets `#!/usr/bin/env node` shebang (so the compiled bin is executable).

**Verify:** `npm install`, `npm run build` produces `dist/`, `node dist/index.js --help` runs.

## Step 1 — `src/types.ts` (shared model)

**Why:** the four-state record is the crux of the whole app; defining it once keeps
storage and report in lockstep.

- `ActivityStatus = "answered" | "dismissed" | "timeout"` (the only **persisted** statuses).
- `ActivityRecord` = `{ timestamp: string /*ISO*/; status: ActivityStatus; activity?: string }`
  (`activity` present only when `answered`).
- `Config` = `{ intervalMinutes: number; dialogTimeoutMinutes: number; question: string }`.
- Report-only display types (a slot may also be `"copied"` or `"absent"` — see Step 4).

## Step 2 — `src/config.ts`

**Why:** config is the single source of truth read by daemon, gap detection, and report;
build it first so everything else can depend on it.

- Path helper: `~/.atracker/` resolved via `os.homedir()`; export `dataDir`, `configPath`,
  `processPath`, `activitiesPath`.
- `DEFAULT_CONFIG` = `{ intervalMinutes: 60, dialogTimeoutMinutes: 10, question: "Чем ты занимался?" }`.
  (Originally `"Что ты делал последний час?"`; shortened once the dialog began appending the
  concrete period — see Part III.)
- `loadConfig()`: ensure dir exists (`fs.mkdirSync(..., { recursive: true })`); if
  `config.json` missing, write defaults and return them; else parse and merge over defaults
  (so new fields get defaults).

**Verify:** unit-testable indirectly; manual — delete `~/.atracker`, run any command, confirm
`config.json` is created with defaults.

## Step 3 — `src/storage.ts` (pure, tested)

**Why:** isolate all file I/O for the JSONL log behind a tiny API; pure parsing logic is unit-tested.

- `appendRecord(record: ActivityRecord)`: ensure dir, append `JSON.stringify(record) + "\n"`
  to `activities.jsonl`.
- `readRecords(): ActivityRecord[]`: read file (return `[]` if missing), split on `\n`,
  drop blanks, `JSON.parse` each line; tolerate/skip malformed lines.
- `readRecordsForDate(date)` / `readRecordsForRange(from, to)`: filter by local-day of
  `timestamp`.

**Tests** (`tests/storage.test.ts`): round-trip append→read; malformed-line tolerance;
date filtering boundaries. Use a temp dir (`fs.mkdtempSync`) so tests don't touch `~/.atracker`
— factor the path so tests can point storage at a temp file (e.g. functions accept an
optional path arg defaulting to `activitiesPath`).

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

**Tests** (`tests/report.test.ts`): the four-state matrix — answered shows activity; dismissed
carries previous forward without persisting; timeout label; gap inserted when
`delta > interval×1.5`; week grouping.

## Step 5 — `src/dialog.ts`

**Why:** the only OS-specific surface; branch on `process.platform` and degrade gracefully.

- `askActivity(config, period?): Promise<ActivityRecord>` returning a record with status
  `answered`/`dismissed`/`timeout`. `period` is `{ start: Date; end: Date }`; when present,
  `composeQuestion` appends a concrete range to the question (`\n(с HH:MM:SS по HH:MM:SS)`)
  so the user knows exactly which slice is being asked about — see Part III.
- **macOS**: `osascript -e 'display dialog ...'` with `giving up after <timeout>`; parse
  `text returned:` for answer, detect cancel button → `dismissed`, "gave up:true" → `timeout`.
- **Windows**: PowerShell `InputBox` (`Microsoft.VisualBasic.Interaction::InputBox`); empty/
  cancel → `dismissed`. Enforce timeout by killing the child after
  `dialogTimeoutMinutes` → `timeout`. **Encoding:** force `[Console]::OutputEncoding = UTF8`
  and pass the script via `-EncodedCommand` (UTF-16LE Base64) so Cyrillic round-trips instead
  of becoming `????` — see Part III.
- Any spawn error / non-zero exit (no perms, headless) → record `timeout`.
- Use `child_process.execFile`/`spawn` with a timeout guard.

**Verify (manual, macOS here):** a temp script calling `askActivity` shows the native dialog;
answering, cancelling, and letting it time out yield the three statuses respectively.

## Step 6 — `src/daemon.ts`

**Why:** the long-running loop that ties timer → skip detection → dialog → storage.

- `runDaemon()`: loop — on each tick compute the interval that just ended
  (`{ start: now - interval, end: now }`), call `dialog.askActivity(config, period)`,
  `storage.appendRecord` the result, then schedule the next tick at `intervalMinutes`.
- On startup and each tick, compute drift; if `delta > interval × 1.5` since last expected
  fire, treat the gap as machine-unavailable (don't backfill records — the gap is inferred at
  report time per Step 4).
- Writes `process.json` `{ pid, startedAt }` on start (see Step 7 guard).

## Step 7 — `src/process.ts` (daemon lifecycle helpers)

**Why:** start/stop and the double-start guard are shared between the CLI and daemon.

- `isRunning(): boolean`: read `process.json`, `process.kill(pid, 0)` liveness check;
  stale file (pid dead) → treat as not running and clean up.
- `startDaemon()`: if `isRunning()`, print message and exit. Else spawn detached child
  (`spawn(process.execPath, [daemonEntry], { detached: true, stdio: "ignore" })`),
  `child.unref()`, write `process.json` with `{ pid: child.pid, startedAt: new Date().toISOString() }`.
- `stopDaemon()`: read `process.json`, `process.kill(pid)`, delete the file.

Note: the detached child must launch the **daemon loop**, not the CLI — index.ts exposes a
hidden `__daemon` subcommand that calls `runDaemon()`.

## Step 8 — `src/index.ts` (CLI wiring with commander)

**Why:** the user-facing surface; thin layer delegating to the modules above.

Commands (per spec):
- `start` → `startDaemon()`
- `stop` → `stopDaemon()`
- `log <text> [--time HH:MM]` → build an `answered` record (timestamp = today at `--time`,
  else now) → `appendRecord`.
- `report [--date YYYY-MM-DD] [--week]` → select records → `buildReport` → print `formatReport`.
- `install` → Step 9.
- `uninstall` → Part IV.
- hidden `__daemon` → `runDaemon()` (entry point for the detached child).

Shebang at top; `program.parseAsync`.

## Step 9 — `install` (autostart, optional)

**Why:** convenience; isolated so failure here doesn't affect core commands.

- **macOS**: write a LaunchAgent plist to `~/Library/LaunchAgents/com.atracker.plist`
  (RunAtLoad, program args = node + daemon entry), `launchctl load` it.
- **Windows**: `schtasks /create` at logon, no admin.
- Print clear next-steps; tolerate the platform not matching.

## Step 10 — `README.md`

Document install/build (`npm install && npm run build && npm link`), the commands, the
four-state semantics table, and config fields. Keep user-facing strings in Russian to match
the spec.

## Critical files

`package.json`, `tsconfig.json`, `src/{types,config,storage,report,dialog,daemon,process,install,index}.ts`,
`tests/{storage,report}.test.ts`, `README.md`.

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
---

# Part III — Post-implementation changes

Changes made after Steps 0–10 were merged. They refine the dialog only; storage, report, and
the four-state model are untouched.

## A. Windows Cyrillic corruption fix (`src/dialog.ts`)

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

## B. Show the asked period in the dialog (`src/dialog.ts`, `src/daemon.ts`, `src/config.ts`)

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

---
---

# Part IV — `uninstall` command

## План — Команда `uninstall` (удаление автозапуска)

### Цель

Добавить команду `atracker uninstall`, которая снимает регистрацию автозапуска,
выполненную через `atracker install`. Это обратная операция к `installAutostart`.

### Контекст

- `install.ts` регистрирует автозапуск:
  - macOS: пишет `~/Library/LaunchAgents/com.atracker.plist` и делает `launchctl load`.
  - Windows: создаёт задачу `schtasks /create /tn ATracker ... /sc onlogon`.
- Константы `LABEL = "com.atracker"` и `TASK_NAME = "ATracker"` уже есть в модуле.
- Команда **не** трогает `~/.atracker/` и не останавливает демон — это зона `stop`.
  `uninstall` отвечает только за автозапуск (симметрия с `install`).

### Шаги

1. **`src/install.ts` — добавить `uninstallAutostart()`** рядом с `installAutostart()`:
   - `uninstallMac()`:
     - путь к plist через тот же `path.join(os.homedir(), "Library", "LaunchAgents", \`${LABEL}.plist\`)`.
     - если файла нет → вывести «Автозапуск не установлен.» и выйти.
     - `launchctl unload <plist>` в `try/catch` (если не был загружен — игнорируем).
     - удалить файл `fs.rmSync(plistPath, { force: true })`.
     - вывести «Автозапуск удалён.».
   - `uninstallWindows()`:
     - `schtasks /delete /tn ATracker /f` в `try/catch`.
     - при ошибке (задачи нет) → «Автозапуск не установлен.».
     - иначе → «Автозапуск удалён.».
   - `uninstallAutostart()`: ветвление по `process.platform`, иначе сообщение про
     поддержку только macOS/Windows (как в `installAutostart`).

2. **`src/index.ts` — зарегистрировать команду**:
   - импорт: `import { installAutostart, uninstallAutostart } from "./install.js";`
   - новая команда `uninstall` с описанием «Удалить автозапуск при входе в систему»,
     `.action(() => uninstallAutostart())`, сразу после команды `install`.

3. **Проверка**: `npm run build` (типы), затем ручной прогон
   `npm run dev -- uninstall` (на macOS — проверка ветки и вывода).

### Вне рамок

- Тесты не добавляем: модуль `install.ts` не покрыт юнит-тестами (побочные эффекты
  на ОС), `uninstall` остаётся консистентным.
- Не трогаем данные пользователя и состояние демона.

## Verification — `atracker uninstall` (removes autostart)

Verifies the change (commit `87c147f`) by running the real CLI surface on macOS, not by tests.

**Verdict:** PASS

### Claim

`uninstall` is the inverse of `install`. On macOS it should `launchctl unload` the
LaunchAgent and delete `~/Library/LaunchAgents/com.atracker.plist`, leaving
`~/.atracker/` and the daemon untouched. Missing plist → «Автозапуск не установлен.».
Matches `src/install.ts` `uninstallMac()`.

### Method

Drove the CLI via `npm run dev -- <cmd>`. Confirmed a clean starting state first
(no plist, nothing in `launchctl list`) so a real install wasn't clobbered, then
used `install` to set up the precondition and verified `uninstall` against the
live LaunchAgent registry.

### Steps

1. ✅ `install` → «Автозапуск установлен: …com.atracker.plist»; plist written
   (479 bytes); `launchctl list` showed `79852  0  com.atracker` (loaded).
2. ✅ `uninstall` → «Автозапуск удалён.»; plist gone (`No such file or directory`);
   `com.atracker` no longer in `launchctl list` (unloaded). **The change under
   test — both the file and the live registration removed.**
3. 🔍 `uninstall` again with nothing installed → «Автозапуск не установлен.»,
   exit 0, launchctl still clean. Double-uninstall is a graceful no-op.

### Findings

- Full round-trip works: install loads + writes, uninstall unloads **and** deletes,
  redundant uninstall is a clean no-op.
- ⚠️ Dev-mode artifact (not an uninstall bug): the generated plist hardcodes
  `node` + `src/index.ts` (`process.execPath` + `process.argv[1]`). `node` can't
  run a `.ts` file, so an install done via `npm run dev` wouldn't actually launch
  at login — only the built / `npm link`-ed binary would. Relevant when testing
  `install`'s autostart behavior, not `uninstall`.
- Left state clean; pre-existing `~/.atracker/process.json` untouched, as expected
  — `uninstall` stays out of the daemon's domain.
