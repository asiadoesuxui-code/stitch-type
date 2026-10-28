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
    id: "rope",
    name: "Rope",
    label: "Rope stitch",
    blurb: "Raised stumpwork rope. A loose thread arcs, then pulls taut into coiled yarn.",
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
  sewPace?: { per: number; max: number };
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
  /** Threads that share a band sew at the same time. The first track sets the pace. */
  band?: number;
  track?: number;
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

  if (options.stitch === "rope") {
    collectRope(marks, mask, options, clothDark, ranges);
    // Long enough that the thread arc and the pull into the rope can be read.
    return { fabric, marks, sewPace: { per: 42, max: 1900 } };
  }

  const contours = tidyContours(traceContours(mask.mask, mask.w, mask.h, mask.scale));
  if (options.stitch === "running") {
    collectRunning(marks, contours, options, clothDark, ranges);
    return { fabric, marks, sewPace: { per: 120, max: 8000 } };
  }
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
  const active: SewMark[] = [];
  for (const mark of scene.marks) {
    if (mark.charIndex >= sewFrom) active.push(mark);
  }
  const steps = sewSteps(active);
  let activeWeight = 0;
  for (const step of steps) activeWeight += step.weight;
  const target = progress >= 1 ? activeWeight : progress * activeWeight;
  const done: SewMark[] = [];
  const partials: Array<{ mark: SewMark; amount: number }> = [];
  let needle: NeedlePose | null = null;
  let consumed = 0;
  for (const step of steps) {
    const next = consumed + step.weight;
    if (target >= next - 0.0001) {
      for (const row of step.tracks) done.push(...row);
    } else if (target > consumed + 0.0001) {
      const advanced = advanceStep(step, target - consumed);
      done.push(...advanced.done);
      partials.push(...advanced.partials);
      needle = advanced.needle;
      break;
    } else break;
    consumed = next;
  }

  const dpr = ctx.getTransform().a || 1;
  const play = playCache(scene, width, height, sewFrom, dpr);
  const layer = play.active.getContext("2d");
  const parallel = active.some((mark) => mark.band !== undefined);
  if (layer) {
    if (parallel || done.length < play.drawn) {
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(0, 0, play.width, play.height);
      layer.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const mark of done) mark.draw(layer, 1);
      play.drawn = done.length;
    } else {
      for (let i = play.drawn; i < done.length; i++) done[i].draw(layer, 1);
      play.drawn = done.length;
    }
  }

  ctx.drawImage(play.settled, 0, 0, width, height);
  ctx.drawImage(play.active, 0, 0, width, height);
  for (const partial of partials) partial.mark.draw(ctx, partial.amount);
  if (needle && progress < 1) drawNeedle(ctx, needle, luminance(scene.fabric) < 0.42);
}

type SewStep = { weight: number; tracks: SewMark[][] };

function sewSteps(marks: SewMark[]) {
  const steps: SewStep[] = [];
  let index = 0;
  while (index < marks.length) {
    const band = marks[index].band;
    if (band === undefined) {
      steps.push({ weight: marks[index].weight, tracks: [[marks[index]]] });
      index++;
      continue;
    }
    const tracks = new Map<number, SewMark[]>();
    while (index < marks.length && marks[index].band === band) {
      const track = marks[index].track ?? 0;
      const row = tracks.get(track);
      if (row) row.push(marks[index]);
      else tracks.set(track, [marks[index]]);
      index++;
    }
    const ordered = [...tracks.entries()].sort((a, b) => a[0] - b[0]);
    const rows = ordered.map((entry) => entry[1]);
    const clock = rows[0].reduce((sum, mark) => sum + mark.weight, 0);
    steps.push({ weight: Math.max(0.0001, clock), tracks: rows });
  }
  return steps;
}

function advanceStep(step: SewStep, local: number) {
  const done: SewMark[] = [];
  const partials: Array<{ mark: SewMark; amount: number }> = [];
  let needle: NeedlePose | null = null;
  const span = step.weight || 1;
  const fraction = Math.max(0, Math.min(1, local / span));
  step.tracks.forEach((row, track) => {
    let rowWeight = 0;
    for (const mark of row) rowWeight += mark.weight;
    const target = rowWeight * fraction;
    let consumed = 0;
    for (const mark of row) {
      const next = consumed + mark.weight;
      if (target >= next - 0.0001) done.push(mark);
      else if (target > consumed + 0.0001) {
        const amount = (target - consumed) / mark.weight;
        partials.push({ mark, amount });
        if (track === 0 && mark.needle) needle = mark.needle(amount);
        break;
      } else break;
      consumed = next;
    }
  });
  return { done, partials, needle };
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
  const active = scene.marks.filter((mark) => mark.charIndex >= from);
  let total = 0;
  for (const step of sewSteps(active)) total += step.weight;
  return total;
}

export function sewDurationFor(weight: number, pace?: { per: number; max: number }) {
  if (weight <= 0) return 0;
  // Weight counts every thread. A filled letter is hundreds of weight, which
  // used to run for up to 16s. Same stitch order, short enough to keep up
  // with typing: a letter finishes in well under a second.
  // Running stitch passes a slower pace so each pierce through the cloth can be seen.
  const per = pace?.per ?? 36;
  const max = pace?.max ?? 640;
  return Math.max(pace ? 320 : 180, Math.min(max, weight * per));
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
    ? "rgba(92, 64, 36, 0.035)"
    : "rgba(255, 255, 255, 0.03)";
  const specks = Math.round((width * height) / 5200);
  for (let i = 0; i < specks; i++) {
    const horizontal = rng() > 0.5;
    ctx.fillRect(
      rng() * width,
      rng() * height,
      horizontal ? 1.6 + rng() * 1.4 : 0.7,
      horizontal ? 0.7 : 1.6 + rng() * 1.4,
    );
  }

  const cx = width / 2;
  const cy = height / 2;
  const vignette = ctx.createRadialGradient(
    cx,
    cy,
    Math.min(width, height) * 0.28,
    cx,
    cy,
    Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(
    1,
    light ? "rgba(70, 45, 25, 0.07)" : "rgba(0, 0, 0, 0.28)",
  );
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

const tiles = new Map<string, HTMLCanvasElement>();

function fabricTile(color: string) {
  const existing = tiles.get(color);
  if (existing) return existing;

  const size = 96;
  const pitch = 4;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const g = tile.getContext("2d");
  if (!g) return tile;

  const [r, gv, b] = hexToRgb(color);
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);

  const count = size / pitch;
  const thread = (index: number, axis: number, lift: number) => {
    const wobble = ((index * 17 + axis * 29) % 11) - 5;
    return `rgb(${clamp(r + lift + wobble)}, ${clamp(gv + lift + wobble * 0.85)}, ${clamp(b + lift + wobble * 0.55)})`;
  };

  g.lineCap = "butt";
  for (let i = 0; i < count; i++) {
    const y = i * pitch + pitch / 2;
    g.strokeStyle = thread(i, 0, -16);
    g.lineWidth = 3.15;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(size, y);
    g.stroke();
    g.strokeStyle = thread(i, 0, 11);
    g.lineWidth = 0.85;
    g.beginPath();
    g.moveTo(0, y - 0.55);
    g.lineTo(size, y - 0.55);
    g.stroke();
  }

  for (let i = 0; i < count; i++) {
    const x = i * pitch + pitch / 2;
    for (let j = 0; j < count; j++) {
      if ((i + j) % 2 !== 0) continue;
      const y0 = j * pitch;
      g.strokeStyle = thread(i, 1, -18);
      g.lineWidth = 3.05;
      g.beginPath();
      g.moveTo(x, y0 + 0.15);
      g.lineTo(x, y0 + pitch - 0.15);
      g.stroke();
      g.strokeStyle = thread(i, 1, 14);
      g.lineWidth = 0.75;
      g.beginPath();
      g.moveTo(x - 0.45, y0 + 0.35);
      g.lineTo(x - 0.45, y0 + pitch - 0.35);
      g.stroke();
    }
  }

  for (let j = 0; j < count; j++) {
    const y = j * pitch + pitch / 2;
    for (let i = 0; i < count; i++) {
      if ((i + j) % 2 === 0) continue;
      const x = i * pitch + pitch / 2;
      g.strokeStyle = thread(j, 2, -14);
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(x - pitch * 0.5, y);
      g.lineTo(x + pitch * 0.5, y);
      g.stroke();
      g.strokeStyle = thread(j, 2, 16);
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x - pitch * 0.5, y - 0.55);
      g.lineTo(x + pitch * 0.5, y - 0.55);
      g.stroke();
    }
  }

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
    const px = tangent.y;
    const py = -tangent.x;
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

type RopeStamp = {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
};

type RopeSpan = {
  pts: Point[];
  radii: number[];
  capStart: boolean;
  capEnd: boolean;
  stamp?: RopeStamp;
  /** The first pass of a letter reveals the whole raised yarn shape. */
  lead?: boolean;
};

type RopePath = {
  pts: Point[];
  radii: number[];
  closed: boolean;
};

function collectRope(
  marks: SewMark[],
  mask: Mask,
  options: EmbroideryOptions,
  clothDark: boolean,
  ranges: Array<[number, number]>,
) {
  const box = bounds(mask.mask, mask.w, mask.h);
  if (!box) return;

  const pad = 4;
  const x0 = Math.max(0, box.minX - pad);
  const y0 = Math.max(0, box.minY - pad);
  const x1 = Math.min(mask.w - 1, box.maxX + pad);
  const y1 = Math.min(mask.h - 1, box.maxY + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  if (cw < 3 || ch < 3) return;

  const crop = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    crop.set(mask.mask.subarray((y + y0) * mask.w + x0, (y + y0) * mask.w + x0 + cw), y * cw);
  }

  const letterH = (box.maxY - box.minY + 1) / mask.scale;
  const step = Math.max(1, Math.ceil(Math.max(cw, ch) / 680));
  const small = downsampleMask(crop, cw, ch, step);
  const pixel = step / mask.scale;
  const originX = x0 / mask.scale;
  const originY = y0 / mask.scale;
  const dilateR = clampNum(1, 5, Math.round((letterH * 0.014) / pixel));
  const ink = dilateMask(small.ink, small.w, small.h, dilateR);

  const comps = inkComponents(ink, small.w, small.h);
  for (const comp of comps) {
    comp.charIndex = charIndexAt(originX + (comp.cx + 0.5) * pixel, ranges);
  }
  comps.sort((a, b) => a.charIndex - b.charIndex || b.area - a.area || a.cy - b.cy);

  for (const comp of comps) {
    const cssW = (comp.maxX - comp.minX + 1) * pixel;
    const cssH = (comp.maxY - comp.minY + 1) * pixel;
    const compact =
      comp.area / Math.max(1, (comp.maxX - comp.minX + 1) * (comp.maxY - comp.minY + 1)) > 0.52;
    const isDot =
      compact &&
      cssH < letterH * 0.28 &&
      cssW < letterH * 0.28 &&
      cssH < cssW * 1.55 &&
      cssW < cssH * 1.55;

    if (isDot) {
      const radius = Math.max(cssW, cssH) * 0.5;
      const span = ropeSpans(
        dotCoil(originX + (comp.cx + 0.5) * pixel, originY + (comp.cy + 0.5) * pixel, radius),
      );
      for (const piece of span) pushRopeSpan(marks, piece, options.thread, clothDark, comp.charIndex, null);
      continue;
    }

    const cropped = cropComponent(small.w, comp);
    const paths = skeletonPaths(cropped.ink, cropped.w, cropped.h, pixel).map((path) => ({
      pts: path.pts.map((point) => ({
        x: point.x + originX + cropped.x0 * pixel,
        y: point.y + originY + cropped.y0 * pixel,
      })),
      radii: path.radii,
      closed: path.closed,
    }));
    const stamp = shadeStamp(
      cropped.ink,
      cropped.w,
      cropped.h,
      options.thread,
      originX + cropped.x0 * pixel,
      originY + cropped.y0 * pixel,
      pixel,
    );
    let lead = true;
    for (const path of paths) {
      for (const span of ropeSpans(path)) {
        span.stamp = stamp ?? undefined;
        span.lead = lead;
        lead = false;
        pushRopeSpan(marks, span, options.thread, clothDark, comp.charIndex, null);
      }
    }
  }
}

type InkComp = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  cx: number;
  cy: number;
  pixels: number[];
  charIndex: number;
};

function inkComponents(ink: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(ink.length);
  const comps: InkComp[] = [];
  const stack = new Int32Array(ink.length);
  for (let seed = 0; seed < ink.length; seed++) {
    if (!ink[seed] || seen[seed]) continue;
    let sp = 0;
    stack[sp++] = seed;
    seen[seed] = 1;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    let sx = 0;
    let sy = 0;
    const pixels: number[] = [];
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p / w) | 0;
      pixels.push(p);
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const n = yy * w + xx;
          if (!ink[n] || seen[n]) continue;
          seen[n] = 1;
          stack[sp++] = n;
        }
      }
    }
    if (area < 8) continue;
    comps.push({
      minX,
      minY,
      maxX,
      maxY,
      area,
      cx: sx / area,
      cy: sy / area,
      pixels,
      charIndex: 0,
    });
  }
  return comps;
}

function cropComponent(srcW: number, comp: InkComp) {
  const pad = 2;
  const x0 = Math.max(0, comp.minX - pad);
  const y0 = Math.max(0, comp.minY - pad);
  const x1 = comp.maxX + pad;
  const y1 = comp.maxY + pad;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8Array(w * h);
  for (const p of comp.pixels) {
    const x = p % srcW;
    const y = (p / srcW) | 0;
    out[(y - y0) * w + (x - x0)] = 1;
  }
  return { ink: out, w, h, x0, y0 };
}

function downsampleMask(src: Uint8Array, w: number, h: number, step: number) {
  if (step <= 1) return { ink: src, w, h };
  const nw = Math.ceil(w / step);
  const nh = Math.ceil(h / step);
  const ink = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let on = 0;
      for (let dy = 0; dy < step && !on; dy++) {
        const sy = y * step + dy;
        if (sy >= h) break;
        const row = sy * w;
        for (let dx = 0; dx < step; dx++) {
          const sx = x * step + dx;
          if (sx < w && src[row + sx]) {
            on = 1;
            break;
          }
        }
      }
      ink[y * nw + x] = on;
    }
  }
  return { ink, w: nw, h: nh };
}

function dilateMask(src: Uint8Array, w: number, h: number, radius: number) {
  if (radius <= 0) return src;
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      const row = y * w;
      for (let xx = x0; xx <= x1; xx++) {
        if (src[row + xx]) {
          on = 1;
          break;
        }
      }
      tmp[row + x] = on;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let on = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      for (let yy = y0; yy <= y1; yy++) {
        if (tmp[yy * w + x]) {
          on = 1;
          break;
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function chamferDistance(ink: Uint8Array, w: number, h: number) {
  const dist = new Float32Array(w * h);
  const INF = 1e6;
  for (let i = 0; i < dist.length; i++) dist[i] = ink[i] ? INF : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let best = dist[i];
      if (x > 0) best = Math.min(best, dist[i - 1] + 3);
      if (y > 0) best = Math.min(best, dist[i - w] + 3);
      if (x > 0 && y > 0) best = Math.min(best, dist[i - w - 1] + 4);
      if (x + 1 < w && y > 0) best = Math.min(best, dist[i - w + 1] + 4);
      dist[i] = best;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let best = dist[i];
      if (x + 1 < w) best = Math.min(best, dist[i + 1] + 3);
      if (y + 1 < h) best = Math.min(best, dist[i + w] + 3);
      if (x + 1 < w && y + 1 < h) best = Math.min(best, dist[i + w + 1] + 4);
      if (x > 0 && y + 1 < h) best = Math.min(best, dist[i + w - 1] + 4);
      dist[i] = best;
    }
  }
  for (let i = 0; i < dist.length; i++) dist[i] *= 1 / 3;
  return dist;
}

function skeletonPaths(ink: Uint8Array, w: number, h: number, pixel: number): RopePath[] {
  if (w < 3 || h < 3) return [];
  const dist = chamferDistance(ink, w, h);
  const contours = traceContours(ink, w, h, 1, 8, 8).sort(
    (a, b) => polygonArea(b) - polygonArea(a),
  );
  const claimed = new Uint8Array(w * h);
  const paths: RopePath[] = [];
  for (const contour of contours) {
    const samples = resampleChain(contour, 1.65);
    if (samples.length < 4) continue;
    let current: Array<{ x: number; y: number; d: number }> = [];
    const flush = () => {
      commitMedial(paths, current, pixel, claimed, w, h);
      current = [];
    };
    for (let i = 0; i < samples.length; i++) {
      const prev = samples[(i - 3 + samples.length) % samples.length];
      const next = samples[(i + 3) % samples.length];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const hit = walkMedial(samples[i].x, samples[i].y, -ty, tx, dist, w, h);
      if (!hit || hit.d < 1.1) {
        flush();
        continue;
      }
      const last = current[current.length - 1];
      if (last && Math.hypot(last.x - hit.x, last.y - hit.y) > Math.max(5.5, hit.d * 1.45)) flush();
      const ix = Math.round(hit.x);
      const iy = Math.round(hit.y);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h || claimed[iy * w + ix]) {
        flush();
        continue;
      }
      current.push(hit);
    }
    flush();
  }
  paths.sort((a, b) => Number(b.closed) - Number(a.closed) || polylineLength(b.pts) - polylineLength(a.pts));
  return paths;
}

function resampleChain(pts: Point[], spacing: number) {
  if (pts.length < 2) return pts;
  const out: Point[] = [{ x: pts[0].x, y: pts[0].y }];
  let carry = 0;
  let cursor = pts[0];
  const seq = pts.concat([pts[0]]);
  for (let i = 1; i < seq.length; i++) {
    const target = seq[i];
    let remain = Math.hypot(target.x - cursor.x, target.y - cursor.y);
    if (remain < 1e-4) continue;
    while (carry + remain >= spacing) {
      const t = (spacing - carry) / remain;
      cursor = {
        x: cursor.x + (target.x - cursor.x) * t,
        y: cursor.y + (target.y - cursor.y) * t,
      };
      out.push({ x: cursor.x, y: cursor.y });
      remain = Math.hypot(target.x - cursor.x, target.y - cursor.y);
      carry = 0;
      if (remain < 1e-4) break;
    }
    carry += remain;
    cursor = target;
  }
  if (out.length > 2 && distance(out[0], out[out.length - 1]) < spacing * 0.6) out.pop();
  return out;
}

function sampleDist(dist: Float32Array, w: number, h: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const i = y0 * w + x0;
  const a = dist[i];
  const b = dist[i + 1];
  const c = dist[i + w];
  const d = dist[i + w + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

function walkMedial(
  x: number,
  y: number,
  nx: number,
  ny: number,
  dist: Float32Array,
  w: number,
  h: number,
) {
  let best: { x: number; y: number; d: number } | null = null;
  for (const sign of [1, -1]) {
    let cx = x;
    let cy = y;
    let peak: { x: number; y: number; d: number } | null = null;
    let entered = false;
    for (let step = 0; step < 80; step++) {
      const nx1 = cx + nx * sign;
      const ny1 = cy + ny * sign;
      if (nx1 < 0.6 || ny1 < 0.6 || nx1 > w - 1.6 || ny1 > h - 1.6) break;
      const next = sampleDist(dist, w, h, nx1, ny1);
      if (next < 0.45) {
        if (entered || step > 2) break;
      } else {
        entered = true;
        if (peak && next < peak.d - 0.22) break;
        if (!peak || next >= peak.d - 0.02) peak = { x: nx1, y: ny1, d: next };
      }
      cx = nx1;
      cy = ny1;
    }
    if (peak && (!best || peak.d > best.d + 0.4)) best = peak;
  }
  return best;
}

function nearClaimed(
  claimed: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return true;
  return claimed[iy * w + ix] === 1;
}

function claimPoint(claimed: Uint8Array, w: number, h: number, x: number, y: number, radius: number) {
  const rad = Math.max(1, Math.round(radius));
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      claimed[py * w + px] = 1;
    }
  }
}

function emitMedial(
  paths: RopePath[],
  points: Array<{ x: number; y: number; d: number }>,
  pixel: number,
  claimed: Uint8Array,
  w: number,
  h: number,
) {
  if (points.length < 4) return;
  const first = points[0];
  const last = points[points.length - 1];
  const closed = Math.hypot(first.x - last.x, first.y - last.y) < Math.max(3.2, first.d * 0.85);
  for (const point of points) claimPoint(claimed, w, h, point.x, point.y, point.d * 0.38);
  let pts = points.map((point) => ({ x: point.x * pixel, y: point.y * pixel }));
  let radii = points.map((point) => Math.max(1.8, point.d * pixel * 0.9));
  ({ pts, radii } = smoothRope(pts, radii, closed));
  ({ pts, radii } = resampleRope(pts, radii, 2.4, closed));
  if (pts.length < 2) return;
  if (closed) ({ pts, radii } = rotateRopeTop(pts, radii));
  else ({ pts, radii } = extendRopeEnds(pts, radii));
  if (polylineLength(pts) < 5) return;
  paths.push({ pts, radii, closed });
}

function commitMedial(
  paths: RopePath[],
  raw: Array<{ x: number; y: number; d: number }>,
  pixel: number,
  claimed: Uint8Array,
  w: number,
  h: number,
) {
  const current: Array<{ x: number; y: number; d: number }> = [];
  const flush = () => {
    emitMedial(paths, current, pixel, claimed, w, h);
    current.length = 0;
  };
  for (const point of raw) {
    if (nearClaimed(claimed, w, h, point.x, point.y)) {
      flush();
      continue;
    }
    let retrace = false;
    for (let i = 0; i < current.length - 3; i++) {
      const other = current[i];
      if (Math.hypot(other.x - point.x, other.y - point.y) < Math.max(1.8, point.d * 0.38)) {
        retrace = true;
        break;
      }
    }
    if (retrace) {
      flush();
      continue;
    }
    current.push(point);
  }
  flush();
  raw.length = 0;
}


function smoothRope(pts: Point[], radii: number[], closed: boolean) {
  const n = pts.length;
  if (n < 4) return { pts, radii };
  let currentP = pts.map((point) => ({ x: point.x, y: point.y }));
  let currentR = radii.slice();
  for (let pass = 0; pass < 2; pass++) {
    const nextP = currentP.map((point) => ({ x: point.x, y: point.y }));
    const nextR = currentR.slice();
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      nextP[i] = {
        x: currentP[a].x * 0.25 + currentP[i].x * 0.5 + currentP[b].x * 0.25,
        y: currentP[a].y * 0.25 + currentP[i].y * 0.5 + currentP[b].y * 0.25,
      };
      nextR[i] = currentR[a] * 0.25 + currentR[i] * 0.5 + currentR[b] * 0.25;
    }
    currentP = nextP;
    currentR = nextR;
  }
  return { pts: currentP, radii: currentR };
}

function resampleRope(pts: Point[], radii: number[], spacing: number, closed: boolean) {
  if (pts.length < 2) return { pts, radii };
  const seqP = closed ? pts.concat([pts[0]]) : pts;
  const seqR = closed ? radii.concat([radii[0]]) : radii;
  const outP: Point[] = [{ x: seqP[0].x, y: seqP[0].y }];
  const outR: number[] = [seqR[0]];
  let cursor = { x: seqP[0].x, y: seqP[0].y };
  let cursorR = seqR[0];
  let carried = 0;
  for (let i = 1; i < seqP.length; i++) {
    const target = seqP[i];
    const targetR = seqR[Math.min(i, seqR.length - 1)];
    let remain = Math.hypot(target.x - cursor.x, target.y - cursor.y);
    if (remain < 1e-4) continue;
    while (carried + remain >= spacing) {
      const t = (spacing - carried) / remain;
      cursor = {
        x: cursor.x + (target.x - cursor.x) * t,
        y: cursor.y + (target.y - cursor.y) * t,
      };
      cursorR += (targetR - cursorR) * t;
      outP.push({ x: cursor.x, y: cursor.y });
      outR.push(cursorR);
      remain = Math.hypot(target.x - cursor.x, target.y - cursor.y);
      carried = 0;
      if (remain < 1e-4) break;
    }
    carried += remain;
    cursor = { x: target.x, y: target.y };
    cursorR = targetR;
  }
  if (!closed) {
    const last = seqP[seqP.length - 1];
    const end = outP[outP.length - 1];
    if (Math.hypot(last.x - end.x, last.y - end.y) > 1) {
      outP.push({ x: last.x, y: last.y });
      outR.push(seqR[seqR.length - 1]);
    }
  } else if (outP.length > 2 && distance(outP[0], outP[outP.length - 1]) < spacing * 0.45) {
    outP.pop();
    outR.pop();
  }
  return { pts: outP, radii: outR };
}

function rotateRopeTop(pts: Point[], radii: number[]) {
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y < pts[best].y || (Math.abs(pts[i].y - pts[best].y) < 0.4 && pts[i].x < pts[best].x)) best = i;
  }
  const spunP = pts.slice(best).concat(pts.slice(0, best));
  const spunR = radii.slice(best).concat(radii.slice(0, best));
  if (spunP.length < 3) return { pts: spunP, radii: spunR };
  if (spunP[1].x < spunP[spunP.length - 1].x) {
    return {
      pts: [spunP[0], ...spunP.slice(1).reverse()],
      radii: [spunR[0], ...spunR.slice(1).reverse()],
    };
  }
  return { pts: spunP, radii: spunR };
}

function extendRopeEnds(pts: Point[], radii: number[]) {
  if (pts.length < 2) return { pts, radii };
  const nextP = pts.map((point) => ({ x: point.x, y: point.y }));
  const nextR = radii.slice();
  const grow = (index: number, toward: number, place: "start" | "end") => {
    const dir = unit(nextP[index].x - nextP[toward].x, nextP[index].y - nextP[toward].y);
    const reach = nextR[index] * 1.08;
    const point = { x: nextP[index].x + dir.x * reach, y: nextP[index].y + dir.y * reach };
    if (place === "start") {
      nextP.unshift(point);
      nextR.unshift(nextR[index]);
    } else {
      nextP.push(point);
      nextR.push(nextR[index]);
    }
  };
  grow(0, 1, "start");
  grow(nextP.length - 1, nextP.length - 2, "end");
  return { pts: nextP, radii: nextR };
}

function dotCoil(cx: number, cy: number, radius: number): RopePath {
  const yarn = Math.max(3.3, radius * 0.44);
  const outer = Math.max(yarn * 0.2, radius - yarn * 0.92);
  const turns = 2.05;
  const steps = Math.max(36, Math.round(turns * 28));
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = -Math.PI / 2 + t * turns * Math.PI * 2;
    const rad = outer * t;
    pts.push({ x: cx + Math.cos(angle) * rad, y: cy + Math.sin(angle) * rad });
  }
  return { pts, radii: pts.map(() => yarn), closed: false };
}

function ropeSpans(path: RopePath): RopeSpan[] {
  const { pts, radii, closed } = path;
  if (pts.length < 2 || radii.length < 2) return [];
  const seqP = closed ? pts.concat([pts[0]]) : pts;
  const seqR = closed ? radii.concat([radii[0]]) : radii;
  const total = polylineLength(seqP);
  if (total < 4) return [];
  const avg = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
  const target = clampNum(52, 124, avg * 4.8);
  if (total < target * 0.8) {
    return [{ pts: seqP, radii: seqR, capStart: !closed, capEnd: !closed }];
  }
  const spans: RopeSpan[] = [];
  let cursor = 0;
  const overlap = Math.min(3.2, avg * 0.22);
  while (cursor < total - 3) {
    let end = Math.min(total, cursor + target);
    if (total - end < target * 0.42) end = total;
    const from = spans.length > 0 ? Math.max(0, cursor - overlap) : 0;
    const slice = sliceByLength(seqP, seqR, from, end);
    if (slice.pts.length >= 2) {
      spans.push({
        pts: slice.pts,
        radii: slice.radii,
        capStart: !closed && spans.length === 0,
        capEnd: !closed && end >= total - 0.4,
      });
    }
    if (end >= total - 0.4) break;
    cursor = end;
  }
  return spans;
}

function sliceByLength(pts: Point[], radii: number[], start: number, end: number) {
  const outP: Point[] = [];
  const outR: number[] = [];
  const push = (point: Point, radius: number) => {
    const last = outP[outP.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.12) {
      outR[outR.length - 1] = radius;
      return;
    }
    outP.push(point);
    outR.push(radius);
  };
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const ra = radii[Math.min(i - 1, radii.length - 1)];
    const rb = radii[Math.min(i, radii.length - 1)];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const segStart = walked;
    const segEnd = walked + seg;
    if (seg > 1e-4 && segEnd >= start && segStart <= end) {
      const t0 = Math.max(0, Math.min(1, (start - segStart) / seg));
      const t1 = Math.max(0, Math.min(1, (end - segStart) / seg));
      if (outP.length === 0) push(lerpPoint(a, b, t0), ra + (rb - ra) * t0);
      if (t1 > t0 + 0.001) push(lerpPoint(a, b, t1), ra + (rb - ra) * t1);
    }
    walked = segEnd;
    if (walked >= end) break;
  }
  return { pts: outP, radii: outR };
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pushRopeSpan(
  marks: SewMark[],
  span: RopeSpan,
  thread: string,
  clothDark: boolean,
  charIndex: number,
  clip: Point[][] | null,
) {
  const length = polylineLength(span.pts);
  const avgR = span.radii.reduce((sum, radius) => sum + radius, 0) / Math.max(1, span.radii.length);
  const bow = clampNum(22, 58, Math.min(avgR * 1.35 + 16, Math.max(28, length * 0.62)));
  const needleLen = clampNum(10, 17, avgR * 0.55 + 7);
  const rise = 0.12;
  const travel = 0.42;
  const pull = 0.34;
  marks.push({
    charIndex,
    weight: (span.lead ? 1.8 : 1) * clampNum(7, 15, 5.5 + length / 16),
    draw(ctx, amount) {
      if (amount <= rise) return;
      if (amount >= 1 || amount >= rise + travel + pull) {
        paintRaisedRope(ctx, span, thread, clothDark, clip, 1);
        return;
      }
      if (amount <= rise + travel) {
        const u = (amount - rise) / travel;
        paintSlackThread(ctx, span.pts, Math.max(0.06, u), bow, thread, clothDark, 1);
        return;
      }
      const ease = smoothstep((amount - rise - travel) / pull);
      paintSlackThread(ctx, span.pts, 1, bow * (1 - ease), thread, clothDark, 1 - ease * 0.92);
      if (ease > 0.04) paintRaisedRope(ctx, span, thread, clothDark, clip, ease);
    },
    needle(amount) {
      const start = span.pts[0];
      const end = span.pts[span.pts.length - 1];
      if (amount <= rise) {
        return {
          x: start.x,
          y: start.y,
          angle: ropeHeading(span.pts, true),
          sink: 1 - amount / Math.max(0.04, rise),
          length: needleLen,
          upright: true,
          quiet: true,
        };
      }
      if (amount <= rise + travel) {
        const u = Math.max(0.08, (amount - rise) / travel);
        const tip = liftedAlong(span.pts, length, u, bow);
        const prev = liftedAlong(span.pts, length, Math.max(0.02, u - 0.06), bow);
        return {
          x: tip.x,
          y: tip.y,
          angle: Math.atan2(tip.y - prev.y, tip.x - prev.x) || ropeHeading(span.pts, true),
          sink: 0,
          length: needleLen,
          quiet: true,
        };
      }
      if (amount >= rise + travel + pull) {
        const sink = Math.min(1, (amount - (rise + travel + pull)) / 0.12);
        return {
          x: end.x,
          y: end.y,
          angle: Math.PI / 2,
          sink,
          length: needleLen,
          upright: true,
          quiet: true,
        };
      }
      const ease = smoothstep((amount - rise - travel) / pull);
      const lift = threadLift(1, bow * (1 - ease));
      return {
        x: end.x,
        y: end.y - lift,
        angle: Math.PI / 2,
        sink: 0,
        length: needleLen,
        upright: lift < 6,
        quiet: true,
      };
    },
  });
}

function smoothstep(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function ropeHeading(pts: Point[], forward: boolean) {
  if (pts.length < 2) return 0;
  const a = forward ? pts[0] : pts[pts.length - 1];
  const b = forward ? pts[Math.min(2, pts.length - 1)] : pts[Math.max(0, pts.length - 3)];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function threadLift(t: number, bow: number) {
  return Math.sin(Math.max(0, Math.min(1, t)) * Math.PI * 0.86) * bow;
}

function pointAlong(pts: Point[], distanceAlong: number) {
  const slice = sliceByLength(pts, pts.map(() => 1), 0, Math.max(0.8, distanceAlong));
  return slice.pts[slice.pts.length - 1] ?? pts[0];
}

function liftedAlong(pts: Point[], length: number, u: number, bow: number) {
  const clamped = Math.max(0, Math.min(1, u));
  const point = pointAlong(pts, Math.max(0.8, length * clamped));
  return { x: point.x, y: point.y - threadLift(clamped, bow) };
}

function paintSlackThread(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  u: number,
  bow: number,
  color: string,
  clothDark: boolean,
  alpha: number,
) {
  if (pts.length < 2 || alpha < 0.03 || bow < 0.6) return;
  const total = polylineLength(pts);
  const clamped = Math.max(0.04, Math.min(1, u));
  const partial =
    clamped >= 0.995
      ? pts
      : sliceByLength(pts, pts.map(() => 1), 0, Math.max(1.2, total * clamped)).pts;
  if (partial.length < 2) return;
  const lifted = partial.map((point, index) => {
    const local = index / (partial.length - 1);
    return { x: point.x, y: point.y - threadLift(local * clamped, bow) };
  });
  ctx.save();
  ctx.globalAlpha = alpha;
  paintFloss(ctx, lifted, color, 3.6, clothDark, true, "none");
  ctx.restore();
}

type RopeFrame = { x: number; y: number; nx: number; ny: number; r: number; s: number };

function ropeFrames(pts: Point[], radii: number[]) {
  const frames: RopeFrame[] = [];
  let traveled = 0;
  let px = 0;
  let py = -1;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    let nx = -ty;
    let ny = tx;
    if (nx * px + ny * py < 0) {
      nx = -nx;
      ny = -ny;
    }
    px = nx;
    py = ny;
    if (i > 0) traveled += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    frames.push({
      x: pts[i].x,
      y: pts[i].y,
      nx,
      ny,
      r: Math.max(1.2, radii[Math.min(i, radii.length - 1)]),
      s: traveled,
    });
  }
  return frames;
}

function paintRaisedRope(
  ctx: CanvasRenderingContext2D,
  span: RopeSpan,
  color: string,
  clothDark: boolean,
  clip: Point[][] | null,
  alpha: number,
) {
  if (span.pts.length < 2 || alpha < 0.03) return;
  const frames = ropeFrames(span.pts, span.radii);
  if (frames.length < 2) return;
  const [r, g, b] = hexToRgb(color);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (span.lead && span.stamp) {
    const stamp = span.stamp;
    ctx.save();
    ctx.shadowColor = clothDark ? "rgba(0,0,0,0.45)" : "rgba(48, 28, 16, 0.3)";
    ctx.shadowBlur = Math.max(6, frames[0].r * 0.38);
    ctx.shadowOffsetY = Math.max(3, frames[0].r * 0.22);
    ctx.drawImage(stamp.canvas, stamp.x, stamp.y, stamp.w, stamp.h);
    ctx.restore();
  } else if (!span.stamp) {
    paintRopeShadow(ctx, frames, clothDark);
    if (clip && clip.length) {
      ctx.save();
      clipEvenOdd(ctx, clip);
      paintRopeTube(ctx, frames, r, g, b, span.capStart, span.capEnd);
      ctx.restore();
    } else {
      paintRopeTube(ctx, frames, r, g, b, span.capStart, span.capEnd);
    }
  } else {
    paintRopeShadow(ctx, frames, clothDark);
  }
  paintRopePlies(ctx, frames, r, g, b, span.stamp ? 0.28 : 1);
  ctx.restore();
}

function shadeStamp(
  ink: Uint8Array,
  w: number,
  h: number,
  color: string,
  x: number,
  y: number,
  pixel: number,
): RopeStamp | null {
  if (w < 2 || h < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const dist = chamferDistance(ink, w, h);
  const image = g.createImageData(w, h);
  const [red, green, blue] = hexToRgb(color);
  const data = image.data;
  for (let yy = 1; yy < h - 1; yy++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = yy * w + xx;
      if (!ink[i]) continue;
      const d = dist[i];
      if (d > 1e5) continue;
      const gx = dist[i + 1] - dist[i - 1];
      const gy = dist[i + w] - dist[i - w];
      const mag = Math.hypot(gx, gy) || 1;
      const along = xx * (-gy / mag) + yy * (gx / mag);
      const inside = Math.min(1, d / 4.2);
      const fiber = Math.sin(along * 0.9);
      const lift = Math.max(-0.62, Math.min(0.48, -0.5 + inside * 0.72 + fiber * 0.2 * inside));
      const [rr, gg, bb] = tone(red, green, blue, lift);
      const o = i * 4;
      data[o] = rr;
      data[o + 1] = gg;
      data[o + 2] = bb;
      data[o + 3] = Math.round(Math.min(1, 0.25 + d * 0.55) * 255);
    }
  }
  g.putImageData(image, 0, 0);
  return { canvas, x, y, w: w * pixel, h: h * pixel };
}

function clipEvenOdd(ctx: CanvasRenderingContext2D, contours: Point[][]) {
  ctx.beginPath();
  for (const contour of contours) {
    if (contour.length < 3) continue;
    ctx.moveTo(contour[0].x, contour[0].y);
    for (let i = 1; i < contour.length; i++) ctx.lineTo(contour[i].x, contour[i].y);
    ctx.closePath();
  }
  ctx.clip("evenodd");
}

function paintRopeShadow(ctx: CanvasRenderingContext2D, frames: RopeFrame[], clothDark: boolean) {
  const ink = clothDark ? "rgba(0, 0, 0, 0.35)" : "rgba(62, 36, 24, 0.28)";
  const soft = clothDark ? "rgba(0, 0, 0, 0.16)" : "rgba(62, 36, 24, 0.12)";
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    const r = (a.r + b.r) / 2;
    ctx.strokeStyle = soft;
    ctx.lineWidth = r * 2.15;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + r * 0.72);
    ctx.lineTo(b.x, b.y + r * 0.72);
    ctx.stroke();
    ctx.strokeStyle = ink;
    ctx.lineWidth = r * 1.55;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + r * 0.38);
    ctx.lineTo(b.x, b.y + r * 0.38);
    ctx.stroke();
  }
  ctx.restore();
}

function paintRopeTube(
  ctx: CanvasRenderingContext2D,
  frames: RopeFrame[],
  red: number,
  green: number,
  blue: number,
  capStart: boolean,
  capEnd: boolean,
) {
  const bands = 8;
  if (capStart) paintRopeDome(ctx, frames[0], red, green, blue);
  if (capEnd) paintRopeDome(ctx, frames[frames.length - 1], red, green, blue);
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const next = frames[i];
    for (let band = 0; band < bands; band++) {
      const u = ((band + 0.5) / bands) * 2 - 1;
      const ny = (prev.ny + next.ny) / 2;
      const lift = ropeLift(u, ny);
      ctx.strokeStyle = rgba(tone(red, green, blue, lift), 1);
      ctx.lineWidth = ((prev.r + next.r) / bands) * 1.18;
      ctx.beginPath();
      ctx.moveTo(prev.x + prev.nx * u * prev.r, prev.y + prev.ny * u * prev.r);
      ctx.lineTo(next.x + next.nx * u * next.r, next.y + next.ny * u * next.r);
      ctx.stroke();
    }
  }
}

function paintRopeDome(
  ctx: CanvasRenderingContext2D,
  frame: RopeFrame,
  r: number,
  g: number,
  b: number,
) {
  const grad = ctx.createRadialGradient(
    frame.x - frame.r * 0.18,
    frame.y - frame.r * 0.38,
    frame.r * 0.15,
    frame.x,
    frame.y + frame.r * 0.05,
    frame.r,
  );
  grad.addColorStop(0, rgba(tone(r, g, b, 0.42), 1));
  grad.addColorStop(0.55, rgba(tone(r, g, b, 0.02), 1));
  grad.addColorStop(1, rgba(tone(r, g, b, -0.42), 1));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(frame.x, frame.y, frame.r, 0, Math.PI * 2);
  ctx.fill();
}

function ropeLift(u: number, ny: number) {
  const crown = Math.sqrt(Math.max(0, 1 - u * u));
  const overhead = -u * ny;
  const lit = crown * 0.55 + overhead * 0.9;
  return Math.max(-0.6, Math.min(0.48, -0.36 + lit * 0.86));
}

function paintRopePlies(
  ctx: CanvasRenderingContext2D,
  frames: RopeFrame[],
  red: number,
  green: number,
  blue: number,
  strength: number,
) {
  const avg = frames.reduce((sum, frame) => sum + frame.r, 0) / frames.length;
  const plies = avg >= 7.5 ? 3 : 2;
  const pitch = Math.max(9, avg * 1.28);
  const freq = (Math.PI * 2) / pitch;
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const next = frames[i];
    const parts: Array<{ ax: number; ay: number; bx: number; by: number; depth: number; radius: number }> = [];
    for (let ply = 0; ply < plies; ply++) {
      const phase = (ply / plies) * Math.PI * 2;
      const angA = prev.s * freq + phase;
      const angB = next.s * freq + phase;
      const off = (frame: RopeFrame, angle: number) => {
        const side = Math.cos(angle);
        return {
          x: frame.x + frame.nx * side * frame.r * 0.5,
          y: frame.y + frame.ny * side * frame.r * 0.5,
          depth: Math.sin(angle),
          side,
        };
      };
      const pa = off(prev, angA);
      const pb = off(next, angB);
      parts.push({
        ax: pa.x,
        ay: pa.y,
        bx: pb.x,
        by: pb.y,
        depth: (pa.depth + pb.depth) / 2,
        radius: (prev.r + next.r) / 2,
      });
    }
    parts.sort((left, right) => left.depth - right.depth);
    for (const part of parts) {
      const facing = part.depth * 0.5 + 0.5;
      const lift = -0.34 + facing * 0.62;
      ctx.strokeStyle = rgba(tone(red, green, blue, lift), (0.55 + facing * 0.4) * strength);
      ctx.lineWidth = Math.max(1.15, part.radius * (0.28 + facing * 0.22));
      ctx.beginPath();
      ctx.moveTo(part.ax, part.ay);
      ctx.lineTo(part.bx, part.by);
      ctx.stroke();
      if (part.depth > 0.42) {
        ctx.strokeStyle = rgba(tone(red, green, blue, 0.62), 0.28 + part.depth * 0.25);
        ctx.lineWidth = Math.max(0.45, part.radius * 0.08);
        ctx.stroke();
      }
    }
  }
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

  let band = 1;
  for (const contour of contours) {
    sewRunningRow(marks, contour, dash, gap, options.thread, width, clothDark, ranges, true, 1, band, 0);
    sewRunningRow(
      marks,
      offsetClosed(contour, echo),
      dash,
      gap,
      options.accent,
      width * 0.9,
      clothDark,
      ranges,
      false,
      1,
      band,
      1,
    );
    band++;
  }
}

function sewRunningRow(
  marks: SewMark[],
  pts: Point[],
  dash: number,
  gap: number,
  color: string,
  width: number,
  clothDark: boolean,
  ranges: Array<[number, number]>,
  everyFront: boolean,
  pace: number,
  band: number,
  track: number,
) {
  const from = marks.length;
  const segments: Array<{ a: Point; b: Point; front: boolean }> = [];
  forEachDash(
    pts,
    dash,
    gap,
    (a, b) => segments.push({ a, b, front: true }),
    (a, b) => segments.push({ a, b, front: false }),
  );

  let index = 0;
  let frontIndex = 0;
  while (index < segments.length) {
    const seg = segments[index++];
    if (!seg.front) {
      pushReverseTravel(
        marks,
        seg.a,
        seg.b,
        charIndexAt((seg.a.x + seg.b.x) / 2, ranges),
        color,
        clothDark,
        frontIndex,
        pace * 0.35,
      );
      continue;
    }
    const under = index < segments.length && !segments[index].front ? segments[index++] : null;
    const visible = everyFront || frontIndex % 2 === 1;
    const side = frontIndex;
    frontIndex++;
    if (!visible) {
      pushReverseTravel(
        marks,
        seg.a,
        under ? under.b : seg.b,
        charIndexAt((seg.a.x + seg.b.x) / 2, ranges),
        color,
        clothDark,
        side,
        pace * 0.35,
      );
      continue;
    }
    pushRunningStitch(
      marks,
      ranges,
      seg.a,
      seg.b,
      under ? under.b : null,
      color,
      width,
      clothDark,
      side,
      pace,
    );
  }
  for (let i = from; i < marks.length; i++) {
    marks[i].band = band;
    marks[i].track = track;
  }
}

function pushRunningStitch(
  marks: SewMark[],
  ranges: Array<[number, number]>,
  a: Point,
  b: Point,
  underEnd: Point | null,
  color: string,
  width: number,
  clothDark: boolean,
  side: number,
  pace: number,
) {
  const pieces = cutSegment(a.x, a.y, b.x, b.y, ranges);
  pieces.forEach((piece, index) => {
    const lead = index === 0;
    const tail = index === pieces.length - 1;
    const back =
      tail && underEnd && distance({ x: piece.x2, y: piece.y2 }, underEnd) > 1.4 ? underEnd : null;
    const dx = piece.x2 - piece.x1;
    const dy = piece.y2 - piece.y1;
    const len = Math.hypot(dx, dy) || 1;
    const backLen = back ? distance({ x: piece.x2, y: piece.y2 }, back) : 0;
    const sag = runningSag(backLen, side);
    const needleLen = Math.min(13, Math.max(7, len * 0.42));
    const from = { x: piece.x1, y: piece.y1 };
    const to = { x: piece.x2, y: piece.y2 };
    marks.push({
      charIndex: piece.charIndex,
      weight:
        pace *
        ((lead ? 1.15 : 0.4) + Math.max(0.85, Math.min(1.6, len / 11)) + (back ? 1.05 : tail ? 0.7 : 0)),
      draw(ctx, amount) {
        if (amount <= 0) return;
        if (amount >= 1) {
          drawThread(ctx, from.x, from.y, to.x, to.y, color, width, clothDark, true, "both");
          return;
        }
        const phase = runningPhase(amount, lead, tail, back !== null);
        if (phase.kind === "up") {
          const stub = (1 - phase.sink) * Math.min(len * 0.2, 3.6);
          if (stub > 0.7) {
            drawThread(
              ctx,
              from.x,
              from.y,
              from.x + (dx / len) * stub,
              from.y + (dy / len) * stub,
              color,
              width,
              clothDark,
              true,
              "entry",
            );
          }
          return;
        }
        if (phase.kind === "lay") {
          const eye = needleLen * 0.55;
          const tip = len * phase.t;
          const end = Math.max(Math.min(2.2, tip), tip - eye);
          if (end <= 0.4) return;
          const t = Math.min(1, end / len);
          drawThread(
            ctx,
            from.x,
            from.y,
            from.x + dx * t,
            from.y + dy * t,
            color,
            width,
            clothDark,
            true,
            "entry",
          );
          return;
        }
        if (phase.kind === "back" && back) {
          drawReverseThread(ctx, to, back, phase.t, color, clothDark, sag);
        }
        drawThread(ctx, from.x, from.y, to.x, to.y, color, width, clothDark, true, "both");
      },
      needle(amount) {
        const phase = runningPhase(amount, lead, tail, back !== null);
        if (phase.kind === "up") {
          return {
            x: from.x,
            y: from.y,
            angle: Math.atan2(dy, dx),
            sink: phase.sink,
            length: needleLen,
            upright: true,
            quiet: true,
            entry: from,
          };
        }
        if (phase.kind === "lay") {
          return {
            x: from.x + dx * phase.t,
            y: from.y + dy * phase.t,
            angle: Math.atan2(dy, dx),
            sink: 0,
            length: needleLen,
            quiet: true,
            entry: lead ? from : undefined,
            exit: tail && phase.t > 0.86 ? to : undefined,
          };
        }
        if (phase.kind === "down") {
          return {
            x: to.x,
            y: to.y,
            angle: Math.atan2(dy, dx),
            sink: phase.sink,
            length: needleLen,
            upright: true,
            quiet: true,
            entry: from,
            exit: to,
          };
        }
        const tip = back ? reversePoint(to, back, sag, phase.t) : to;
        return {
          x: tip.x,
          y: tip.y,
          angle: Math.atan2((back?.y ?? to.y) - to.y, (back?.x ?? to.x) - to.x),
          sink: 0.92,
          length: needleLen,
          upright: true,
          quiet: true,
          entry: tip,
          exit: to,
        };
      },
    });
  });
}

function pushReverseTravel(
  marks: SewMark[],
  a: Point,
  b: Point,
  charIndex: number,
  color: string,
  clothDark: boolean,
  side: number,
  pace: number,
) {
  const len = distance(a, b);
  if (len < 0.8) return;
  const sag = runningSag(len, side);
  marks.push({
    charIndex,
    weight: pace * Math.max(0.55, Math.min(1.2, len / 14)),
    draw(ctx, amount) {
      if (amount <= 0.02 || amount >= 1) return;
      drawReverseThread(ctx, a, b, amount, color, clothDark, sag);
    },
    needle(amount) {
      const tip = reversePoint(a, b, sag, Math.max(0.04, amount));
      return {
        x: tip.x,
        y: tip.y,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        sink: 0.92,
        length: Math.min(12, Math.max(7, len * 0.35)),
        upright: true,
        quiet: true,
        entry: tip,
        exit: a,
      };
    },
  });
}

function runningPhase(amount: number, lead: boolean, tail: boolean, hasBack: boolean) {
  const backShare = hasBack ? 0.32 : 0;
  const front = 1 - backShare;
  const rise = lead ? 0.46 * front : 0;
  const sink = tail ? 0.32 * front : 0;
  const layEnd = Math.max(rise, front - sink);
  if (amount <= rise && rise > 0) {
    return { kind: "up" as const, sink: 1 - amount / rise, t: 0 };
  }
  if (amount < layEnd) {
    const span = Math.max(0.05, layEnd - rise);
    return { kind: "lay" as const, sink: 0, t: (amount - rise) / span };
  }
  if (amount < front || !hasBack) {
    const span = Math.max(0.05, front - layEnd);
    return { kind: "down" as const, sink: sink === 0 ? 1 : (amount - layEnd) / span, t: 1 };
  }
  return { kind: "back" as const, sink: 1, t: (amount - front) / backShare };
}

function runningSag(len: number, side: number) {
  const bow = Math.min(5.2, Math.max(2.3, len * 0.36));
  return (side % 2 === 0 ? 1 : -1) * bow;
}

function reverseCurve(from: Point, to: Point, sag: number, amount: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = {
    x: (from.x + to.x) / 2 + (-dy / len) * sag,
    y: (from.y + to.y) / 2 + (dx / len) * sag,
  };
  const steps = Math.max(2, Math.round(7 * Math.max(amount, 0.2)));
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

function reversePoint(from: Point, to: Point, sag: number, amount: number) {
  const pts = reverseCurve(from, to, sag, amount);
  return pts[pts.length - 1];
}

function drawReverseThread(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  amount: number,
  color: string,
  clothDark: boolean,
  sag: number,
) {
  const pts = reverseCurve(from, to, sag, amount);
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = clothDark ? "rgba(0,0,0,0.32)" : "rgba(48, 28, 16, 0.2)";
  ctx.lineWidth = 3.6;
  ctx.stroke();
  ctx.globalAlpha = clothDark ? 0.72 : 0.8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([1.1, 1.7]);
  ctx.strokeStyle = clothDark ? "rgba(18, 14, 12, 0.55)" : "rgba(255, 248, 236, 0.78)";
  ctx.lineWidth = 2.3;
  ctx.stroke();
  ctx.restore();
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
  minArea = 18,
  minLength = 10,
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
    .filter((contour) => contour.length > minLength && polygonArea(contour) > minArea);
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
    const target = pts[i % pts.length];
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
