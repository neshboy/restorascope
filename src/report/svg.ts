import type { SizeTrendPoint } from "../aggregate.js";
import { formatBytes, formatDate } from "../format.js";

/**
 * Hand-built SVG line chart for a size-over-time trend, with no charting
 * library. One backup-set (tool:repo) per chart - each is its own line,
 * on its own axis, rather than overlaying tools/repos whose size metrics
 * aren't directly comparable (see types.ts doc comment).
 *
 * Palette/spec choices follow this project's data-viz conventions: a
 * single series needs no legend, a 2px round-joined line, an >=8px end
 * marker, hairline recessive gridlines, and text kept in ink tokens
 * rather than the series color.
 */

const WIDTH = 720;
const HEIGHT = 280;
const PAD_LEFT = 70;
const PAD_RIGHT = 24;
const PAD_TOP = 28;
const PAD_BOTTOM = 40;

const COLOR_SURFACE = "#fcfcfb";
const COLOR_SERIES = "#2a78d6";
const COLOR_GRIDLINE = "#e1e0d9";
const COLOR_AXIS = "#c3c2b7";
const COLOR_INK_PRIMARY = "#0b0b0b";
const COLOR_INK_SECONDARY = "#52514e";
const COLOR_INK_MUTED = "#898781";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rounds `max` up to a "nice" number (1/2/5 * 10^n) for clean axis ticks. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exponent = Math.floor(Math.log10(max));
  const base = 10 ** exponent;
  const normalized = max / base;
  let niceNormalized: number;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * base;
}

/** `label` should be a bare backup-set label, e.g. "restic:myrepo" - this function appends "size trend" itself. */
export function renderSizeTrendSvg(points: SizeTrendPoint[], label: string): string {
  const title = `${label} size trend`;
  const chartW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  if (points.length === 0) {
    return (
      `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" ` +
      `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(title)}: no size data yet">` +
      `<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${COLOR_SURFACE}"/>` +
      `<text x="${WIDTH / 2}" y="${HEIGHT / 2}" text-anchor="middle" fill="${COLOR_INK_MUTED}" ` +
      `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="14">No size data yet</text>` +
      `</svg>`
    );
  }

  const maxVal = niceMax(Math.max(...points.map((p) => p.sizeBytes)));
  const minTimeMs = new Date(points[0].time).getTime();
  const maxTimeMs = new Date(points[points.length - 1].time).getTime();
  const timeSpan = maxTimeMs - minTimeMs || 1;

  const xFor = (i: number, timeMs: number): number => {
    if (points.length === 1) return PAD_LEFT + chartW / 2;
    return PAD_LEFT + ((timeMs - minTimeMs) / timeSpan) * chartW;
  };
  const yFor = (value: number): number => PAD_TOP + chartH - (value / maxVal) * chartH;

  const coords = points.map((p, i) => ({
    x: xFor(i, new Date(p.time).getTime()),
    y: yFor(p.sizeBytes),
    p,
  }));

  // Y-axis gridlines/ticks: 0, 1/4, 1/2, 3/4, full of the nice max.
  const tickCount = 4;
  const yTicks: string[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const value = (maxVal / tickCount) * i;
    const y = yFor(value);
    yTicks.push(
      `<line x1="${PAD_LEFT}" y1="${y.toFixed(1)}" x2="${WIDTH - PAD_RIGHT}" y2="${y.toFixed(1)}" ` +
        `stroke="${COLOR_GRIDLINE}" stroke-width="1"/>` +
        `<text x="${PAD_LEFT - 10}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" ` +
        `fill="${COLOR_INK_MUTED}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" ` +
        `font-size="11">${escapeXml(formatBytes(value))}</text>`
    );
  }

  const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  const dots = coords
    .map(
      (c) =>
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="${COLOR_SERIES}" ` +
        `stroke="${COLOR_SURFACE}" stroke-width="2"><title>${escapeXml(
          `${formatDate(c.p.time)} - ${formatBytes(c.p.sizeBytes)} (${c.p.id})`
        )}</title></circle>`
    )
    .join("");

  const last = coords[coords.length - 1];
  const endLabel =
    `<text x="${Math.min(last.x + 8, WIDTH - PAD_RIGHT - 4)}" y="${(last.y - 10).toFixed(1)}" ` +
    `text-anchor="${last.x + 8 > WIDTH - PAD_RIGHT - 60 ? "end" : "start"}" fill="${COLOR_INK_PRIMARY}" ` +
    `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="12" font-weight="600">` +
    `${escapeXml(formatBytes(last.p.sizeBytes))}</text>`;

  const firstDateLabel = `<text x="${PAD_LEFT}" y="${HEIGHT - PAD_BOTTOM + 20}" text-anchor="start" ` +
    `fill="${COLOR_INK_SECONDARY}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11">` +
    `${escapeXml(formatDate(points[0].time).slice(0, 10))}</text>`;
  const lastDateLabel = `<text x="${WIDTH - PAD_RIGHT}" y="${HEIGHT - PAD_BOTTOM + 20}" text-anchor="end" ` +
    `fill="${COLOR_INK_SECONDARY}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11">` +
    `${escapeXml(formatDate(points[points.length - 1].time).slice(0, 10))}</text>`;

  return (
    `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" ` +
    `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(title)}">` +
    `<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${COLOR_SURFACE}"/>` +
    `<text x="${PAD_LEFT}" y="18" fill="${COLOR_INK_PRIMARY}" ` +
    `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="13" font-weight="600">` +
    `${escapeXml(title)}</text>` +
    yTicks.join("") +
    `<line x1="${PAD_LEFT}" y1="${PAD_TOP}" x2="${PAD_LEFT}" y2="${HEIGHT - PAD_BOTTOM}" stroke="${COLOR_AXIS}" stroke-width="1"/>` +
    `<line x1="${PAD_LEFT}" y1="${HEIGHT - PAD_BOTTOM}" x2="${WIDTH - PAD_RIGHT}" y2="${HEIGHT - PAD_BOTTOM}" stroke="${COLOR_AXIS}" stroke-width="1"/>` +
    `<path d="${pathD}" fill="none" stroke="${COLOR_SERIES}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    dots +
    endLabel +
    firstDateLabel +
    lastDateLabel +
    `</svg>`
  );
}
