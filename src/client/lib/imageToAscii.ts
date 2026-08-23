import {
  isLineArtFromLumas,
  luma,
  preparePhotoSamples,
  samplesToAscii,
  type AsciiMode,
  type AsciiResult,
} from '../../shared/ascii';
import {
  DEFAULT_COLS,
  GLYPH_LINE_PACK,
  MAX_COLS,
  MIN_COLS,
} from '../../shared/config';

export type ConvertOptions = {
  width?: number;
  charAspect?: number;
  forceMode?: AsciiMode;
  invert?: boolean;
  contrast?: number;
};

/** Extra pixels per cell so downscale averages a block instead of one bilinear sample. */
const OVERSAMPLE = 6;

/** Matches {@link layoutAscii} line box: 1em tall, measured M width. */
export const MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

let cachedMonoAspect: number | null = null;

/** Character cell width / height for the font we paint with. */
export function measureMonoAspect(): number {
  if (cachedMonoAspect != null) return cachedMonoAspect;
  if (typeof document === 'undefined') {
    cachedMonoAspect = 0.6;
    return cachedMonoAspect;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    cachedMonoAspect = 0.6;
    return cachedMonoAspect;
  }
  ctx.font = `100px ${MONO_STACK}`;
  const width = ctx.measureText('M').width;
  cachedMonoAspect = Math.min(0.75, Math.max(0.45, width / 100));
  return cachedMonoAspect;
}

export async function loadImageElement(
  source: File | string | HTMLImageElement
): Promise<HTMLImageElement> {
  if (source instanceof HTMLImageElement) {
    if (source.complete && source.naturalWidth > 0) return source;
    await source.decode();
    return source;
  }

  const img = new Image();
  img.decoding = 'async';

  if (typeof source === 'string') {
    img.crossOrigin = 'anonymous';
    img.src = source;
  } else {
    img.src = URL.createObjectURL(source);
  }

  try {
    try {
      await img.decode();
    } catch {
      if (!(img.complete && img.naturalWidth > 0)) {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Could not open that picture'));
        });
      }
    }
    return img;
  } finally {
    if (source instanceof File) {
      URL.revokeObjectURL(img.src);
    }
  }
}

function sampleLumas(
  img: HTMLImageElement,
  cols: number,
  rows: number
): Uint8Array {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const tw = Math.max(cols, cols * OVERSAMPLE);
  const th = Math.max(rows, rows * OVERSAMPLE);

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This phone or computer cannot draw the picture');

  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }
  // Paper-white behind alpha so transparent logos stay readable.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(img, 0, 0, srcW, srcH, 0, 0, tw, th);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, tw, th).data;
  } catch {
    throw new Error(
      'We could not read that picture link. Please use From device.'
    );
  }
  const samples = new Uint8Array(cols * rows);
  const cellW = tw / cols;
  const cellH = th / rows;

  for (let y = 0; y < rows; y++) {
    const y0 = Math.floor(y * cellH);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * cellH));
    for (let x = 0; x < cols; x++) {
      const x0 = Math.floor(x * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * cellW));
      let sum = 0;
      let count = 0;
      for (let py = y0; py < y1; py++) {
        let p = (py * tw + x0) * 4;
        for (let px = x0; px < x1; px++) {
          const r = data[p]!;
          const g = data[p + 1]!;
          const b = data[p + 2]!;
          const a = data[p + 3]! / 255;
          const rr = r * a + 255 * (1 - a);
          const gg = g * a + 255 * (1 - a);
          const bb = b * a + 255 * (1 - a);
          sum += luma(rr, gg, bb);
          count++;
          p += 4;
        }
      }
      samples[y * cols + x] = count ? sum / count : 255;
    }
  }

  return samples;
}

/**
 * Convert an image to ASCII via canvas sampling (no AI).
 */
export async function imageToAscii(
  source: File | string | HTMLImageElement,
  options: ConvertOptions = {}
): Promise<AsciiResult> {
  const width = options.width ?? DEFAULT_COLS;
  const charAspect = options.charAspect ?? measureMonoAspect();

  const img = await loadImageElement(source);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) {
    throw new Error('That picture is empty or broken');
  }

  const cols = Math.max(MIN_COLS, Math.min(MAX_COLS, width));
  // Packed row box is shorter than the em, so we need more rows to
  // keep the painted block the same shape as the picture.
  const cellAspect = charAspect / GLYPH_LINE_PACK;
  const rows = Math.max(4, Math.round((srcH / srcW) * cols * cellAspect));

  let samples = sampleLumas(img, cols, rows);
  const mode =
    options.forceMode ?? (isLineArtFromLumas(samples) ? 'line-art' : 'photo');
  if (mode === 'photo') {
    samples = preparePhotoSamples(samples, cols, rows, {
      ...(options.contrast !== undefined ? { contrast: options.contrast } : {}),
    });
  }

  return samplesToAscii(samples, cols, rows, {
    forceMode: mode,
    ...(options.invert !== undefined ? { invert: options.invert } : {}),
  });
}
