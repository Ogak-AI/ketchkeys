export type AsciiModeApi = 'line-art' | 'photo';

export type RecentAsciiPost = {
  id: string;
  url: string;
  title: string;
  subreddit: string;
  at: number;
  author?: string;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  totalConversions: number;
  userConversions: number;
  postTitle: string;
  recentPosts: RecentAsciiPost[];
  /** Letter rows for a posted draw card (typewriter replay). */
  drawLines?: string[];
};

export type RecordConversionRequest = {
  mode: AsciiModeApi;
  cols: number;
  rows: number;
  /** First ~400 chars of the letter art, for optional audit. */
  preview?: string;
};

export type RecordConversionResponse = {
  type: 'recorded';
  totalConversions: number;
  userConversions: number;
};

/** Resolve a remote image URL to a data URL the client can sample. */
export type ResolveImageRequest = {
  /** https://… direct image URL (png/jpeg/webp/gif). */
  url: string;
};

export type ResolveImageResponse = {
  type: 'resolved';
  /** data:image/…;base64,… ready for canvas sampling */
  imageDataUrl?: string;
  /** Reddit-hosted copy when rehost succeeded */
  mediaUrl?: string;
};

export type ShareImageRequest = {
  /** data:image/jpeg;base64,... or data:image/png;base64,... */
  imageDataUrl: string;
};

export type ShareImageResponse = {
  type: 'shared';
  mediaUrl: string;
  mediaId: string;
};

/**
 * Auto-publish: post original + text art as one swipeable gallery.
 * Prefer already-uploaded Reddit media URLs (client uploads one image at a
 * time). Data URLs are accepted as a fallback.
 */
export type PublishAsciiRequest = {
  originalMediaUrl?: string;
  asciiMediaUrl?: string;
  originalImageDataUrl?: string;
  asciiImageDataUrl?: string;
  mode: AsciiModeApi;
  cols: number;
  rows: number;
};

export type PublishAsciiResponse = {
  type: 'published';
  postId: string;
  postUrl: string;
  subredditName: string;
  authorName?: string;
  title: string;
  /** True when the post is approved and visible in the public feed. */
  public: boolean;
  /**
   * Reddit accepted the submit but has not returned a comments link yet
   * (image posts are created asynchronously).
   */
  pending?: boolean;
  originalMediaUrl: string;
  asciiMediaUrl: string;
  mediaUrl: string;
  mediaId: string;
};

/**
 * Auto-publish the typewriter draw as a custom post that plays in the feed.
 * Reddit’s media plugin does not accept our soundtrack-length MP4, so the
 * posted “video” is the live letter draw plus the soundtrack.
 */
export type PublishVideoRequest = {
  originalMediaUrl?: string;
  asciiMediaUrl?: string;
  originalImageDataUrl?: string;
  asciiImageDataUrl?: string;
  lines: string[];
  mode: AsciiModeApi;
  cols: number;
  rows: number;
};

export type PublishVideoResponse = {
  type: 'published-video';
  postId: string;
  postUrl: string;
  subredditName: string;
  authorName?: string;
  title: string;
  public: boolean;
  pending?: boolean;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};

/** Stored on conversion custom posts so the feed card can swipe both stills. */
export const GALLERY_POST_KIND = 'ascii-gallery';

/** Custom post that plays the typewriter draw with the soundtrack. */
export const DRAW_POST_KIND = 'ascii-draw';

export type GalleryPostData = {
  kind: typeof GALLERY_POST_KIND;
  originalUrl: string;
  asciiUrl: string;
  mode?: string;
  cols?: number;
  rows?: number;
};

export type DrawPostData = {
  kind: typeof DRAW_POST_KIND;
  originalUrl: string;
  asciiUrl: string;
  mode?: string;
  cols?: number;
  rows?: number;
};

function isHttpsPair(d: Record<string, unknown>): boolean {
  return (
    typeof d.originalUrl === 'string' &&
    d.originalUrl.startsWith('https://') &&
    typeof d.asciiUrl === 'string' &&
    d.asciiUrl.startsWith('https://')
  );
}

export function isGalleryPostData(data: unknown): data is GalleryPostData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.kind === GALLERY_POST_KIND && isHttpsPair(d);
}

export function isDrawPostData(data: unknown): data is DrawPostData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.kind === DRAW_POST_KIND && isHttpsPair(d);
}
