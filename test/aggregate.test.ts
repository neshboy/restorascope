import { describe, it, expect } from "vitest";
import { sizeTrend, successStats, verificationStatusByGroup } from "../src/aggregate.js";
import type { BackupRecord, VerificationRecord } from "../src/types.js";

function backup(overrides: Partial<BackupRecord>): BackupRecord {
  return {
    id: "abc123",
    tool: "restic",
    repo: "default",
    time: "2026-06-01T00:00:00.000Z",
    success: true,
    sourceKind: "test",
    ...overrides,
  };
}

describe("sizeTrend", () => {
  it("sorts by time ascending and drops records with no size data", () => {
    const backups = [
      backup({ id: "b", time: "2026-06-08T00:00:00.000Z", sizeBytes: 200 }),
      backup({ id: "a", time: "2026-06-01T00:00:00.000Z", sizeBytes: 100 }),
      backup({ id: "c", time: "2026-06-15T00:00:00.000Z" }), // no size - excluded
    ];

    const trend = sizeTrend(backups);
    expect(trend.map((p) => p.id)).toEqual(["a", "b"]);
    expect(trend.map((p) => p.sizeBytes)).toEqual([100, 200]);
  });

  it("returns an empty array when nothing has size data", () => {
    expect(sizeTrend([backup({ sizeBytes: undefined })])).toEqual([]);
  });
});

describe("successStats", () => {
  it("counts successes and failures and computes a success rate", () => {
    const backups = [backup({ success: true }), backup({ success: true }), backup({ success: false })];
    const stats = successStats(backups);
    expect(stats).toEqual({ total: 3, succeeded: 2, failed: 1, successRate: 2 / 3 });
  });

  it("reports a 0 success rate (not NaN) for an empty history", () => {
    expect(successStats([]).successRate).toBe(0);
  });
});

describe("verificationStatusByGroup", () => {
  const now = new Date("2026-06-20T00:00:00.000Z");

  it("flags a backup set with no verification records at all as stale/UNVERIFIED", () => {
    const backups = [backup({ id: "a", tool: "restic", repo: "unverified-repo" })];
    const statuses = verificationStatusByGroup(backups, [], 90, now);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].stale).toBe(true);
    expect(statuses[0].lastVerification).toBeNull();
    expect(statuses[0].daysSinceVerification).toBeNull();
  });

  it("flags a backup set whose most recent verification is older than the staleness window", () => {
    const backups = [backup({ id: "a", tool: "restic", repo: "stale-repo" })];
    const verifications: VerificationRecord[] = [
      { backupId: "a", timestamp: "2026-01-01T00:00:00.000Z", note: "restored months ago" },
    ];
    const statuses = verificationStatusByGroup(backups, verifications, 90, now);

    expect(statuses[0].stale).toBe(true);
    expect(statuses[0].daysSinceVerification).toBeGreaterThan(90);
  });

  it("does NOT flag a backup set with a recent verification within the staleness window", () => {
    const backups = [backup({ id: "a", tool: "restic", repo: "fresh-repo" })];
    const verifications: VerificationRecord[] = [
      {
        backupId: "a",
        timestamp: "2026-06-10T00:00:00.000Z", // 10 days before `now`
        note: "restored to /tmp/test-restore, verified checksums match",
      },
    ];
    const statuses = verificationStatusByGroup(backups, verifications, 90, now);

    expect(statuses[0].stale).toBe(false);
    expect(statuses[0].daysSinceVerification).toBeCloseTo(10, 5);
    expect(statuses[0].lastVerification?.note).toContain("checksums match");
  });

  it("groups independently by (tool, repo) so one verified set doesn't cover another", () => {
    const backups = [
      backup({ id: "a", tool: "restic", repo: "repo-a" }),
      backup({ id: "b", tool: "borg", repo: "repo-b" }),
    ];
    const verifications: VerificationRecord[] = [
      { backupId: "a", timestamp: "2026-06-15T00:00:00.000Z", note: "verified repo-a" },
    ];
    const statuses = verificationStatusByGroup(backups, verifications, 90, now);

    const repoA = statuses.find((s) => s.repo === "repo-a")!;
    const repoB = statuses.find((s) => s.repo === "repo-b")!;
    expect(repoA.stale).toBe(false);
    expect(repoB.stale).toBe(true);
  });
});
