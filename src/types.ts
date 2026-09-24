/**
 * Internal data model shared by both the restic and Borg parsers.
 *
 * The two tools report genuinely different things, so the mapping below is
 * documented rather than pretended-equivalent:
 *
 * - `sizeBytes` is the closest analog each tool has to "how big is this
 *   backup, logically". For restic this is `total_bytes_processed` (the
 *   size of everything scanned in this backup run). For Borg this is
 *   `stats.original_size` (the uncompressed size of the files stored in
 *   this archive).
 * - `newOrDedupedBytes` is the closest analog each tool has to "how much
 *   unique data did this backup actually add to the repo". For restic this
 *   is `data_added` (new, compressed data written to the repo). For Borg
 *   this is `stats.deduplicated_size` (unique, compressed/deduped bytes
 *   this archive contributes to the repo).
 *
 * These are NOT the same metric across tools and should not be compared
 * apples-to-apples between a restic repo and a Borg repo. They are each
 * tool's own best documented answer to "how much space is this backup
 * using".
 */
export type BackupTool = "restic" | "borg";

export interface BackupRecord {
  /** Stable identifier: restic snapshot id/short_id, or Borg archive name/id. */
  id: string;
  tool: BackupTool;
  /**
   * User-supplied label identifying which repository/backup-set this
   * record belongs to (via `--repo` on ingest). Neither restic's nor
   * Borg's JSON output identifies "which repo" a run belongs to, so
   * Restorascope can't infer this automatically - it defaults to
   * "default" if not supplied.
   */
  repo: string;
  /** ISO-8601 timestamp of when the backup/archive was made. */
  time: string;
  paths?: string[];
  hostname?: string;
  filesNew?: number;
  filesChanged?: number;
  filesUnmodified?: number;
  /** See module doc: tool-specific "logical size of this backup". */
  sizeBytes?: number;
  /** See module doc: tool-specific "new/unique bytes this backup added". */
  newOrDedupedBytes?: number;
  durationSeconds?: number;
  /** Whether this ingested run represents a successful backup/archive. */
  success: boolean;
  /** Human-readable reason when success is false. */
  errorMessage?: string;
  /** Source JSON message type or shape this record was derived from, for debugging. */
  sourceKind: string;
}

export interface VerificationRecord {
  /** The BackupRecord.id this verification is attesting to. */
  backupId: string;
  /** ISO-8601 timestamp of when the verification was performed/recorded. */
  timestamp: string;
  /** User-attested note describing what was actually verified. */
  note: string;
}

export interface Store {
  backups: BackupRecord[];
  verifications: VerificationRecord[];
}

export function emptyStore(): Store {
  return { backups: [], verifications: [] };
}
