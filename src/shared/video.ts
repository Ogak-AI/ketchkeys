/**
 * Posted draw-video timing follows audio/demo.mpeg (ffprobe: 81.891632s).
 * The typewriter uses the track minus a short hold of the finished picture.
 * Playback stays above Reddit’s 62s video floor.
 */

/** Length of `audio/demo.mpeg`, measured with ffprobe. */
export const AUDIO_DURATION_SECONDS = 81.891632;

export const VIDEO_MIN_SECONDS = 63;
export const VIDEO_HOLD_SECONDS = 2;
export const VIDEO_DRAW_SECONDS = AUDIO_DURATION_SECONDS - VIDEO_HOLD_SECONDS;
export const VIDEO_FPS = 8;
export const VIDEO_BITRATE = 90_000;
export const AUDIO_BITRATE = 128_000;

export function videoDrawFrames(
  fps = VIDEO_FPS,
  drawSeconds = VIDEO_DRAW_SECONDS
): number {
  return Math.max(1, Math.ceil(fps * drawSeconds));
}

export function videoHoldFrames(
  fps = VIDEO_FPS,
  holdSeconds = VIDEO_HOLD_SECONDS
): number {
  return Math.max(0, Math.ceil(fps * holdSeconds));
}

export function videoTotalFrames(
  fps = VIDEO_FPS,
  drawSeconds = VIDEO_DRAW_SECONDS,
  holdSeconds = VIDEO_HOLD_SECONDS
): number {
  return videoDrawFrames(fps, drawSeconds) + videoHoldFrames(fps, holdSeconds);
}

export function videoDurationSeconds(
  fps = VIDEO_FPS,
  drawSeconds = VIDEO_DRAW_SECONDS,
  holdSeconds = VIDEO_HOLD_SECONDS
): number {
  return videoTotalFrames(fps, drawSeconds, holdSeconds) / fps;
}

export function revealedForVideoFrame(
  frameIndex: number,
  totalGlyphs: number,
  drawFrames = videoDrawFrames()
): number {
  if (totalGlyphs <= 0) return 0;
  if (drawFrames <= 1) return totalGlyphs;
  if (frameIndex >= drawFrames) return totalGlyphs;
  return Math.min(
    totalGlyphs,
    Math.round((frameIndex / (drawFrames - 1)) * totalGlyphs)
  );
}
