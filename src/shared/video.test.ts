import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_DURATION_SECONDS,
  VIDEO_DRAW_SECONDS,
  VIDEO_FPS,
  VIDEO_HOLD_SECONDS,
  VIDEO_MIN_SECONDS,
  revealedForVideoFrame,
  videoDurationSeconds,
  videoTotalFrames,
} from './video.ts';

describe('draw video timing', () => {
  it('matches the soundtrack and stays longer than 62 seconds', () => {
    const seconds = videoDurationSeconds();
    assert.ok(seconds > 62);
    assert.ok(seconds >= VIDEO_MIN_SECONDS);
    assert.ok(Math.abs(VIDEO_DRAW_SECONDS + VIDEO_HOLD_SECONDS - AUDIO_DURATION_SECONDS) < 0.001);
    assert.ok(seconds >= AUDIO_DURATION_SECONDS);
    assert.ok(seconds < AUDIO_DURATION_SECONDS + 1);
    assert.equal(
      seconds,
      videoTotalFrames(VIDEO_FPS, VIDEO_DRAW_SECONDS, VIDEO_HOLD_SECONDS) /
        VIDEO_FPS
    );
  });

  it('reveals all glyphs by the last draw frame and holds them', () => {
    const glyphs = 1000;
    const drawFrames = Math.ceil(VIDEO_FPS * VIDEO_DRAW_SECONDS);
    assert.equal(revealedForVideoFrame(0, glyphs, drawFrames), 0);
    assert.equal(revealedForVideoFrame(drawFrames - 1, glyphs, drawFrames), glyphs);
    assert.equal(revealedForVideoFrame(drawFrames + 5, glyphs, drawFrames), glyphs);
  });
});
