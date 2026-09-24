import { describe, it, expect } from "vitest";
import { parseResticJson, toShortId } from "../src/parsers/restic.js";
import { parseBorgJson } from "../src/parsers/borg.js";
import { readFixture } from "./helpers.js";

describe("restic parser", () => {
  it("parses a `restic backup --json` JSONL stream ending in a summary line", () => {
    const raw = readFixture("restic-backup-summary.json");
    const records = parseResticJson(raw, "myrepo");

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.tool).toBe("restic");
    expect(r.repo).toBe("myrepo");
    expect(r.sourceKind).toBe("restic-backup-summary");
    expect(r.success).toBe(true);

    // Real documented restic backup summary fields, parsed correctly.
    expect(r.filesNew).toBe(12);
    expect(r.filesChanged).toBe(8);
    expect(r.filesUnmodified).toBe(822);
    expect(r.sizeBytes).toBe(5482391); // total_bytes_processed
    expect(r.newOrDedupedBytes).toBe(4213891); // data_added
    expect(r.durationSeconds).toBeCloseTo(6.7331, 4);

    // id is the restic "short id" convention: first 8 hex chars of snapshot_id.
    expect(r.id).toBe(toShortId("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"));
    expect(r.id).toBe("a1b2c3d4");
  });

  it("parses a failed `restic backup --json` run (error line, no summary) as success:false", () => {
    const raw = readFixture("restic-backup-error.json");
    const records = parseResticJson(raw, "myrepo");

    expect(records).toHaveLength(1);
    expect(records[0].success).toBe(false);
    expect(records[0].errorMessage).toContain("permission denied");
    expect(records[0].sizeBytes).toBeUndefined();
  });

  it("parses `restic snapshots --json` array output into one record per snapshot", () => {
    const raw = readFixture("restic-snapshots.json");
    const records = parseResticJson(raw, "myrepo");

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id)).toEqual(["a1b2c3d4", "b2c3d4e5"]);
    expect(records[0].hostname).toBe("homelab-01");
    expect(records[0].paths).toEqual(["/home/nesh/projects"]);
    expect(records[0].time).toBe("2026-06-01T02:00:14.128374512-07:00");
    expect(records[0].sourceKind).toBe("restic-snapshot-listing");
    // Snapshot listings carry no size data - that's only in `backup --json`.
    expect(records[0].sizeBytes).toBeUndefined();
  });

  it("rejects JSON that is neither a snapshots array nor a summary/error line", () => {
    expect(() => parseResticJson('{"message_type":"status","percent_done":0.5}', "myrepo")).toThrow();
  });
});

describe("borg parser", () => {
  it("parses `borg list --json` archives with no size stats", () => {
    const raw = readFixture("borg-list.json");
    const records = parseBorgJson(raw, "myrepo");

    expect(records).toHaveLength(2);
    expect(records[0].id).toBe("homelab-01-2026-06-01T02:00:00");
    expect(records[0].tool).toBe("borg");
    expect(records[0].sourceKind).toBe("borg-list");
    expect(records[0].sizeBytes).toBeUndefined();
    expect(records[0].time).toBe("2026-06-01T02:00:00.000000");
    expect(records[0].success).toBe(true);
  });

  it("parses `borg info --json` archives with real documented stats fields", () => {
    const raw = readFixture("borg-info.json");
    const records = parseBorgJson(raw, "myrepo");

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.sourceKind).toBe("borg-info");
    expect(r.sizeBytes).toBe(8912345678); // stats.original_size
    expect(r.newOrDedupedBytes).toBe(2011223344); // stats.deduplicated_size
    expect(r.durationSeconds).toBe(272.5);
    expect(r.id).toBe("homelab-01-2026-06-01T02:00:00");
  });

  it("rejects a document without an archives array", () => {
    expect(() => parseBorgJson('{"not_archives": []}', "myrepo")).toThrow();
  });
});
