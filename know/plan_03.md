# План 03 — Команда `uninstall` (удаление автозапуска)

## Цель

Добавить команду `atracker uninstall`, которая снимает регистрацию автозапуска,
выполненную через `atracker install`. Это обратная операция к `installAutostart`.

## Контекст

- `install.ts` регистрирует автозапуск:
  - macOS: пишет `~/Library/LaunchAgents/com.atracker.plist` и делает `launchctl load`.
  - Windows: создаёт задачу `schtasks /create /tn ATracker ... /sc onlogon`.
- Константы `LABEL = "com.atracker"` и `TASK_NAME = "ATracker"` уже есть в модуле.
- Команда **не** трогает `~/.atracker/` и не останавливает демон — это зона `stop`.
  `uninstall` отвечает только за автозапуск (симметрия с `install`).

## Шаги

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

## Вне рамок

- Тесты не добавляем: модуль `install.ts` не покрыт юнит-тестами (побочные эффекты
  на ОС), `uninstall` остаётся консистентным.
- Не трогаем данные пользователя и состояние демона.
