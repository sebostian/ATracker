#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { startDaemon, stopDaemon } from "./process.js";
import { runDaemon } from "./daemon.js";
import {
  appendRecord,
  readRecordsForDate,
  readRecordsForRange,
} from "./storage.js";
import { buildReport, formatReport, formatWeeklyReport } from "./report.js";
import { installAutostart, uninstallAutostart } from "./install.js";
import type { ActivityRecord } from "./types.js";

/** Build an ISO timestamp for now, or for today at `HH:MM` if `--time` was given. */
function timestampFor(time: string | undefined): string {
  const d = new Date();
  if (time) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!m) {
      console.error("Неверный формат времени, ожидается HH:MM.");
      process.exit(1);
    }
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  }
  return d.toISOString();
}

const program = new Command();

program
  .name("atracker")
  .description("Отслеживание активности: раз в интервал спрашивает, чем ты занимался.")
  .version("0.1.0");

program
  .command("start")
  .description("Запустить фоновый процесс")
  .action(() => startDaemon());

program
  .command("stop")
  .description("Остановить фоновый процесс")
  .action(() => stopDaemon());

program
  .command("log")
  .description("Добавить запись вручную")
  .argument("<text>", "чем ты занимался")
  .option("--time <HH:MM>", "указать время задним числом")
  .action((text: string, opts: { time?: string }) => {
    const record: ActivityRecord = {
      timestamp: timestampFor(opts.time),
      status: "answered",
      activity: text,
    };
    appendRecord(record);
    console.log("Записано.");
  });

program
  .command("report")
  .description("Показать отчёт")
  .option("--date <YYYY-MM-DD>", "отчёт за конкретную дату")
  .option("--week", "отчёт за последние 7 дней")
  .action((opts: { date?: string; week?: boolean }) => {
    const config = loadConfig();
    if (opts.week) {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 6); // 7 days inclusive of today
      const out = formatWeeklyReport(readRecordsForRange(from, to), config);
      console.log(out || "Нет записей.");
    } else {
      const records = readRecordsForDate(opts.date ?? new Date());
      const out = formatReport(buildReport(records, config));
      console.log(out || "Нет записей.");
    }
  });

program
  .command("install")
  .description("Зарегистрировать автозапуск при входе в систему")
  .action(() => installAutostart());

program
  .command("uninstall")
  .description("Удалить автозапуск при входе в систему")
  .action(() => uninstallAutostart());

// Hidden entry point for the detached child spawned by `start` — runs the loop.
program
  .command("__daemon", { hidden: true })
  .action(async () => {
    await runDaemon();
  });

await program.parseAsync(process.argv);
