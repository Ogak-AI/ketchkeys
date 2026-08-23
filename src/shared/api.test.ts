import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAW_POST_KIND,
  GALLERY_POST_KIND,
  isDrawPostData,
  isGalleryPostData,
} from './api.ts';

describe('gallery post data', () => {
  it('accepts two https media URLs', () => {
    assert.equal(
      isGalleryPostData({
        kind: GALLERY_POST_KIND,
        originalUrl: 'https://i.redd.it/original.jpg',
        asciiUrl: 'https://i.redd.it/ascii.jpg',
      }),
      true
    );
  });

  it('rejects missing or non-https URLs', () => {
    assert.equal(isGalleryPostData(undefined), false);
    assert.equal(
      isGalleryPostData({
        kind: GALLERY_POST_KIND,
        originalUrl: 'https://i.redd.it/original.jpg',
      }),
      false
    );
    assert.equal(
      isGalleryPostData({
        kind: GALLERY_POST_KIND,
        originalUrl: 'http://example.com/a.jpg',
        asciiUrl: 'https://i.redd.it/ascii.jpg',
      }),
      false
    );
  });
});

describe('draw post data', () => {
  it('accepts a draw card with two https stills', () => {
    assert.equal(
      isDrawPostData({
        kind: DRAW_POST_KIND,
        originalUrl: 'https://i.redd.it/original.jpg',
        asciiUrl: 'https://i.redd.it/ascii.jpg',
      }),
      true
    );
    assert.equal(
      isGalleryPostData({
        kind: DRAW_POST_KIND,
        originalUrl: 'https://i.redd.it/original.jpg',
        asciiUrl: 'https://i.redd.it/ascii.jpg',
      }),
      false
    );
  });

  it('rejects a gallery card as a draw card', () => {
    assert.equal(
      isDrawPostData({
        kind: GALLERY_POST_KIND,
        originalUrl: 'https://i.redd.it/original.jpg',
        asciiUrl: 'https://i.redd.it/ascii.jpg',
      }),
      false
    );
  });
});
