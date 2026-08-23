/**
 * App-wide constants. Client + server import from here so sizes and
 * product copy stay in one place as the app scales.
 */

export const APP_NAME = 'Text Art';
export const APP_TAGLINE = 'Turn a picture into letters. No AI.';

/** ASCII-only overlay (bottom-right). Not stamped on original photos. */
export const WATERMARK_TEXT = 'r/ketchkeys';
export const WATERMARK_URL = 'https://www.reddit.com/r/ketchkeys';

/**
 * Community that receives every conversion (original + text art).
 * App must be installed here so the bot account can submit.
 */
export const COMMUNITY_SUBREDDIT = 'ketchkeys';

/**
 * Preview / video stay 9:16. Posted stills use {@link shareFrameSize}
 * so landscape photos are not letterboxed into a tall black frame.
 * Width stays in Reddit’s 600–800px band.
 */
export const FRAME_MIN_W = 600;
export const FRAME_MAX_W = 800;
export const FRAME_W = 720;
export const FRAME_H = 1280;

/** Shortest posted still (16:9). Wider sources are cover-cropped to this. */
export const SHARE_MIN_H = Math.round((FRAME_W * 9) / 16);

/**
 * Canvas size for a posted still from the source aspect.
 * Width prefers {@link FRAME_W}; height follows the picture and is clamped
 * to [{@link SHARE_MIN_H}, {@link FRAME_H}]. Extreme aspects cover-crop.
 */
export function shareFrameSize(
  contentW: number,
  contentH: number
): { w: number; h: number } {
  const srcW = Math.max(1, contentW);
  const srcH = Math.max(1, contentH);
  const aspect = srcW / srcH;

  let w = FRAME_W;
  let h = Math.round(w / aspect);

  if (h > FRAME_H) {
    h = FRAME_H;
    w = Math.round(h * aspect);
    if (w < FRAME_MIN_W) w = FRAME_MIN_W;
    else if (w > FRAME_MAX_W) w = FRAME_MAX_W;
  } else if (h < SHARE_MIN_H) {
    h = SHARE_MIN_H;
  }

  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Destination rect that cover-crops `src` into `dst` (centered). */
export function coverDrawRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): { dx: number; dy: number; dw: number; dh: number } {
  const sw = Math.max(1, srcW);
  const sh = Math.max(1, srcH);
  const scale = Math.max(dstW / sw, dstH / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  return {
    dx: (dstW - dw) / 2,
    dy: (dstH - dh) / 2,
    dw,
    dh,
  };
}

/**
 * Live preview is smaller so the UI stays responsive during typewriter
 * animation. Posted stills use {@link shareFrameSize} instead of this frame.
 */
export const PREVIEW_W = 540;
export const PREVIEW_H = 960;

/** Fill the feed card when the still is taller/narrower than the iframe. */
export function splashUsesCover(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number
): boolean {
  if (!imgW || !imgH || !boxW || !boxH) return true;
  return imgW / imgH < boxW / boxH;
}

/**
 * Conversion width in character columns. ~80 keeps glyphs large enough
 * to read as letters; 150 packed into 720px is a noisy gray reprint.
 */
export const DEFAULT_COLS = 80;
export const MIN_COLS = 40;
export const MAX_COLS = 120;

/**
 * Row box vs paint size. < 1 packs lines so the em-box gap does not
 * become horizontal scan-lines across the still.
 */
export const GLYPH_LINE_PACK = 0.86;

/** Typewriter draw matches audio/demo.mpeg minus the 2s end hold. */
export const DRAW_SECONDS = 79.891632;

/** Redis keys (prefix allows future multi-app / multi-env namespaces). */
export const REDIS = {
  totalConversions: 'ascii:total_conversions',
  userCount: (username: string) => `ascii:user:${username}:count`,
  userPosts: (username: string) => `ascii:user:${username}:posts`,
  postLastMode: (postId: string) => `ascii:post:${postId}:last_mode`,
  draw: (postId: string) => `ascii:draw:${postId}`,
} as const;

/** How many conversion permalinks we keep per user. */
export const MAX_RECENT_POSTS = 8;

/**
 * Soft ceiling for a single image data URL in one API request.
 * Devvit’s documented body cap is 4 MB, but the webview RPC 502s well
 * below that — keep stills small enough to survive the bridge.
 */
export const MAX_SHARE_DATA_URL_CHARS = 400_000;

/**
 * Server → client ceiling when resolving a picture link. Larger than the
 * share upload cap because Reddit-hosted JPEGs are often 400–900KB.
 */
export const MAX_RESOLVE_DATA_URL_CHARS = 1_600_000;

/** Max bytes when resolving a remote image link for conversion. */
export const MAX_RESOLVE_IMAGE_BYTES = 8_000_000;
