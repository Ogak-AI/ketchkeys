import { reddit } from '@devvit/web/server';
import type { Post } from '@devvit/web/server';
import {
  DRAW_POST_KIND,
  GALLERY_POST_KIND,
  type DrawPostData,
  type GalleryPostData,
} from '../../shared/api';
import { APP_NAME, APP_TAGLINE, COMMUNITY_SUBREDDIT } from '../../shared/config';
import {
  asciiArtPostTitle,
  communityNewUrl,
  isAsciiCommunityTitle,
  isAsyncMediaAccept,
  videoArtPostTitle,
} from '../../shared/publish';

export const APP_POST_TITLE = `${APP_NAME} — ${APP_TAGLINE}`;

export const createPost = async (title?: string) => {
  return await reddit.submitCustomPost({
    title: title?.trim() || APP_POST_TITLE,
  });
};

/** Build a comments URL that works with bare ids or t3_ fullnames. */
export function postCommentsUrl(
  subredditName: string | undefined,
  postId: string
): string {
  const id = postId.startsWith('t3_') ? postId.slice(3) : postId;
  const sub = subredditName || 'reddit';
  return `https://www.reddit.com/r/${sub}/comments/${id}`;
}

export const subredditNewUrl = communityNewUrl;

export function permalinkToUrl(permalink: string | undefined, fallback: string): string {
  if (!permalink) return fallback;
  if (permalink.startsWith('http://') || permalink.startsWith('https://')) {
    return permalink;
  }
  const path = permalink.startsWith('/') ? permalink : `/${permalink}`;
  return `https://www.reddit.com${path}`;
}

function asPostFullname(postId: string): `t3_${string}` {
  return postId.startsWith('t3_')
    ? (postId as `t3_${string}`)
    : (`t3_${postId}` as `t3_${string}`);
}

export type SubmittedAsciiPost = {
  id: string;
  postUrl: string;
  subredditName: string;
  authorName?: string;
  public: boolean;
  /** Submit was accepted; Reddit has not returned a comments link yet. */
  pending?: boolean;
};

export { asciiArtPostTitle, isAsciiCommunityTitle, isAsyncMediaAccept, videoArtPostTitle };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Native image post as the signed-in user — shows in their profile + feed. */
async function submitFeedImage(options: {
  subredditName: string;
  title: string;
  imageUrls: string[];
}) {
  return await reddit.submitPost({
    subredditName: options.subredditName,
    title: options.title,
    kind: 'image',
    imageUrls: options.imageUrls as [string],
    runAs: 'USER',
  });
}

async function submitMediaCustomPost(options: {
  subredditName: string;
  title: string;
  originalUrl: string;
  asciiUrl: string;
  postData: GalleryPostData | DrawPostData;
  fallbackText: string;
}) {
  return await reddit.submitCustomPost({
    subredditName: options.subredditName,
    title: options.title,
    entry: 'default',
    runAs: 'USER',
    userGeneratedContent: {
      text: options.title,
      imageUrls: [options.originalUrl, options.asciiUrl],
    },
    postData: options.postData,
    textFallback: { text: options.fallbackText },
    styles: {
      heightPixels: 512,
      backgroundColor: '#0B0D10FF',
      backgroundColorDark: '#0B0D10FF',
      shareImageUrl: options.asciiUrl,
    },
  });
}

function mediaPostFields(options: {
  originalUrl: string;
  asciiUrl: string;
  mode?: string;
  cols?: number;
  rows?: number;
}) {
  return {
    originalUrl: options.originalUrl,
    asciiUrl: options.asciiUrl,
    ...(options.mode ? { mode: options.mode } : {}),
    ...(typeof options.cols === 'number' ? { cols: options.cols } : {}),
    ...(typeof options.rows === 'number' ? { rows: options.rows } : {}),
  };
}

/** Custom post fallback: swipeable original + text art. */
async function submitGalleryCustomPost(options: {
  subredditName: string;
  title: string;
  originalUrl: string;
  asciiUrl: string;
  mode?: string;
  cols?: number;
  rows?: number;
}) {
  const postData: GalleryPostData = {
    kind: GALLERY_POST_KIND,
    ...mediaPostFields(options),
  };
  return await submitMediaCustomPost({
    ...options,
    postData,
    fallbackText: `Your picture and text art\n\n[Your picture](${options.originalUrl})\n\n[Text art](${options.asciiUrl})`,
  });
}

/** Custom post that plays the typewriter draw with the soundtrack. */
async function submitDrawCustomPost(options: {
  subredditName: string;
  title: string;
  originalUrl: string;
  asciiUrl: string;
  mode?: string;
  cols?: number;
  rows?: number;
}) {
  const postData: DrawPostData = {
    kind: DRAW_POST_KIND,
    ...mediaPostFields(options),
  };
  return await submitMediaCustomPost({
    ...options,
    postData,
    fallbackText: `Watch your picture turn into text art\n\n[Your picture](${options.originalUrl})\n\n[Text art](${options.asciiUrl})`,
  });
}

async function findPostByTitle(
  subredditName: string,
  title: string
): Promise<Post | null> {
  const match = (posts: Post[]) => posts.find((p) => p.title === title) ?? null;

  try {
    const fresh = await reddit
      .getNewPosts({ subredditName, limit: 25, pageSize: 25 })
      .get(25);
    const found = match(fresh);
    if (found) return found;
  } catch (error) {
    console.error('getNewPosts lookup failed:', errorText(error));
  }

  try {
    const queue = await reddit
      .getUnmoderated({ subreddit: subredditName, type: 'post' })
      .get(25);
    const found = match(queue);
    if (found) return found;
  } catch (error) {
    console.error('unmoderated lookup failed:', errorText(error));
  }

  try {
    const queued = await reddit
      .getModQueue({ subreddit: subredditName, type: 'post' })
      .get(25);
    const found = match(queued);
    if (found) return found;
  } catch (error) {
    console.error('modqueue lookup failed:', errorText(error));
  }

  try {
    const spam = await reddit
      .getSpam({ subreddit: subredditName, type: 'post' })
      .get(25);
    const found = match(spam);
    if (found) return found;
  } catch (error) {
    console.error('spam lookup failed:', errorText(error));
  }

  return null;
}

/** Auto-approve so the image post is public (no human approval step). */
export async function makeCommunityPostPublic(postId: string): Promise<{
  public: boolean;
  post: Post;
}> {
  const id = asPostFullname(postId);
  const post = await reddit.getPostById(id);
  try {
    if (post.hidden) await post.unhide();
  } catch (error) {
    console.error('unhide failed:', errorText(error));
  }
  try {
    await post.approve();
  } catch (error) {
    console.error('approve failed:', errorText(error));
  }
  try {
    await post.ignoreReports();
  } catch {
    /* optional */
  }

  let refreshed = post;
  try {
    refreshed = await reddit.getPostById(id);
  } catch {
    /* use original */
  }

  const isPublic = !refreshed.removed && !refreshed.spam && !refreshed.hidden;
  return { public: isPublic, post: refreshed };
}

async function waitForPostByTitle(
  subredditName: string,
  title: string
): Promise<Post | null> {
  // Stay well under the 30s serverless budget; image posts usually appear
  // in a few seconds. Video posts can take longer — those become `pending`.
  for (const delay of [0, 700, 1400]) {
    if (delay) await sleep(delay);
    const found = await findPostByTitle(subredditName, title);
    if (found) return found;
  }
  return null;
}

function pendingAsciiPost(subredditName: string): SubmittedAsciiPost {
  return {
    id: '',
    postUrl: communityNewUrl(subredditName),
    subredditName,
    public: false,
    pending: true,
  };
}

async function finalizePost(
  subredditName: string,
  title: string,
  post: Post | null
): Promise<SubmittedAsciiPost> {
  let resolved = post;
  if (!resolved?.id) {
    resolved = await waitForPostByTitle(subredditName, title);
  }

  if (resolved) {
    let visible = resolved;
    let isPublic = false;
    try {
      const made = await makeCommunityPostPublic(resolved.id);
      visible = made.post;
      isPublic = made.public;
    } catch (error) {
      console.error('make public failed:', errorText(error));
    }
    return {
      id: visible.id,
      postUrl: permalinkToUrl(
        visible.permalink,
        postCommentsUrl(visible.subredditName || subredditName, visible.id)
      ),
      subredditName: visible.subredditName || subredditName,
      authorName: visible.authorName,
      public: isPublic,
    };
  }

  // Native image submits often succeed without an immediate id.
  // Treat that as accepted rather than failing the conversion.
  return pendingAsciiPost(subredditName);
}

/** Post the typewriter draw as a custom feed card the signed-in user. */
export async function submitAsciiDrawPost(options: {
  originalUrl: string;
  asciiUrl: string;
  title: string;
  mode?: string;
  cols?: number;
  rows?: number;
}): Promise<SubmittedAsciiPost> {
  const username = await reddit.getCurrentUsername();
  if (!username) {
    throw new Error('Please log in to Reddit to post.');
  }

  const subredditName = COMMUNITY_SUBREDDIT;
  const post = await submitDrawCustomPost({
    subredditName,
    title: options.title,
    originalUrl: options.originalUrl,
    asciiUrl: options.asciiUrl,
    mode: options.mode,
    cols: options.cols,
    rows: options.rows,
  });
  return await finalizePost(subredditName, options.title, post);
}

/**
 * Auto-post original + text art as the signed-in user (not the app account).
 */
export async function submitAsciiImagePost(options: {
  mediaUrls: string[];
  title: string;
  subredditName?: string;
  mode?: string;
  cols?: number;
  rows?: number;
}): Promise<SubmittedAsciiPost> {
  const username = await reddit.getCurrentUsername();
  if (!username) {
    throw new Error('Please log in to Reddit to post.');
  }

  const subredditName = COMMUNITY_SUBREDDIT;
  const urls = options.mediaUrls.filter(Boolean);
  const originalUrl = urls[0];
  if (!originalUrl) {
    throw new Error('A picture is needed to post.');
  }
  const asciiUrl = urls[1] ?? originalUrl;

  const tryNative = async (imageUrls: string[]) => {
    try {
      const post = await submitFeedImage({
        subredditName,
        title: options.title,
        imageUrls,
      });
      return await finalizePost(subredditName, options.title, post);
    } catch (error) {
      if (isAsyncMediaAccept(error)) {
        return await finalizePost(subredditName, options.title, null);
      }
      throw error;
    }
  };

  // Prefer a native image/gallery post so it appears in New / Images.
  if (asciiUrl !== originalUrl) {
    try {
      return await tryNative([originalUrl, asciiUrl]);
    } catch (error) {
      console.error('Native two-image post failed:', errorText(error));
    }
  }

  try {
    const posted = await tryNative([asciiUrl]);
    if (posted.id && originalUrl !== asciiUrl) {
      try {
        await reddit.submitComment({
          id: asPostFullname(posted.id),
          text: `Original photo:\n\n${originalUrl}`,
          runAs: 'USER',
        });
      } catch (error) {
        console.error('Original comment failed:', errorText(error));
      }
    }
    return posted;
  } catch (error) {
    console.error('Native text-art image post failed:', errorText(error));
  }

  const post = await submitGalleryCustomPost({
    subredditName,
    title: options.title,
    originalUrl,
    asciiUrl,
    mode: options.mode,
    cols: options.cols,
    rows: options.rows,
  });
  return await finalizePost(subredditName, options.title, post);
}
