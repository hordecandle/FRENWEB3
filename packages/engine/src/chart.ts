import { deflateSync } from "node:zlib";

/**
 * Trade snapshots as PNG, drawn in plain code: no browser, no native module,
 * no fonts on the server. A small bitmap font covers the labels.
 */

export interface Candle {
  /** Open time, ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type LevelKind = "entry" | "stop" | "target" | "liq" | "exit";

export interface ChartLevel {
  kind: LevelKind;
  price: number;
  /** Shown on the right-hand tag, e.g. "STOP". */
  label: string;
}

export interface ChartMark {
  t: number;
  price: number;
  /** A buy points up from below, a sell down from above. */
  side: "buy" | "sell";
}

export interface ChartInput {
  title: string;
  subtitle?: string;
  candles: Candle[];
  levels: ChartLevel[];
  marks: ChartMark[];
  /** Formats a price for the axis and the tags. */
  fmt?: (n: number) => string;
}

type RGB = readonly [number, number, number];

const C = {
  bg: [17, 20, 27],
  grid: [33, 38, 48],
  text: [214, 219, 228],
  dim: [120, 128, 142],
  up: [38, 186, 128],
  down: [232, 80, 91],
  entry: [76, 154, 255],
  stop: [232, 80, 91],
  target: [38, 186, 128],
  liq: [245, 158, 11],
  exit: [190, 130, 255],
  ink: [12, 14, 18],
} satisfies Record<string, RGB>;

/** 5x7 glyphs, one string per row, "#" is ink. */
const FONT: Record<string, string[]> = {
  "0": [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  "3": ["#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "],
  "4": ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  "6": ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  "8": [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  "9": [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
  A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  B: ["#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "],
  C: [" ### ", "#   #", "#    ", "#    ", "#    ", "#   #", " ### "],
  D: ["###  ", "#  # ", "#   #", "#   #", "#   #", "#  # ", "###  "],
  E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
  F: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#    "],
  G: [" ### ", "#   #", "#    ", "# ###", "#   #", "#   #", " ####"],
  H: ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  I: [" ### ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  J: ["  ###", "   # ", "   # ", "   # ", "   # ", "#  # ", " ##  "],
  K: ["#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"],
  N: ["#   #", "#   #", "##  #", "# # #", "#  ##", "#   #", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  P: ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "],
  Q: [" ### ", "#   #", "#   #", "#   #", "# # #", "#  # ", " ## #"],
  R: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
  S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "#   #", "# # #", "# # #", "# # #", " # # "],
  X: ["#   #", "#   #", " # # ", "  #  ", " # # ", "#   #", "#   #"],
  Y: ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "],
  Z: ["#####", "    #", "   # ", "  #  ", " #   ", "#    ", "#####"],
  ".": ["     ", "     ", "     ", "     ", "     ", " ##  ", " ##  "],
  ",": ["     ", "     ", "     ", "     ", " ##  ", "  #  ", " #   "],
  ":": ["     ", " ##  ", " ##  ", "     ", " ##  ", " ##  ", "     "],
  "-": ["     ", "     ", "     ", "#####", "     ", "     ", "     "],
  "+": ["     ", "  #  ", "  #  ", "#####", "  #  ", "  #  ", "     "],
  "$": ["  #  ", " ####", "# #  ", " ### ", "  # #", "#### ", "  #  "],
  "%": ["##   ", "##  #", "   # ", "  #  ", " #   ", "#  ##", "   ##"],
  "/": ["     ", "    #", "   # ", "  #  ", " #   ", "#    ", "     "],
  "(": ["   # ", "  #  ", " #   ", " #   ", " #   ", "  #  ", "   # "],
  ")": [" #   ", "  #  ", "   # ", "   # ", "   # ", "  #  ", " #   "],
  "·": ["     ", "     ", "     ", "  #  ", "     ", "     ", "     "],
  "@": [" ### ", "#   #", "# ###", "# # #", "# ###", "#    ", " ####"],
  " ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
};

export class Raster {
  readonly px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    bg: RGB = C.bg,
  ) {
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 3);
  }

  set(x: number, y: number, c: RGB) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px.set(c, (y * this.w + x) * 3);
  }

  rect(x: number, y: number, w: number, h: number, c: RGB) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px.set(c, (yy * this.w + xx) * 3);
  }

  /** A horizontal line; dash 0 is solid. */
  hline(x0: number, x1: number, y: number, c: RGB, thick = 2, dash = 0) {
    for (let x = Math.round(x0); x < x1; x++) {
      if (dash && Math.floor((x - x0) / dash) % 2 === 1) continue;
      for (let t = 0; t < thick; t++) this.set(x, y + t - Math.floor(thick / 2), c);
    }
  }

  vline(x: number, y0: number, y1: number, c: RGB, thick = 1) {
    const [a, b] = y0 < y1 ? [y0, y1] : [y1, y0];
    for (let y = Math.round(a); y <= b; y++) for (let t = 0; t < thick; t++) this.set(x + t - Math.floor(thick / 2), y, c);
  }

  text(x: number, y: number, s: string, c: RGB, scale = 2): number {
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const g = FONT[ch] ?? FONT[" "]!;
      g.forEach((row, ry) => {
        for (let rx = 0; rx < 5; rx++) if (row[rx] === "#") this.rect(cx + rx * scale, y + ry * scale, scale, scale, c);
      });
      cx += 6 * scale;
    }
    return cx - x;
  }

  static textWidth(s: string, scale = 2) {
    return [...s].length * 6 * scale;
  }

  /** A filled triangle pointing up (buy) or down (sell), tip at (x, y). */
  arrow(x: number, y: number, up: boolean, c: RGB, size = 9) {
    for (let r = 0; r <= size; r++) {
      const yy = up ? y + r : y - r;
      for (let dx = -r; dx <= r; dx++) this.set(x + dx, yy, c);
    }
  }

  png(): Buffer {
    const row = this.w * 3 + 1;
    const raw = Buffer.alloc(row * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * row] = 0;
      raw.set(this.px.subarray(y * this.w * 3, (y + 1) * this.w * 3), y * row + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // truecolour
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const LEVEL_STYLE: Record<LevelKind, { c: RGB; dash: number }> = {
  entry: { c: C.entry, dash: 0 },
  exit: { c: C.exit, dash: 0 },
  stop: { c: C.stop, dash: 10 },
  target: { c: C.target, dash: 10 },
  liq: { c: C.liq, dash: 4 },
};

function axisPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

/**
 * Candles with the trade's levels drawn across and a marker where it filled.
 * Levels far outside the candles' range still get a line: the chart widens to
 * show them, since a stop or target the owner can't see is the point missed.
 */
export function renderTradeChart(input: ChartInput): Buffer {
  const W = 1000;
  const H = 560;
  const fmt = input.fmt ?? axisPrice;
  const r = new Raster(W, H);
  const left = 24;
  const right = W - 190;
  const top = 92;
  const bottom = H - 48;

  r.text(left, 22, input.title, C.text, 4);
  if (input.subtitle) r.text(left, 62, input.subtitle, C.dim, 2);
  const brand = "FREN";
  r.text(W - 24 - Raster.textWidth(brand, 2), 28, brand, C.dim, 2);

  const candles = input.candles.filter((k) => [k.o, k.h, k.l, k.c].every((v) => Number.isFinite(v) && v > 0));
  const prices = [...candles.flatMap((k) => [k.h, k.l]), ...input.levels.map((l) => l.price), ...input.marks.map((m) => m.price)].filter((v) => v > 0);
  if (!prices.length) return r.png();
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  if (hi - lo < hi * 1e-6) {
    hi *= 1.01;
    lo *= 0.99;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const y = (p: number) => bottom - ((p - lo) / (hi - lo)) * (bottom - top);

  // Where each level's tag goes on the right, nudged so none sit on top of each other.
  const sorted = [...input.levels].sort((a, b) => b.price - a.price);
  const tags: number[] = [];
  for (const lv of sorted) {
    let ty = y(lv.price) - 11;
    while (tags.some((t) => Math.abs(t - ty) < 24)) ty += 24;
    tags.push(ty);
  }

  // Grid with prices on the right, except where a tag will be.
  for (let i = 0; i <= 4; i++) {
    const p = lo + ((hi - lo) * i) / 4;
    const yy = y(p);
    r.hline(left, right, yy, C.grid, 1);
    if (!tags.some((t) => yy - 6 > t - 16 && yy - 6 < t + 24)) r.text(right + 14, yy - 6, fmt(p), C.dim, 2);
  }

  const t0 = candles[0]?.t ?? Math.min(...input.marks.map((m) => m.t), Date.now());
  const tEnd = candles.length ? candles[candles.length - 1]!.t : Math.max(...input.marks.map((m) => m.t), t0 + 1);
  const step = candles.length > 1 ? (tEnd - t0) / (candles.length - 1) : 60_000;
  const span = Math.max(1, tEnd - t0 + step);
  const x = (t: number) => left + 8 + ((t - t0 + step / 2) / span) * (right - left - 16);
  const bodyW = Math.max(2, Math.floor(((right - left - 16) / Math.max(1, candles.length)) * 0.65));

  for (const k of candles) {
    const xx = x(k.t);
    const c = k.c >= k.o ? C.up : C.down;
    r.vline(xx, y(k.h), y(k.l), c, 1);
    const yo = y(k.o);
    const yc = y(k.c);
    r.rect(xx - bodyW / 2, Math.min(yo, yc), bodyW, Math.max(2, Math.abs(yo - yc)), c);
  }

  // Time labels, UTC.
  if (candles.length > 1) {
    for (let i = 0; i <= 3; i++) {
      const t = t0 + ((tEnd - t0) * i) / 3;
      const d = new Date(t);
      const s = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      r.text(Math.min(right - 60, Math.max(left, x(t) - 30)), bottom + 16, s, C.dim, 2);
    }
    r.text(right + 14, bottom + 16, "UTC", C.dim, 2);
  }

  // Levels and their tags.
  sorted.forEach((lv, i) => {
    const st = LEVEL_STYLE[lv.kind];
    r.hline(left, right, y(lv.price), st.c, 2, st.dash);
    const ty = tags[i]!;
    const label = `${lv.label} ${fmt(lv.price)}`;
    r.rect(right + 6, ty, Math.min(W - right - 10, Raster.textWidth(label, 2) + 12), 22, st.c);
    r.text(right + 12, ty + 4, label.slice(0, 14), C.ink, 2);
  });

  for (const m of input.marks) {
    const xx = Math.min(right - 10, Math.max(left + 10, x(m.t)));
    const yy = y(m.price);
    if (m.side === "buy") r.arrow(xx, yy + 6, true, C.entry, 10);
    else r.arrow(xx, yy - 6, false, C.exit, 10);
  }
  return r.png();
}
