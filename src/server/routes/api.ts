import { Hono } from 'hono';
import { context, media, redis, reddit } from '@devvit/web/server';
import type {
  ErrorResponse,
  InitResponse,
  PublishAsciiRequest,
  PublishAsciiResponse,
  PublishVideoRequest,
  PublishVideoResponse,
  RecentAsciiPost,
  RecordConversionRequest,
  RecordConversionResponse,
  ResolveImageRequest,
  ResolveImageResponse,
  ShareImageRequest,
  ShareImageResponse,
} from '../../shared/api';
import {
  APP_NAME,
  COMMUNITY_SUBREDDIT,
  MAX_RECENT_POSTS,
  MAX_RESOLVE_DATA_URL_CHARS,
  MAX_RESOLVE_IMAGE_BYTES,
  MAX_SHARE_DATA_URL_CHARS,
  REDIS,
} from '../../shared/config';
import { isCommentsPostUrl } from '../../shared/publish';
import {
  asciiArtPostTitle,
  submitAsciiDrawPost,
  submitAsciiImagePost,
  videoArtPostTitle,
} from '../core/post';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true, app: 'ascii-draw' }));

function parseRecentPosts(raw: string | null | undefined): RecentAsciiPost[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentAsciiPost => {
      if (!item || typeof item !== 'object') return false;
      const p = item as Partial<RecentAsciiPost>;
      return (
        typeof p.id === 'string' &&
        typeof p.url === 'string' &&
        p.url.includes('/comments/') &&
        typeof p.title === 'string' &&
        typeof p.subreddit === 'string' &&
        typeof p.at === 'number'
      );
    });
  } catch {
    return [];
  }
}

async function loadUserPosts(username: string): Promise<RecentAsciiPost[]> {
  if (!username || username === 'anonymous') return [];
  const raw = await redis.get(REDIS.userPosts(username));
  return parseRecentPosts(raw);
}

async function rememberUserPost(
  username: string,
  post: RecentAsciiPost
): Promise<RecentAsciiPost[]> {
  if (!username || username === 'anonymous') return [post];
  const existing = await loadUserPosts(username);
  const next = [post, ...existing.filter((p) => p.id !== post.id)].slice(
    0,
    MAX_RECENT_POSTS
  );
  await redis.set(REDIS.userPosts(username), JSON.stringify(next));
  return next;
}

const MAX_DRAW_LINES = 400;
const MAX_DRAW_LINE_CHARS = 220;

function parseDrawLines(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_DRAW_LINES) {
    return null;
  }
  const lines: string[] = [];
  for (const row of raw) {
    if (typeof row !== 'string' || row.length > MAX_DRAW_LINE_CHARS) return null;
    lines.push(row);
  }
  return lines;
}

function parseStoredDrawLines(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { lines?: unknown };
    return parseDrawLines(parsed.lines);
  } catch {
    return null;
  }
}

function drawRedisKeys(postId: string): string[] {
  const bare = postId.startsWith('t3_') ? postId.slice(3) : postId;
  return [REDIS.draw(bare), REDIS.draw(`t3_${bare}`)];
}

async function loadDrawLines(postId: string): Promise<string[] | null> {
  for (const key of drawRedisKeys(postId)) {
    const lines = parseStoredDrawLines(await redis.get(key));
    if (lines) return lines;
  }
  return null;
}

async function saveDrawLines(postId: string, lines: string[]): Promise<void> {
  const payload = JSON.stringify({ lines });
  await Promise.all(drawRedisKeys(postId).map((key) => redis.set(key, payload)));
}

function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Could not load the app. Please try again.' },
      400
    );
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const [totalRaw, userRaw, recentPosts, drawLines] = await Promise.all([
      redis.get(REDIS.totalConversions),
      username !== 'anonymous'
        ? redis.get(REDIS.userCount(username))
        : Promise.resolve(null),
      loadUserPosts(username),
      loadDrawLines(postId),
    ]);

    return c.json<InitResponse>({
      type: 'init',
      postId,
      username,
      totalConversions: parseCount(totalRaw),
      userConversions: parseCount(userRaw),
      postTitle: APP_NAME,
      recentPosts,
      ...(drawLines ? { drawLines } : {}),
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    const message =
      error instanceof Error
        ? error.message
        : 'Could not load the app. Please try again.';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/conversion', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Could not save your count' },
      400
    );
  }

  try {
    const body = await c.req.json<RecordConversionRequest>().catch(() => null);
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';

    const total = await redis.incrBy(REDIS.totalConversions, 1);
    let userConversions = 0;
    if (username !== 'anonymous') {
      userConversions = await redis.incrBy(REDIS.userCount(username), 1);
    }

    if (body?.mode === 'line-art' || body?.mode === 'photo') {
      await redis.set(REDIS.postLastMode(postId), body.mode);
    }

    return c.json<RecordConversionResponse>({
      type: 'recorded',
      totalConversions: total,
      userConversions,
    });
  } catch (error) {
    console.error('Record conversion error:', error);
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Could not save your count' },
      400
    );
  }
});

function validateRedditMediaUrl(
  raw: unknown
): { ok: true; url: string } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, message: 'A picture is needed to post' };
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith('https://')) {
    return { ok: false, message: 'The picture link must start with https://' };
  }
  return { ok: true, url: trimmed };
}

function validateImageDataUrl(
  imageDataUrl: unknown
): { ok: true; imageDataUrl: string } | { ok: false; message: string } {
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return { ok: false, message: 'A picture is needed' };
  }
  if (!imageDataUrl.startsWith('data:image/')) {
    return { ok: false, message: 'Please send a picture' };
  }
  if (imageDataUrl.length > MAX_SHARE_DATA_URL_CHARS) {
    return {
      ok: false,
      message: 'This picture is too big. Use less detail, or pick a smaller picture.',
    };
  }
  return { ok: true, imageDataUrl };
}

function parseRemoteImageUrl(
  raw: unknown
): { ok: true; url: string } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, message: 'A picture link is needed' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: 'A picture link is needed' };
  }
  // Client may paste a data URL; resolve endpoint is for remote links only.
  if (trimmed.startsWith('data:image/')) {
    return {
      ok: false,
      message: 'Paste a picture link that starts with https://. Or use From device.',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: 'That is not a valid picture link' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, message: 'Please use a link that starts with http:// or https://' };
  }
  // Prefer https for media rehost.
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }
  return { ok: true, url: parsed.toString() };
}

function mediaTypeFromUrl(url: string): 'image' | 'gif' {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.gif')) return 'gif';
  } catch {
    /* ignore */
  }
  return 'image';
}

function mimeFromContentType(contentType: string | null, fallbackUrl: string): string {
  const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.startsWith('image/')) return base;
  try {
    const path = new URL(fallbackUrl).pathname.toLowerCase();
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.gif')) return 'image/gif';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  } catch {
    /* ignore */
  }
  return 'image/jpeg';
}

function bufferToDataUrl(buffer: ArrayBuffer, mime: string): string {
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:${mime};base64,${base64}`;
}

/**
 * Rehost a remote image URL via Reddit media, then return a data URL
 * the client can sample (avoids CSP + canvas CORS on external hosts).
 */
api.post('/resolve-image', async (c) => {
  try {
    const body = await c.req.json<ResolveImageRequest>().catch(() => null);
    const checked = parseRemoteImageUrl(body?.url);
    if (!checked.ok) {
      return c.json<ErrorResponse>(
        { status: 'error', message: checked.message },
        400
      );
    }

    const kind = mediaTypeFromUrl(checked.url);
    const uploaded = await media.upload({
      url: checked.url,
      type: kind,
    });

    // Download the Reddit-hosted copy so the client gets untainted pixels.
    const res = await fetch(uploaded.mediaUrl);
    if (!res.ok) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'Could not open that picture',
        },
        400
      );
    }

    const contentType = res.headers.get('content-type');
    const mime = mimeFromContentType(contentType, uploaded.mediaUrl);
    if (!mime.startsWith('image/')) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'That link is not a picture' },
        400
      );
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'That picture is empty' },
        400
      );
    }
    if (buffer.byteLength > MAX_RESOLVE_IMAGE_BYTES) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'This picture is too big. Please pick a smaller one.',
        },
        400
      );
    }

    const imageDataUrl = bufferToDataUrl(buffer, mime);
    if (imageDataUrl.length <= MAX_RESOLVE_DATA_URL_CHARS) {
      return c.json<ResolveImageResponse>({
        type: 'resolved',
        imageDataUrl,
        mediaUrl: uploaded.mediaUrl,
      });
    }

    // Too big for the webview body — client can try the Reddit-hosted URL.
    return c.json<ResolveImageResponse>({
      type: 'resolved',
      mediaUrl: uploaded.mediaUrl,
    });
  } catch (error) {
    console.error('Resolve image error:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'We could not open that picture link.';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

/**
 * Upload a canvas still (data URL) to Reddit media CDN.
 */
api.post('/share-image', async (c) => {
  try {
    const body = await c.req.json<ShareImageRequest>().catch(() => null);
    const checked = validateImageDataUrl(body?.imageDataUrl);
    if (!checked.ok) {
      return c.json<ErrorResponse>(
        { status: 'error', message: checked.message },
        400
      );
    }

    const uploaded = await media.upload({
      url: checked.imageDataUrl,
      type: 'image',
    });

    return c.json<ShareImageResponse>({
      type: 'shared',
      mediaUrl: uploaded.mediaUrl,
      mediaId: uploaded.mediaId,
    });
  } catch (error) {
    console.error('Share image error:', error);
    const message =
      error instanceof Error ? error.message : 'Could not send the picture';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

/**
 * Auto-post original + text art as the signed-in user.
 */
async function resolvePublishAsset(
  label: string,
  mediaUrl: unknown,
  imageDataUrl: unknown
): Promise<
  | { ok: true; mediaUrl: string; mediaId: string }
  | { ok: false; message: string }
> {
  const hosted = validateRedditMediaUrl(mediaUrl);
  if (hosted.ok) {
    return { ok: true, mediaUrl: hosted.url, mediaId: '' };
  }

  const data = validateImageDataUrl(imageDataUrl);
  if (!data.ok) {
    return { ok: false, message: `${label}: ${data.message}` };
  }

  try {
    const uploaded = await media.upload({
      url: data.imageDataUrl,
      type: 'image',
    });
    return {
      ok: true,
      mediaUrl: uploaded.mediaUrl,
      mediaId: uploaded.mediaId,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'could not send';
    return { ok: false, message: `${label}: ${detail}` };
  }
}

api.post('/publish-ascii', async (c) => {
  try {
    const body = await c.req.json<PublishAsciiRequest>().catch(() => null);
    if (!body) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'This picture is too big. Please pick a smaller one.',
        },
        400
      );
    }

    const originalAsset = await resolvePublishAsset(
      'Your picture',
      body.originalMediaUrl,
      body.originalImageDataUrl
    );
    if (!originalAsset.ok) {
      return c.json<ErrorResponse>(
        { status: 'error', message: originalAsset.message },
        400
      );
    }

    const asciiAsset = await resolvePublishAsset(
      'Text art',
      body.asciiMediaUrl,
      body.asciiImageDataUrl
    );
    if (!asciiAsset.ok) {
      return c.json<ErrorResponse>(
        { status: 'error', message: asciiAsset.message },
        400
      );
    }

    const mode = body.mode === 'line-art' || body.mode === 'photo' ? body.mode : 'photo';
    const cols = typeof body.cols === 'number' && body.cols > 0 ? body.cols : 0;
    const rows = typeof body.rows === 'number' && body.rows > 0 ? body.rows : 0;

    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const title = asciiArtPostTitle(username, mode, cols, rows);

    const post = await submitAsciiImagePost({
      mediaUrls: [originalAsset.mediaUrl, asciiAsset.mediaUrl],
      title,
      subredditName: COMMUNITY_SUBREDDIT,
      mode,
      cols,
      rows,
    });

    const pending = Boolean(post.pending) || !isCommentsPostUrl(post.postUrl);
    if (!pending && !post.id) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: `Posted. We do not have the link yet. Open r/${COMMUNITY_SUBREDDIT}/new`,
        },
        400
      );
    }

    let authorName = post.authorName;
    if (!authorName) {
      try {
        const appUser = await reddit.getAppUser();
        authorName = appUser?.username;
      } catch {
        /* optional */
      }
    }

    if (!pending) {
      await rememberUserPost(username, {
        id: post.id,
        url: post.postUrl,
        title,
        subreddit: post.subredditName || COMMUNITY_SUBREDDIT,
        at: Date.now(),
        ...(authorName ? { author: authorName } : {}),
      });
    }

    return c.json<PublishAsciiResponse>({
      type: 'published',
      postId: post.id || `pending:${Date.now().toString(36)}`,
      postUrl: post.postUrl,
      subredditName: post.subredditName || COMMUNITY_SUBREDDIT,
      public: post.public,
      title,
      ...(pending ? { pending: true } : {}),
      ...(authorName ? { authorName } : {}),
      originalMediaUrl: originalAsset.mediaUrl,
      asciiMediaUrl: asciiAsset.mediaUrl,
      mediaUrl: originalAsset.mediaUrl,
      mediaId: originalAsset.mediaId || asciiAsset.mediaId,
    });
  } catch (error) {
    console.error('Publish text-art error:', error);
    const message =
      error instanceof Error
        ? error.message
        : `Could not post to r/${COMMUNITY_SUBREDDIT}`;
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/publish-video', async (c) => {
  try {
    const body = await c.req.json<PublishVideoRequest>().catch(() => null);
    if (!body) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'The video is missing. Please try again.' },
        400
      );
    }

    const lines = parseDrawLines(body.lines);
    if (!lines) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'The letters for the video are missing.' },
        400
      );
    }

    const originalAsset = await resolvePublishAsset(
      'Your picture',
      body.originalMediaUrl,
      body.originalImageDataUrl
    );
    if (!originalAsset.ok) {
      return c.json<ErrorResponse>(
        { status: 'error', message: originalAsset.message },
        400
      );
    }

    const asciiAsset = await resolvePublishAsset(
      'Text art',
      body.asciiMediaUrl,
      body.asciiImageDataUrl
    );
    if (!asciiAsset.ok) {
      return c.json<ErrorResponse>(
        { status: 'error', message: asciiAsset.message },
        400
      );
    }

    const mode = body.mode === 'line-art' || body.mode === 'photo' ? body.mode : 'photo';
    const cols = typeof body.cols === 'number' && body.cols > 0 ? body.cols : 0;
    const rows = typeof body.rows === 'number' && body.rows > 0 ? body.rows : 0;
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const title = videoArtPostTitle(username, mode, cols, rows);

    const post = await submitAsciiDrawPost({
      originalUrl: originalAsset.mediaUrl,
      asciiUrl: asciiAsset.mediaUrl,
      title,
      mode,
      cols,
      rows,
    });

    const pending = Boolean(post.pending) || !isCommentsPostUrl(post.postUrl);
    if (post.id) {
      await saveDrawLines(post.id, lines);
    }

    let authorName = post.authorName;
    if (!authorName) {
      try {
        const appUser = await reddit.getAppUser();
        authorName = appUser?.username;
      } catch {
        /* optional */
      }
    }

    if (!pending) {
      await rememberUserPost(username, {
        id: post.id,
        url: post.postUrl,
        title,
        subreddit: post.subredditName || COMMUNITY_SUBREDDIT,
        at: Date.now(),
        ...(authorName ? { author: authorName } : {}),
      });
    }

    return c.json<PublishVideoResponse>({
      type: 'published-video',
      postId: post.id || `pending:${Date.now().toString(36)}`,
      postUrl: post.postUrl,
      subredditName: post.subredditName || COMMUNITY_SUBREDDIT,
      public: post.public,
      title,
      ...(pending ? { pending: true } : {}),
      ...(authorName ? { authorName } : {}),
    });
  } catch (error) {
    console.error('Publish video error:', error);
    const message =
      error instanceof Error
        ? error.message
        : `Could not post the video to r/${COMMUNITY_SUBREDDIT}`;
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});
