import { describe, it, expect } from "vitest";
import { emptyStore } from "../src/types.js";
import { upsertBackups, addVerification } from "../src/store.js";
import { parseResticJson } from "../src/parsers/restic.js";
import { readFixture } from "./helpers.js";

describe("upsertBackups", () => {
  it("adds new records and reports the count added", () => {
    const store = emptyStore();
    const records = parseResticJson(readFixture("restic-backup-summary.json"), "myrepo");
    const result = upsertBackups(store, records);

    expect(result).toEqual({ added: 1, updated: 0 });
    expect(store.backups).toHaveLength(1);
  });

  it("merges a later ingest of `snapshots --json` into the same record instead of clobbering size data", () => {
    const store = emptyStore();
    upsertBackups(store, parseResticJson(readFixture("restic-backup-summary.json"), "myrepo"));

    // Same run: snapshot short_id "a1b2c3d4" matches the backup summary's snapshot_id prefix.
    const snapshotRecords = parseResticJson(readFixture("restic-snapshots.json"), "myrepo");
    const result = upsertBackups(store, snapshotRecords);

    // One of the two snapshots (a1b2c3d4) matches the existing backup-summary record and merges;
    // the other (b2c3d4e5) is new.
    expect(result).toEqual({ added: 1, updated: 1 });

    const merged = store.backups.find((b) => b.id === "a1b2c3d4")!;
    // Size data from the original backup-summary ingest is preserved...
    expect(merged.sizeBytes).toBe(5482391);
    // ...while the accurate timestamp/hostname from the snapshots listing was merged in.
    expect(merged.time).toBe("2026-06-01T02:00:14.128374512-07:00");
    expect(merged.hostname).toBe("homelab-01");
  });
});

describe("addVerification", () => {
  it("appends a verification record to the store", () => {
    const store = emptyStore();
    addVerification(store, { backupId: "a1b2c3d4", timestamp: "2026-06-15T00:00:00.000Z", note: "checked" });
    expect(store.verifications).toHaveLength(1);
    expect(store.verifications[0].backupId).toBe("a1b2c3d4");
  });
});
