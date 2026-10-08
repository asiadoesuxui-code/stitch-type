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
    blurb: "Straight threads laid side by side, striped with the accent color.",
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

export function paintEmbroidery(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: EmbroideryOptions,
) {
  if (width < 2 || height < 2) return;

  drawFabric(ctx, width, height, options.fabric);

  const text = options.text.trim();
  if (!text) return;

  const clothDark = luminance(options.fabric) < 0.42;
  const rng = mulberry32(hashString(`${text}:${options.stitch}`));

  if (options.stitch === "cross") {
    drawCrossStitch(ctx, width, height, options, clothDark, rng);
    return;
  }

  const mask = rasterizeText(text, options, width, height);
  if (!mask) return;

  if (options.stitch === "satin") {
    drawSatin(ctx, mask, options, clothDark);
    return;
  }

  if (options.stitch === "knot") {
    drawKnots(ctx, mask, options, clothDark, rng);
    return;
  }

  const contours = tidyContours(
    traceContours(mask.mask, mask.w, mask.h, mask.scale),
  );
  if (options.stitch === "running") drawRunning(ctx, contours, options, clothDark);
  if (options.stitch === "chain") drawChain(ctx, contours, options, clothDark, rng);
  if (options.stitch === "whipped") drawWhipped(ctx, contours, options, clothDark);
}

function drawFabric(
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
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const maxW = canvas.width * 0.88;
  const maxH = Math.max(80, (canvas.height - options.insetBottom * scale) * 0.78);
  const centerY = (canvas.height - options.insetBottom * scale) / 2;
  let size = Math.min(maxH * 0.92, canvas.width * 0.42);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";

  while (size > 28) {
    ctx.font = `600 ${size}px ${options.fontFamily}`;
    ctx.letterSpacing = `${size * 0.035}px`;
    const metrics = ctx.measureText(text);
    const textH =
      (metrics.actualBoundingBoxAscent || size * 0.72) +
      (metrics.actualBoundingBoxDescent || size * 0.18);
    if (metrics.width <= maxW && textH <= maxH) break;
    size *= 0.94;
  }

  ctx.font = `600 ${size}px ${options.fontFamily}`;
  ctx.letterSpacing = `${size * 0.035}px`;
  ctx.fillText(text, canvas.width / 2, centerY);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = image.data[i * 4 + 3] > 120 ? 1 : 0;
  }
  return { mask, w: canvas.width, h: canvas.height, scale };
}

function drawCrossStitch(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: EmbroideryOptions,
  clothDark: boolean,
  rng: () => number,
) {
  const cell = clampNum(16, 34, 22 * options.scale);
  const maxW = width * 0.9;
  const maxH = Math.max(48, (height - options.insetBottom) * 0.8);
  const cols = Math.max(6, Math.round(maxW / cell));
  const rows = Math.max(6, Math.round(maxH / cell));

  const mini = document.createElement("canvas");
  mini.width = cols;
  mini.height = rows;
  const m = mini.getContext("2d", { willReadFrequently: true });
  if (!m) return;

  m.textAlign = "center";
  m.textBaseline = "middle";
  m.fillStyle = "#fff";
  let size = rows * 0.9;
  while (size > 4) {
    m.font = `650 ${size}px ${options.fontFamily}`;
    m.letterSpacing = `${Math.max(0, size * 0.02)}px`;
    if (m.measureText(options.text.trim()).width <= cols * 0.94) break;
    size *= 0.92;
  }
  m.font = `650 ${size}px ${options.fontFamily}`;
  m.letterSpacing = `${Math.max(0, size * 0.02)}px`;
  m.fillText(options.text.trim(), cols / 2, rows / 2 + rows * 0.02);

  const pixels = m.getImageData(0, 0, cols, rows).data;
  const gridW = cols * cell;
  const gridH = rows * cell;
  const ox = (width - gridW) / 2;
  const oy = (height - options.insetBottom - gridH) / 2;
  const threadW = Math.max(1.1, cell * 0.16);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (pixels[(y * cols + x) * 4 + 3] < 90) continue;
      const left = ox + x * cell;
      const top = oy + y * cell;
      const pad = cell * 0.1;
      const j = () => (rng() - 0.5) * 0.45;
      drawThread(
        ctx,
        left + pad + j(),
        top + pad + j(),
        left + cell - pad + j(),
        top + cell - pad + j(),
        options.accent,
        threadW * 0.92,
        clothDark,
      );
      drawThread(
        ctx,
        left + pad + j(),
        top + cell - pad + j(),
        left + cell - pad + j(),
        top + pad + j(),
        options.thread,
        threadW,
        clothDark,
      );
    }
  }
}

function drawSatin(
  ctx: CanvasRenderingContext2D,
  mask: Mask,
  options: EmbroideryOptions,
  clothDark: boolean,
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

  let band = 0;
  for (let t = minT; t <= maxT; t += spacing) {
    const color = band % 8 < 2 ? options.accent : options.thread;
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
          drawThread(
            ctx,
            (nx * t + dx * runStart) / mask.scale,
            (ny * t + dy * runStart) / mask.scale,
            (nx * t + dx * end) / mask.scale,
            (ny * t + dy * end) / mask.scale,
            color,
            width,
            clothDark,
          );
        }
        runStart = null;
      }
    }
    band++;
  }
}

function drawKnots(
  ctx: CanvasRenderingContext2D,
  mask: Mask,
  options: EmbroideryOptions,
  clothDark: boolean,
  rng: () => number,
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
      drawKnot(
        ctx,
        px,
        py,
        spacing * 0.42,
        options.thread,
        options.accent,
        clothDark,
        rng,
      );
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
  rng: () => number,
) {
  const turn = rng() * Math.PI * 2;
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

function drawRunning(
  ctx: CanvasRenderingContext2D,
  contours: Point[][],
  options: EmbroideryOptions,
  clothDark: boolean,
) {
  const dash = clampNum(7, 18, 12 * options.scale);
  const gap = dash * 0.62;
  const width = clampNum(1.3, 2.8, 1.7 * options.scale);
  const echo = 4.2 * options.scale;

  for (const contour of contours) {
    forEachDash(contour, dash, gap, (a, b) => {
      drawThread(ctx, a.x, a.y, b.x, b.y, options.thread, width, clothDark);
    });
    const offset = offsetClosed(contour, echo);
    forEachDash(offset, dash, gap, (a, b, index) => {
      if (index % 2 === 0) return;
      drawThread(ctx, a.x, a.y, b.x, b.y, options.accent, width * 0.9, clothDark);
    });
  }
}

function drawChain(
  ctx: CanvasRenderingContext2D,
  contours: Point[][],
  options: EmbroideryOptions,
  clothDark: boolean,
  rng: () => number,
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

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.bezierCurveTo(
        p.x + tx * len * 0.2 + nx * bulge + j,
        p.y + ty * len * 0.2 + ny * bulge,
        q.x - tx * len * 0.05 + nx * bulge * 0.92,
        q.y - ty * len * 0.05 + ny * bulge * 0.92,
        q.x,
        q.y,
      );
      ctx.bezierCurveTo(
        q.x - tx * len * 0.35 + nx * bulge * 0.18,
        q.y - ty * len * 0.35 + ny * bulge * 0.18,
        p.x + tx * len * 0.25 + nx * bulge * 0.12,
        p.y + ty * len * 0.25 + ny * bulge * 0.12,
        p.x,
        p.y,
      );

      ctx.strokeStyle = clothDark ? "rgba(0,0,0,0.45)" : "rgba(70,40,24,0.2)";
      ctx.lineWidth = width + 1.1;
      ctx.stroke();
      ctx.strokeStyle = options.thread;
      ctx.lineWidth = width;
      ctx.stroke();

      const pin = 4.6 * options.scale;
      drawThread(
        ctx,
        p.x - nx * 0.4,
        p.y - ny * 0.4,
        p.x + nx * pin,
        p.y + ny * pin,
        options.accent,
        width * 1.15,
        clothDark,
      );
    }
  }
}

function drawWhipped(
  ctx: CanvasRenderingContext2D,
  contours: Point[][],
  options: EmbroideryOptions,
  clothDark: boolean,
) {
  const stitch = clampNum(6, 14, 8 * options.scale);
  const baseW = clampNum(1.8, 3.6, 2.7 * options.scale);
  const whipSpacing = clampNum(5, 10, 7.2 * options.scale);
  const whipLen = 7.2 * options.scale;

  for (const contour of contours) {
    forEachDash(contour, stitch, 0, (a, b) => {
      drawThread(ctx, a.x, a.y, b.x, b.y, options.thread, baseW, clothDark);
    });

    const pts = resampleClosed(contour, whipSpacing);
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
      drawThread(
        ctx,
        p.x - ux * whipLen,
        p.y - uy * whipLen,
        p.x + ux * whipLen,
        p.y + uy * whipLen,
        options.accent,
        baseW * 0.48,
        clothDark,
      );
    }

    forEachDash(contour, stitch, 0, (a, b) => {
      drawThread(ctx, a.x, a.y, b.x, b.y, options.thread, baseW * 0.42, clothDark);
    });
  }
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
    if (drawing && step > 0.2) fn(pos, next, index);
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
