/**
 * Pure pixel → ASCII mapping (no AI).
 * Shared conceptually between client conversion and display helpers.
 *
 * Photo output is meant for a dark canvas: bright parts of the picture
 * become dense glyphs, dark parts stay empty — so the ASCII reads like
 * the original, not a negative.
 */

/**
 * Sparse → dense (dark canvas: space = black, @ = brightest).
 * Short ramp so neighbouring midtones stay the same letter instead of
 * turning a face into mixed-shape noise.
 */
export const ASCII_CHARS_PHOTO = ' .,:;+=*?%#@';

/** Sparse → dense; line-art inverts luma so ink becomes glyphs. */
export const ASCII_CHARS_LINE = ' .:-=+*#@';

/** > 1 keeps high-key midtones (skin, walls) from all becoming dense. */
export const PHOTO_LUMA_GAMMA = 1.15;

/** Contrast around mid-gray after histogram stretch. */
export const PHOTO_CONTRAST = 1.45;

/** Unsharp amount on the luma grid (faces / hair edges). */
export const PHOTO_SHARPEN = 0.55;

/** Inclusive percentiles used to stretch a photo onto 0–255. */
export const PHOTO_STRETCH_LOW = 0.02;
export const PHOTO_STRETCH_HIGH = 0.98;

export type AsciiMode = 'line-art' | 'photo';

export type AsciiResult = {
  lines: string[];
  text: string;
  mode: AsciiMode;
  cols: number;
  rows: number;
};

/** Luma from sRGB channel values 0–255. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isLineArtFromLumas(values: Uint8Array | number[]): boolean {
  const n = values.length;
  if (n === 0) return false;
  let whiteish = 0;
  let darkish = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (v >= 235) whiteish++;
    else if (v <= 50) darkish++;
  }
  const mid = n - whiteish - darkish;
  // Photos with a bright backdrop still have lots of midtones (skin, sky).
  // Real ink-on-paper is bimodal: paper + strokes, almost no gray.
  return whiteish / n > 0.72 && darkish / n > 0.03 && mid / n < 0.18;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Contrast around mid-gray. factor 1 = identity. */
export function applyContrast(value: number, factor: number): number {
  return clampByte(((value / 255 - 0.5) * factor + 0.5) * 255);
}

/** Inclusive luma bounds at the given percentiles (0–1). */
export function percentileBounds(
  samples: Uint8Array | number[],
  low = 0.02,
  high = 0.98
): { min: number; max: number } {
  const hist = new Uint32Array(256);
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const bin = clampByte(samples[i] ?? 0);
    hist[bin] = (hist[bin] ?? 0) + 1;
  }
  const loCount = Math.floor(n * low);
  const hiCount = Math.ceil(n * high);
  let seen = 0;
  let min = 0;
  let max = 255;
  for (let v = 0; v < 256; v++) {
    seen += hist[v]!;
    if (seen > loCount) {
      min = v;
      break;
    }
  }
  seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v]!;
    if (seen >= hiCount) {
      max = v;
      break;
    }
  }
  return { min, max };
}

/** Stretch luma so the used range fills 0–255 (keeps flat images flat). */
export function stretchSamples(
  samples: Uint8Array,
  min: number,
  max: number
): Uint8Array {
  if (max <= min + 4) return samples;
  const out = new Uint8Array(samples.length);
  const scale = 255 / (max - min);
  for (let i = 0; i < samples.length; i++) {
    out[i] = clampByte((samples[i]! - min) * scale);
  }
  return out;
}

/**
 * Always stretch the used luma range, then contrast + sharpen.
 * High-key portraits (bright room, pale clothes) otherwise collapse
 * into one mid-density letter.
 */
export function preparePhotoSamples(
  samples: Uint8Array,
  cols: number,
  rows: number,
  options?: { contrast?: number; sharpen?: number }
): Uint8Array {
  const { min, max } = percentileBounds(
    samples,
    PHOTO_STRETCH_LOW,
    PHOTO_STRETCH_HIGH
  );
  let out = stretchSamples(samples, min, max);
  const contrast = options?.contrast ?? PHOTO_CONTRAST;
  if (contrast !== 1) {
    const next = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) {
      next[i] = applyContrast(out[i]!, contrast);
    }
    out = next;
  }
  return sharpenSamples(out, cols, rows, options?.sharpen ?? PHOTO_SHARPEN);
}

/** Unsharp-mask on a row-major luma grid. */
export function sharpenSamples(
  samples: Uint8Array,
  cols: number,
  rows: number,
  amount = 0.55
): Uint8Array {
  if (amount <= 0 || cols < 3 || rows < 3) return samples;
  const out = new Uint8Array(samples.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const c = samples[i]!;
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
        out[i] = c;
        continue;
      }
      const blur =
        (samples[i - cols - 1]! +
          samples[i - cols]! +
          samples[i - cols + 1]! +
          samples[i - 1]! +
          c +
          samples[i + 1]! +
          samples[i + cols - 1]! +
          samples[i + cols]! +
          samples[i + cols + 1]!) /
        9;
      out[i] = clampByte(c + amount * (c - blur));
    }
  }
  return out;
}

/** Map 0–255 luma to a charset index. Gamma < 1 lifts midtones. */
export function lumaToCharIndex(
  value: number,
  lastIndex: number,
  gamma = PHOTO_LUMA_GAMMA
): number {
  let t = value / 255;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const g = gamma === 1 ? t : Math.pow(t, gamma);
  return Math.min(lastIndex, Math.max(0, Math.round(g * lastIndex)));
}

/**
 * Map a grayscale sample grid to ASCII lines.
 * samples: row-major luma 0–255, length = cols * rows
 */
export function samplesToAscii(
  samples: Uint8Array | number[],
  cols: number,
  rows: number,
  options?: {
    forceMode?: AsciiMode;
    invert?: boolean;
    chars?: string;
    dither?: boolean;
    gamma?: number;
  }
): AsciiResult {
  const mode =
    options?.forceMode ??
    (isLineArtFromLumas(samples) ? 'line-art' : 'photo');
  const chars =
    options?.chars ??
    (mode === 'line-art' ? ASCII_CHARS_LINE : ASCII_CHARS_PHOTO);
  const invert = options?.invert ?? false;
  // High-res photo ramps already have enough steps; dither adds grain.
  const dither = options?.dither ?? false;
  const gamma = options?.gamma ?? (mode === 'photo' ? PHOTO_LUMA_GAMMA : 1);
  const n = chars.length - 1;
  const lines: string[] = [];

  const buf = new Float32Array(cols * rows);
  for (let i = 0; i < buf.length; i++) {
    let v = samples[i] ?? 255;
    // Photo: bright pixel → dense glyph. Line art: ink (dark) → glyph.
    if (mode === 'line-art') v = 255 - v;
    if (invert) v = 255 - v;
    buf[i] = v;
  }

  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let v = buf[i]!;
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      const idx = lumaToCharIndex(v, n, gamma);
      line += chars[idx];

      if (dither) {
        const quantized = (idx / n) * 255;
        const err = v - quantized;
        const add = (index: number, weight: number) => {
          buf[index] = (buf[index] ?? 0) + err * weight;
        };
        if (x + 1 < cols) add(i + 1, 7 / 16);
        if (y + 1 < rows) {
          if (x > 0) add(i + cols - 1, 3 / 16);
          add(i + cols, 5 / 16);
          if (x + 1 < cols) add(i + cols + 1, 1 / 16);
        }
      }
    }
    lines.push(line);
  }

  return {
    lines,
    text: lines.join('\n'),
    mode,
    cols,
    rows: lines.length,
  };
}

function densityRank(ch: string): number {
  const photo = ASCII_CHARS_PHOTO.indexOf(ch);
  if (photo >= 0) return photo;
  const line = ASCII_CHARS_LINE.indexOf(ch);
  if (line >= 0) return line;
  return 5;
}

/** Build draw order (ink cells only) for typewriter animation. */
export function buildDrawOrder(
  lines: string[],
  style: 'typewriter' | 'ink' = 'typewriter'
): Array<{ r: number; c: number; ch: string }> {
  const order: Array<{ r: number; c: number; ch: string; dens: number }> = [];

  for (let r = 0; r < lines.length; r++) {
    const line = lines[r]!;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]!;
      if (ch === ' ') continue;
      order.push({ r, c, ch, dens: densityRank(ch) });
    }
  }

  if (style === 'ink') {
    order.sort((a, b) => a.dens - b.dens || a.r - b.r || a.c - b.c);
  }

  return order.map(({ r, c, ch }) => ({ r, c, ch }));
}
