export const STITCHES = [
  {
    id: "cross",
    name: "Cross",
    label: "Cross stitch",
    blurb: "Counted X stitches on a grid. The under-stitch is the accent thread.",
  },
  {
    id: "satin",
    name: "Satin",
    label: "Satin stitch",
    blurb: "Parallel threads laid edge to edge across each stroke.",
  },
  {
    id: "knot",
    name: "Knots",
    label: "Knot stitch",
    blurb: "Twisted knots chained through the letter, with a short thread between each one.",
  },
  {
    id: "running",
    name: "Running",
    label: "Running stitch",
    blurb: "Even dashes along the outline, echoed beside them in the accent thread.",
  },
  {
    id: "chain",
    name: "Chain",
    label: "Chain stitch",
    blurb: "Interlocking loops. The tack that pins each loop is the accent thread.",
  },
  {
    id: "whipped",
    name: "Whipped",
    label: "Whipped back stitch",
    blurb: "A back stitch wrapped in a second thread, so the line turns into a rope.",
  },
] as const;

export type StitchId = (typeof STITCHES)[number]["id"];

export type EmbroideryOptions = {
  text: string;
  stitch: StitchId;
  thread: string;
  accent: string;
  fabric: string;
  scale: number;
  fontFamily: string;
  insetBottom: number;
};

type Point = { x: number; y: number };
type Seg = { x1: number; y1: number; x2: number; y2: number };
type Mask = { mask: Uint8Array; w: number; h: number; scale: number };

const CASES: Array<Array<[number, number]>> = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [[3, 0], [1, 2]],
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[2, 0]],
  [[0, 1], [2, 3]],
  [[2, 1]],
  [[1, 3]],
  [[1, 0]],
  [[0, 3]],
  [],
];

const STITCH_SCALE_MIN = 0.7;
const STITCH_SCALE_MAX = 1.55;

export type WordLayout = {
  fontSize: number;
  letterSpacing: number;
  centerY: number;
  textWidth: number;
  stitchScale: number;
};

export function measureWord(
  text: string,
  fontFamily: string,
  width: number,
  height: number,
  insetBottom: number,
): WordLayout {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const maxW = width * 0.88;
  const maxH = Math.max(40, (height - insetBottom) * 0.78);
  const centerY = (height - insetBottom) / 2;
  const maxSize = Math.min(maxH * 0.92, width * 0.42);
  let size = maxSize;
  const sample = text.trim();

  if (ctx && sample) {
    while (size > 28) {
      ctx.font = `600 ${size}px ${fontFamily}`;
      ctx.letterSpacing = `${size * 0.035}px`;
      const metrics = ctx.measureText(sample);
      const textH =
        (metrics.actualBoundingBoxAscent || size * 0.72) +
        (metrics.actualBoundingBoxDescent || size * 0.18);
      if (metrics.width <= maxW && textH <= maxH) break;
      size *= 0.94;
    }
  }

  let textWidth = 0;
  if (ctx && sample) {
    ctx.font = `600 ${size}px ${fontFamily}`;
    ctx.letterSpacing = `${size * 0.035}px`;
    textWidth = ctx.measureText(sample).width;
  }

  return {
    fontSize: size,
    letterSpacing: size * 0.035,
    centerY,
    textWidth,
    stitchScale: stitchScaleFor(size, maxSize),
  };
}

function stitchScaleFor(fontSize: number, maxFontSize: number) {
  if (maxFontSize <= 0) return STITCH_SCALE_MAX;
  const ratio = Math.min(1, Math.max(0, fontSize / maxFontSize));
  return Math.max(STITCH_SCALE_MIN, STITCH_SCALE_MAX * ratio);
}

export function measureTextWidth(
  text: string,
  fontFamily: string,
  fontSize: number,
  letterSpacing: number,
) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx || !text) return 0;
  ctx.font = `600 ${fontSize}px ${fontFamily}`;
  ctx.letterSpacing = `${letterSpacing}px`;
  return ctx.measureText(text).width;
}

type PlayCache = {
  width: number;
  height: number;
  sewFrom: number;
  settled: HTMLCanvasElement;
  active: HTMLCanvasElement;
  drawn: number;
};

export type EmbroideryScene = {
  fabric: string;
  marks: SewMark[];
  play?: PlayCache;
};

type NeedlePose = {
  x: number;
  y: number;
  angle: number;
  sink: number;
  length: number;
  upright?: boolean;
  quiet?: boolean;
  entry?: Point;
  exit?: Point;
};

type SewMark = {
  charIndex: number;
  weight: number;
  draw: (ctx: CanvasRenderingContext2D, amount: number) => void;
  needle?: (amount: number) => NeedlePose;
};

export function buildEmbroideryScene(
  width: number,
  height: number,
  options: EmbroideryOptions,
): EmbroideryScene {
  const fabric = options.fabric;
  if (width < 2 || height < 2) return { fabric, marks: [] };

  const text = options.text.trim();
  if (!text) return { fabric, marks: [] };

  const clothDark = luminance(fabric) < 0.42;
  const rng = mulberry32(hashString(`${text}:${options.stitch}`));
  const marks: SewMark[] = [];

  if (options.stitch === "cross") {
    collectCross(marks, width, height, options, clothDark, rng);
    return { fabric, marks };
  }

  const layout = measureWord(text, options.fontFamily, width, height, options.insetBottom);
  const ranges = charRanges(
    text,
    options.fontFamily,
    width / 2 - layout.textWidth / 2,
    width / 2 + layout.textWidth / 2,
    layout.fontSize,
    layout.letterSpacing,
  );
  const mask = rasterizeText(text, options, width, height);
  if (!mask) return { fabric, marks };

  if (options.stitch === "satin") {
    collectSatin(marks, mask, options, clothDark, ranges);
    return { fabric, marks };
  }

  if (options.stitch === "knot") {
    collectKnots(marks, mask, options, clothDark, rng, ranges);
    return { fabric, marks };
  }

  const contours = tidyContours(traceContours(mask.mask, mask.w, mask.h, mask.scale));
  if (options.stitch === "running") collectRunning(marks, contours, options, clothDark, ranges);
  if (options.stitch === "chain") collectChain(marks, contours, options, clothDark, rng, ranges);
  if (options.stitch === "whipped") collectWhipped(marks, contours, options, clothDark, ranges);
  return { fabric, marks };
}

export function drawEmbroideryScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: EmbroideryScene,
  sewFrom: number,
  sewProgress: number,
) {
  if (width < 2 || height < 2) return;
  drawFabric(ctx, width, height, scene.fabric);

  const progress = Math.max(0, Math.min(1, sewProgress));
  let activeWeight = 0;
  const active: SewMark[] = [];
  for (const mark of scene.marks) {
    if (mark.charIndex >= sewFrom) {
      activeWeight += mark.weight;
      active.push(mark);
    }
  }
  const target = progress >= 1 ? activeWeight : progress * activeWeight;
  let consumed = 0;
  let complete = 0;
  let partial: { mark: SewMark; amount: number } | null = null;
  let needle: NeedlePose | null = null;
  for (const mark of active) {
    const next = consumed + mark.weight;
    if (target >= next - 0.0001) complete++;
    else if (target > consumed + 0.0001) {
      const amount = (target - consumed) / mark.weight;
      partial = { mark, amount };
      if (mark.needle) needle = mark.needle(amount);
      break;
    } else break;
    consumed = next;
  }

  const dpr = ctx.getTransform().a || 1;
  const play = playCache(scene, width, height, sewFrom, dpr);
  const layer = play.active.getContext("2d");
  if (layer) {
    if (complete < play.drawn) {
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(0, 0, play.width, play.height);
      layer.setTransform(dpr, 0, 0, dpr, 0, 0);
      play.drawn = 0;
    }
    for (let i = play.drawn; i < complete; i++) active[i].draw(layer, 1);
    play.drawn = complete;
  }

  ctx.drawImage(play.settled, 0, 0, width, height);
  ctx.drawImage(play.active, 0, 0, width, height);
  if (partial) partial.mark.draw(ctx, partial.amount);
  if (needle && progress < 1) drawNeedle(ctx, needle, luminance(scene.fabric) < 0.42);
}

function playCache(
  scene: EmbroideryScene,
  width: number,
  height: number,
  sewFrom: number,
  dpr: number,
) {
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  const existing = scene.play;
  if (
    existing &&
    existing.width === w &&
    existing.height === h &&
    existing.sewFrom === sewFrom
  ) {
    return existing;
  }

  const make = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return canvas;
  };
  const settled = make();
  const settledCtx = settled.getContext("2d");
  if (settledCtx) {
    for (const mark of scene.marks) {
      if (mark.charIndex < sewFrom) mark.draw(settledCtx, 1);
    }
  }
  const active = make();
  const play = { width: w, height: h, sewFrom, settled, active, drawn: 0 };
  scene.play = play;
  return play;
}

export function sceneSewWeight(scene: EmbroideryScene, from: number) {
  let total = 0;
  for (const mark of scene.marks) {
    if (mark.charIndex >= from) total += mark.weight;
  }
  return total;
}

export function sewDurationFor(weight: number) {
  if (weight <= 0) return 0;
  // Weight counts every thread. A filled letter is hundreds of weight, which
  // used to run for up to 16s. Same stitch order, short enough to keep up
  // with typing: a letter finishes in well under a second.
  return Math.max(180, Math.min(640, weight * 36));
}

export function paintEmbroidery(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: EmbroideryOptions,
) {
  const scene = buildEmbroideryScene(width, height, options);
  drawEmbroideryScene(ctx, width, height, scene, options.text.trim().length, 1);
}

let fabricLayer: { key: string; canvas: HTMLCanvasElement } | null = null;

function drawFabric(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
) {
  const dpr = ctx.getTransform().a || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  const key = `${w}x${h}:${color}`;
  if (!fabricLayer || fabricLayer.key !== key) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const layer = canvas.getContext("2d");
    if (layer) {
      layer.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintFabric(layer, width, height, color);
    }
    fabricLayer = { key, canvas };
  }
  ctx.drawImage(fabricLayer.canvas, 0, 0, width, height);
}

function paintFabric(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
) {
  const pattern = ctx.createPattern(fabricTile(color), "repeat");
  ctx.fillStyle = pattern ?? color;
  ctx.fillRect(0, 0, width, height);

  const rng = mulberry32(hashString(color));
  const light = luminance(color) > 0.5;
  ctx.fillStyle = light
    ? "rgba(90, 60, 30, 0.045)"
    : "rgba(255, 255, 255, 0.035)";
  const specks = Math.round((width * height) / 1800);
  for (let i = 0; i < specks; i++) {
    ctx.fillRect(rng() * width, rng() * height, 1.2, 1.2);
  }

  const cx = width / 2;
  const cy = height / 2;
  const vignette = ctx.createRadialGradient(
    cx,
    cy,
    Math.min(width, height) * 0.2,
    cx,
    cy,
    Math.max(width, height) * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(
    1,
    light ? "rgba(70, 45, 25, 0.16)" : "rgba(0, 0, 0, 0.35)",
  );
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

const tiles = new Map<string, HTMLCanvasElement>();

function fabricTile(color: string) {
  const existing = tiles.get(color);
  if (existing) return existing;

  const tile = document.createElement("canvas");
  tile.width = 56;
  tile.height = 56;
  const g = tile.getContext("2d");
  if (!g) return tile;

  const [r, gv, b] = hexToRgb(color);
  g.fillStyle = color;
  g.fillRect(0, 0, 56, 56);

  const warp = `rgba(${clamp(r - 22)}, ${clamp(gv - 18)}, ${clamp(b - 14)}, 0.09)`;
  const weft = `rgba(${clamp(r + 24)}, ${clamp(gv + 20)}, ${clamp(b + 16)}, 0.07)`;
  g.lineWidth = 1;
  for (let y = 2; y < 56; y += 3) {
    g.strokeStyle = y % 6 === 2 ? warp : weft;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(56, y);
    g.stroke();
  }
  g.globalAlpha = 0.45;
  for (let x = 2; x < 56; x += 3) {
    g.strokeStyle = weft;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 56);
    g.stroke();
  }
  g.globalAlpha = 1;

  tiles.set(color, tile);
  return tile;
}

function rasterizeText(
  text: string,
  options: EmbroideryOptions,
  width: number,
  height: number,
): Mask | null {
  const scale = 2;
  const layout = measureWord(
    text,
    options.fontFamily,
    width,
    height,
    options.insetBottom,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const size = layout.fontSize * scale;
  const centerY = layout.centerY * scale;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${size}px ${options.fontFamily}`;
  ctx.letterSpacing = `${layout.letterSpacing * scale}px`;
  ctx.fillText(text, canvas.width / 2, centerY);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = image.data[i * 4 + 3] > 120 ? 1 : 0;
  }
  return { mask, w: canvas.width, h: canvas.height, scale };
}

function crossChart(
  text: string,
  fontFamily: string,
  width: number,
  height: number,
  insetBottom: number,
  stitchScale: number,
) {
  const cell = clampNum(11, 22, 14 * stitchScale);
  const maxW = width * 0.9;
  const maxH = Math.max(48, (height - insetBottom) * 0.8);
  const cols = Math.max(6, Math.round(maxW / cell));
  const rows = Math.max(6, Math.round(maxH / cell));
  const sample = text.trim();
  const mini = document.createElement("canvas");
  mini.width = cols;
  mini.height = rows;
  const m = mini.getContext("2d", { willReadFrequently: true });
  if (!m || !sample) return null;

  m.textAlign = "center";
  m.textBaseline = "middle";
  m.fillStyle = "#fff";
  let size = rows * 0.9;
  while (size > 4) {
    m.font = `650 ${size}px ${fontFamily}`;
    m.letterSpacing = `${Math.max(0, size * 0.02)}px`;
    if (m.measureText(sample).width <= cols * 0.94) break;
    size *= 0.92;
  }
  m.font = `650 ${size}px ${fontFamily}`;
  m.letterSpacing = `${Math.max(0, size * 0.02)}px`;
  m.fillText(sample, cols / 2, rows / 2 + rows * 0.02);

  const pixels = m.getImageData(0, 0, cols, rows).data;
  let minCol = cols;
  let maxCol = -1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (pixels[(y * cols + x) * 4 + 3] < 90) continue;
      if (x < minCol) minCol = x;
      if (x > maxCol) maxCol = x;
    }
  }

  const gridW = cols * cell;
  const gridH = rows * cell;
  const ox = (width - gridW) / 2;
  const hasInk = maxCol >= minCol;
  return {
    cell,
    cols,
    rows,
    pixels,
    ox,
    oy: (height - insetBottom - gridH) / 2,
    textWidth: hasInk ? (maxCol - minCol + 1) * cell : 0,
    spanStart: hasInk ? ox + minCol * cell : ox,
    spanEnd: hasInk ? ox + (maxCol + 1) * cell : ox,
  };
}

export function visibleTextWidth(
  text: string,
  stitch: StitchId,
  fontFamily: string,
  width: number,
  height: number,
  insetBottom: number,
  stitchScale: number,
) {
  const sample = text.trim();
  if (!sample) return 0;
  if (stitch === "cross") {
    return (
      crossChart(sample, fontFamily, width, height, insetBottom, stitchScale)
        ?.textWidth ?? 0
    );
  }
  return measureWord(sample, fontFamily, width, height, insetBottom).textWidth;
}

function collectCross(
  marks: SewMark[],
  width: number,
  height: number,
  options: EmbroideryOptions,
  clothDark: boolean,
  rng: () => number,
) {
  const chart = crossChart(
    options.text,
    options.fontFamily,
    width,
    height,
    options.insetBottom,
    options.scale,
  );
  if (!chart) return;

  const { cell, cols, rows, pixels, ox, oy, spanStart, spanEnd } = chart;
  const ranges = charRanges(options.text.trim(), options.fontFamily, spanStart, spanEnd, 100, 2);
  const threadW = Math.max(1.1, cell * 0.16) * 2;
  const reach = cell * 2.5;

  type CrossCell = {
    tl: Point;
    tr: Point;
    bl: Point;
    br: Point;
    charIndex: number;
  };
  const byRow = new Map<number, CrossCell[]>();

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (pixels[(y * cols + x) * 4 + 3] < 90) continue;
      const left = ox + x * cell;
      const top = oy + y * cell;
      const pad = cell * 0.1;
      const j = () => (rng() - 0.5) * 0.45;
      const tl = { x: left + pad + j(), y: top + pad + j() };
      const tr = { x: left + cell - pad + j(), y: top + pad + j() };
      const bl = { x: left + pad + j(), y: top + cell - pad + j() };
      const br = { x: left + cell - pad + j(), y: top + cell - pad + j() };
      const row = byRow.get(y) ?? [];
      row.push({ tl, tr, bl, br, charIndex: charIndexAt((tl.x + br.x) / 2, ranges) });
      byRow.set(y, row);
    }
  }

  const rowKeys = [...byRow.keys()].sort((a, b) => a - b);
  let carry: Point | null = null;
  for (const key of rowKeys) {
    const cells = byRow.get(key);
    if (!cells?.length) continue;
    if (carry && distance(carry, cells[0].tl) <= reach) {
      pushUnder(marks, carry.x, carry.y, cells[0].tl.x, cells[0].tl.y, cells[0].charIndex, clothDark);
    }

    for (let i = 0; i < cells.length; i++) {
      const cellMark = cells[i];
      pushThread(
        marks,
        ranges,
        cellMark.tl.x,
        cellMark.tl.y,
        cellMark.br.x,
        cellMark.br.y,
        options.accent,
        threadW * 0.92,
        clothDark,
      );
      const next = cells[i + 1];
      if (next && distance(cellMark.br, next.tl) <= reach) {
        pushUnder(marks, cellMark.br.x, cellMark.br.y, next.tl.x, next.tl.y, next.charIndex, clothDark);
      }
    }

    const last = cells[cells.length - 1];
    if (distance(last.br, last.tr) <= reach) {
      pushUnder(marks, last.br.x, last.br.y, last.tr.x, last.tr.y, last.charIndex, clothDark);
    }

    for (let i = cells.length - 1; i >= 0; i--) {
      const cellMark = cells[i];
      pushThread(
        marks,
        ranges,
        cellMark.tr.x,
        cellMark.tr.y,
        cellMark.bl.x,
        cellMark.bl.y,
        options.thread,
        threadW,
        clothDark,
      );
      const prev = cells[i - 1];
      if (prev && distance(cellMark.bl, prev.tr) <= reach) {
        pushUnder(marks, cellMark.bl.x, cellMark.bl.y, prev.tr.x, prev.tr.y, prev.charIndex, clothDark);
      }
    }

    carry = cells[0].bl;
  }
}

function collectSatin(
  marks: SewMark[],
  mask: Mask,
  options: EmbroideryOptions,
  clothDark: boolean,
  ranges: Array<[number, number]>,
) {
  const spacing = clampNum(2.2, 3.2, 2.5 * options.scale);
  const width = spacing * 1.42;
  const strokes = satinStrokes(mask, spacing);

  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      const stitch = stroke[i];
      pushThread(
        marks,
        ranges,
        stitch.ax,
        stitch.ay,
        stitch.bx,
        stitch.by,
        options.thread,
        width,
        clothDark,
        "satin",
      );
      const next = stroke[i + 1];
      if (!next) continue;
      const span = Math.hypot(stitch.bx - stitch.ax, stitch.by - stitch.ay);
      const jump = Math.hypot(stitch.bx - next.ax, stitch.by - next.ay);
      if (jump > Math.max(span * 1.45, spacing * 3)) continue;
      pushSatinHop(marks, stitch.bx, stitch.by, next.ax, next.ay, charIndexAt(next.ax, ranges));
    }
  }
}

type SatinStitch = { ax: number; ay: number; bx: number; by: number };
type SatinPoly = { pts: Point[]; closed: boolean };

const SATIN_N8: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function satinStrokes(mask: Mask, spacingScreen: number) {
  const box = bounds(mask.mask, mask.w, mask.h);
  if (!box) return [] as SatinStitch[][];
  const bw = box.maxX - box.minX + 1;
  const bh = box.maxY - box.minY + 1;
  let step = 2;
  while ((bw / step) * (bh / step) > 260000 && step < 6) step += 1;

  const gw = Math.ceil(bw / step) + 2;
  const gh = Math.ceil(bh / step) + 2;
  const grid = new Uint8Array(gw * gh);
  for (let y = box.minY; y <= box.maxY; y++) {
    const gy = 1 + Math.floor((y - box.minY) / step);
    const row = y * mask.w;
    for (let x = box.minX; x <= box.maxX; x++) {
      if (!mask.mask[row + x]) continue;
      grid[gy * gw + (1 + Math.floor((x - box.minX) / step))] = 1;
    }
  }

  thinZhangSuen(grid, gw, gh);
  const polys = traceSkeleton(grid, gw, gh);
  const spacing = spacingScreen * mask.scale;
  const strokes: SatinStitch[][] = [];

  for (const poly of polys) {
    if (poly.pts.length < 2) continue;
    const mapped = poly.pts.map((point) => ({
      x: box.minX + (point.x - 1 + 0.5) * step,
      y: box.minY + (point.y - 1 + 0.5) * step,
    }));
    if (!poly.closed && polylineLength(mapped) < 3) continue;
    const reached = poly.closed ? mapped : extendSatinEnds(mapped, mask);
    const smooth = smoothPoly(reached, poly.closed, 6);
    let samples = resamplePoly(smooth, spacing, poly.closed);
    samples = orientSatin(samples, poly.closed);
    if (samples.length < 2) continue;
    const row = satinRow(samples, poly.closed, mask);
    if (row.length) strokes.push(row);
  }

  const kept = dropCoveredSpurs(strokes, spacingScreen);
  const all = kept.concat(satinDots(mask, kept, spacing));
  all.sort((a, b) => {
    const ax = Math.min(...a.map((stitch) => Math.min(stitch.ax, stitch.bx)));
    const bx = Math.min(...b.map((stitch) => Math.min(stitch.ax, stitch.bx)));
    const ay = Math.min(...a.map((stitch) => Math.min(stitch.ay, stitch.by)));
    const by = Math.min(...b.map((stitch) => Math.min(stitch.ay, stitch.by)));
    return ax - bx || ay - by;
  });
  return all;
}

function satinDots(mask: Mask, strokes: SatinStitch[][], spacing: number) {
  const count = mask.w * mask.h;
  if (!count) return [] as SatinStitch[][];
  const seen = new Uint8Array(count);
  const hit = new Uint8Array(count);
  for (const stroke of strokes) {
    for (const stitch of stroke) {
      const ix = Math.round(((stitch.ax + stitch.bx) / 2) * mask.scale);
      const iy = Math.round(((stitch.ay + stitch.by) / 2) * mask.scale);
      if (ix < 0 || iy < 0 || ix >= mask.w || iy >= mask.h) continue;
      hit[iy * mask.w + ix] = 1;
    }
  }

  const box = bounds(mask.mask, mask.w, mask.h);
  const extra: SatinStitch[][] = [];
  if (!box) return extra;
  const stack: number[] = [];
  for (let y0 = box.minY; y0 <= box.maxY; y0++) {
    for (let x0 = box.minX; x0 <= box.maxX; x0++) {
      const start = y0 * mask.w + x0;
      if (!mask.mask[start] || seen[start]) continue;
      stack.push(start);
      seen[start] = 1;
      let covered = hit[start] === 1;
      const pixels: Point[] = [];
      if (!covered) pixels.push({ x: start % mask.w, y: (start / mask.w) | 0 });
      while (stack.length) {
        const cur = stack.pop() as number;
        const x = cur % mask.w;
        const y = (cur / mask.w) | 0;
        for (let k = 0; k < SATIN_N8.length; k++) {
          const nx = x + SATIN_N8[k][0];
          const ny = y + SATIN_N8[k][1];
          if (nx < 0 || ny < 0 || nx >= mask.w || ny >= mask.h) continue;
          const ni = ny * mask.w + nx;
          if (seen[ni] || !mask.mask[ni]) continue;
          seen[ni] = 1;
          stack.push(ni);
          if (hit[ni]) {
            covered = true;
            pixels.length = 0;
          } else if (!covered) pixels.push({ x: nx, y: ny });
        }
      }
      if (covered) continue;
      const row = blobSatin(pixels, mask, spacing);
      if (row.length) extra.push(row);
    }
  }
  return extra;
}

function blobSatin(pixels: Point[], mask: Mask, spacing: number) {
  if (pixels.length < 6) return [] as SatinStitch[];
  const slant = (-22 * Math.PI) / 180;
  const dx = Math.cos(slant);
  const dy = Math.sin(slant);
  const nx = -dy;
  const ny = dx;
  let minN = Infinity;
  let maxN = -Infinity;
  let cx = 0;
  let cy = 0;
  const ink = new Set<number>();
  for (const p of pixels) {
    cx += p.x;
    cy += p.y;
    ink.add(p.y * mask.w + p.x);
    const n = p.x * nx + p.y * ny;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  }
  cx /= pixels.length;
  cy /= pixels.length;
  const span = maxN - minN;
  const lines = span < spacing * 1.15 ? 1 : Math.max(1, Math.round(span / spacing));
  const step = lines === 1 ? 0 : span / lines;
  const start = lines === 1 ? (minN + maxN) / 2 : minN + step / 2;
  const row: SatinStitch[] = [];
  for (let i = 0; i < lines; i++) {
    const n = start + step * i;
    const cn = cx * nx + cy * ny;
    const origin = nearestInk(pixels, ink, mask.w, cx + nx * (n - cn), cy + ny * (n - cn));
    const hit = castSatin(mask, origin.x, origin.y, dx, dy, localSatinWidth(mask, origin.x, origin.y));
    if (hit) row.push(hit);
  }
  return row;
}

function nearestInk(pixels: Point[], ink: Set<number>, w: number, x: number, y: number) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ink.has(iy * w + ix)) return { x: ix, y: iy };
  let best = pixels[0];
  let bestD = Infinity;
  for (const p of pixels) {
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d >= bestD) continue;
    bestD = d;
    best = p;
  }
  return { x: best.x, y: best.y };
}

function dropCoveredSpurs(strokes: SatinStitch[][], spacing: number) {
  const reach = spacing * 1.8;
  return strokes.filter((stroke) => {
    if (stroke.length >= 3) return true;
    return !stroke.every((stitch) => {
      const mx = (stitch.ax + stitch.bx) / 2;
      const my = (stitch.ay + stitch.by) / 2;
      return strokes.some(
        (other) =>
          other !== stroke &&
          other.length >= 3 &&
          other.some((kept) => Math.hypot(mx - (kept.ax + kept.bx) / 2, my - (kept.ay + kept.by) / 2) < reach),
      );
    });
  });
}

function satinRow(samples: Point[], closed: boolean, mask: Mask) {
  const row: SatinStitch[] = [];
  const n = samples.length;
  if (n < 2) return row;
  const slant = (-22 * Math.PI) / 180;
  const cs = Math.cos(slant);
  const sn = Math.sin(slant);
  let prevX = 0;
  let prevY = 0;
  let hasPrev = false;

  for (let i = 0; i < n; i++) {
    let tx = 0;
    let ty = 0;
    if (!closed && i === 0) {
      tx = samples[1].x - samples[0].x;
      ty = samples[1].y - samples[0].y;
    } else if (!closed && i === n - 1) {
      tx = samples[n - 1].x - samples[n - 2].x;
      ty = samples[n - 1].y - samples[n - 2].y;
    } else {
      const prev = samples[(i - 1 + n) % n];
      const next = samples[(i + 1) % n];
      tx = next.x - prev.x;
      ty = next.y - prev.y;
    }
    const tangent = unit(tx, ty);
    let px = tangent.y;
    let py = -tangent.x;
    let ax = px * cs - py * sn;
    let ay = px * sn + py * cs;
    const axis = unit(ax, ay);
    ax = axis.x;
    ay = axis.y;
    if (hasPrev && prevX * ax + prevY * ay < 0) {
      ax = -ax;
      ay = -ay;
    }
    prevX = ax;
    prevY = ay;
    hasPrev = true;

    const local = localSatinWidth(mask, samples[i].x, samples[i].y);
    const jitter = ((((i * 47) % 11) - 5) / 5) * 0.02;
    const jx = ax * Math.cos(jitter) - ay * Math.sin(jitter);
    const jy = ax * Math.sin(jitter) + ay * Math.cos(jitter);
    const hit = castSatin(mask, samples[i].x, samples[i].y, jx, jy, local);
    if (hit) row.push(hit);
  }
  return row;
}

function localSatinWidth(mask: Mask, x: number, y: number) {
  let best = Infinity;
  for (let k = 0; k < 8; k++) {
    const angle = (k / 8) * Math.PI;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const len =
      walkSatin(mask, x, y, dx, dy).dist + walkSatin(mask, x, y, -dx, -dy).dist;
    if (len < best) best = len;
  }
  return best;
}

function castSatin(mask: Mask, x: number, y: number, dx: number, dy: number, local: number) {
  if (!maskPixel(mask, x, y)) return null;
  const cap = Math.max(4, local * 1.2);
  const forward = walkSatin(mask, x, y, dx, dy, cap);
  const back = walkSatin(mask, x, y, -dx, -dy, cap);
  const len = forward.dist + back.dist;
  if (len < 3.2) return null;

  let x1 = back.x / mask.scale;
  let y1 = back.y / mask.scale;
  let x2 = forward.x / mask.scale;
  let y2 = forward.y / mask.scale;
  const span = Math.hypot(x2 - x1, y2 - y1);
  if (span < 1.8) return null;
  const hash =
    Math.imul(Math.round(x1 * 13) ^ Math.imul(Math.round(y1 * 13), 374761393), 668265263) >>> 0;
  const inset = Math.min(span * 0.08, 0.08 + (hash % 6) * 0.1);
  const ux = (x2 - x1) / span;
  const uy = (y2 - y1) / span;
  x1 += ux * inset;
  y1 += uy * inset;
  x2 -= ux * inset;
  y2 -= uy * inset;
  return { ax: x1, ay: y1, bx: x2, by: y2 };
}

function walkSatin(
  mask: Mask,
  x: number,
  y: number,
  dx: number,
  dy: number,
  maxDist = Infinity,
) {
  let cx = x;
  let cy = y;
  let dist = 0;
  const step = 0.7;
  for (let i = 0; i < 500 && dist < maxDist; i++) {
    const room = Math.min(step, maxDist - dist);
    const nx = cx + dx * room;
    const ny = cy + dy * room;
    if (!maskPixel(mask, nx, ny)) break;
    cx = nx;
    cy = ny;
    dist += room;
  }
  return { x: cx, y: cy, dist };
}

function maskPixel(mask: Mask, x: number, y: number) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= mask.w || iy >= mask.h) return false;
  return mask.mask[iy * mask.w + ix] === 1;
}

function pushSatinHop(
  marks: SewMark[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  charIndex: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.8) return;
  marks.push({
    charIndex,
    weight: 0.22,
    draw() {},
    needle(amount) {
      return {
        x: x1 + dx * amount,
        y: y1 + dy * amount,
        angle: Math.atan2(dy, dx),
        sink: 1,
        length: 11,
        quiet: true,
        exit: { x: x1, y: y1 },
        entry: amount > 0.62 ? { x: x2, y: y2 } : undefined,
      };
    },
  });
}

function thinZhangSuen(grid: Uint8Array, w: number, h: number) {
  const kill = new Uint8Array(grid.length);
  const at = (x: number, y: number) => grid[y * w + x];
  let changed = true;
  for (let guard = 0; changed && guard < 80; guard++) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      kill.fill(0);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!grid[i]) continue;
          const p2 = at(x, y - 1);
          const p3 = at(x + 1, y - 1);
          const p4 = at(x + 1, y);
          const p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1);
          const p7 = at(x - 1, y + 1);
          const p8 = at(x - 1, y);
          const p9 = at(x - 1, y - 1);
          const neighbors = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (neighbors < 2 || neighbors > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let turns = 0;
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) turns++;
          if (turns !== 1) continue;
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          kill[i] = 1;
        }
      }
      for (let i = 0; i < grid.length; i++) {
        if (!kill[i]) continue;
        grid[i] = 0;
        changed = true;
      }
    }
  }
}

function traceSkeleton(grid: Uint8Array, w: number, h: number) {
  const deg = new Uint8Array(grid.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!grid[i]) continue;
      let count = 0;
      for (const [dx, dy] of SATIN_N8) if (grid[(y + dy) * w + (x + dx)]) count++;
      deg[i] = count;
    }
  }

  const used = new Set<string>();
  const edgeKey = (x1: number, y1: number, x2: number, y2: number) => {
    const a = y1 * w + x1;
    const b = y2 * w + x2;
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  };
  const neighborsOf = (x: number, y: number) => {
    const found: Point[] = [];
    for (const [dx, dy] of SATIN_N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (grid[ny * w + nx]) found.push({ x: nx, y: ny });
    }
    return found;
  };

  const walk = (x0: number, y0: number, x1: number, y1: number) => {
    const pts: Point[] = [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ];
    used.add(edgeKey(x0, y0, x1, y1));
    let px = x0;
    let py = y0;
    let cx = x1;
    let cy = y1;
    for (let guard = 0; deg[cy * w + cx] === 2 && guard < w * h; guard++) {
      let nxt: Point | null = null;
      for (const point of neighborsOf(cx, cy)) {
        if (point.x === px && point.y === py) continue;
        nxt = point;
        break;
      }
      if (!nxt) break;
      if (nxt.x === x0 && nxt.y === y0) {
        used.add(edgeKey(cx, cy, nxt.x, nxt.y));
        return { pts, closed: true };
      }
      const id = edgeKey(cx, cy, nxt.x, nxt.y);
      if (used.has(id)) break;
      used.add(id);
      pts.push(nxt);
      px = cx;
      py = cy;
      cx = nxt.x;
      cy = nxt.y;
    }
    return { pts, closed: false };
  };

  const open: SatinPoly[] = [];
  const closed: SatinPoly[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const count = deg[y * w + x];
      if (count !== 1 && count < 3) continue;
      for (const next of neighborsOf(x, y)) {
        if (used.has(edgeKey(x, y, next.x, next.y))) continue;
        const poly = walk(x, y, next.x, next.y);
        if (poly.pts.length < 2) continue;
        if (poly.closed) closed.push(poly);
        else open.push(poly);
      }
    }
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (deg[y * w + x] !== 2) continue;
      const next = neighborsOf(x, y);
      if (next.length < 1) continue;
      if (used.has(edgeKey(x, y, next[0].x, next[0].y))) continue;
      const poly = walk(x, y, next[0].x, next[0].y);
      if (poly.closed && poly.pts.length > 4) closed.push(poly);
    }
  }

  return closed.concat(mergeSatinEdges(open));
}

function mergeSatinEdges(open: SatinPoly[]) {
  const used = new Array(open.length).fill(false);
  const touch = new Map<string, number[]>();
  const keyOf = (point: Point) => `${point.x},${point.y}`;
  for (let i = 0; i < open.length; i++) {
    const pts = open[i].pts;
    const start = keyOf(pts[0]);
    const end = keyOf(pts[pts.length - 1]);
    for (const key of start === end ? [start] : [start, end]) {
      const list = touch.get(key);
      if (list) list.push(i);
      else touch.set(key, [i]);
    }
  }

  const orient = (pts: Point[], key: string) => {
    const start = keyOf(pts[0]) === key;
    const end = keyOf(pts[pts.length - 1]) === key;
    if (start && !end) return pts;
    if (end && !start) return pts.slice().reverse();
    return null;
  };

  const approachEnd = (pts: Point[]) => {
    const q = pts[Math.max(0, pts.length - 5)];
    return unit(pts[pts.length - 1].x - q.x, pts[pts.length - 1].y - q.y);
  };
  const approachStart = (pts: Point[]) => {
    const q = pts[Math.min(4, pts.length - 1)];
    return unit(pts[0].x - q.x, pts[0].y - q.y);
  };
  const depart = (pts: Point[]) => {
    const q = pts[Math.min(4, pts.length - 1)];
    return unit(q.x - pts[0].x, q.y - pts[0].y);
  };

  const continuation = (key: string, approach: Point) => {
    const list = touch.get(key) ?? [];
    let best = -1;
    let bestDot = 0.6;
    let pts: Point[] | null = null;
    for (const index of list) {
      if (used[index]) continue;
      const oriented = orient(open[index].pts, key);
      if (!oriented || oriented.length < 2) continue;
      const dir = depart(oriented);
      const dot = approach.x * dir.x + approach.y * dir.y;
      if (dot <= bestDot) continue;
      bestDot = dot;
      best = index;
      pts = oriented;
    }
    if (best < 0 || !pts) return null;
    used[best] = true;
    return pts;
  };

  const merged: SatinPoly[] = [];
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let pts = open[i].pts.slice();
    for (let guard = 0; guard < open.length; guard++) {
      const next = continuation(keyOf(pts[pts.length - 1]), approachEnd(pts));
      if (!next) break;
      pts = pts.concat(next.slice(1));
    }
    for (let guard = 0; guard < open.length; guard++) {
      const next = continuation(keyOf(pts[0]), approachStart(pts));
      if (!next) break;
      pts = next.slice(1).reverse().concat(pts);
    }
    if (polylineLength(pts) >= 1.5) merged.push({ pts, closed: false });
  }
  return merged;
}

function orientSatin(samples: Point[], closed: boolean) {
  if (samples.length < 2) return samples;
  if (closed) {
    let min = 0;
    for (let i = 1; i < samples.length; i++) {
      const better =
        samples[i].y < samples[min].y - 0.5 ||
        (Math.abs(samples[i].y - samples[min].y) <= 0.5 && samples[i].x < samples[min].x);
      if (better) min = i;
    }
    return samples.slice(min).concat(samples.slice(0, min));
  }
  const start = samples[0];
  const end = samples[samples.length - 1];
  const keep =
    start.y < end.y - 1 || (Math.abs(start.y - end.y) <= 1 && start.x <= end.x);
  return keep ? samples : samples.slice().reverse();
}

function extendSatinEnds(pts: Point[], mask: Mask) {
  if (pts.length < 2) return pts;
  const grow = (origin: Point, toward: Point) => {
    const dir = unit(origin.x - toward.x, origin.y - toward.y);
    let x = origin.x;
    let y = origin.y;
    for (let i = 0; i < 100; i++) {
      const nx = x + dir.x * 1.1;
      const ny = y + dir.y * 1.1;
      if (!maskPixel(mask, nx, ny)) break;
      x = nx;
      y = ny;
    }
    return { x, y };
  };
  return [grow(pts[0], pts[1]), ...pts.slice(1, -1), grow(pts[pts.length - 1], pts[pts.length - 2])];
}

function smoothPoly(pts: Point[], closed: boolean, passes = 2) {
  if (pts.length < 3) return pts.map((point) => ({ ...point }));
  let cur = pts.map((point) => ({ ...point }));
  for (let pass = 0; pass < passes; pass++) {
    const next = cur.map((point) => ({ ...point }));
    const n = cur.length;
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const prev = cur[(i - 1 + n) % n];
      const point = cur[i];
      const following = cur[(i + 1) % n];
      next[i] = {
        x: (prev.x + point.x * 2 + following.x) / 4,
        y: (prev.y + point.y * 2 + following.y) / 4,
      };
    }
    cur = next;
  }
  return cur;
}

function resamplePoly(pts: Point[], spacing: number, closed: boolean) {
  const seq = closed && pts.length > 2 ? pts.concat([pts[0]]) : pts;
  const out: Point[] = [];
  if (!seq.length) return out;
  out.push({ ...seq[0] });
  let cursor = seq[0];
  let carried = 0;
  for (let i = 1; i < seq.length; i++) {
    const target = seq[i];
    let dx = target.x - cursor.x;
    let dy = target.y - cursor.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 1e-4) continue;
    while (carried + dist >= spacing) {
      const t = (spacing - carried) / dist;
      cursor = { x: cursor.x + dx * t, y: cursor.y + dy * t };
      out.push(cursor);
      dx = target.x - cursor.x;
      dy = target.y - cursor.y;
      dist = Math.hypot(dx, dy);
      carried = 0;
      if (dist < 1e-4) break;
    }
    carried += dist;
    cursor = target;
  }
  if (!closed && out.length) {
    const last = seq[seq.length - 1];
    const end = out[out.length - 1];
    if (Math.hypot(last.x - end.x, last.y - end.y) > 1.5) out.push({ ...last });
  }
  if (closed && out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < spacing * 0.45) out.pop();
  }
  return out;
}

function polylineLength(pts: Point[]) {
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return length;
}

function unit(x: number, y: number) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function collectKnots(
  marks: SewMark[],
  mask: Mask,
  options: EmbroideryOptions,
  clothDark: boolean,
  rng: () => number,
  ranges: Array<[number, number]>,
) {
  const box = bounds(mask.mask, mask.w, mask.h);
  if (!box) return;

  const size = clampNum(4.8, 8, 6 * options.scale);
  const strand = Math.max(1.7, size * 0.42);
  const pitchY = size * 2.42;
  const pitchX = size * 2.16;
  const minX = box.minX / mask.scale;
  const maxX = box.maxX / mask.scale;
  const minY = box.minY / mask.scale;
  const maxY = box.maxY / mask.scale;

  type Knot = {
    x: number;
    y: number;
    size: number;
    turn: number;
    lean: number;
    charIndex: number;
  };

  let col = 0;
  let carry: Point | null = null;
  for (let x = minX; x <= maxX; x += pitchX) {
    const knots: Knot[] = [];
    const y0 = minY + (col % 2) * pitchY * 0.22;
    for (let y = y0; y <= maxY; y += pitchY) {
      const wander = Math.sin(y * 0.17 + col * 1.4) * size * 0.28;
      const px = x + wander + (rng() - 0.5) * size * 0.22;
      const py = y + (rng() - 0.5) * size * 0.28;
      if (!inside(mask, px, py)) continue;
      knots.push({
        x: px,
        y: py,
        size: size * (0.82 + rng() * 0.36),
        turn: (rng() - 0.5) * 1.1,
        lean: rng() * 2 - 1,
        charIndex: charIndexAt(px, ranges),
      });
    }

    const ordered = col % 2 === 0 ? knots : knots.slice().reverse();
    if (carry && ordered.length && distance(carry, ordered[0]) < pitchX * 3.4) {
      pushUnder(
        marks,
        carry.x,
        carry.y,
        ordered[0].x,
        ordered[0].y,
        ordered[0].charIndex,
        clothDark,
      );
    }

    for (let i = 0; i < ordered.length; i++) {
      const knot = ordered[i];
      const next = ordered[i + 1];
      const linked = next && distance(knot, next) < pitchY * 1.7 ? next : null;
      pushKnot(marks, knot, linked, strand, options.thread, clothDark);
    }

    if (ordered.length) carry = ordered[ordered.length - 1];
    col++;
  }
}

function pushKnot(
  marks: SewMark[],
  knot: { x: number; y: number; size: number; turn: number; lean: number; charIndex: number },
  next: { x: number; y: number; size: number } | null,
  strand: number,
  thread: string,
  clothDark: boolean,
) {
  const link = next ? knotLink(knot, next) : null;
  const wrapEnd = link ? 0.66 : 0.84;
  marks.push({
    charIndex: knot.charIndex,
    weight: link ? 4.4 : 3.3,
    draw(ctx, amount) {
      if (amount <= 0.04) return;
      const wrap = Math.min(1, amount / wrapEnd);
      drawKnotBall(ctx, knot.x, knot.y, knot.size, knot.turn, knot.lean, thread, clothDark, wrap);
      if (!link || amount <= wrapEnd) return;
      const u = (amount - wrapEnd) / (1 - wrapEnd);
      const pts = curveLink(link.from, link.to, link.bend, u);
      paintFloss(ctx, pts, thread, strand, clothDark, false, "none");
    },
    needle(amount) {
      const up = 0.12;
      const down = 0.12;
      if (amount <= up) {
        return {
          x: knot.x,
          y: knot.y,
          angle: knot.turn,
          sink: 1 - amount / up,
          length: 12,
          upright: true,
          entry: { x: knot.x, y: knot.y },
        };
      }
      if (amount < wrapEnd) {
        const wrap = (amount - up) / (wrapEnd - up);
        const tip = chordTip(knot.x, knot.y, knot.size, knot.turn, knot.lean, wrap);
        return {
          x: tip.x,
          y: tip.y,
          angle: tip.angle,
          sink: 0,
          length: 11,
          entry: { x: knot.x, y: knot.y },
        };
      }
      if (!link) {
        return {
          x: knot.x,
          y: knot.y,
          angle: knot.turn,
          sink: Math.min(1, (amount - wrapEnd) / (1 - wrapEnd)),
          length: 12,
          upright: true,
          entry: { x: knot.x, y: knot.y },
          exit: { x: knot.x, y: knot.y },
        };
      }
      const u = Math.min(1, (amount - wrapEnd) / (1 - wrapEnd - down));
      const along = curveLink(link.from, link.to, link.bend, Math.max(0.04, u));
      const tip = along[along.length - 1];
      const prev = along[Math.max(0, along.length - 2)];
      const sinking = amount > 1 - down;
      return {
        x: tip.x,
        y: tip.y,
        angle: Math.atan2(tip.y - prev.y, tip.x - prev.x),
        sink: sinking ? (amount - (1 - down)) / down : 0,
        length: 11,
        entry: { x: knot.x, y: knot.y },
        exit: sinking ? link.to : undefined,
      };
    },
  });
}

function knotLink(
  knot: { x: number; y: number; size: number; lean: number },
  next: { x: number; y: number; size: number },
) {
  return {
    from: stepToward(knot, next, knot.size * 0.42),
    to: stepToward(next, knot, next.size * 0.7),
    bend: knot.lean * knot.size * 0.16,
  };
}

function stepToward(from: { x: number; y: number }, to: { x: number; y: number }, dist: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
}

function drawKnotBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  turn: number,
  lean: number,
  thread: string,
  clothDark: boolean,
  amount: number,
) {
  if (amount <= 0.02) return;
  const chords = knotChords(x, y, size, turn, lean);
  const width = Math.max(2.4, size * 0.78);
  const shown = amount * chords.length;
  for (let i = 0; i < chords.length; i++) {
    if (shown <= i) break;
    const u = Math.min(1, shown - i);
    const chord = chords[i];
    paintFloss(
      ctx,
      [chord.a, { x: chord.a.x + (chord.b.x - chord.a.x) * u, y: chord.a.y + (chord.b.y - chord.a.y) * u }],
      thread,
      width,
      clothDark,
      false,
      "none",
    );
  }
}

function knotChords(x: number, y: number, size: number, turn: number, lean: number) {
  const chords: Array<{ a: Point; b: Point }> = [];
  for (let i = 0; i < 6; i++) {
    const angle = turn + (i * Math.PI) / 6 + lean * 0.05;
    const reach = size * (i < 4 ? 0.46 : 0.28) * (1 + 0.06 * Math.sin(i + lean * 2));
    const c = Math.cos(angle);
    const s = Math.sin(angle) * (0.9 + lean * 0.05);
    const ox = -Math.sin(angle) * size * 0.04 * ((i % 3) - 1);
    const oy = Math.cos(angle) * size * 0.04 * ((i % 3) - 1);
    chords.push({
      a: { x: x - c * reach + ox, y: y - s * reach + oy },
      b: { x: x + c * reach + ox, y: y + s * reach + oy },
    });
  }
  return chords;
}

function chordTip(x: number, y: number, size: number, turn: number, lean: number, amount: number) {
  const chords = knotChords(x, y, size, turn, lean);
  const f = Math.max(0, Math.min(0.999, amount)) * chords.length;
  const i = Math.min(chords.length - 1, Math.floor(f));
  const u = f - i;
  const chord = chords[i];
  return {
    x: chord.a.x + (chord.b.x - chord.a.x) * u,
    y: chord.a.y + (chord.b.y - chord.a.y) * u,
    angle: Math.atan2(chord.b.y - chord.a.y, chord.b.x - chord.a.x),
  };
}

function curveLink(from: Point, to: Point, bend: number, amount: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = {
    x: (from.x + to.x) / 2 + (-dy / len) * bend,
    y: (from.y + to.y) / 2 + (dx / len) * bend,
  };
  const steps = Math.max(2, Math.round(7 * amount));
  const pts: Point[] = [];
  const uMax = Math.max(0.04, Math.min(1, amount));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * uMax;
    const u = 1 - t;
    pts.push({
      x: u * u * from.x + 2 * u * t * c.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * c.y + t * t * to.y,
    });
  }
  return pts;
}

function collectRunning(
  marks: SewMark[],
  contours: Point[][],
  options: EmbroideryOptions,
  clothDark: boolean,
  ranges: Array<[number, number]>,
) {
  const dash = clampNum(7, 18, 12 * options.scale);
  const gap = dash * 0.62;
  const width = clampNum(1.3, 2.8, 1.7 * options.scale) * 2;
  const echo = 4.2 * options.scale;

  for (const contour of contours) {
    forEachDash(
      contour,
      dash,
      gap,
      (a, b) => {
        pushThread(marks, ranges, a.x, a.y, b.x, b.y, options.thread, width, clothDark);
      },
      (a, b) => {
        pushUnder(marks, a.x, a.y, b.x, b.y, charIndexAt((a.x + b.x) / 2, ranges), clothDark);
      },
    );
    const offset = offsetClosed(contour, echo);
    forEachDash(
      offset,
      dash,
      gap,
      (a, b, index) => {
        if (index % 2 === 0) {
          pushUnder(marks, a.x, a.y, b.x, b.y, charIndexAt((a.x + b.x) / 2, ranges), clothDark);
          return;
        }
        pushThread(marks, ranges, a.x, a.y, b.x, b.y, options.accent, width * 0.9, clothDark);
      },
      (a, b) => {
        pushUnder(marks, a.x, a.y, b.x, b.y, charIndexAt((a.x + b.x) / 2, ranges), clothDark);
      },
    );
  }
}

function collectChain(
  marks: SewMark[],
  contours: Point[][],
  options: EmbroideryOptions,
  clothDark: boolean,
  rng: () => number,
  ranges: Array<[number, number]>,
) {
  const spacing = clampNum(7, 16, 11 * options.scale);
  const width = clampNum(1.2, 2.4, 1.55 * options.scale) * 2;

  for (const contour of contours) {
    const pts = resampleClosed(contour, spacing);
    if (pts.length < 3) continue;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      if (len > spacing * 2.4) continue;
      const tx = dx / len;
      const ty = dy / len;
      const side = 1;
      const nx = -ty * side;
      const ny = tx * side;
      const bulge = len * 0.78;
      const j = (rng() - 0.5) * 0.6;
      const pin = 4.6 * options.scale;
      const charIndex = charIndexAt(p.x, ranges);
      const c1 = {
        x: p.x + tx * len * 0.2 + nx * bulge + j,
        y: p.y + ty * len * 0.2 + ny * bulge,
      };
      const c2 = {
        x: q.x - tx * len * 0.05 + nx * bulge * 0.92,
        y: q.y - ty * len * 0.05 + ny * bulge * 0.92,
      };
      const c3 = {
        x: q.x - tx * len * 0.35 + nx * bulge * 0.18,
        y: q.y - ty * len * 0.35 + ny * bulge * 0.18,
      };
      const c4 = {
        x: p.x + tx * len * 0.25 + nx * bulge * 0.12,
        y: p.y + ty * len * 0.25 + ny * bulge * 0.12,
      };
      const loopAt = (u: number) =>
        u <= 0.5
          ? bezierPoint(p, c1, c2, q, u * 2)
          : bezierPoint(q, c3, c4, p, (u - 0.5) * 2);
      marks.push({
        charIndex,
        weight: Math.max(2.4, Math.min(3.6, len / 5)),
        draw(ctx, amount) {
          const paint = () => {
            const steps = 22;
            const pts: Point[] = [];
            for (let s = 0; s <= steps; s++) pts.push(loopAt(s / steps));
            paintFloss(ctx, pts, options.thread, width, clothDark);
          };
          if (amount >= 1) {
            paint();
            return;
          }
          const phase = stabPhase(amount, true, true);
          if (phase.t <= 0) return;
          const tip = phase.sink > 0.22 && phase.t >= 1 ? 1 : Math.max(0.04, phase.t - 0.07);
          const steps = Math.max(4, Math.round(18 * tip));
          const points: Point[] = [];
          for (let step = 0; step <= steps; step++) points.push(loopAt((step / steps) * tip));
          strokeThread(ctx, points, options.thread, width, clothDark, "entry");
        },
        needle(amount) {
          const phase = stabPhase(amount, true, true);
          const point = loopAt(phase.t);
          const ahead = loopAt(Math.min(1, phase.t + 0.04));
          return {
            x: point.x,
            y: point.y,
            angle: Math.atan2(ahead.y - point.y, ahead.x - point.x),
            sink: phase.sink,
            length: Math.min(14, Math.max(7, len * 0.55)),
            entry: p,
            exit: phase.t >= 1 && phase.sink > 0.04 ? p : undefined,
          };
        },
      });
      const tackEnd = { x: p.x + nx * pin, y: p.y + ny * pin };
      pushThread(
        marks,
        ranges,
        p.x - nx * 0.4,
        p.y - ny * 0.4,
        tackEnd.x,
        tackEnd.y,
        options.accent,
        width * 1.15,
        clothDark,
      );
      if (distance(tackEnd, q) < spacing * 3) {
        pushUnder(marks, tackEnd.x, tackEnd.y, q.x, q.y, charIndexAt(q.x, ranges), clothDark);
      }
    }
  }
}

function collectWhipped(
  marks: SewMark[],
  contours: Point[][],
  options: EmbroideryOptions,
  clothDark: boolean,
  ranges: Array<[number, number]>,
) {
  const stitch = clampNum(6, 14, 8 * options.scale);
  const baseW = clampNum(1.8, 3.6, 2.7 * options.scale) * 2;
  const whipSpacing = clampNum(5, 10, 7.2 * options.scale);
  const whipLen = 7.2 * options.scale;

  for (const contour of contours) {
    const segments: Array<{ a: Point; b: Point }> = [];
    forEachDash(contour, stitch, 0, (a, b) => segments.push({ a, b }));
    if (segments.length > 0) {
      const first = segments[0];
      pushThread(marks, ranges, first.a.x, first.a.y, first.b.x, first.b.y, options.thread, baseW, clothDark);
      for (let i = 1; i < segments.length; i++) {
        const prev = segments[i - 1];
        const seg = segments[i];
        pushUnder(marks, prev.b.x, prev.b.y, seg.b.x, seg.b.y, charIndexAt(seg.b.x, ranges), clothDark);
        pushThread(marks, ranges, seg.b.x, seg.b.y, seg.a.x, seg.a.y, options.thread, baseW, clothDark);
      }
    }

    const pts = resampleClosed(contour, whipSpacing);
    let prevEnd: Point | null = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const tx = dx / len;
      const ty = dy / len;
      const flip = i % 2 === 0 ? 1 : -1;
      const wx = tx * 0.55 + -ty * 0.85 * flip;
      const wy = ty * 0.55 + tx * 0.85 * flip;
      const wlen = Math.hypot(wx, wy) || 1;
      const ux = wx / wlen;
      const uy = wy / wlen;
      const start = { x: p.x - ux * whipLen, y: p.y - uy * whipLen };
      const end = { x: p.x + ux * whipLen, y: p.y + uy * whipLen };
      if (prevEnd && distance(prevEnd, start) < whipLen * 5) {
        pushUnder(marks, prevEnd.x, prevEnd.y, start.x, start.y, charIndexAt(start.x, ranges), clothDark);
      }
      pushThread(marks, ranges, start.x, start.y, end.x, end.y, options.accent, baseW * 0.48, clothDark);
      prevEnd = end;
    }

    forEachDash(contour, stitch, 0, (a, b) => {
      pushThread(marks, ranges, a.x, a.y, b.x, b.y, options.thread, baseW * 0.42, clothDark, "glide");
    });
  }
}

function charRanges(
  text: string,
  fontFamily: string,
  start: number,
  end: number,
  fontSize: number,
  letterSpacing: number,
): Array<[number, number]> {
  if (!text) return [];
  const total = measureTextWidth(text, fontFamily, fontSize, letterSpacing) || 1;
  const span = end - start;
  const ranges: Array<[number, number]> = [];
  let prev = start;
  for (let i = 0; i < text.length; i++) {
    const prefix = measureTextWidth(text.slice(0, i + 1), fontFamily, fontSize, letterSpacing);
    const right = i === text.length - 1 ? end : start + (prefix / total) * span;
    ranges.push([prev, right]);
    prev = right;
  }
  return ranges;
}

function charIndexAt(x: number, ranges: Array<[number, number]>) {
  if (ranges.length <= 1) return 0;
  for (let i = 0; i < ranges.length - 1; i++) {
    if (x < ranges[i][1]) return i;
  }
  return ranges.length - 1;
}

function pushThread(
  marks: SewMark[],
  ranges: Array<[number, number]>,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  clothDark: boolean,
  mode: "stab" | "glide" | "satin" = "stab",
) {
  const pieces = cutSegment(x1, y1, x2, y2, ranges);
  const castShadow = mode !== "satin";
  pieces.forEach((piece, index) => {
    const lead = mode !== "glide" && index === 0;
    const tail = mode !== "glide" && index === pieces.length - 1;
    const dx = piece.x2 - piece.x1;
    const dy = piece.y2 - piece.y1;
    const len = Math.hypot(dx, dy) || 1;
    const needleLen = Math.min(13, Math.max(6.5, len * 0.36));
    const phaseOf = (amount: number) =>
      mode === "satin"
        ? stabPhase(amount, lead, tail, lead ? 0.08 : 0, tail ? 0.1 : 0)
        : stabPhase(amount, lead, tail);
    const weight =
      mode === "satin"
        ? Math.max(1.05, Math.min(2.6, len / 14))
        : (mode === "glide" ? 0.38 : 1) * Math.max(0.45, Math.min(3.4, len / 12));
    marks.push({
      charIndex: piece.charIndex,
      weight,
      draw(ctx, amount) {
        if (amount <= 0) return;
        if (amount >= 1) {
          drawThread(ctx, piece.x1, piece.y1, piece.x2, piece.y2, color, width, clothDark, castShadow, "both");
          return;
        }
        const phase = phaseOf(amount);
        if (phase.t <= 0) return;
        const eye = needleLen * 0.58;
        const tip = len * phase.t;
        const end =
          phase.sink > 0.22 && phase.t >= 1 ? len : Math.max(Math.min(2.4, tip), tip - eye);
        if (end <= 0.4) return;
        const t = Math.min(1, end / len);
        drawThread(
          ctx,
          piece.x1,
          piece.y1,
          piece.x1 + dx * t,
          piece.y1 + dy * t,
          color,
          width,
          clothDark,
          castShadow,
          "entry",
        );
      },
      needle(amount) {
        const phase = phaseOf(amount);
        return {
          x: piece.x1 + dx * phase.t,
          y: piece.y1 + dy * phase.t,
          angle: Math.atan2(dy, dx),
          sink: phase.sink,
          length: needleLen,
          entry: lead ? { x: piece.x1, y: piece.y1 } : undefined,
          exit: tail && phase.t > 0.72 ? { x: piece.x2, y: piece.y2 } : undefined,
        };
      },
    });
  });
}

function pushUnder(
  marks: SewMark[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  charIndex: number,
  clothDark: boolean,
  weight?: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.8) return;
  marks.push({
    charIndex,
    weight: weight ?? Math.max(0.85, Math.min(1.6, len / 16)),
    draw(ctx, amount) {
      if (amount <= 0.01 || amount >= 1) return;
      drawBuriedThread(ctx, x1, y1, x1 + dx * amount, y1 + dy * amount, clothDark);
    },
    needle(amount) {
      return {
        x: x1 + dx * amount,
        y: y1 + dy * amount,
        angle: Math.atan2(dy, dx),
        sink: 1,
        length: Math.min(12, Math.max(7, len * 0.35)),
        entry: { x: x1, y: y1 },
      };
    },
  });
}

function stabPhase(
  amount: number,
  lead: boolean,
  tail: boolean,
  rise = lead ? 0.18 : 0,
  sink = tail ? 0.16 : 0,
) {
  const up = rise;
  const down = sink;
  const span = Math.max(0.05, 1 - up - down);
  if (amount <= up) {
    return { t: 0, sink: up === 0 ? 0 : 1 - amount / up };
  }
  if (amount >= 1 - down) {
    return { t: 1, sink: down === 0 ? 0 : (amount - (1 - down)) / down };
  }
  return { t: (amount - up) / span, sink: 0 };
}

function bezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function strokeThread(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  width: number,
  clothDark: boolean,
  ends: ThreadEnd = "both",
) {
  paintFloss(ctx, points, color, width, clothDark, true, ends);
}

function drawBuriedThread(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  clothDark: boolean,
) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = clothDark ? "rgba(255,255,255,0.1)" : "rgba(62, 38, 22, 0.14)";
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = clothDark ? "rgba(0,0,0,0.16)" : "rgba(255, 248, 236, 0.32)";
  ctx.lineWidth = 0.55;
  ctx.stroke();
  ctx.restore();
}

function drawNeedle(ctx: CanvasRenderingContext2D, pose: NeedlePose, clothDark: boolean) {
  const sink = Math.max(0, Math.min(1, pose.sink));
  if (pose.entry && sink < 0.98) drawHole(ctx, pose.entry.x, pose.entry.y, clothDark);
  if (pose.exit && sink > 0.12) drawHole(ctx, pose.exit.x, pose.exit.y, clothDark);
  if (sink > 0.4 && !pose.quiet) drawDimple(ctx, pose, clothDark);
  if (pose.upright) {
    drawUprightNeedle(ctx, pose, sink, clothDark);
    return;
  }
  if (sink > 0.8) return;

  const visible = 1 - sink;
  const length = pose.length * (0.4 + 0.6 * visible);
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.angle);
  ctx.fillStyle = clothDark ? "rgba(0,0,0,0.4)" : "rgba(48, 28, 16, 0.22)";
  ctx.beginPath();
  ctx.moveTo(1.5, 1.1);
  ctx.lineTo(-length, 0.2);
  ctx.lineTo(-length, 2.2);
  ctx.closePath();
  ctx.fill();

  const metal = ctx.createLinearGradient(-length, -1.2, 2, 1.2);
  metal.addColorStop(0, "#8e98a3");
  metal.addColorStop(0.42, "#f5f8fb");
  metal.addColorStop(1, "#c5ced6");
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.moveTo(2.5, 0);
  ctx.lineTo(-length + 2.4, -1.15);
  ctx.lineTo(-length, -0.85);
  ctx.lineTo(-length, 0.85);
  ctx.lineTo(-length + 2.4, 1.15);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = clothDark ? "#140e0a" : "#24180f";
  ctx.beginPath();
  ctx.ellipse(-length + 2.15, 0, 0.55, 0.95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawUprightNeedle(
  ctx: CanvasRenderingContext2D,
  pose: NeedlePose,
  sink: number,
  clothDark: boolean,
) {
  if (sink > 0.84) return;
  const length = 13 * (1 - sink);
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.fillStyle = clothDark ? "rgba(0,0,0,0.4)" : "rgba(48, 28, 16, 0.22)";
  ctx.beginPath();
  ctx.ellipse(1.1, 1, 2.1, 1.25, 0, 0, Math.PI * 2);
  ctx.fill();
  const metal = ctx.createLinearGradient(0, 0, -1.5, -length);
  metal.addColorStop(0, "#b7c1cb");
  metal.addColorStop(1, "#f7f9fb");
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-2.5, -length);
  ctx.lineTo(1.35, -length + 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = clothDark ? "#0e0a08" : "#24180f";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.ellipse(-0.55, -length + 2.3, 0.55, 0.85, -0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHole(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  clothDark: boolean,
) {
  ctx.beginPath();
  ctx.fillStyle = clothDark ? "rgba(0,0,0,0.78)" : "rgba(32, 16, 8, 0.72)";
  ctx.arc(x, y, 2.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = clothDark ? "rgba(255,255,255,0.28)" : "rgba(255,248,236,0.85)";
  ctx.arc(x - 0.45, y - 0.5, 0.62, 0, Math.PI * 2);
  ctx.fill();
}

function drawDimple(ctx: CanvasRenderingContext2D, pose: NeedlePose, clothDark: boolean) {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.angle);
  ctx.fillStyle = clothDark ? "rgba(0,0,0,0.34)" : "rgba(48, 28, 16, 0.28)";
  ctx.beginPath();
  ctx.ellipse(1.6, 1.3, 9.5, 4.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = clothDark ? "rgba(255,255,255,0.14)" : "rgba(255,250,242,0.72)";
  ctx.beginPath();
  ctx.ellipse(-0.8, -0.7, 6.2, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = clothDark ? "rgba(0,0,0,0.22)" : "rgba(90, 58, 36, 0.18)";
  ctx.beginPath();
  ctx.ellipse(0.2, 0.15, 7.2, 1.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function cutSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  ranges: Array<[number, number]>,
) {
  if (ranges.length === 0) {
    return [{ x1, y1, x2, y2, charIndex: 0 }];
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const ts = [0, 1];
  if (Math.abs(dx) > 0.01) {
    for (let i = 0; i < ranges.length - 1; i++) {
      const t = (ranges[i][1] - x1) / dx;
      if (t > 0.02 && t < 0.98) ts.push(t);
    }
  }
  ts.sort((a, b) => a - b);
  const pieces: Array<{ x1: number; y1: number; x2: number; y2: number; charIndex: number }> = [];
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i + 1] - ts[i] < 0.02) continue;
    const t0 = ts[i];
    const t1 = ts[i + 1];
    const ax = x1 + dx * t0;
    const ay = y1 + dy * t0;
    const bx = x1 + dx * t1;
    const by = y1 + dy * t1;
    pieces.push({
      x1: ax,
      y1: ay,
      x2: bx,
      y2: by,
      charIndex: charIndexAt((ax + bx) / 2, ranges),
    });
  }
  if (pieces.length === 0) {
    return [{ x1, y1, x2, y2, charIndex: charIndexAt((x1 + x2) / 2, ranges) }];
  }
  return pieces;
}

type ThreadEnd = "both" | "entry" | "none";

function drawThread(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  clothDark: boolean,
  castShadow = true,
  ends: ThreadEnd = "both",
) {
  if (!castShadow) {
    paintSatinStrand(ctx, x1, y1, x2, y2, color, width, clothDark, ends);
    return;
  }
  paintFloss(ctx, [{ x: x1, y: y1 }, { x: x2, y: y2 }], color, width, clothDark, castShadow, ends);
}

function paintSatinStrand(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  clothDark: boolean,
  ends: ThreadEnd,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.35) return;
  const [r, g, b] = hexToRgb(color);
  const w = Math.max(1, width);
  const radius = w / 2;
  const x0 = ends === "none" ? 0 : Math.min(radius, len * 0.42);
  const x1b = ends === "both" ? Math.max(x0 + 0.35, len - radius) : len;
  const angle = Math.atan2(dy, dx);
  const tx = Math.cos(angle);
  const ty = Math.sin(angle);
  // Light sits up and to the left, above the cloth.
  const lx = -0.4;
  const ly = -0.92;
  const along = tx * lx + ty * ly;
  const facing = Math.sqrt(Math.max(0, 1 - along * along));
  const across = 0.4 * Math.sin(angle) - 0.92 * Math.cos(angle);
  const lift = Math.abs(across) < 0.2 ? (across < 0 ? -0.2 : 0.2) : across;
  const seed = threadPhase(x1, y1);
  const glint = facing * (0.28 + 0.72 * (0.5 + 0.5 * Math.sin(seed)));
  const strand = w * 0.74;

  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(angle);
  ctx.lineCap = "round";

  if (ends !== "none") paintPuncture(ctx, 0, 0, w * 0.45, clothDark);
  if (ends === "both") paintPuncture(ctx, len, 0, w * 0.45, clothDark);

  ctx.beginPath();
  ctx.rect(-0.15, -w, len + 0.3, w * 2);
  ctx.clip();

  const shadowY = -0.45 * Math.sin(angle) + 0.8 * Math.cos(angle);
  const mid0 = x0 + (x1b - x0) * 0.12;
  const mid1 = x1b - (x1b - x0) * 0.12;
  ctx.strokeStyle = clothDark ? "rgba(0,0,0,0.45)" : "rgba(42, 24, 14, 0.9)";
  ctx.globalAlpha = clothDark ? 0.28 : 0.2;
  ctx.lineWidth = strand * 1.05;
  ctx.beginPath();
  ctx.moveTo(mid0, shadowY);
  ctx.lineTo(mid1, shadowY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  paintShadedSatinFloss(ctx, x0, x1b, strand, color, clothDark, seed, facing, lift);

  const sheenY = lift * strand * 0.16;
  const sheen = (alpha: number, liftTone: number, line: number) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = rgba(tone(r, g, b, liftTone), 1);
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.moveTo(x0, sheenY);
    ctx.lineTo(x1b, sheenY);
    ctx.stroke();
  };
  sheen(0.1 + 0.16 * glint, 0.28, strand * 0.42);
  sheen(0.08 + 0.34 * glint, 0.48, strand * 0.22);
  if (glint > 0.55) sheen(0.22 + 0.4 * glint, 0.72, Math.max(0.35, strand * 0.1));
  ctx.globalAlpha = 1;
  ctx.restore();
}

type SatinScratch = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

const satinScratch: { color: SatinScratch | null; mask: SatinScratch | null } = {
  color: null,
  mask: null,
};

function scratchSize(pixels: number) {
  let size = 64;
  while (size < pixels) size *= 2;
  return size;
}

function scratchCanvas(slot: "color" | "mask", width: number, height: number) {
  let scratch = satinScratch[slot];
  if (!scratch) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    scratch = { canvas, ctx };
    satinScratch[slot] = scratch;
  }
  const { canvas, ctx } = scratch;
  const nextW = Math.max(canvas.width, scratchSize(width));
  const nextH = Math.max(canvas.height, scratchSize(height));
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  return scratch;
}

function paintShadedSatinFloss(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1b: number,
  strand: number,
  color: string,
  clothDark: boolean,
  seed: number,
  facing: number,
  lift: number,
) {
  const spanPx = Math.max(0.4, x1b - x0);
  const pad = strand;
  const bw = spanPx + pad * 2;
  const bh = strand * 2.4;
  const res = 3;
  const pw = Math.max(1, Math.ceil(bw * res));
  const ph = Math.max(1, Math.ceil(bh * res));
  const colorScratch = scratchCanvas("color", pw, ph);
  if (!colorScratch) return;
  const colorCanvas = colorScratch.canvas;
  const g = colorScratch.ctx;

  g.setTransform(res, 0, 0, res, 0, 0);
  g.translate(pad, bh / 2);

  const plySpan = 0.82;
  const scale = Math.max(1.05, strand) / (FLOSS_CORD * plySpan);
  const tileSpan = spanPx / scale;
  const phase = (seed / (Math.PI * 2)) * FLOSS_TILE_W;
  const origin = -(((phase % FLOSS_TILE_W) + FLOSS_TILE_W) % FLOSS_TILE_W);
  const tile = flossTile(color, clothDark);
  g.save();
  g.scale(scale, scale);
  clipStrand(g, tileSpan, (FLOSS_CORD * plySpan) / 2, false, false);
  for (let x = origin - FLOSS_TILE_W; x < tileSpan + FLOSS_CORD; x += FLOSS_TILE_W) {
    g.drawImage(tile, x, -FLOSS_TILE_H / 2, FLOSS_TILE_W, FLOSS_TILE_H);
  }
  g.restore();

  const maskScratch = scratchCanvas("mask", pw, ph);
  if (!maskScratch) return;
  const maskCanvas = maskScratch.canvas;
  const mask = maskScratch.ctx;
  mask.drawImage(colorCanvas, 0, 0, pw, ph, 0, 0, pw, ph);

  // Same side-to-side light as the satin cylinder: darken the shadow side, brighten the lit side.
  const loF = 0.72 - 0.18 * (1 - facing);
  const hiLift = 0.08 + 0.22 * facing;
  const gray = (factor: number) => {
    const v = clamp(factor * 255);
    return `rgb(${v},${v},${v})`;
  };
  const mul = g.createLinearGradient(0, -strand / 2, 0, strand / 2);
  const add = g.createLinearGradient(0, -strand / 2, 0, strand / 2);
  if (lift >= 0) {
    mul.addColorStop(0, gray(loF));
    mul.addColorStop(0.38, gray(0.92));
    mul.addColorStop(0.62, gray(1));
    mul.addColorStop(1, gray(1));
    add.addColorStop(0, gray(0));
    add.addColorStop(0.62, gray(0));
    add.addColorStop(1, gray(hiLift));
  } else {
    mul.addColorStop(0, gray(1));
    mul.addColorStop(0.38, gray(1));
    mul.addColorStop(0.62, gray(0.92));
    mul.addColorStop(1, gray(loF));
    add.addColorStop(0, gray(hiLift));
    add.addColorStop(0.38, gray(0));
    add.addColorStop(1, gray(0));
  }

  g.lineCap = "butt";
  g.globalAlpha = 1;
  g.globalCompositeOperation = "multiply";
  g.strokeStyle = mul;
  g.lineWidth = strand;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(spanPx, 0);
  g.stroke();

  g.globalCompositeOperation = "screen";
  g.strokeStyle = add;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(spanPx, 0);
  g.stroke();

  g.globalCompositeOperation = "destination-in";
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(maskCanvas, 0, 0, pw, ph, 0, 0, pw, ph);
  g.globalCompositeOperation = "source-over";

  ctx.drawImage(colorCanvas, 0, 0, pw, ph, x0 - pad, -bh / 2, bw, bh);
}

function paintPuncture(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  threadW: number,
  clothDark: boolean,
) {
  const r = Math.max(0.38, Math.min(0.7, threadW * 0.16));
  ctx.save();
  ctx.fillStyle = clothDark ? "rgba(255,255,255,0.05)" : "rgba(58, 36, 18, 0.1)";
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.12, r * 1.25, r * 0.72, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = clothDark ? "rgba(0,0,0,0.82)" : "rgba(22, 11, 6, 0.78)";
  ctx.beginPath();
  ctx.ellipse(x + 0.03, y + 0.05, r * 0.62, r * 0.46, 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = clothDark ? "rgba(255,255,255,0.2)" : "rgba(255, 250, 242, 0.75)";
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.ellipse(x - 0.04, y - 0.06, r * 0.9, r * 0.55, 0.55, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();
}

const FLOSS_TILE_W = 48;
const FLOSS_TILE_H = 36;
const FLOSS_CORD = 22;

const flossTiles = new Map<string, HTMLCanvasElement>();

function flossTile(color: string, clothDark: boolean) {
  const key = `${color}:${clothDark ? "d" : "l"}`;
  const existing = flossTiles.get(key);
  if (existing) return existing;

  const res = 3;
  const canvas = document.createElement("canvas");
  canvas.width = FLOSS_TILE_W * res;
  canvas.height = FLOSS_TILE_H * res;
  const g = canvas.getContext("2d");
  if (!g) return canvas;
  g.setTransform(res, 0, 0, res, 0, 0);

  const [r, gv, b] = hexToRgb(color);
  const mid = FLOSS_TILE_H / 2;
  const cord = FLOSS_CORD;
  const plies = [
    { phase: 0.2, amp: 0.11, lift: -0.22, tone: -0.24, width: 0.2, alpha: 0.96 },
    { phase: 2.2, amp: 0.1, lift: 0.0, tone: 0.0, width: 0.18, alpha: 0.94 },
    { phase: 4.1, amp: 0.09, lift: 0.22, tone: -0.34, width: 0.16, alpha: 0.92 },
    { phase: 1.3, amp: 0.07, lift: -0.06, tone: clothDark ? 0.42 : 0.26, width: 0.08, alpha: 0.6 },
  ];

  g.lineCap = "round";
  g.lineJoin = "round";
  for (const ply of plies) {
    g.strokeStyle = rgba(tone(r, gv, b, ply.tone), ply.alpha);
    g.lineWidth = cord * ply.width;
    g.beginPath();
    for (let x = -2; x <= FLOSS_TILE_W + 2; x += 1) {
      const y =
        mid +
        Math.sin((x / FLOSS_TILE_W) * Math.PI * 2 + ply.phase) * cord * ply.amp +
        cord * ply.lift;
      if (x === -2) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  flossTiles.set(key, canvas);
  return canvas;
}

function paintFloss(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  width: number,
  clothDark: boolean,
  castShadow = true,
  ends: ThreadEnd = "both",
) {
  if (points.length < 2) return;
  const w = Math.max(1.05, width * 0.92);
  const tile = flossTile(color, clothDark);
  const scale = w / FLOSS_CORD;
  const radius = FLOSS_CORD / 2;
  const sunk = sinkEnds(points, ends, Math.min(2.3, w * 1.2));

  if (castShadow) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokeShifted(
      ctx,
      sunk,
      0.2,
      Math.max(0.35, w * 0.32),
      w * 0.5,
      clothDark ? "rgba(0,0,0,0.28)" : "rgba(40, 24, 12, 0.14)",
    );
    ctx.restore();
  }

  let phase = (threadPhase(points[0].x, points[0].y) / (Math.PI * 2)) * FLOSS_TILE_W;
  for (let i = 1; i < sunk.length; i++) {
    const a = sunk[i - 1];
    const b = sunk[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.2) continue;
    const span = len / scale;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.scale(scale, scale);
    const capStart = ends === "none" && i === 1;
    const capEnd = ends === "none" && i === sunk.length - 1;
    clipStrand(ctx, span, radius, capStart, capEnd);
    const origin = -(((phase % FLOSS_TILE_W) + FLOSS_TILE_W) % FLOSS_TILE_W);
    for (let x = origin - FLOSS_TILE_W; x < span + radius; x += FLOSS_TILE_W) {
      ctx.drawImage(tile, x, -FLOSS_TILE_H / 2, FLOSS_TILE_W, FLOSS_TILE_H);
    }
    ctx.restore();
    phase += span;
  }

  if (ends !== "none") buryThreadEnd(ctx, points[0], sunk[0], color, w, clothDark);
  if (ends === "both") buryThreadEnd(ctx, points[points.length - 1], sunk[sunk.length - 1], color, w, clothDark);
}

function sinkEnds(points: Point[], ends: ThreadEnd, dist: number) {
  const out = points.map((point) => ({ x: point.x, y: point.y }));
  if (ends === "none" || out.length < 2 || dist <= 0) return out;
  const pull = (index: number, toward: number) => {
    const from = out[index];
    const next = out[toward];
    const dx = next.x - from.x;
    const dy = next.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < dist * 2.1) return;
    out[index] = { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
  };
  pull(0, 1);
  if (ends === "both") pull(out.length - 1, out.length - 2);
  return out;
}

function buryThreadEnd(
  ctx: CanvasRenderingContext2D,
  outer: Point,
  inner: Point,
  color: string,
  width: number,
  clothDark: boolean,
) {
  const dx = inner.x - outer.x;
  const dy = inner.y - outer.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.4) {
    paintPuncture(ctx, outer.x, outer.y, width, clothDark);
    return;
  }
  const px = -dy / len;
  const py = dx / len;
  const [r, g, b] = hexToRgb(color);
  ctx.save();
  ctx.lineCap = "round";
  const necks = [
    { side: -0.16, lift: -0.2, alpha: 0.95 },
    { side: 0.02, lift: 0.08, alpha: 0.9 },
    { side: 0.16, lift: -0.32, alpha: 0.8 },
  ];
  for (const neck of necks) {
    ctx.strokeStyle = rgba(tone(r, g, b, neck.lift), neck.alpha);
    ctx.lineWidth = Math.max(0.28, width * 0.16);
    ctx.beginPath();
    ctx.moveTo(outer.x, outer.y);
    ctx.lineTo(inner.x + px * width * neck.side, inner.y + py * width * neck.side);
    ctx.stroke();
  }
  ctx.restore();
  paintPuncture(ctx, outer.x, outer.y, width, clothDark);
}

function clipStrand(
  ctx: CanvasRenderingContext2D,
  length: number,
  radius: number,
  capStart: boolean,
  capEnd: boolean,
) {
  ctx.beginPath();
  if (capStart) ctx.arc(0, 0, radius, Math.PI / 2, -Math.PI / 2, false);
  else ctx.moveTo(0, -radius);
  ctx.lineTo(length, -radius);
  if (capEnd) ctx.arc(length, 0, radius, -Math.PI / 2, Math.PI / 2, false);
  else ctx.lineTo(length, radius);
  ctx.lineTo(0, radius);
  ctx.closePath();
  ctx.clip();
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  width: number,
  style: string,
) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}

function strokeShifted(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  dx: number,
  dy: number,
  width: number,
  style: string,
) {
  strokePath(
    ctx,
    points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    width,
    style,
  );
}

function threadPhase(x: number, y: number) {
  const n = Math.imul(Math.round(x * 7) ^ Math.imul(Math.round(y * 7), 374761393), 668265263);
  return ((n >>> 0) % 1000) / 1000 * Math.PI * 2;
}

function traceContours(
  mask: Uint8Array,
  w: number,
  h: number,
  scale: number,
): Point[][] {
  const box = bounds(mask, w, h);
  if (!box) return [];

  const x0 = Math.max(0, box.minX - 2);
  const y0 = Math.max(0, box.minY - 2);
  const x1 = Math.min(w - 1, box.maxX + 2);
  const y1 = Math.min(h - 1, box.maxY + 2);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  if (cw < 3 || ch < 3) return [];

  const crop = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    crop.set(mask.subarray((y + y0) * w + x0, (y + y0) * w + x0 + cw), y * cw);
  }

  const segs: Seg[] = [];
  for (let y = 0; y < ch - 1; y++) {
    for (let x = 0; x < cw - 1; x++) {
      const code =
        (crop[y * cw + x] ? 1 : 0) |
        (crop[y * cw + x + 1] ? 2 : 0) |
        (crop[(y + 1) * cw + x + 1] ? 4 : 0) |
        (crop[(y + 1) * cw + x] ? 8 : 0);
      for (const [a, b] of CASES[code]) {
        const p = edgePoint(a, x, y);
        const q = edgePoint(b, x, y);
        segs.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
      }
    }
  }

  return linkSegments(dedupe(segs))
    .map((contour) =>
      contour.map((point) => ({
        x: (point.x + x0) / scale,
        y: (point.y + y0) / scale,
      })),
    )
    .filter((contour) => contour.length > 10 && polygonArea(contour) > 18);
}

function edgePoint(edge: number, x: number, y: number): Point {
  if (edge === 0) return { x: x + 0.5, y };
  if (edge === 1) return { x: x + 1, y: y + 0.5 };
  if (edge === 2) return { x: x + 0.5, y: y + 1 };
  return { x, y: y + 0.5 };
}

function dedupe(segs: Seg[]) {
  const seen = new Set<string>();
  const out: Seg[] = [];
  for (const seg of segs) {
    const a = pointKey(seg.x1, seg.y1);
    const b = pointKey(seg.x2, seg.y2);
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(seg);
  }
  return out;
}

function linkSegments(segs: Seg[]): Point[][] {
  const nodes = new Map<string, { x: number; y: number; segs: number[] }>();
  const touch = (x: number, y: number, index: number) => {
    const id = pointKey(x, y);
    let node = nodes.get(id);
    if (!node) {
      node = { x, y, segs: [] };
      nodes.set(id, node);
    }
    node.segs.push(index);
  };

  segs.forEach((seg, index) => {
    touch(seg.x1, seg.y1, index);
    touch(seg.x2, seg.y2, index);
  });

  const used = new Uint8Array(segs.length);
  const contours: Point[][] = [];

  const otherEnd = (index: number, id: string) => {
    const seg = segs[index];
    return pointKey(seg.x1, seg.y1) === id
      ? pointKey(seg.x2, seg.y2)
      : pointKey(seg.x1, seg.y1);
  };

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const startKey = pointKey(segs[i].x1, segs[i].y1);
    const contour: Point[] = [];
    let current = i;
    let currentKey = startKey;
    let guard = 0;

    while (guard++ < segs.length + 2) {
      if (used[current]) break;
      used[current] = 1;
      const node = nodes.get(currentKey);
      if (node) contour.push({ x: node.x, y: node.y });
      const nextKey = otherEnd(current, currentKey);
      if (nextKey === startKey) break;
      const nextNode = nodes.get(nextKey);
      if (!nextNode) break;
      const next = nextNode.segs.find((index) => !used[index]);
      if (next === undefined) {
        contour.push({ x: nextNode.x, y: nextNode.y });
        break;
      }
      currentKey = nextKey;
      current = next;
    }

    if (contour.length > 8) contours.push(contour);
  }

  return contours;
}

function tidyContours(contours: Point[][]) {
  return contours.map((contour) =>
    resampleClosed(smoothClosed(contour, 9), 1.8),
  );
}

function smoothClosed(pts: Point[], window: number) {
  const count = pts.length;
  const half = Math.floor(window / 2);
  const out: Point[] = [];
  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    for (let k = -half; k <= half; k++) {
      const point = pts[(i + k + count) % count];
      x += point.x;
      y += point.y;
    }
    const span = half * 2 + 1;
    out.push({ x: x / span, y: y / span });
  }
  return out;
}

function resampleClosed(pts: Point[], spacing: number) {
  if (pts.length < 2) return pts;
  const out: Point[] = [];
  let prev = pts[0];
  let carry = 0;
  out.push(prev);

  for (let i = 1; i <= pts.length; i++) {
    let target = pts[i % pts.length];
    let dx = target.x - prev.x;
    let dy = target.y - prev.y;
    let distLeft = Math.hypot(dx, dy);
    if (distLeft === 0) continue;

    while (carry + distLeft >= spacing) {
      const travel = (spacing - carry) / distLeft;
      prev = {
        x: prev.x + dx * travel,
        y: prev.y + dy * travel,
      };
      out.push(prev);
      dx = target.x - prev.x;
      dy = target.y - prev.y;
      distLeft = Math.hypot(dx, dy);
      carry = 0;
      if (distLeft === 0) break;
    }
    carry += distLeft;
    prev = target;
  }

  if (out.length > 1 && distance(out[0], out[out.length - 1]) < spacing * 0.4) {
    out.pop();
  }
  return out;
}

function forEachDash(
  pts: Point[],
  dash: number,
  gap: number,
  fn: (a: Point, b: Point, index: number) => void,
  onGap?: (a: Point, b: Point) => void,
) {
  if (pts.length < 2) return;
  const loop = [...pts, pts[0]];
  let total = 0;
  for (let i = 1; i < loop.length; i++) total += distance(loop[i - 1], loop[i]);
  if (total < 2) return;

  let covered = 0;
  let seg = 0;
  let pos = { ...loop[0] };
  let segEnd = loop[1];
  let segLeft = distance(pos, segEnd);
  let drawing = true;
  let remain = Math.max(dash, 0.5);
  let index = 0;
  let guard = 0;

  while (covered < total - 0.25 && guard++ < 200000) {
    if (segLeft < 0.01) {
      seg++;
      if (seg >= pts.length) break;
      pos = { ...loop[seg] };
      segEnd = loop[seg + 1];
      segLeft = distance(pos, segEnd);
      continue;
    }

    const step = Math.min(remain, segLeft);
    const nx = pos.x + ((segEnd.x - pos.x) / segLeft) * step;
    const ny = pos.y + ((segEnd.y - pos.y) / segLeft) * step;
    const next = { x: nx, y: ny };
    if (step > 0.2) {
      if (drawing) fn(pos, next, index);
      else onGap?.(pos, next);
    }
    pos = next;
    segLeft -= step;
    remain -= step;
    covered += step;
    if (remain > 0.05) continue;
    if (drawing) index++;
    drawing = gap <= 0 ? true : !drawing;
    remain = drawing || gap <= 0 ? Math.max(dash, 0.5) : gap;
  }
}

function offsetClosed(pts: Point[], amount: number) {
  const count = pts.length;
  return pts.map((point, index) => {
    const prev = pts[(index - 1 + count) % count];
    const next = pts[(index + 1) % count];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    return { x: point.x - ty * amount, y: point.y + tx * amount };
  });
}

function bounds(mask: Uint8Array, w: number, h: number) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    any = true;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

function inside(mask: Mask, x: number, y: number) {
  const ix = Math.round(x * mask.scale);
  const iy = Math.round(y * mask.scale);
  if (ix < 0 || iy < 0 || ix >= mask.w || iy >= mask.h) return false;
  return mask.mask[iy * mask.w + ix] === 1;
}

function polygonArea(pts: Point[]) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointKey(x: number, y: number) {
  return `${Math.round(x * 2)},${Math.round(y * 2)}`;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function tone(r: number, g: number, b: number, lift: number): [number, number, number] {
  if (lift >= 0) {
    return [
      clamp(r + (255 - r) * lift),
      clamp(g + (255 - g) * lift),
      clamp(b + (255 - b) * lift),
    ];
  }
  const scale = 1 + lift;
  return [clamp(r * scale), clamp(g * scale), clamp(b * scale)];
}

function rgba(channels: [number, number, number], alpha: number) {
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampNum(min: number, max: number, value: number) {
  return Math.max(min, Math.min(max, value));
}
