import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COLS,
  DRAW_SECONDS,
  FRAME_H,
  FRAME_MAX_W,
  FRAME_MIN_W,
  FRAME_W,
  GLYPH_LINE_PACK,
  MAX_COLS,
  MAX_RESOLVE_DATA_URL_CHARS,
  MAX_SHARE_DATA_URL_CHARS,
  MIN_COLS,
  SHARE_MIN_H,
  coverDrawRect,
  shareFrameSize,
  splashUsesCover,
} from './config.ts';
import { VIDEO_DRAW_SECONDS } from './video.ts';

describe('share frame size', () => {
  it('keeps the preview/video frame 9:16 and 600–800px wide', () => {
    assert.ok(FRAME_W >= FRAME_MIN_W);
    assert.ok(FRAME_W <= FRAME_MAX_W);
    assert.equal(FRAME_MIN_W, 600);
    assert.equal(FRAME_MAX_W, 800);
    assert.equal(FRAME_H / FRAME_W, 16 / 9);
    assert.equal(SHARE_MIN_H, 405);
  });

  it('sizes landscape stills to the photo, not a tall 9:16 box', () => {
    const landscape = shareFrameSize(1920, 1080);
    assert.equal(landscape.w, FRAME_W);
    assert.equal(landscape.h, 405);
    assert.ok(landscape.h < FRAME_H);
  });

  it('keeps a 9:16 portrait as the full share frame', () => {
    const portrait = shareFrameSize(1080, 1920);
    assert.equal(portrait.w, FRAME_W);
    assert.equal(portrait.h, FRAME_H);
  });

  it('cover-crops ultra-wide sources to 16:9 rather than a thin strip', () => {
    const wide = shareFrameSize(3000, 1000);
    assert.equal(wide.w, FRAME_W);
    assert.equal(wide.h, SHARE_MIN_H);
  });

  it('clamps very tall sources to FRAME_H and the width band', () => {
    const tall = shareFrameSize(400, 2000);
    assert.equal(tall.h, FRAME_H);
    assert.ok(tall.w >= FRAME_MIN_W);
    assert.ok(tall.w <= FRAME_MAX_W);
  });

  it('keeps share payloads small enough for the Devvit RPC bridge', () => {
    assert.ok(MAX_SHARE_DATA_URL_CHARS <= 500_000);
    assert.ok(MAX_RESOLVE_DATA_URL_CHARS > MAX_SHARE_DATA_URL_CHARS);
  });

  it('draws letters for the soundtrack minus the end hold', () => {
    assert.equal(DRAW_SECONDS, VIDEO_DRAW_SECONDS);
  });

  it('keeps conversion columns in the readable-letter range', () => {
    assert.ok(DEFAULT_COLS >= 60);
    assert.ok(DEFAULT_COLS <= 100);
    assert.ok(MIN_COLS < DEFAULT_COLS);
    assert.ok(MAX_COLS > DEFAULT_COLS);
    assert.ok(GLYPH_LINE_PACK > 0.7 && GLYPH_LINE_PACK < 1);
  });
});

describe('splashUsesCover', () => {
  it('covers a 9:16 still in a wide TALL feed card', () => {
    assert.equal(splashUsesCover(720, 1280, 640, 512), true);
  });

  it('contains a 16:9 still so landscape photos are not side-cropped', () => {
    assert.equal(splashUsesCover(720, 405, 640, 512), false);
  });
});

describe('coverDrawRect', () => {
  it('fills a taller frame from a landscape source (letterbox gone)', () => {
    const r = coverDrawRect(1920, 1080, 720, 1280);
    assert.ok(r.dw >= 720);
    assert.equal(r.dh, 1280);
    assert.ok(r.dx < 0);
    assert.equal(r.dy, 0);
  });

  it('matches the canvas when aspects are equal', () => {
    const r = coverDrawRect(1920, 1080, 720, 405);
    assert.equal(Math.round(r.dw), 720);
    assert.equal(Math.round(r.dh), 405);
    assert.equal(Math.round(r.dx), 0);
    assert.equal(Math.round(r.dy), 0);
  });
});
