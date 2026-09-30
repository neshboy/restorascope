#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { parseResticJson } from "./parsers/restic.js";
import { parseBorgJson } from "./parsers/borg.js";
import { loadStore, saveStore, upsertBackups, addVerification, DEFAULT_DATA_DIR } from "./store.js";
import { successStats, verificationStatusByGroup, groupKeyOf, sizeTrend, DEFAULT_STALE_WINDOW_DAYS } from "./aggregate.js";
import { formatBytes, formatDate, formatDays } from "./format.js";
import { renderHtmlReport } from "./report/html.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
};

function color(text: string, code: string): string {
  if (process.env.NO_COLOR) return text;
  return `${code}${text}${ANSI.reset}`;
}

function readInput(file: string | undefined): string {
  if (!file || file === "-") {
    return readFileSync(0, "utf-8");
  }
  return readFileSync(file, "utf-8");
}

const program = new Command();

program
  .name("restorascope")
  .description(
    "Backup observability for restic and Borg: job history, size trends, and honest restore-verification tracking."
  )
  .version("0.1.0");

program
  .command("ingest")
  .description("Parse real restic/Borg --json output and record it locally")
  .argument("<tool>", "restic or borg")
  .argument("[file]", "path to a JSON file, or omit / pass '-' to read from stdin")
  .option("--repo <name>", "label for this backup repository/set (restic/Borg JSON does not self-identify a repo)", "default")
  .option("--data-dir <dir>", "local data directory", DEFAULT_DATA_DIR)
  .action((tool: string, file: string | undefined, opts: { repo: string; dataDir: string }) => {
    if (tool !== "restic" && tool !== "borg") {
      console.error(`Unknown tool "${tool}". Expected "restic" or "borg".`);
      process.exitCode = 1;
      return;
    }
    let raw: string;
    try {
      raw = readInput(file);
    } catch (err) {
      console.error(`Could not read input: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }

    try {
      const records = tool === "restic" ? parseResticJson(raw, opts.repo) : parseBorgJson(raw, opts.repo);
      const store = loadStore(opts.dataDir);
      const { added, updated } = upsertBackups(store, records);
      saveStore(store, opts.dataDir);

      const failed = records.filter((r) => !r.success).length;
      console.log(
        `Ingested ${records.length} ${tool} record(s) into repo "${opts.repo}" (${added} new, ${updated} updated).`
      );
      if (failed > 0) {
        console.log(color(`  ${failed} of them recorded as FAILED.`, ANSI.yellow));
      }
    } catch (err) {
      console.error(`Failed to parse ${tool} JSON: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Terminal summary of ingested backups, success rate, and restore-verification staleness")
  .option("--stale-days <n>", "verification staleness window in days", String(DEFAULT_STALE_WINDOW_DAYS))
  .option("--data-dir <dir>", "local data directory", DEFAULT_DATA_DIR)
  .action((opts: { staleDays: string; dataDir: string }) => {
    const store = loadStore(opts.dataDir);
    const staleWindowDays = Number(opts.staleDays);
    if (Number.isNaN(staleWindowDays)) {
      console.error(`Invalid --stale-days value "${opts.staleDays}": expected a number.`);
      process.exitCode = 1;
      return;
    }
    const stats = successStats(store.backups);
    const groups = verificationStatusByGroup(store.backups, store.verifications, staleWindowDays);

    console.log(color("Restorascope status", ANSI.bold));
    console.log(`  Backups ingested : ${stats.total}`);
    console.log(
      `  Success rate     : ${(stats.successRate * 100).toFixed(0)}% (${stats.succeeded} ok / ${stats.failed} failed)`
    );
    console.log(`  Backup sets      : ${groups.length}`);
    console.log("");

    if (groups.length === 0) {
      console.log(color("  No backups ingested yet. Run `restorascope ingest <restic|borg> <file>` first.", ANSI.dim));
      return;
    }

    console.log(color(`Restore verification (staleness window: ${staleWindowDays} days)`, ANSI.bold));
    for (const g of groups) {
      const label = `${g.tool}:${g.repo}`;
      const flag = g.stale
        ? color("UNVERIFIED - do you actually know this backup works?", ANSI.red)
        : color("verified", ANSI.green);
      console.log(`  ${label.padEnd(24)} last backup ${formatDate(g.lastBackupTime)}  ${flag}`);
      console.log(
        color(
          `    last verification: ${g.lastVerification ? formatDate(g.lastVerification.timestamp) : "never"} (${formatDays(
            g.daysSinceVerification
          )})`,
          ANSI.dim
        )
      );
    }
    console.log("");

    console.log(color("Size trend (most recent per set)", ANSI.bold));
    for (const g of groups) {
      const key = groupKeyOf(g);
      const trend = sizeTrend(store.backups.filter((b) => groupKeyOf(b) === key));
      const latest = trend[trend.length - 1];
      console.log(`  ${`${g.tool}:${g.repo}`.padEnd(24)} ${latest ? formatBytes(latest.sizeBytes) : "no size data"}`);
    }
  });

program
  .command("verify-restore")
  .description("Record a real, timestamped, user-attested restore verification for a backup")
  .argument("<backup-id>", "the backup/snapshot/archive id shown by `restorascope status` or the source tool")
  .requiredOption("--note <note>", "what you actually did to verify this restore, e.g. \"restored to /tmp/test-restore, verified checksums match\"")
  .option("--data-dir <dir>", "local data directory", DEFAULT_DATA_DIR)
  .action((backupId: string, opts: { note: string; dataDir: string }) => {
    const store = loadStore(opts.dataDir);
    const timestamp = new Date().toISOString();
    addVerification(store, { backupId, timestamp, note: opts.note });
    saveStore(store, opts.dataDir);

    const known = store.backups.some((b) => b.id === backupId);
    console.log(`Recorded verification for backup "${backupId}" at ${formatDate(timestamp)}.`);
    console.log(`  note: ${opts.note}`);
    if (!known) {
      console.log(
        color(
          `  Note: no ingested backup with id "${backupId}" was found yet - this verification is recorded but ` +
            `won't be matched to a backup set until a matching backup is ingested.`,
          ANSI.yellow
        )
      );
    }
  });

program
  .command("report")
  .description("Render a static HTML report (job history, size trend SVG chart, verification staleness)")
  .option("-o, --output <file>", "output HTML file path", "report.html")
  .option("--stale-days <n>", "verification staleness window in days", String(DEFAULT_STALE_WINDOW_DAYS))
  .option("--data-dir <dir>", "local data directory", DEFAULT_DATA_DIR)
  .action((opts: { output: string; staleDays: string; dataDir: string }) => {
    const store = loadStore(opts.dataDir);
    const staleWindowDays = Number(opts.staleDays);
    if (Number.isNaN(staleWindowDays)) {
      console.error(`Invalid --stale-days value "${opts.staleDays}": expected a number.`);
      process.exitCode = 1;
      return;
    }
    const html = renderHtmlReport(store, staleWindowDays);
    writeFileSync(opts.output, html, "utf-8");
    console.log(`Wrote report to ${opts.output}`);
  });

program.parseAsync(process.argv);
