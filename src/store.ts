import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BackupRecord, Store, VerificationRecord } from "./types.js";
import { emptyStore } from "./types.js";

export const DEFAULT_DATA_DIR = ".restorascope";
export const STORE_FILE_NAME = "store.json";

export function getStorePath(dataDir: string = DEFAULT_DATA_DIR): string {
  return join(dataDir, STORE_FILE_NAME);
}

export function loadStore(dataDir: string = DEFAULT_DATA_DIR): Store {
  const path = getStorePath(dataDir);
  if (!existsSync(path)) {
    return emptyStore();
  }
  const raw = readFileSync(path, "utf-8");
  if (raw.trim().length === 0) {
    return emptyStore();
  }
  const parsed = JSON.parse(raw) as Store;
  return {
    backups: parsed.backups ?? [],
    verifications: parsed.verifications ?? [],
  };
}

export function saveStore(store: Store, dataDir: string = DEFAULT_DATA_DIR): void {
  const path = getStorePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), "utf-8");
}

function backupKey(b: Pick<BackupRecord, "tool" | "repo" | "id">): string {
  return `${b.tool}:${b.repo}:${b.id}`;
}

/**
 * restic splits a single backup run's information across two different
 * commands: `backup --json` has size/stat fields but no real timestamp,
 * while `snapshots --json` has the real timestamp/hostname/paths but no
 * size. Both, when ingested for the same run, resolve to the same
 * (tool, repo, id) key (id is always the first-8-hex-chars short id).
 *
 * So re-ingesting isn't a blind overwrite: it's a field-level merge, where
 * the newly-ingested record's defined fields win, and anything it leaves
 * undefined falls back to what was already stored. This lets ingesting
 * both commands' output for the same run "sum" into one complete record
 * instead of the second ingest clobbering the first.
 */
function mergeBackupRecord(existing: BackupRecord, incoming: BackupRecord): BackupRecord {
  const merged: BackupRecord = { ...existing };
  for (const [key, value] of Object.entries(incoming) as [keyof BackupRecord, unknown][]) {
    if (value !== undefined) {
      (merged as any)[key] = value;
    }
  }
  return merged;
}

/**
 * Merge newly-parsed backup records into the store. Records that share the
 * same (tool, repo, id) key as an existing record are field-merged into it
 * (see `mergeBackupRecord`); new ones are appended.
 *
 * Returns how many records were newly added vs. updated in place, so the
 * CLI can report something meaningful after an ingest.
 */
export function upsertBackups(
  store: Store,
  records: BackupRecord[]
): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  for (const record of records) {
    const key = backupKey(record);
    const existingIndex = store.backups.findIndex((b) => backupKey(b) === key);
    if (existingIndex === -1) {
      store.backups.push(record);
      added++;
    } else {
      store.backups[existingIndex] = mergeBackupRecord(store.backups[existingIndex], record);
      updated++;
    }
  }
  return { added, updated };
}

export function addVerification(store: Store, record: VerificationRecord): void {
  store.verifications.push(record);
}
