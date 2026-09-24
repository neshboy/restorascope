import { describe, it, expect } from "vitest";
import { emptyStore } from "../src/types.js";
import { upsertBackups, addVerification } from "../src/store.js";
import { parseResticJson } from "../src/parsers/restic.js";
import { parseBorgJson } from "../src/parsers/borg.js";
import { renderSizeTrendSvg } from "../src/report/svg.js";
import { renderHtmlReport } from "../src/report/html.js";
import { sizeTrend } from "../src/aggregate.js";
import { readFixture } from "./helpers.js";

describe("renderSizeTrendSvg", () => {
  it("renders a placeholder chart when there is no size data", () => {
    const svg = renderSizeTrendSvg([], "restic:empty");
    expect(svg).toContain("<svg");
    expect(svg).toContain("No size data yet");
  });

  it("renders a line chart with a point per backup and an end-value label", () => {
    const store = emptyStore();
    upsertBackups(store, parseResticJson(readFixture("restic-backup-summary.json"), "r"));
    upsertBackups(store, parseResticJson(readFixture("restic-backup-summary-2.json"), "r"));

    const trend = sizeTrend(store.backups);
    const svg = renderSizeTrendSvg(trend, "restic:r");

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
    // Two data points -> two circles.
    expect(svg.match(/<circle/g)?.length).toBe(2);
  });
});

describe("renderHtmlReport", () => {
  it("produces a full HTML document that flags an unverified backup set", () => {
    const store = emptyStore();
    upsertBackups(store, parseResticJson(readFixture("restic-backup-summary.json"), "r"));
    upsertBackups(store, parseBorgJson(readFixture("borg-info.json"), "b"));

    const html = renderHtmlReport(store, 90);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Restorascope report");
    expect(html).toContain("UNVERIFIED");
    expect(html).toContain("<svg");
  });

  it("shows VERIFIED for a backup set with a recent verify-restore record", () => {
    const store = emptyStore();
    upsertBackups(store, parseResticJson(readFixture("restic-backup-summary.json"), "r"));
    addVerification(store, {
      backupId: "a1b2c3d4",
      timestamp: new Date().toISOString(),
      note: "restored to /tmp/test-restore, verified checksums match",
    });

    const html = renderHtmlReport(store, 90);
    expect(html).toContain('badge good">&#10003; VERIFIED');
    // The word "UNVERIFIED" still appears once, in the fixed explanatory footnote text -
    // what matters is that no *badge* flags this backup set as unverified.
    expect(html).not.toContain("badge critical");
  });
});
