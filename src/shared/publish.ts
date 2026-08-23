/** Helpers for conversion auto-publish (client + server). */

export function isAsyncMediaAccept(error: unknown): boolean {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return text.includes('being created asynchronously');
}

/** Native Reddit comments permalink, e.g. /r/sub/comments/abc123. */
export function isCommentsPostUrl(url: string | undefined): boolean {
  return Boolean(url && /\/comments\/[a-z0-9]+/i.test(url));
}

export function communityNewUrl(subredditName: string): string {
  return `https://www.reddit.com/r/${subredditName}/new/`;
}

/** Devvit gateway dropped the app server (timeout, crash, or oversized body). */
export function isDevvitGatewayError(status: number, text: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  return /failed to call devvit|Bad Gateway|code = Unavailable/i.test(text);
}

export function publishErrorMessage(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : String(error);
  if (isDevvitGatewayError(0, text)) {
    return 'Reddit is busy. Please try again in a moment.';
  }
  return text.trim() || fallback;
}

export function isAsciiCommunityTitle(title: string | undefined): boolean {
  return Boolean(
    title?.startsWith('Picture and text art by') ||
      title?.startsWith('Text art video by') ||
      title?.startsWith('Original + ASCII by')
  );
}

function postTitleWho(username: string): string {
  return username && username !== 'anonymous' ? `u/${username}` : 'someone';
}

function postTitleKind(mode: string): string {
  return mode === 'line-art' ? 'drawing' : 'photo';
}

function clipRedditTitle(base: string): string {
  return base.length <= 300 ? base : `${base.slice(0, 297)}…`;
}

/** Reddit title max is 300; keep a safe headroom for unicode. */
export function asciiArtPostTitle(
  username: string,
  mode: string,
  cols: number,
  rows: number
): string {
  const tag = Date.now().toString(36).slice(-4);
  return clipRedditTitle(
    `Picture and text art by ${postTitleWho(username)} · ${postTitleKind(mode)} · ${cols} by ${rows} · ${tag}`
  );
}

export function videoArtPostTitle(
  username: string,
  mode: string,
  cols: number,
  rows: number
): string {
  const tag = Date.now().toString(36).slice(-4);
  return clipRedditTitle(
    `Text art video by ${postTitleWho(username)} · ${postTitleKind(mode)} · ${cols} by ${rows} · ${tag}`
  );
}
