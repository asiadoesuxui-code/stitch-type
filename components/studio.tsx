"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsoLayoutEffect = useLayoutEffect;
import {
  STITCHES,
  buildEmbroideryScene,
  drawEmbroideryScene,
  measureTextWidth,
  measureWord,
  sceneSewWeight,
  sewDurationFor,
  visibleTextWidth,
  type EmbroideryScene,
  type StitchId,
} from "@/lib/embroidery";

const DEFAULTS = {
  text: "",
  stitch: "cross" as StitchId,
  thread: "#5e1a1a",
  accent: "#8aadfd",
  fabric: "#fff8ec",
};

export function Studio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(DEFAULTS.text);
  const [stitch, setStitch] = useState<StitchId>(DEFAULTS.stitch);
  const [thread, setThread] = useState(DEFAULTS.thread);
  const [accent, setAccent] = useState(DEFAULTS.accent);
  const [fabric, setFabric] = useState(DEFAULTS.fabric);
  const [insetBottom, setInsetBottom] = useState(180);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [fontReady, setFontReady] = useState(false);
  const [focused, setFocused] = useState(true);
  const [caret, setCaret] = useState(0);

  const darkCloth = relativeLuminance(fabric) < 0.42;

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.style.overflow = "clip";
    body.style.overflow = "clip";
    root.style.position = "fixed";
    body.style.position = "fixed";
    root.style.inset = "0";
    body.style.inset = "0";
    root.style.width = "100%";
    body.style.width = "100%";
    root.style.height = "100%";
    body.style.height = "100%";
    root.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    const stopWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const bar = controlsRef.current?.firstElementChild;
      if (
        bar instanceof HTMLElement &&
        event.target instanceof Node &&
        bar.contains(event.target) &&
        bar.scrollWidth > bar.clientWidth + 1 &&
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("wheel", stopWheel, { passive: false });
    window.scrollTo(0, 0);
    return () => window.removeEventListener("wheel", stopWheel);
  }, []);

  useEffect(() => {
    let cancel = false;
    const family = fontFamily();
    document.fonts.load(`600 120px ${family}`).then(() => {
      if (!cancel) setFontReady(true);
    });
    wordRef.current?.focus();
    return () => {
      cancel = true;
    };
  }, []);

  useIsoLayoutEffect(() => {
    const controls = controlsRef.current;
    const stageEl = stageRef.current;
    if (!controls || !stageEl) return;
    const measure = () => {
      setInsetBottom(controls.offsetHeight + 28);
      const rect = stageEl.getBoundingClientRect();
      setStage({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, []);

  const sewRef = useRef({
    text: "",
    stitch: DEFAULTS.stitch,
    from: 0,
    started: 0,
    duration: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fontReady) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const next = text.trim();
    const prev = sewRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !next) {
      sewRef.current = { text: next, stitch, from: next.length, started: 0, duration: 0 };
    } else if (stitch !== prev.stitch) {
      sewRef.current = { text: next, stitch, from: 0, started: 0, duration: -1 };
    } else if (next.startsWith(prev.text) && next.length > prev.text.length) {
      const added = next.slice(prev.text.length);
      sewRef.current = added.trim()
        ? { text: next, stitch, from: prev.text.length, started: 0, duration: -1 }
        : { text: next, stitch, from: next.length, started: 0, duration: 0 };
    } else if (next.length < prev.text.length && prev.text.startsWith(next)) {
      sewRef.current = { text: next, stitch, from: next.length, started: 0, duration: 0 };
    } else if (next !== prev.text) {
      let from = 0;
      const limit = Math.min(next.length, prev.text.length);
      while (from < limit && next[from] === prev.text[from]) from++;
      sewRef.current = { text: next, stitch, from, started: 0, duration: -1 };
    }

    let scene: EmbroideryScene | null = null;
    let sceneKey = "";
    let frame = 0;
    let backup = 0;

    const paint = (now: number) => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const nextW = Math.round(width * dpr);
      const nextH = Math.round(height * dpr);
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
      const cssW = `${width}px`;
      const cssH = `${height}px`;
      if (canvas.style.width !== cssW) canvas.style.width = cssW;
      if (canvas.style.height !== cssH) canvas.style.height = cssH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const key = `${text}|${stitch}|${thread}|${accent}|${fabric}|${width}|${height}|${insetBottom}`;
      if (!scene || sceneKey !== key) {
        scene = buildEmbroideryScene(width, height, {
          text,
          stitch,
          thread,
          accent,
          fabric,
          scale: measureWord(text, fontFamily(), width, height, insetBottom).stitchScale,
          fontFamily: fontFamily(),
          insetBottom,
        });
        sceneKey = key;
      }
      const sew = sewRef.current;
      if (sew.duration < 0) {
        sew.duration = sewDurationFor(sceneSewWeight(scene, sew.from), scene.sewPace);
      }
      const progress =
        sew.duration === 0
          ? 1
          : sew.started === 0
            ? 0
            : Math.max(0, Math.min(1, (now - sew.started) / sew.duration));
      drawEmbroideryScene(ctx, width, height, scene, sew.from, progress);
    };

    const tick = (now: number) => {
      const sew = sewRef.current;
      if (sew.duration > 0 && sew.started === 0) sew.started = now;
      paint(now);
      if (sew.duration > 0 && now - sew.started < sew.duration) schedule();
    };

    const schedule = () => {
      let settled = false;
      frame = requestAnimationFrame((now) => {
        if (settled) return;
        settled = true;
        clearTimeout(backup);
        tick(now);
      });
      backup = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(frame);
        tick(performance.now());
      }, 40);
    };

    paint(performance.now());
    schedule();
    const observer = new ResizeObserver(() => paint(performance.now()));
    observer.observe(parent);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(backup);
      observer.disconnect();
    };
  }, [text, stitch, thread, accent, fabric, insetBottom, fontReady]);

  const layout =
    stage.width > 0
      ? measureWord(text, fontFamily(), stage.width, stage.height, insetBottom)
      : null;

  const caretLeft = (word: NonNullable<typeof layout>) => {
    const family = fontFamily();
    const bar = Math.max(3, word.fontSize * 0.04);
    const visual = visibleTextWidth(
      text,
      stitch,
      family,
      stage.width,
      stage.height,
      insetBottom,
      word.stitchScale,
    );
    const prefix = measureTextWidth(
      text.slice(0, caret),
      family,
      word.fontSize,
      word.letterSpacing,
    );
    const ratio = word.textWidth > 0 ? Math.min(1, prefix / word.textWidth) : 0;
    return stage.width / 2 - visual / 2 + ratio * visual - bar / 2;
  };

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 overflow-hidden"
      style={{ background: fabric }}
    >
      <h1 className="sr-only">Stitch</h1>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

      <div
        className="absolute inset-x-0 top-0 z-10 flex items-center overflow-hidden"
        style={{ bottom: insetBottom }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            wordRef.current?.focus();
          }
        }}
      >
        <input
          ref={wordRef}
          value={text}
          aria-label="Type a word"
          onChange={(event) => {
            const next = event.target.value.slice(0, 18);
            setText(next);
            setCaret(Math.min(event.target.selectionStart ?? next.length, next.length));
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onScroll={(event) => {
            event.currentTarget.scrollLeft = 0;
            event.currentTarget.scrollTop = 0;
          }}
          size={1}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="word-field absolute inset-0 block bg-transparent text-center outline-none"
          style={{
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            height: "100%",
            maxHeight: "100%",
            minHeight: 0,
            overflow: "clip",
            boxSizing: "border-box",
            fontFamily: "var(--font-display), Georgia, serif",
            fontWeight: 600,
            fontSize: layout?.fontSize ?? 160,
            letterSpacing: layout ? `${layout.letterSpacing}px` : "0.035em",
            lineHeight: 1,
            color: "transparent",
            caretColor: "transparent",
          }}
        />
        {layout && (focused || text.length === 0) && (
          <span
            aria-hidden
            className="stitch-caret pointer-events-none absolute"
            style={{
              left: caretLeft(layout),
              top: layout.centerY - (layout.fontSize * 0.9) / 2,
              height: layout.fontSize * 0.9,
              width: Math.max(3, layout.fontSize * 0.04),
              transform: "none",
              background: thread,
            }}
          />
        )}
      </div>

      <div
        ref={controlsRef}
        className="absolute inset-x-0 bottom-0 z-20 overflow-hidden px-3 pb-3 sm:px-5 sm:pb-5"
      >
        <div
          className={`mx-auto w-fit max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-[14px] border p-3 pr-5 backdrop-blur-md sm:p-4 sm:pr-6 ${
            darkCloth
              ? "border-white/10 bg-[#1c1916]/80 text-[#f6f1e8]"
              : "border-[#3a2a1c]/10 bg-[#fffaf3]/82 text-[#2a2118]"
          }`}
        >
          <div className="flex w-max items-center gap-3 md:gap-12">
            <div
              role="radiogroup"
              aria-label="Stitch type"
              className="flex gap-1"
            >
              {STITCHES.map((item) => {
                const selected = item.id === stitch;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setStitch(item.id);
                      wordRef.current?.focus();
                    }}
                    className={`flex size-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[10px] px-1 text-[11px] tracking-wide whitespace-nowrap transition ${
                      selected
                        ? darkCloth
                          ? "bg-white/10"
                          : "bg-[#2a2118]/6"
                        : "hover:bg-black/4"
                    }`}
                  >
                    <StitchIcon id={item.id} />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-x-4">
              <Swatch label="Thread" value={thread} onChange={setThread} />
              <Swatch label="Accent" value={accent} onChange={setAccent} />
              <Swatch label="Cloth" value={fabric} onChange={setFabric} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Swatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span
        className="relative h-6 w-6 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(40,24,12,0.18)]"
        style={{ background: value }}
      >
        <input
          type="color"
          value={value}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none overflow-hidden border-0 p-0 opacity-0"
        />
      </span>
      <span className="text-[11px] font-medium tracking-[0.16em] uppercase opacity-60">
        {label}
      </span>
    </label>
  );
}

function StitchIcon({ id }: { id: StitchId }) {
  const common = {
    width: 36,
    height: 18,
    viewBox: "0 0 36 18",
    fill: "none",
    "aria-hidden": true as const,
  };

  if (id === "cross") {
    return (
      <svg {...common}>
        <path d="M4 3.5 10 14.5M10 3.5 4 14.5M15 3.5 21 14.5M21 3.5 15 14.5M26 3.5 32 14.5M32 3.5 26 14.5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }

  if (id === "satin") {
    return (
      <svg {...common}>
        {Array.from({ length: 8 }, (_, index) => (
          <path
            key={index}
            d={`M${4 + index * 3.6} 15.5 ${8 + index * 3.6} 2.5`}
            stroke="currentColor"
            strokeWidth="1.5"
          />
        ))}
      </svg>
    );
  }

  if (id === "rope") {
    return (
      <svg {...common}>
        <path
          d="M3 6.4c3.1 0 4.3 5.1 7.4 5.1s4.3-5.1 7.4-5.1 4.3 5.1 7.4 5.1 4.2-5.1 7.4-5.1"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M3 11.6c3.1 0 4.3-5.1 7.4-5.1s4.3 5.1 7.4 5.1 4.3-5.1 7.4-5.1 4.2 5.1 7.4 5.1"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (id === "running") {
    return (
      <svg {...common}>
        <path d="M3 9h5M13 9h5M23 9h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M8 12.5h4M18 12.5h4M28 12.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
      </svg>
    );
  }

  if (id === "chain") {
    return (
      <svg {...common}>
        <path d="M4 9c2-4 6-4 8 0-2 4-6 4-8 0Zm8 0c2-4 6-4 8 0-2 4-6 4-8 0Zm8 0c2-4 6-4 8 0-2 4-6 4-8 0" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M3 9h30" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 5.5 11 12.5M13 5.5 17 12.5M19 5.5 23 12.5M25 5.5 29 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function fontFamily() {
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-display")
    .trim();
  return family || "Georgia, serif";
}

function relativeLuminance(hex: string) {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  const value = Number.parseInt(full, 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
    (channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    },
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
