import type { BackupRecord } from "../types.js";

/**
 * Parser for restic's real, documented `--json` output.
 *
 * Two shapes are supported, matching two real restic invocations:
 *
 * 1. `restic backup --json` - emits one JSON object per line (JSONL) while
 *    the backup runs (message_type: "status"/"verbose_status"), and on
 *    success a single final line with message_type "summary" containing
 *    the real documented fields:
 *      files_new, files_changed, files_unmodified, dirs_new, dirs_changed,
 *      dirs_unmodified, data_blobs, tree_blobs, data_added,
 *      data_added_packed, total_files_processed, total_bytes_processed,
 *      total_duration, snapshot_id.
 *    On failure, restic instead emits one or more lines with
 *    message_type "error" (shape: { message_type, error: { message },
 *    during, item }) and no "summary" line.
 *
 * 2. `restic snapshots --json` - emits a single JSON array of snapshot
 *    objects, each with: time, parent, tree, paths, hostname, username,
 *    id, short_id (and optionally tags, program_version, etc). This shape
 *    carries no size/stat information - restic's snapshot listing never
 *    did size accounting, only the backup run itself does.
 */

interface ResticSummaryLine {
  message_type: "summary";
  files_new?: number;
  files_changed?: number;
  files_unmodified?: number;
  data_added?: number;
  data_added_packed?: number;
  total_files_processed?: number;
  total_bytes_processed?: number;
  total_duration?: number;
  snapshot_id?: string;
}

interface ResticErrorLine {
  message_type: "error";
  error?: { message?: string };
  during?: string;
  item?: string;
}

interface ResticSnapshotEntry {
  time: string;
  paths?: string[];
  hostname?: string;
  username?: string;
  id: string;
  short_id?: string;
  tags?: string[];
}

/** restic's own convention: the short id is the first 8 hex chars of the full id. */
export function toShortId(fullId: string): string {
  return fullId.slice(0, 8);
}

function parseSnapshotsArray(entries: ResticSnapshotEntry[], repo: string): BackupRecord[] {
  return entries.map((entry) => ({
    id: entry.short_id ?? toShortId(entry.id),
    tool: "restic" as const,
    repo,
    time: entry.time,
    paths: entry.paths,
    hostname: entry.hostname,
    success: true,
    sourceKind: "restic-snapshot-listing",
  }));
}

function parseBackupJsonLines(lines: string[], repo: string): BackupRecord[] {
  const parsedLines: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    parsedLines.push(JSON.parse(trimmed));
  }

  const summary = parsedLines.find(
    (l): l is ResticSummaryLine =>
      typeof l === "object" && l !== null && (l as any).message_type === "summary"
  );
  const errors = parsedLines.filter(
    (l): l is ResticErrorLine =>
      typeof l === "object" && l !== null && (l as any).message_type === "error"
  );

  if (summary) {
    const id = summary.snapshot_id
      ? toShortId(summary.snapshot_id)
      : `no-snapshot-id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return [
      {
        id,
        tool: "restic",
        repo,
        time: new Date().toISOString(),
        filesNew: summary.files_new,
        filesChanged: summary.files_changed,
        filesUnmodified: summary.files_unmodified,
        sizeBytes: summary.total_bytes_processed,
        newOrDedupedBytes: summary.data_added,
        durationSeconds: summary.total_duration,
        success: true,
        sourceKind: "restic-backup-summary",
      },
    ];
  }

  if (errors.length > 0) {
    const first = errors[0];
    return [
      {
        id: `failed-${Date.now()}`,
        tool: "restic",
        repo,
        time: new Date().toISOString(),
        success: false,
        errorMessage: first.error?.message ?? `restic error during "${first.during ?? "backup"}"`,
        sourceKind: "restic-backup-error",
      },
    ];
  }

  throw new Error(
    "Could not find a restic 'summary' or 'error' message in this --json output. " +
      "Expected the output of `restic backup --json` (JSON lines) or `restic snapshots --json` (a JSON array)."
  );
}

export function parseResticJson(raw: string, repo: string): BackupRecord[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Empty restic JSON input.");
  }

  // Try whole-document parse first: covers `restic snapshots --json` (an
  // array) and the degenerate case of a single JSON object on its own.
  try {
    const whole = JSON.parse(trimmed);
    if (Array.isArray(whole)) {
      return parseSnapshotsArray(whole as ResticSnapshotEntry[], repo);
    }
    if (typeof whole === "object" && whole !== null) {
      // Single JSON object: treat as a one-line backup --json stream.
      return parseBackupJsonLines([trimmed], repo);
    }
  } catch {
    // Not a single JSON document - fall through to JSON-lines handling,
    // which is the normal shape of `restic backup --json` output.
  }

  return parseBackupJsonLines(trimmed.split("\n"), repo);
}
