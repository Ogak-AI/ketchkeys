import { useCallback, useEffect, useState } from 'react';
import type {
  InitResponse,
  PublishAsciiResponse,
  PublishVideoResponse,
  RecentAsciiPost,
  RecordConversionResponse,
  ResolveImageResponse,
  ShareImageResponse,
} from '../../shared/api';
import { COMMUNITY_SUBREDDIT } from '../../shared/config';
import { isCommentsPostUrl, isDevvitGatewayError } from '../../shared/publish';

type AppState = {
  username: string | null;
  totalConversions: number;
  userConversions: number;
  postId: string | null;
  recentPosts: RecentAsciiPost[];
  loading: boolean;
  error: string | null;
};

async function readApiError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const err = JSON.parse(text) as { message?: string };
    if (err.message) {
      if (isDevvitGatewayError(0, err.message)) {
        return 'Reddit is busy. Please try again in a moment.';
      }
      return err.message;
    }
  } catch {
    /* HTML / empty body from a gateway limit */
  }
  if (isDevvitGatewayError(res.status, text)) {
    return 'Reddit is busy. Please try again in a moment.';
  }
  if (res.status === 413) {
    return 'This picture is too big. Please pick a smaller one.';
  }
  if (res.status === 429) {
    return 'Reddit is asking us to wait. Please try again in a moment.';
  }
  const snippet = text.replace(/<[^>]+>/g, ' ').trim().slice(0, 160);
  return snippet || `${fallback} (${res.status})`;
}

async function fetchApp(
  input: string,
  init?: RequestInit,
  retries = 1
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (!isDevvitGatewayError(res.status, '') || attempt === retries) {
        return res;
      }
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!isDevvitGatewayError(0, message) || attempt === retries) {
        throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Reddit is busy. Please try again in a moment.');
}

const initial: AppState = {
  username: null,
  totalConversions: 0,
  userConversions: 0,
  postId: null,
  recentPosts: [],
  loading: true,
  error: null,
};

export const useAsciiApp = () => {
  const [state, setState] = useState<AppState>(initial);

  useEffect(() => {
    let alive = true;
    const init = async () => {
      try {
        const res = await fetchApp('/api/init');
        if (!res.ok) throw new Error('Could not load the app. Please try again.');
        const data: InitResponse = await res.json();
        if (data.type !== 'init') throw new Error('Something went wrong. Please try again.');
        if (!alive) return;
        setState({
          username: data.username,
          totalConversions: data.totalConversions,
          userConversions: data.userConversions,
          postId: data.postId,
          recentPosts: data.recentPosts ?? [],
          loading: false,
          error: null,
        });
      } catch (err) {
        console.error('Failed to init', err);
        if (!alive) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: 'Could not load the app. Please try again.',
        }));
      }
    };
    void init();
    return () => {
      alive = false;
    };
  }, []);

  const recordConversion = useCallback(
    async (payload: {
      mode: 'line-art' | 'photo';
      cols: number;
      rows: number;
      preview?: string;
    }) => {
      try {
        const res = await fetchApp('/api/conversion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: RecordConversionResponse = await res.json();
        if (data.type !== 'recorded') throw new Error('Unexpected response');
        setState((prev) => ({
          ...prev,
          totalConversions: data.totalConversions,
          userConversions: data.userConversions,
        }));
        return data;
      } catch (err) {
        console.error('recordConversion failed', err);
        return null;
      }
    },
    []
  );

  const resolveImageUrl = useCallback(async (url: string) => {
    const res = await fetchApp('/api/resolve-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { message?: string }).message ||
          'We could not open that picture link. Please use From device.'
      );
    }
    const data: ResolveImageResponse = await res.json();
    if (data.type !== 'resolved' || (!data.imageDataUrl && !data.mediaUrl)) {
      throw new Error('Something went wrong with that picture link.');
    }
    return data;
  }, []);

  const shareImage = useCallback(async (imageDataUrl: string) => {
    const res = await fetchApp('/api/share-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl }),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, 'Could not send the picture'));
    }
    const data: ShareImageResponse = await res.json();
    if (data.type !== 'shared') {
      throw new Error('Something went wrong sending the picture.');
    }
    return data;
  }, []);

  const publishAscii = useCallback(
    async (
      payload: {
        originalImageDataUrl?: string;
        asciiImageDataUrl?: string;
        originalMediaUrl?: string;
        asciiMediaUrl?: string;
        mode: 'line-art' | 'photo';
        cols: number;
        rows: number;
      },
      onProgress?: (message: string) => void
    ) => {
      let originalUrl = payload.originalMediaUrl;
      let asciiUrl = payload.asciiMediaUrl;
      if (!originalUrl || !asciiUrl) {
        if (!payload.originalImageDataUrl || !payload.asciiImageDataUrl) {
          throw new Error('A picture is needed to post.');
        }
        onProgress?.('Sending your pictures…');
        const original = await shareImage(payload.originalImageDataUrl);
        const ascii = await shareImage(payload.asciiImageDataUrl);
        originalUrl = original.mediaUrl;
        asciiUrl = ascii.mediaUrl;
      }

      onProgress?.(`Posting as you on r/${COMMUNITY_SUBREDDIT}…`);
      const res = await fetchApp('/api/publish-ascii', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalMediaUrl: originalUrl,
          asciiMediaUrl: asciiUrl,
          mode: payload.mode,
          cols: payload.cols,
          rows: payload.rows,
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Could not post'));
      }
      const data: PublishAsciiResponse = await res.json();
      if (data.type !== 'published') {
        throw new Error('Something went wrong while posting.');
      }
      if (!data.pending && isCommentsPostUrl(data.postUrl)) {
        const remembered: RecentAsciiPost = {
          id: data.postId,
          url: data.postUrl,
          title: data.title,
          subreddit: data.subredditName,
          at: Date.now(),
          ...(data.authorName ? { author: data.authorName } : {}),
        };
        setState((prev) => ({
          ...prev,
          recentPosts: [
            remembered,
            ...prev.recentPosts.filter((p) => p.id !== remembered.id),
          ].slice(0, 8),
        }));
      }
      return data;
    },
    [shareImage]
  );

  const publishVideo = useCallback(
    async (
      payload: {
        originalMediaUrl?: string;
        asciiMediaUrl?: string;
        originalImageDataUrl?: string;
        asciiImageDataUrl?: string;
        lines: string[];
        mode: 'line-art' | 'photo';
        cols: number;
        rows: number;
      },
      onProgress?: (message: string) => void
    ) => {
      onProgress?.(`Posting the video as you on r/${COMMUNITY_SUBREDDIT}…`);
      const res = await fetchApp('/api/publish-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(payload.originalMediaUrl
            ? { originalMediaUrl: payload.originalMediaUrl }
            : {}),
          ...(payload.asciiMediaUrl
            ? { asciiMediaUrl: payload.asciiMediaUrl }
            : {}),
          ...(payload.originalImageDataUrl
            ? { originalImageDataUrl: payload.originalImageDataUrl }
            : {}),
          ...(payload.asciiImageDataUrl
            ? { asciiImageDataUrl: payload.asciiImageDataUrl }
            : {}),
          lines: payload.lines,
          mode: payload.mode,
          cols: payload.cols,
          rows: payload.rows,
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Could not post the video'));
      }
      const data: PublishVideoResponse = await res.json();
      if (data.type !== 'published-video') {
        throw new Error('Something went wrong while posting the video.');
      }
      if (!data.pending && isCommentsPostUrl(data.postUrl)) {
        const remembered: RecentAsciiPost = {
          id: data.postId,
          url: data.postUrl,
          title: data.title,
          subreddit: data.subredditName,
          at: Date.now(),
          ...(data.authorName ? { author: data.authorName } : {}),
        };
        setState((prev) => ({
          ...prev,
          recentPosts: [
            remembered,
            ...prev.recentPosts.filter((p) => p.id !== remembered.id),
          ].slice(0, 8),
        }));
      }
      return data;
    },
    []
  );

  return {
    ...state,
    recordConversion,
    resolveImageUrl,
    shareImage,
    publishAscii,
    publishVideo,
  } as const;
};
