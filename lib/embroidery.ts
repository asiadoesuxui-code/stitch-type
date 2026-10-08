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
    blurb: "Straight threads laid side by side in a single thread color.",
  },
  {
    id: "knot",
    name: "Knots",
    label: "French knot",
    blurb: "Raised knots packed into the letter. Each center is the accent thread.",
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
  const cell = clampNum(16, 34, 22 * stitchScale);
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
  const threadW = Math.max(1.1, cell * 0.16);
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
  const box = bounds(mask.mask, mask.w, mask.h);
  if (!box) return;

  const angle = (-58 * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;
  const spacing = clampNum(2.4, 6.5, 3.5 * options.scale) * mask.scale;
  const width = (spacing / mask.scale) * 0.82;
  const hop = (spacing / mask.scale) * 3.2;
  const runs: Array<{ x1: number; y1: number; x2: number; y2: number; mx: number; my: number }> = [];

  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.maxY },
  ];
  let minT = Infinity;
  let maxT = -Infinity;
  let minS = Infinity;
  let maxS = -Infinity;
  for (const corner of corners) {
    const t = corner.x * nx + corner.y * ny;
    const s = corner.x * dx + corner.y * dy;
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
  }

  for (let t = minT; t <= maxT; t += spacing) {
    let runStart: number | null = null;
    for (let s = minS; s <= maxS; s += 1) {
      const x = Math.round(nx * t + dx * s);
      const y = Math.round(ny * t + dy * s);
      const on =
        x >= 0 &&
        y >= 0 &&
        x < mask.w &&
        y < mask.h &&
        mask.mask[y * mask.w + x] === 1;
      if (on && runStart === null) runStart = s;
      if ((!on || s + 1 > maxS) && runStart !== null) {
        const end = on ? s : s - 1;
        if (end - runStart > 2) {
          const x1 = (nx * t + dx * runStart) / mask.scale;
          const y1 = (ny * t + dy * runStart) / mask.scale;
          const x2 = (nx * t + dx * end) / mask.scale;
          const y2 = (ny * t + dy * end) / mask.scale;
          runs.push({ x1, y1, x2, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 });
        }
        runStart = null;
      }
    }
  }

  const neighbor = (spacing / mask.scale) * 2.4;
  const chains: Array<typeof runs> = [];
  for (const run of runs) {
    let best = -1;
    let bestD = neighbor;
    for (let i = 0; i < chains.length; i++) {
      const last = chains[i][chains[i].length - 1];
      const dist = Math.hypot(run.mx - last.mx, run.my - last.my);
      if (dist < bestD) {
        best = i;
        bestD = dist;
      }
    }
    if (best >= 0) chains[best].push(run);
    else chains.push([run]);
  }
  chains.sort((a, b) => a[0].mx - b[0].mx || a[0].my - b[0].my);

  for (const chain of chains) {
    for (let i = 0; i < chain.length; i++) {
      const run = chain[i];
      const forward = i % 2 === 0;
      const ax = forward ? run.x1 : run.x2;
      const ay = forward ? run.y1 : run.y2;
      const bx = forward ? run.x2 : run.x1;
      const by = forward ? run.y2 : run.y1;
      pushThread(marks, ranges, ax, ay, bx, by, options.thread, width, clothDark);
      const next = chain[i + 1];
      if (!next) continue;
      const nextForward = i % 2 === 1;
      const nx = nextForward ? next.x1 : next.x2;
      const ny = nextForward ? next.y1 : next.y2;
      if (Math.hypot(bx - nx, by - ny) <= hop) {
        pushUnder(marks, bx, by, nx, ny, charIndexAt(nx, ranges), clothDark);
      }
    }
  }
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

  const spacing = clampNum(10, 22, 15 * options.scale);
  const minX = box.minX / mask.scale;
  const maxX = box.maxX / mask.scale;
  const minY = box.minY / mask.scale;
  const maxY = box.maxY / mask.scale;
  let row = 0;
  for (let y = minY; y <= maxY; y += spacing) {
    const shift = row % 2 === 0 ? 0 : spacing * 0.5;
    for (let x = minX; x <= maxX; x += spacing) {
      const px = x + shift + (rng() - 0.5) * spacing * 0.22;
      const py = y + (rng() - 0.5) * spacing * 0.22;
      if (!inside(mask, px, py)) continue;
      const radius = spacing * 0.42;
      const turn = rng() * Math.PI * 2;
      const charIndex = charIndexAt(px, ranges);
      marks.push({
        charIndex,
        weight: 4.8,
        draw(ctx, amount) {
          if (amount >= 1) {
            drawKnot(ctx, px, py, radius, options.thread, options.accent, clothDark, turn);
            return;
          }
          const emerge = 0.16;
          const wrapEnd = 0.68;
          if (amount <= emerge) return;
          if (amount < wrapEnd) {
            const u = (amount - emerge) / (wrapEnd - emerge);
            drawCoil(ctx, px, py, radius * 0.95, u * 1.7, options.thread, turn, clothDark);
            return;
          }
          const u = (amount - wrapEnd) / (1 - wrapEnd);
          ctx.save();
          if (u < 0.82) {
            ctx.globalAlpha = 1 - Math.max(0, (u - 0.35) / 0.47);
            drawCoil(
              ctx,
              px,
              py,
              radius * (0.95 - 0.5 * u),
              1.7,
              options.thread,
              turn,
              clothDark,
            );
          }
          if (u > 0.4) {
            ctx.globalAlpha = Math.min(1, (u - 0.4) / 0.45);
            drawKnot(ctx, px, py, radius, options.thread, options.accent, clothDark, turn);
          }
          ctx.restore();
        },
        needle(amount) {
          let sink = 0;
          if (amount < 0.16) sink = 1 - amount / 0.16;
          else if (amount > 0.72) sink = Math.min(1, (amount - 0.72) / 0.28);
          return {
            x: px,
            y: py,
            angle: turn,
            sink,
            length: 12,
            upright: true,
            entry: { x: px, y: py },
            exit: amount > 0.72 ? { x: px, y: py } : undefined,
          };
        },
      });
    }
    row++;
  }
}

function drawKnot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  thread: string,
  accent: string,
  clothDark: boolean,
  turn: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);

  ctx.fillStyle = clothDark ? "rgba(0,0,0,0.45)" : "rgba(70,40,24,0.22)";
  ctx.beginPath();
  ctx.ellipse(0.7, 1.15, radius * 0.95, radius * 0.78, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = thread;
  ctx.lineWidth = radius * 0.7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.46, 0.2, Math.PI * 2.2);
  ctx.stroke();

  ctx.strokeStyle = lighten(thread, 0.38);
  ctx.lineWidth = radius * 0.28;
  ctx.beginPath();
  ctx.arc(-radius * 0.08, -radius * 0.1, radius * 0.34, Math.PI * 1.05, Math.PI * 1.85);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0.2, 0.2, Math.max(1.1, radius * 0.3), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
  const width = clampNum(1.3, 2.8, 1.7 * options.scale);
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
  const width = clampNum(1.2, 2.4, 1.55 * options.scale);

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
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, q.x, q.y);
            ctx.bezierCurveTo(c3.x, c3.y, c4.x, c4.y, p.x, p.y);
            ctx.strokeStyle = clothDark ? "rgba(0,0,0,0.45)" : "rgba(70,40,24,0.2)";
            ctx.lineWidth = width + 1.1;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.stroke();
            ctx.strokeStyle = options.thread;
            ctx.lineWidth = width;
            ctx.stroke();
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
          strokeThread(ctx, points, options.thread, width, clothDark);
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
  const baseW = clampNum(1.8, 3.6, 2.7 * options.scale);
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
  mode: "stab" | "glide" = "stab",
) {
  const pieces = cutSegment(x1, y1, x2, y2, ranges);
  pieces.forEach((piece, index) => {
    const lead = mode === "stab" && index === 0;
    const tail = mode === "stab" && index === pieces.length - 1;
    const dx = piece.x2 - piece.x1;
    const dy = piece.y2 - piece.y1;
    const len = Math.hypot(dx, dy) || 1;
    const needleLen = Math.min(13, Math.max(6.5, len * 0.36));
    marks.push({
      charIndex: piece.charIndex,
      weight: (mode === "glide" ? 0.38 : 1) * Math.max(0.45, Math.min(3.4, len / 12)),
      draw(ctx, amount) {
        if (amount <= 0) return;
        if (amount >= 1) {
          drawThread(ctx, piece.x1, piece.y1, piece.x2, piece.y2, color, width, clothDark);
          return;
        }
        const phase = stabPhase(amount, lead, tail);
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
        );
      },
      needle(amount) {
        const phase = stabPhase(amount, lead, tail);
        return {
          x: piece.x1 + dx * phase.t,
          y: piece.y1 + dy * phase.t,
          angle: Math.atan2(dy, dx),
          sink: phase.sink,
          length: needleLen,
          entry: lead ? { x: piece.x1, y: piece.y1 } : undefined,
          exit: tail && phase.t > 0.78 ? { x: piece.x2, y: piece.y2 } : undefined,
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
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.8) return;
  marks.push({
    charIndex,
    weight: Math.max(0.85, Math.min(1.6, len / 16)),
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

function stabPhase(amount: number, lead: boolean, tail: boolean) {
  const up = lead ? 0.18 : 0;
  const down = tail ? 0.16 : 0;
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
) {
  if (points.length < 2) return;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  };
  const alpha = ctx.globalAlpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  trace();
  ctx.strokeStyle = clothDark ? "rgba(0,0,0,0.45)" : "rgba(72, 42, 28, 0.24)";
  ctx.lineWidth = width + 0.9;
  ctx.stroke();
  trace();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  trace();
  ctx.strokeStyle = lighten(color, clothDark ? 0.5 : 0.34);
  ctx.globalAlpha = alpha * (clothDark ? 0.72 : 0.48);
  ctx.lineWidth = Math.max(0.5, width * 0.28);
  ctx.stroke();
  ctx.globalAlpha = alpha;
}

function drawCoil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  turns: number,
  color: string,
  rot: number,
  clothDark: boolean,
) {
  if (turns <= 0.02 || radius <= 0.4) return;
  const steps = Math.max(6, Math.ceil(turns * 20));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = rot + (i / steps) * turns * Math.PI * 2;
    const r = radius * (1 - 0.12 * (i / steps));
    points.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  strokeThread(ctx, points, color, Math.max(1.15, radius * 0.34), clothDark);
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
  ctx.strokeStyle = clothDark ? "rgba(255,255,255,0.13)" : "rgba(62, 38, 22, 0.16)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = clothDark ? "rgba(0,0,0,0.2)" : "rgba(255, 248, 236, 0.42)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function drawNeedle(ctx: CanvasRenderingContext2D, pose: NeedlePose, clothDark: boolean) {
  const sink = Math.max(0, Math.min(1, pose.sink));
  if (pose.entry && sink < 0.98) drawHole(ctx, pose.entry.x, pose.entry.y, clothDark);
  if (pose.exit && sink > 0.12) drawHole(ctx, pose.exit.x, pose.exit.y, clothDark);
  if (sink > 0.4) drawDimple(ctx, pose, clothDark);
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

function drawThread(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  clothDark: boolean,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = clothDark ? "rgba(0,0,0,0.5)" : "rgba(72, 42, 28, 0.24)";
  ctx.lineWidth = width + 0.7;
  ctx.beginPath();
  ctx.moveTo(x1 + 0.35, y1 + 1);
  ctx.lineTo(x2 + 0.35, y2 + 1);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.strokeStyle = lighten(color, clothDark ? 0.5 : 0.34);
  ctx.globalAlpha = clothDark ? 0.72 : 0.48;
  ctx.lineWidth = Math.max(0.5, width * 0.28);
  ctx.beginPath();
  ctx.moveTo(x1 - nx * width * 0.16, y1 - ny * width * 0.16);
  ctx.lineTo(x2 - nx * width * 0.16, y2 - ny * width * 0.16);
  ctx.stroke();
  ctx.globalAlpha = 1;
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

function lighten(hex: string, amount: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${clamp(r + (255 - r) * amount)}, ${clamp(g + (255 - g) * amount)}, ${clamp(b + (255 - b) * amount)})`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampNum(min: number, max: number, value: number) {
  return Math.max(min, Math.min(max, value));
}
