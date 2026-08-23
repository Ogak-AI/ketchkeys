import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASCII_CHARS_PHOTO,
  buildDrawOrder,
  isLineArtFromLumas,
  lumaToCharIndex,
  percentileBounds,
  preparePhotoSamples,
  samplesToAscii,
  stretchSamples,
} from './ascii.ts';

describe('ascii engine', () => {
  it('detects line art from mostly white + ink', () => {
    const samples = new Uint8Array(100);
    samples.fill(250);
    for (let i = 0; i < 8; i++) samples[i] = 10;
    assert.equal(isLineArtFromLumas(samples), true);
  });

  it('does not treat a photo histogram as line art', () => {
    const samples = new Uint8Array(100);
    samples.fill(140);
    for (let i = 0; i < 20; i++) samples[i] = 250;
    for (let i = 20; i < 30; i++) samples[i] = 20;
    assert.equal(isLineArtFromLumas(samples), false);
  });

  it('maps bright photo pixels to dense characters on a dark canvas', () => {
    const samples = [0, 255, 0, 255];
    const result = samplesToAscii(samples, 2, 2, {
      forceMode: 'photo',
      dither: false,
    });
    assert.equal(result.lines.length, 2);
    assert.equal(result.cols, 2);
    assert.equal(result.rows, 2);
    assert.equal(result.lines[0]![0], ' ');
    assert.equal(result.lines[0]![1], '@');
    assert.match(result.text, /@/);
  });

  it('maps dark line-art ink to dense characters', () => {
    const samples = [0, 255, 0, 255];
    const result = samplesToAscii(samples, 2, 2, {
      forceMode: 'line-art',
      dither: false,
    });
    assert.equal(result.lines[0]![0], '@');
    assert.equal(result.lines[0]![1], ' ');
  });

  it('keeps blank edge rows so framing matches the source', () => {
    // Photo mode: dark (0) → space, so a dark frame stays as empty rows.
    const samples = [0, 0, 255, 0, 0, 0];
    const result = samplesToAscii(samples, 2, 3, {
      forceMode: 'photo',
      dither: false,
    });
    assert.equal(result.rows, 3);
    assert.equal(result.lines[0]!.trim(), '');
    assert.equal(result.lines[2]!.trim(), '');
    assert.match(result.lines[1]!, /@/);
  });

  it('stretches a narrow luma range across 0–255', () => {
    const samples = new Uint8Array([80, 100, 120]);
    const { min, max } = percentileBounds(samples, 0, 1);
    const out = stretchSamples(samples, min, max);
    assert.equal(out[0], 0);
    assert.equal(out[2], 255);
  });

  it('photo charset goes from space to @ in a short ramp', () => {
    assert.equal(ASCII_CHARS_PHOTO[0], ' ');
    assert.equal(ASCII_CHARS_PHOTO.at(-1), '@');
    assert.ok(ASCII_CHARS_PHOTO.length >= 8);
    assert.ok(ASCII_CHARS_PHOTO.length <= 16);
  });

  it('spreads a high-key portrait across the charset, not one mid band', () => {
    const samples = new Uint8Array(100);
    for (let i = 0; i < 70; i++) samples[i] = 160 + (i % 40);
    for (let i = 70; i < 85; i++) samples[i] = 30;
    for (let i = 85; i < 100; i++) samples[i] = 240;
    const prepared = preparePhotoSamples(samples, 10, 10);
    const result = samplesToAscii(prepared, 10, 10, {
      forceMode: 'photo',
      dither: false,
    });
    const ranks = [...result.text.replace(/\n/g, '')].map((ch) =>
      ASCII_CHARS_PHOTO.indexOf(ch)
    );
    const minR = Math.min(...ranks);
    const maxR = Math.max(...ranks);
    assert.ok(maxR - minR >= 6, `range ${minR}-${maxR}`);
    assert.ok(minR <= 2);
    assert.ok(maxR >= ASCII_CHARS_PHOTO.length - 3);
  });

  it('maps luma to denser characters as the picture gets brighter', () => {
    const last = ASCII_CHARS_PHOTO.length - 1;
    const a = lumaToCharIndex(0, last);
    const b = lumaToCharIndex(80, last);
    const c = lumaToCharIndex(160, last);
    const d = lumaToCharIndex(255, last);
    assert.equal(a, 0);
    assert.equal(d, last);
    assert.ok(a < b && b < c && c < d);
  });

  it('keeps a horizontal fade in left-to-right order', () => {
    const cols = 8;
    const samples = [0, 36, 72, 108, 144, 180, 216, 255];
    const result = samplesToAscii(samples, cols, 1, {
      forceMode: 'photo',
      dither: false,
      gamma: 1,
    });
    const ranks = [...result.lines[0]!].map((ch) =>
      ASCII_CHARS_PHOTO.indexOf(ch)
    );
    for (let i = 1; i < ranks.length; i++) {
      assert.ok(ranks[i]! >= ranks[i - 1]!);
    }
  });

  it('keeps a bright plus shape recognizable', () => {
    const cols = 7;
    const rows = 7;
    const samples = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const on = x === 3 || y === 3;
        samples[y * cols + x] = on ? 255 : 0;
      }
    }
    const result = samplesToAscii(samples, cols, rows, {
      forceMode: 'photo',
      dither: false,
    });
    assert.equal(result.lines[0], '   @   ');
    assert.equal(result.lines[3], '@@@@@@@');
    assert.equal(result.lines[6], '   @   ');
  });

  it('buildDrawOrder skips spaces', () => {
    const order = buildDrawOrder(['@ @', '   ', '##']);
    assert.equal(order.every((c) => c.ch !== ' '), true);
    assert.equal(order.length, 4);
  });
});
