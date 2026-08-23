import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  asciiArtPostTitle,
  communityNewUrl,
  isAsciiCommunityTitle,
  isAsyncMediaAccept,
  isCommentsPostUrl,
  isDevvitGatewayError,
  publishErrorMessage,
  videoArtPostTitle,
} from './publish.ts';

describe('publish helpers', () => {
  it('detects Devvit async image/video accept errors', () => {
    assert.equal(
      isAsyncMediaAccept(
        new Error(
          'Post of video type with https://i.redd.it/x is being created asynchronously and should be updated in the subreddit soon.'
        )
      ),
      true
    );
    assert.equal(isAsyncMediaAccept(new Error('FORBIDDEN')), false);
    assert.equal(isAsyncMediaAccept('nope'), false);
    assert.equal(isAsyncMediaAccept(undefined), false);
  });

  it('accepts comments permalinks and rejects /new', () => {
    assert.equal(
      isCommentsPostUrl('https://www.reddit.com/r/ketchkeys/comments/abc123'),
      true
    );
    assert.equal(
      isCommentsPostUrl('https://www.reddit.com/r/ketchkeys/new/'),
      false
    );
    assert.equal(isCommentsPostUrl(undefined), false);
  });

  it('builds the community New listing URL', () => {
    assert.equal(
      communityNewUrl('ketchkeys'),
      'https://www.reddit.com/r/ketchkeys/new/'
    );
  });

  it('detects Devvit 502 gateway / RPC unavailable errors', () => {
    assert.equal(isDevvitGatewayError(502, ''), true);
    assert.equal(isDevvitGatewayError(503, ''), true);
    assert.equal(
      isDevvitGatewayError(
        500,
        'failed to call devvit application: rpc error: code = Unavailable desc = unexpected HTTP status code received from server: 502 (Bad Gateway)'
      ),
      true
    );
    assert.equal(isDevvitGatewayError(400, 'Image too large'), false);
  });

  it('rewrites gateway errors for the UI', () => {
    assert.match(
      publishErrorMessage(
        new Error(
          'failed to call devvit application: rpc error: code = Unavailable desc = unexpected HTTP status code received from server: 502 (Bad Gateway); transport: received'
        ),
        'fallback'
      ),
      /Reddit is busy/
    );
    assert.equal(publishErrorMessage(new Error('Nope'), 'fallback'), 'Nope');
  });

  it('recognizes picture and video community titles', () => {
    assert.equal(
      isAsciiCommunityTitle('Picture and text art by u/sam · photo · 100 by 80 · abcd'),
      true
    );
    assert.equal(
      isAsciiCommunityTitle('Text art video by u/sam · drawing · 80 by 60 · efgh'),
      true
    );
    assert.equal(isAsciiCommunityTitle('Random selfie'), false);
    assert.equal(isAsciiCommunityTitle(undefined), false);
  });

  it('builds distinct picture and video titles', () => {
    const picture = asciiArtPostTitle('sam', 'photo', 100, 80);
    const video = videoArtPostTitle('sam', 'photo', 100, 80);
    assert.match(picture, /^Picture and text art by u\/sam/);
    assert.match(video, /^Text art video by u\/sam/);
    assert.notEqual(picture, video);
    assert.ok(picture.length <= 300);
    assert.ok(video.length <= 300);
  });
});
