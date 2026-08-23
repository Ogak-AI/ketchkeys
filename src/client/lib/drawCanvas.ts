import { buildDrawOrder } from '../../shared/ascii';
import {
  DRAW_SECONDS,
  FRAME_H,
  FRAME_W,
  GLYPH_LINE_PACK,
  PREVIEW_H,
  PREVIEW_W,
  SHARE_MIN_H,
  WATERMARK_TEXT,
  coverDrawRect,
  shareFrameSize,
} from '../../shared/config';
import { loadImageElement, measureMonoAspect, MONO_STACK } from './imageToAscii';

export { FRAME_H, FRAME_W, PREVIEW_H, PREVIEW_W };

export type DrawTheme = 'light' | 'dark';

type Layout = {
  fontSize: number;
  charW: number;
  lineH: number;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
};

function themeColors(theme: DrawTheme) {
  if (theme === 'dark') {
    return {
      bg: '#000000',
      fg: '#ffffff',
      watermark: '#ffffff',
      cursor: '#ffffff',
    };
  }
  return {
    bg: '#ffffff',
    fg: '#000000',
    watermark: '#111111',
    cursor: '#000000',
  };
}

export function watermarkBandH(h: number): number {
  return Math.max(22, Math.round(h * 0.035));
}

function glyphMetrics(lines: string[], frameW: number, aspect: number) {
  const cols = Math.max(...lines.map((l) => l.length), 1);
  const rows = Math.max(lines.length, 1);
  const margin = Math.max(12, Math.round(frameW * 0.03));
  const usableW = frameW - margin * 2;
  const maxSize = Math.max(8, Math.round(28 * (frameW / FRAME_W)));
  const fontSize = Math.max(
    4,
    Math.min(maxSize, Math.floor(usableW / (cols * aspect)))
  );
  return { cols, rows, margin, fontSize };
}

export function layoutAscii(
  lines: string[],
  frameW: number,
  frameH: number
): Layout {
  const aspect = measureMonoAspect();
  const g = glyphMetrics(lines, frameW, aspect);
  const bot = watermarkBandH(frameH);
  const padTop = Math.max(8, Math.round(g.margin * 0.5));
  const usableH = Math.max(8, frameH - bot - padTop);

  let fontSize = g.fontSize;
  const packed = (size: number) => size * GLYPH_LINE_PACK;
  if (g.rows * packed(fontSize) > usableH) {
    fontSize = Math.max(4, Math.floor(usableH / (g.rows * GLYPH_LINE_PACK)));
  }

  const lineH = packed(fontSize);
  const charW = fontSize * aspect;
  const blockW = g.cols * charW;
  const blockH = g.rows * lineH;
  const originX = (frameW - blockW) / 2;
  const originY = padTop + Math.max(0, (usableH - blockH) / 2);

  return { fontSize, charW, lineH, originX, originY, cols: g.cols, rows: g.rows };
}

export function createOffscreenCanvas(
  w = FRAME_W,
  h = FRAME_H
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This phone or computer cannot draw the picture');
  return { canvas, ctx };
}

function ensureSize(canvas: HTMLCanvasElement, w: number, h: number): boolean {
  const resized = canvas.width !== w || canvas.height !== h;
  if (resized) {
    canvas.width = w;
    canvas.height = h;
  }
  return resized;
}

/**
 * Posted letter still: width {@link FRAME_W}, height fits the glyph block
 * (clamped to 16:9 landscape … 9:16 portrait). Font is sized from width
 * first so a second layout pass does not shrink the letters and leave
 * black bars.
 */
export function asciiShareFrameSize(lines: string[]): { w: number; h: number } {
  const w = FRAME_W;
  const g = glyphMetrics(lines, w, measureMonoAspect());
  const padTop = Math.max(8, Math.round(g.margin * 0.5));
  let fontSize = g.fontSize;
  let contentH = g.rows * fontSize * GLYPH_LINE_PACK;
  let h = Math.min(
    FRAME_H,
    Math.max(SHARE_MIN_H, Math.round(contentH + padTop + Math.max(24, w * 0.042)))
  );
  const bot = watermarkBandH(h);
  const usableH = Math.max(8, h - bot - padTop);
  if (g.rows * fontSize * GLYPH_LINE_PACK > usableH) {
    fontSize = Math.max(4, Math.floor(usableH / (g.rows * GLYPH_LINE_PACK)));
    contentH = g.rows * fontSize * GLYPH_LINE_PACK;
    h = Math.min(FRAME_H, Math.max(SHARE_MIN_H, Math.round(contentH + padTop + bot)));
  }
  return { w, h };
}

/** Stamp only `r/ketchkeys` — no strip, progress bar, or status copy. */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  options?: {
    color?: string;
    alpha?: number;
  }
): void {
  const margin = Math.round(w * 0.044);
  const size = Math.max(12, Math.round(w * 0.026));

  ctx.save();
  ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.globalAlpha = options?.alpha ?? 0.88;
  ctx.fillStyle = options?.color ?? '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 4;
  ctx.fillText(WATERMARK_TEXT, w - margin, h - Math.round(margin * 0.7));
  ctx.restore();
}

export function paintAsciiFrame(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  order: Array<{ r: number; c: number; ch: string }>,
  revealed: number,
  theme: DrawTheme,
  options?: { showCursor?: boolean; blinkOn?: boolean }
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const colors = themeColors(theme);
  const layout = layoutAscii(lines, w, h);

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.font = `${layout.fontSize}px ${MONO_STACK}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.fg;

  const max = Math.min(revealed, order.length);
  for (let i = 0; i < max; i++) {
    const cell = order[i]!;
    ctx.fillText(
      cell.ch,
      layout.originX + cell.c * layout.charW,
      layout.originY + cell.r * layout.lineH
    );
  }

  if (options?.showCursor && revealed < order.length && options.blinkOn !== false) {
    const next = order[revealed]!;
    ctx.fillStyle = colors.cursor;
    ctx.fillRect(
      layout.originX + next.c * layout.charW,
      layout.originY + next.r * layout.lineH,
      Math.max(2, layout.charW - 1),
      layout.lineH - 2
    );
  }

  drawWatermark(ctx, w, h, { color: colors.watermark });
}

export type AnimTarget = {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
};

/**
 * Incremental typewriter draw into `target.canvas`.
 * Returns a cancel function.
 */
export function runDrawAnimation(
  lines: string[],
  theme: DrawTheme,
  options: {
    durationMs?: number;
    style?: 'typewriter' | 'ink';
    target: AnimTarget;
    onFrame?: (state: { revealed: number; total: number; done: boolean }) => void;
    onComplete?: () => void;
  }
): () => void {
  const order = buildDrawOrder(lines, options.style ?? 'typewriter');
  const durationMs = Math.max(1, options.durationMs ?? DRAW_SECONDS * 1000);
  const canvas = options.target.canvas;
  const w = options.target.width ?? PREVIEW_W;
  const h = options.target.height ?? PREVIEW_H;
  ensureSize(canvas, w, h);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    options.onFrame?.({ revealed: 0, total: order.length, done: true });
    options.onComplete?.();
    return () => undefined;
  }

  const colors = themeColors(theme);
  const layout = layoutAscii(lines, w, h);
  let cancelled = false;
  let raf = 0;
  let lastDrawn = 0;
  let cursorCell: { r: number; c: number } | null = null;
  const start = performance.now();
  const font = `${layout.fontSize}px ${MONO_STACK}`;

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.font = font;
  ctx.textBaseline = 'top';

  const stamp = () => {
    const band = watermarkBandH(h);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, h - band, w, band);
    drawWatermark(ctx, w, h, { color: colors.watermark });
  };
  stamp();

  const clearCursor = () => {
    if (!cursorCell) return;
    const x = layout.originX + cursorCell.c * layout.charW;
    const y = layout.originY + cursorCell.r * layout.lineH;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(x, y, Math.max(2, layout.charW), layout.lineH);
    cursorCell = null;
  };

  const finish = () => {
    clearCursor();
    if (lastDrawn < order.length) {
      ctx.fillStyle = colors.fg;
      ctx.font = font;
      ctx.textBaseline = 'top';
      for (let i = lastDrawn; i < order.length; i++) {
        const cell = order[i]!;
        ctx.fillText(
          cell.ch,
          layout.originX + cell.c * layout.charW,
          layout.originY + cell.r * layout.lineH
        );
      }
      lastDrawn = order.length;
    }
    stamp();
    options.onFrame?.({ revealed: order.length, total: order.length, done: true });
    options.onComplete?.();
  };

  if (order.length === 0) {
    stamp();
    options.onFrame?.({ revealed: 0, total: 0, done: true });
    options.onComplete?.();
    return () => {
      cancelled = true;
    };
  }

  const tick = (now: number) => {
    if (cancelled) return;

    const t = Math.min(1, (now - start) / durationMs);
    const revealed = Math.min(order.length, Math.round(t * order.length));
    const done = revealed >= order.length;
    const blinkOn = Math.floor(now / 250) % 2 === 0;

    if (revealed > lastDrawn) {
      clearCursor();
      ctx.fillStyle = colors.fg;
      ctx.font = font;
      ctx.textBaseline = 'top';
      for (let i = lastDrawn; i < revealed; i++) {
        const cell = order[i]!;
        ctx.fillText(
          cell.ch,
          layout.originX + cell.c * layout.charW,
          layout.originY + cell.r * layout.lineH
        );
      }
      lastDrawn = revealed;
    }

    if (!done) {
      const next = order[revealed];
      if (next) {
        if (cursorCell && (cursorCell.r !== next.r || cursorCell.c !== next.c)) {
          clearCursor();
        }
        const x = layout.originX + next.c * layout.charW;
        const y = layout.originY + next.r * layout.lineH;
        if (blinkOn) {
          ctx.fillStyle = colors.cursor;
          ctx.fillRect(x, y, Math.max(2, layout.charW - 1), layout.lineH - 2);
          cursorCell = { r: next.r, c: next.c };
        } else if (cursorCell) {
          clearCursor();
        }
      }
    }

    stamp();

    if (!done) {
      options.onFrame?.({ revealed, total: order.length, done: false });
      raf = requestAnimationFrame(tick);
    } else if (!cancelled) {
      finish();
    }
  };

  raf = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

export function renderFinalFrame(
  lines: string[],
  theme: DrawTheme,
  w?: number,
  h?: number
): HTMLCanvasElement {
  const sized = w != null && h != null ? { w, h } : asciiShareFrameSize(lines);
  const order = buildDrawOrder(lines, 'typewriter');
  const { canvas, ctx } = createOffscreenCanvas(sized.w, sized.h);
  paintAsciiFrame(ctx, lines, order, order.length, theme, {
    showCursor: false,
  });

  return canvas;
}

/**
 * Paint the source photo onto a share still. No label or community
 * watermark — that mark is letter-art only. Canvas follows the photo
 * aspect (see {@link shareFrameSize}) so landscape pictures fill the
 * post instead of sitting in a 9:16 box.
 */
export async function renderWatermarkedOriginal(
  source: File | string | HTMLImageElement,
  w?: number,
  h?: number
): Promise<HTMLCanvasElement> {
  const img = await loadImageElement(source);
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  if (!nw || !nh) {
    throw new Error('That picture is empty or broken');
  }

  const sized = w != null && h != null ? { w, h } : shareFrameSize(nw, nh);
  const { canvas, ctx } = createOffscreenCanvas(sized.w, sized.h);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, sized.w, sized.h);

  const dest = coverDrawRect(nw, nh, sized.w, sized.h);
  ctx.drawImage(img, dest.dx, dest.dy, dest.dw, dest.dh);

  return canvas;
}

export function paintCompleteToCanvas(
  canvas: HTMLCanvasElement,
  lines: string[],
  theme: DrawTheme,
  w = PREVIEW_W,
  h = PREVIEW_H
): void {
  ensureSize(canvas, w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const order = buildDrawOrder(lines, 'typewriter');
  paintAsciiFrame(ctx, lines, order, order.length, theme, {
    showCursor: false,
  });
}
