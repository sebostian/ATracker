#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("atracker")
  .description("Отслеживание активности: раз в интервал спрашивает, чем ты занимался.")
  .version("0.1.0");

// Commands are wired up in later steps (start, stop, log, report, install).

await program.parseAsync(process.argv);