import type { BackupRecord } from "../types.js";

/**
 * Parser for Borg Backup's real, documented `--json` output.
 *
 * Two shapes are supported, matching two real Borg invocations, both of
 * which return a top-level object with an "archives" array:
 *
 * 1. `borg list --json` - each archive entry has: archive, barchive, id,
 *    name, start, time (no size stats - `borg list` never touched the
 *    archive contents, so it can't report sizes).
 *
 * 2. `borg info --json` (optionally scoped to one archive with
 *    `borg info --json ::archive-name`, or across all archives) - each
 *    archive entry additionally has: end, duration (seconds), and a
 *    "stats" object with the real documented fields:
 *      original_size, compressed_size, deduplicated_size, nfiles.
 *
 * Known honest limitation: unlike restic, Borg's list/info JSON carries no
 * per-archive success/failure signal - an archive that exists in the repo
 * is structurally complete, but Borg does not record "this run failed" in
 * a way `list`/`info` can surface. Ingested Borg archives are therefore
 * always recorded as success=true. See README "Limitations".
 */

interface BorgStats {
  original_size?: number;
  compressed_size?: number;
  deduplicated_size?: number;
  nfiles?: number;
}

interface BorgArchiveEntry {
  archive?: string;
  barchive?: string;
  id: string;
  name: string;
  start?: string;
  time?: string;
  end?: string;
  duration?: number;
  stats?: BorgStats;
}

interface BorgJsonDocument {
  archives: BorgArchiveEntry[];
  repository?: { id?: string; location?: string };
}

export function parseBorgJson(raw: string, repo: string): BackupRecord[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Empty Borg JSON input.");
  }

  let doc: BorgJsonDocument;
  try {
    doc = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `Could not parse Borg JSON input: ${(err as Error).message}. Expected the output of ` +
        "`borg list --json` or `borg info --json`."
    );
  }

  if (!doc || !Array.isArray(doc.archives)) {
    throw new Error(
      "Expected a Borg JSON document with an 'archives' array (from `borg list --json` or " +
        "`borg info --json`)."
    );
  }

  return doc.archives.map((entry) => {
    const hasStats = entry.stats !== undefined;
    return {
      id: entry.name ?? entry.archive ?? entry.id,
      tool: "borg" as const,
      repo,
      time: entry.start ?? entry.time ?? new Date().toISOString(),
      sizeBytes: entry.stats?.original_size,
      newOrDedupedBytes: entry.stats?.deduplicated_size,
      durationSeconds: entry.duration,
      success: true,
      sourceKind: hasStats ? "borg-info" : "borg-list",
    };
  });
}
