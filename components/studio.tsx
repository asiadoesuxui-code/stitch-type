"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
import {
  STITCHES,
  measureTextWidth,
  measureWord,
  paintEmbroidery,
  visibleTextWidth,
  type StitchId,
} from "@/lib/embroidery";

const DEFAULTS = {
  text: "",
  stitch: "satin" as StitchId,
  thread: "#9c3048",
  accent: "#1f6b45",
  fabric: "#efe6d4",
  scale: 1,
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
  const [scale, setScale] = useState(DEFAULTS.scale);
  const [insetBottom, setInsetBottom] = useState(180);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [fontReady, setFontReady] = useState(false);
  const [focused, setFocused] = useState(true);
  const [caret, setCaret] = useState(0);

  const active = STITCHES.find((item) => item.id === stitch) ?? STITCHES[0];
  const darkCloth = relativeLuminance(fabric) < 0.42;

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fontReady) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const paint = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintEmbroidery(ctx, width, height, {
        text,
        stitch,
        thread,
        accent,
        fabric,
        scale,
        fontFamily: fontFamily(),
        insetBottom,
      });
    };

    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [text, stitch, thread, accent, fabric, scale, insetBottom, fontReady]);

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
      scale,
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
      className="relative h-dvh overflow-hidden"
      style={{ background: fabric }}
    >
      <h1 className="sr-only">Stitch</h1>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

      <div
        className="absolute inset-x-0 top-0 z-10 flex items-center"
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
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="word-field w-full bg-transparent text-center outline-none"
          style={{
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
        className="absolute inset-x-0 bottom-0 z-20 px-3 pb-3 sm:px-5 sm:pb-5"
      >
        <div
          className={`mx-auto w-full max-w-3xl rounded-3xl border p-3 shadow-[0_20px_50px_rgba(40,24,12,0.14)] backdrop-blur-md sm:p-4 ${
            darkCloth
              ? "border-white/10 bg-[#1c1916]/80 text-[#f6f1e8]"
              : "border-[#3a2a1c]/10 bg-[#fffaf3]/82 text-[#2a2118]"
          }`}
        >
          <p className="px-1 text-xs leading-5 opacity-70">{active.blurb}</p>

          <div
            role="radiogroup"
            aria-label="Stitch type"
            className="mt-2 flex gap-1.5 overflow-x-auto pb-1"
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
                  className={`flex min-w-[4.6rem] flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] tracking-wide transition ${
                    selected
                      ? darkCloth
                        ? "bg-white/10"
                        : "bg-[#2a2118]/6"
                      : "hover:bg-black/4"
                  }`}
                  style={
                    selected
                      ? { boxShadow: `inset 0 -2px 0 ${thread}` }
                      : undefined
                  }
                >
                  <StitchIcon id={item.id} />
                  <span>{item.name}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 px-1">
            <Swatch label="Thread" value={thread} onChange={setThread} />
            <Swatch label="Accent" value={accent} onChange={setAccent} />
            <Swatch label="Cloth" value={fabric} onChange={setFabric} />
            <label className="ml-auto flex min-w-36 flex-1 items-center gap-3 sm:max-w-56">
              <span className="text-[11px] font-medium tracking-[0.16em] uppercase opacity-60">
                Size
              </span>
              <input
                type="range"
                min={0.7}
                max={1.55}
                step={0.01}
                value={scale}
                aria-label="Stitch size"
                onChange={(event) => setScale(Number(event.target.value))}
                className="stitch-range"
                style={{ color: thread }}
              />
            </label>
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
        className="relative h-7 w-7 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(40,24,12,0.18)]"
        style={{ background: value }}
      >
        <input
          type="color"
          value={value}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
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

  if (id === "knot") {
    return (
      <svg {...common}>
        {[6, 14, 22, 30].map((x) => (
          <g key={x} stroke="currentColor">
            <circle cx={x} cy="9" r="3.1" strokeWidth="1.4" />
            <circle cx={x} cy="9" r="0.8" fill="currentColor" stroke="none" />
          </g>
        ))}
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
