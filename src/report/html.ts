import type { Store } from "../types.js";
import { sizeTrend, successStats, verificationStatusByGroup, groupKeyOf, DEFAULT_STALE_WINDOW_DAYS } from "../aggregate.js";
import { formatBytes, formatDate, formatDays } from "../format.js";
import { renderSizeTrendSvg } from "./svg.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
:root {
  color-scheme: light;
  --surface-1: #fcfcfb;
  --page-plane: #f9f9f7;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #898781;
  --gridline: #e1e0d9;
  --border: rgba(11,11,11,0.10);
  --status-good: #0ca30c;
  --status-critical: #d03b3b;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px;
  background: var(--page-plane);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 32px 0 12px; }
.subtitle { color: var(--text-secondary); font-size: 13px; margin: 0 0 24px; }
.tiles { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
.tile {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  min-width: 160px;
}
.tile .label { color: var(--text-secondary); font-size: 12px; margin-bottom: 6px; }
.tile .value { font-size: 28px; font-weight: 600; }
.tile .value.good { color: var(--status-good); }
.tile .value.critical { color: var(--status-critical); }
table { border-collapse: collapse; width: 100%; background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 8px 12px; font-size: 13px; border-bottom: 1px solid var(--gridline); font-variant-numeric: tabular-nums; }
th { color: var(--text-secondary); font-weight: 600; background: var(--page-plane); }
tr:last-child td { border-bottom: none; }
.badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
.badge.good { color: var(--status-good); }
.badge.critical { color: var(--status-critical); }
.group { margin-bottom: 40px; }
.group-header { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.chart-card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 8px; margin-bottom: 12px; }
.footnote { color: var(--text-secondary); font-size: 12px; margin-top: 40px; border-top: 1px solid var(--gridline); padding-top: 16px; }
.success-text { color: var(--status-good); font-weight: 600; }
.fail-text { color: var(--status-critical); font-weight: 600; }
`;

function verifiedBadge(stale: boolean): string {
  return stale
    ? `<span class="badge critical">&#9888; UNVERIFIED</span>`
    : `<span class="badge good">&#10003; VERIFIED</span>`;
}

export function renderHtmlReport(store: Store, staleWindowDays: number = DEFAULT_STALE_WINDOW_DAYS): string {
  const stats = successStats(store.backups);
  const groups = verificationStatusByGroup(store.backups, store.verifications, staleWindowDays);
  const unverifiedCount = groups.filter((g) => g.stale).length;
  const generatedAt = formatDate(new Date().toISOString());

  const tiles = `
    <div class="tiles">
      <div class="tile"><div class="label">Backups ingested</div><div class="value">${stats.total}</div></div>
      <div class="tile"><div class="label">Success rate</div><div class="value ${stats.successRate === 1 ? "good" : stats.failed > 0 ? "critical" : ""}">${(stats.successRate * 100).toFixed(0)}%</div></div>
      <div class="tile"><div class="label">Backup sets tracked</div><div class="value">${groups.length}</div></div>
      <div class="tile"><div class="label">Unverified backup sets</div><div class="value ${unverifiedCount > 0 ? "critical" : "good"}">${unverifiedCount}</div></div>
    </div>`;

  const verificationRows = groups
    .map(
      (g) => `
      <tr>
        <td>${escapeHtml(g.tool)}</td>
        <td>${escapeHtml(g.repo)}</td>
        <td>${g.backupCount}</td>
        <td>${escapeHtml(formatDate(g.lastBackupTime))}</td>
        <td>${g.lastVerification ? escapeHtml(formatDate(g.lastVerification.timestamp)) : "never"}</td>
        <td>${escapeHtml(formatDays(g.daysSinceVerification))}</td>
        <td>${verifiedBadge(g.stale)}</td>
      </tr>`
    )
    .join("");

  const verificationTable = `
    <h2>Restore verification status (staleness window: ${staleWindowDays} days)</h2>
    <p class="subtitle">Restorascope does not perform restore tests itself - this reflects whether a human ran
      <code>restorascope verify-restore</code> recently enough to trust these backups.</p>
    <table>
      <thead><tr><th>Tool</th><th>Repo</th><th>Backups</th><th>Last backup</th><th>Last verification</th><th>Age</th><th>Status</th></tr></thead>
      <tbody>${verificationRows || `<tr><td colspan="7">No backups ingested yet.</td></tr>`}</tbody>
    </table>`;

  const groupSections = groups
    .map((g) => {
      const key = groupKeyOf(g);
      const groupBackups = store.backups.filter((b) => groupKeyOf(b) === key).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const trend = sizeTrend(groupBackups);
      const svg = renderSizeTrendSvg(trend, `${g.tool}:${g.repo}`);
      const rows = groupBackups
        .slice()
        .reverse()
        .slice(0, 15)
        .map(
          (b) => `
          <tr>
            <td>${escapeHtml(b.id)}</td>
            <td>${escapeHtml(formatDate(b.time))}</td>
            <td>${b.success ? '<span class="success-text">success</span>' : '<span class="fail-text">failed</span>'}</td>
            <td>${escapeHtml(formatBytes(b.sizeBytes ?? null))}</td>
            <td>${escapeHtml(formatBytes(b.newOrDedupedBytes ?? null))}</td>
          </tr>`
        )
        .join("");

      return `
      <div class="group">
        <div class="group-header">${escapeHtml(g.tool)} : ${escapeHtml(g.repo)} ${verifiedBadge(g.stale)}</div>
        <div class="chart-card">${svg}</div>
        <table>
          <thead><tr><th>ID</th><th>Time</th><th>Result</th><th>Size</th><th>New/deduped</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5">No backups in this set.</td></tr>`}</tbody>
        </table>
      </div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Restorascope report</title>
<style>${STYLE}</style>
</head>
<body>
  <h1>Restorascope report</h1>
  <p class="subtitle">Generated ${escapeHtml(generatedAt)}</p>
  ${tiles}
  ${verificationTable}
  <h2>Backup sets</h2>
  ${groupSections || "<p>No backups ingested yet. Run <code>restorascope ingest</code> first.</p>"}
  <p class="footnote">Restorascope tracks whether a restore was verified by a human - it does not itself perform destructive
    restore tests. An "UNVERIFIED" backup set may still be perfectly fine; it simply means nobody has recorded proving it
    with <code>restorascope verify-restore</code> within the staleness window.</p>
</body>
</html>`;
}
