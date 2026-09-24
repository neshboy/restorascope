import type { BackupRecord, BackupTool, VerificationRecord } from "./types.js";

export const DEFAULT_STALE_WINDOW_DAYS = 90;

export interface SizeTrendPoint {
  time: string;
  sizeBytes: number;
  id: string;
  tool: BackupTool;
  repo: string;
}

/** Chronological size-over-time series across all ingested backups that carry a size. */
export function sizeTrend(backups: BackupRecord[]): SizeTrendPoint[] {
  return backups
    .filter((b): b is BackupRecord & { sizeBytes: number } => typeof b.sizeBytes === "number")
    .slice()
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .map((b) => ({ time: b.time, sizeBytes: b.sizeBytes, id: b.id, tool: b.tool, repo: b.repo }));
}

export interface SuccessStats {
  total: number;
  succeeded: number;
  failed: number;
  /** 0..1, 0 when there are no records. */
  successRate: number;
}

export function successStats(backups: BackupRecord[]): SuccessStats {
  const total = backups.length;
  const succeeded = backups.filter((b) => b.success).length;
  return { total, succeeded, failed: total - succeeded, successRate: total === 0 ? 0 : succeeded / total };
}

export function groupKeyOf(b: Pick<BackupRecord, "tool" | "repo">): string {
  return `${b.tool}:${b.repo}`;
}

export interface VerificationStatus {
  tool: BackupTool;
  repo: string;
  backupCount: number;
  lastBackupTime: string | null;
  lastVerification: VerificationRecord | null;
  daysSinceVerification: number | null;
  /** True means UNVERIFIED: no verification ever recorded, or the most recent one is older than the staleness window. */
  stale: boolean;
  staleWindowDays: number;
}

/**
 * Groups ingested backups by (tool, repo) - the "backup set" - and checks
 * whether any verify-restore record attesting to a backup in that set falls
 * within `staleWindowDays` of `now`. This is the honest, achievable version
 * of "did anyone prove this backup actually restores": Restorascope can't
 * safely perform a destructive restore test itself, so it tracks whether a
 * human did (see `restorascope verify-restore`).
 */
export function verificationStatusByGroup(
  backups: BackupRecord[],
  verifications: VerificationRecord[],
  staleWindowDays: number = DEFAULT_STALE_WINDOW_DAYS,
  now: Date = new Date()
): VerificationStatus[] {
  const groups = new Map<string, { tool: BackupTool; repo: string; backups: BackupRecord[] }>();
  for (const b of backups) {
    const key = groupKeyOf(b);
    let group = groups.get(key);
    if (!group) {
      group = { tool: b.tool, repo: b.repo, backups: [] };
      groups.set(key, group);
    }
    group.backups.push(b);
  }

  const results: VerificationStatus[] = [];
  for (const group of groups.values()) {
    const idsInGroup = new Set(group.backups.map((b) => b.id));
    const relevant = verifications.filter((v) => idsInGroup.has(v.backupId));
    const last =
      relevant.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] ??
      null;
    const lastBackup =
      group.backups.slice().sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())[0] ?? null;

    let daysSinceVerification: number | null = null;
    let stale = true;
    if (last) {
      daysSinceVerification = (now.getTime() - new Date(last.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      stale = daysSinceVerification > staleWindowDays;
    }

    results.push({
      tool: group.tool,
      repo: group.repo,
      backupCount: group.backups.length,
      lastBackupTime: lastBackup?.time ?? null,
      lastVerification: last,
      daysSinceVerification,
      stale,
      staleWindowDays,
    });
  }

  return results.sort((a, b) => groupKeyOf(a).localeCompare(groupKeyOf(b)));
}
