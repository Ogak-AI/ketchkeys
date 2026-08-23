import './styles/index.css';

import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo, showToast } from '@devvit/web/client';
import type { AsciiMode, AsciiResult } from '../shared/ascii';
import {
  APP_NAME,
  COMMUNITY_SUBREDDIT,
  DEFAULT_COLS,
  DRAW_SECONDS,
  FRAME_MAX_W,
  FRAME_MIN_W,
  FRAME_W,
  MAX_SHARE_DATA_URL_CHARS,
  PREVIEW_H,
  PREVIEW_W,
  WATERMARK_TEXT,
  WATERMARK_URL,
} from '../shared/config';
import { useAsciiApp } from './hooks/useAsciiApp';
import { imageToAscii } from './lib/imageToAscii';
import {
  renderFinalFrame,
  renderWatermarkedOriginal,
  runDrawAnimation,
} from './lib/drawCanvas';
import {
  recordDrawVideo,
  type DrawVideoResult,
} from './lib/recordDrawVideo';
import { playSoundtrack } from './lib/soundtrack';
import { copyText } from './lib/copyText';
import { saveBlobFile } from './lib/saveFile';
import { isCommentsPostUrl, publishErrorMessage } from '../shared/publish';

const DRAW_THEME = 'dark' as const;

type Stage = 'idle' | 'converting' | 'drawing' | 'done';
type PostStatus = 'idle' | 'posting' | 'posted' | 'failed';

/** Visually hide file input without display:none (breaks .click() in some WebViews). */
const fileInputClass = 'absolute h-px w-px overflow-hidden opacity-0';

function encodeJpeg(canvas: HTMLCanvasElement): string {
  for (const quality of [0.62, 0.5, 0.38, 0.28]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= MAX_SHARE_DATA_URL_CHARS) return dataUrl;
  }
  return canvas.toDataURL('image/jpeg', 0.2);
}

function scaleCanvasToWidth(source: HTMLCanvasElement, width: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round((w * source.height) / Math.max(1, source.width)));
  const scaled = document.createElement('canvas');
  scaled.width = w;
  scaled.height = h;
  const ctx = scaled.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0, w, h);
  return scaled;
}

function canvasToShareDataUrl(canvas: HTMLCanvasElement): string {
  const sized =
    canvas.width < FRAME_MIN_W || canvas.width > FRAME_MAX_W
      ? scaleCanvasToWidth(canvas, FRAME_W)
      : canvas;

  const first = encodeJpeg(sized);
  if (first.length <= MAX_SHARE_DATA_URL_CHARS) return first;

  return encodeJpeg(scaleCanvasToWidth(sized, FRAME_MIN_W));
}

function videoFileName(mime: string): string {
  const ext = /webm/i.test(mime) ? 'webm' : 'mp4';
  return `text-art-${Date.now()}.${ext}`;
}

function saveVideoBlob(video: DrawVideoResult): Promise<void> {
  const mime = video.mime || 'video/mp4';
  return saveBlobFile(video.blob, videoFileName(mime), mime);
}

function isUnsupportedPicture(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type.includes('heic') ||
    type.includes('heif') ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

function modeWords(mode: AsciiMode): string {
  return mode === 'line-art' ? 'drawing' : 'photo';
}

function stageWords(stage: Stage, pct: number): string {
  if (stage === 'converting') return 'working';
  if (stage === 'drawing') return `drawing ${pct}%`;
  if (stage === 'done') return 'done';
  return 'ready';
}

const LAST_POST_KEY = 'ascii-draw:last-post';

type LastPost = {
  url: string;
  subreddit: string;
  author?: string;
  title?: string;
  public: boolean;
  pending?: boolean;
};

function readStoredLastPost(): LastPost | null {
  try {
    const raw = sessionStorage.getItem(LAST_POST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastPost;
    if (!parsed?.url) return null;
    if (!isCommentsPostUrl(parsed.url) && !parsed.pending) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const App = () => {
  const {
    username,
    totalConversions,
    userConversions,
    recentPosts,
    loading,
    error,
    recordConversion,
    resolveImageUrl,
    shareImage,
    publishAscii,
    publishVideo,
  } = useAsciiApp();

  const fileRef = useRef<HTMLInputElement>(null);
  const textDetailsRef = useRef<HTMLDetailsElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const cancelAnim = useRef<(() => void) | null>(null);
  const shareCanvas = useRef<HTMLCanvasElement | null>(null);
  const convertGen = useRef(0);
  const animGen = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const videoResultRef = useRef<DrawVideoResult | null>(null);
  const videoEncodePromise = useRef<Promise<DrawVideoResult | null> | null>(
    null
  );
  const videoUrlRef = useRef<string | null>(null);
  const stopAudio = useRef<(() => void) | null>(null);
  const progressTimer = useRef(0);
  const lastProgress = useRef({ revealed: 0, total: 0 });

  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<AsciiResult | null>(null);
  const [progress, setProgress] = useState({ revealed: 0, total: 0 });
  const [busyShare, setBusyShare] = useState(false);
  const [busyDownload, setBusyDownload] = useState(false);
  const [busyVideo, setBusyVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState('text-art.mp4');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageLink, setImageLink] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [lastPost, setLastPost] = useState<LastPost | null>(readStoredLastPost);
  const [postStatus, setPostStatus] = useState<PostStatus>('idle');
  const [postError, setPostError] = useState<string | null>(null);
  const lastPublish = useRef<{
    originalImageDataUrl?: string;
    asciiImageDataUrl?: string;
    originalMediaUrl?: string;
    asciiMediaUrl?: string;
    mode: 'line-art' | 'photo';
    cols: number;
    rows: number;
  } | null>(null);
  const lastVideoPublish = useRef<{
    originalMediaUrl?: string;
    asciiMediaUrl?: string;
    originalImageDataUrl?: string;
    asciiImageDataUrl?: string;
    lines: string[];
    mode: 'line-art' | 'photo';
    cols: number;
    rows: number;
  } | null>(null);
  const [postProgress, setPostProgress] = useState('');
  const [sharedLink, setSharedLink] = useState<string | null>(null);
  const [videoPostStatus, setVideoPostStatus] = useState<PostStatus>('idle');
  const [videoPostError, setVideoPostError] = useState<string | null>(null);
  const [videoPostProgress, setVideoPostProgress] = useState('');
  const [lastVideoPost, setLastVideoPost] = useState<LastPost | null>(null);

  useEffect(() => {
    return () => {
      convertGen.current += 1;
      cancelAnim.current?.();
      stopAudio.current?.();
      stopAudio.current = null;
      if (progressTimer.current) window.clearTimeout(progressTimer.current);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
      videoResultRef.current = null;
    };
  }, []);

  const stopAnimation = useCallback(() => {
    cancelAnim.current?.();
    cancelAnim.current = null;
    stopAudio.current?.();
    stopAudio.current = null;
    if (progressTimer.current) {
      window.clearTimeout(progressTimer.current);
      progressTimer.current = 0;
    }
  }, []);

  const reportProgress = useCallback((revealed: number, total: number, force = false) => {
    lastProgress.current = { revealed, total };
    if (force) {
      if (progressTimer.current) {
        window.clearTimeout(progressTimer.current);
        progressTimer.current = 0;
      }
      setProgress({ revealed, total });
      return;
    }
    if (progressTimer.current) return;
    progressTimer.current = window.setTimeout(() => {
      progressTimer.current = 0;
      setProgress({ ...lastProgress.current });
    }, 100);
  }, []);

  const startDraw = useCallback(
    (ascii: AsciiResult, gen: number) => {
      const canvas = previewRef.current;
      if (!canvas) {
        setStage('done');
        return;
      }

      shareCanvas.current = null;
      stopAnimation();
      setStage('drawing');
      reportProgress(0, 0, true);
      stopAudio.current = playSoundtrack();

      cancelAnim.current = runDrawAnimation(ascii.lines, DRAW_THEME, {
        durationMs: DRAW_SECONDS * 1000,
        style: 'typewriter',
        target: { canvas, width: PREVIEW_W, height: PREVIEW_H },
        onFrame: ({ revealed, total, done }) => {
          if (gen !== animGen.current) return;
          reportProgress(revealed, total, done);
          if (done) setStage('done');
        },
        onComplete: () => {
          if (gen !== animGen.current) return;
          reportProgress(
            lastProgress.current.total || 1,
            lastProgress.current.total || 1,
            true
          );
          setStage('done');
        },
      });
    },
    [reportProgress, stopAnimation]
  );

  const clearPreviewObjectUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const clearVideoObjectUrl = useCallback(() => {
    videoResultRef.current = null;
    videoEncodePromise.current = null;
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    setVideoUrl(null);
    setVideoProgress(0);
  }, []);

  const rememberVideoFile = useCallback((video: DrawVideoResult) => {
    videoResultRef.current = video;
    setVideoName(videoFileName(video.mime));
    const url = URL.createObjectURL(video.blob);
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = url;
    setVideoUrl(url);
  }, []);

  const makeDrawVideo = useCallback(
    (lines: string[], gen: number): Promise<DrawVideoResult | null> => {
      if (videoResultRef.current) {
        return Promise.resolve(videoResultRef.current);
      }
      if (videoEncodePromise.current) return videoEncodePromise.current;

      setBusyVideo(true);
      setVideoProgress(0);
      const pending: Promise<DrawVideoResult | null> = recordDrawVideo(
        lines,
        DRAW_THEME,
        (done, total) => {
          if (gen !== convertGen.current) return;
          setVideoProgress(Math.round((done / Math.max(1, total)) * 100));
        }
      )
        .then((video) => {
          if (gen !== convertGen.current) return null;
          rememberVideoFile(video);
          return video;
        })
        .finally(() => {
          if (videoEncodePromise.current === pending) {
            videoEncodePromise.current = null;
          }
          if (gen === convertGen.current) setBusyVideo(false);
        });
      videoEncodePromise.current = pending;
      return pending;
    },
    [rememberVideoFile]
  );

  const runPublish = useCallback(
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
      gen: number
    ) => {
      setPostStatus('posting');
      setPostError(null);
      setPostProgress('Posting your pictures…');
      try {
        const published = await publishAscii(payload, (message) => {
          if (gen !== convertGen.current) return;
          setPostProgress(message);
        });
        if (gen !== convertGen.current) return;
        const sub = published.subredditName || COMMUNITY_SUBREDDIT;
        const saved: LastPost = {
          url: published.postUrl,
          subreddit: sub,
          public: published.public,
          title: published.title,
          ...(published.pending ? { pending: true } : {}),
          ...(published.authorName ? { author: published.authorName } : {}),
        };
        setLastPost(saved);
        try {
          sessionStorage.setItem(LAST_POST_KEY, JSON.stringify(saved));
        } catch {
          /* private mode */
        }
        setPostStatus('posted');
        setPostProgress('');
        showToast(
          published.pending
            ? `Sent! Look on r/${sub}/new`
            : 'Posted! Open the link below'
        );
        return published;
      } catch (err) {
        if (gen !== convertGen.current) return null;
        console.error('Auto-publish failed', err);
        const message = publishErrorMessage(
          err,
          `Could not post to r/${COMMUNITY_SUBREDDIT}`
        );
        setPostError(message);
        setPostStatus('failed');
        setPostProgress('');
        showToast(message);
        return null;
      }
    },
    [publishAscii]
  );

  const runPublishVideo = useCallback(
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
      gen: number
    ) => {
      setVideoPostStatus('posting');
      setVideoPostError(null);
      setVideoPostProgress('Posting the video…');
      try {
        const published = await publishVideo(payload, (message) => {
          if (gen !== convertGen.current) return;
          setVideoPostProgress(message);
        });
        if (gen !== convertGen.current) return;
        const sub = published.subredditName || COMMUNITY_SUBREDDIT;
        const saved: LastPost = {
          url: published.postUrl,
          subreddit: sub,
          public: published.public,
          title: published.title,
          ...(published.pending ? { pending: true } : {}),
          ...(published.authorName ? { author: published.authorName } : {}),
        };
        setLastVideoPost(saved);
        setVideoPostStatus('posted');
        setVideoPostProgress('');
        showToast(
          published.pending
            ? `Video sent! Look on r/${sub}/new`
            : 'Video posted! Open the link below'
        );
      } catch (err) {
        if (gen !== convertGen.current) return;
        console.error('Auto-publish video failed', err);
        const message = publishErrorMessage(
          err,
          `Could not post the video to r/${COMMUNITY_SUBREDDIT}`
        );
        setVideoPostError(message);
        setVideoPostStatus('failed');
        setVideoPostProgress('');
        showToast(message);
      }
    },
    [publishVideo]
  );

  const convertSource = useCallback(
    async (source: File | string, previewDisplayUrl: string) => {
      const gen = ++convertGen.current;
      const drawGen = ++animGen.current;
      stopAnimation();
      setStage('converting');
      setResult(null);
      setProgress({ revealed: 0, total: 0 });
      shareCanvas.current = null;
      setPostStatus('idle');
      setPostError(null);
      setPostProgress('');
      lastPublish.current = null;
      lastVideoPublish.current = null;
      setVideoPostStatus('idle');
      setVideoPostError(null);
      setVideoPostProgress('');
      setLastVideoPost(null);
      setShowLinkInput(false);
      setBusyVideo(false);
      setSharedLink(null);
      clearVideoObjectUrl();

      clearPreviewObjectUrl();
      if (source instanceof File) {
        const objectUrl = URL.createObjectURL(source);
        previewUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);
      } else {
        setPreviewUrl(previewDisplayUrl);
      }

      try {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));

        const ascii = await imageToAscii(source, {
          width: DEFAULT_COLS,
        });
        if (gen !== convertGen.current) return;

        setResult(ascii);
        void recordConversion({
          mode: ascii.mode,
          cols: ascii.cols,
          rows: ascii.rows,
          preview: ascii.text.slice(0, 400),
        });

        // Replay only bumps animGen so it never cancels this publish.
        // Upload once, post the playable draw card first, then the pictures.
        void (async () => {
          try {
            setPostStatus('posting');
            setVideoPostStatus('posting');
            setPostProgress('Getting your pictures ready…');
            const [originalCanvas, asciiCanvas] = await Promise.all([
              renderWatermarkedOriginal(source),
              Promise.resolve(renderFinalFrame(ascii.lines, DRAW_THEME)),
            ]);
            if (gen !== convertGen.current) return;
            shareCanvas.current = asciiCanvas;

            const originalImageDataUrl = canvasToShareDataUrl(originalCanvas);
            const asciiImageDataUrl = canvasToShareDataUrl(asciiCanvas);
            lastPublish.current = {
              originalImageDataUrl,
              asciiImageDataUrl,
              mode: ascii.mode,
              cols: ascii.cols,
              rows: ascii.rows,
            };

            setPostProgress('Sending your pictures…');
            const original = await shareImage(originalImageDataUrl);
            const asciiShared = await shareImage(asciiImageDataUrl);
            if (gen !== convertGen.current) return;

            const hosted = {
              originalMediaUrl: original.mediaUrl,
              asciiMediaUrl: asciiShared.mediaUrl,
              originalImageDataUrl,
              asciiImageDataUrl,
              mode: ascii.mode,
              cols: ascii.cols,
              rows: ascii.rows,
            };
            lastPublish.current = hosted;
            lastVideoPublish.current = {
              ...hosted,
              lines: ascii.lines,
            };

            await runPublishVideo(lastVideoPublish.current, gen);
            if (gen !== convertGen.current) return;
            await runPublish(hosted, gen);
          } catch (err) {
            if (gen !== convertGen.current) return;
            console.error('Auto-publish failed', err);
            const message = publishErrorMessage(
              err,
              `Could not post to r/${COMMUNITY_SUBREDDIT}`
            );
            setPostError(message);
            setPostStatus('failed');
            setPostProgress('');
            showToast(message);
          }
        })();

        startDraw(ascii, drawGen);
      } catch (err) {
        if (gen !== convertGen.current) return;
        console.error(err);
        showToast(
          err instanceof Error
            ? err.message
            : 'We could not turn that picture into text art'
        );
        setStage('idle');
      }
    },
    [
      recordConversion,
      runPublish,
      runPublishVideo,
      shareImage,
      startDraw,
      stopAnimation,
      clearPreviewObjectUrl,
      clearVideoObjectUrl,
    ]
  );

  const convertFile = useCallback(
    async (file: File) => {
      if (isUnsupportedPicture(file)) {
        showToast('Please use a JPG, PNG, WEBP, or GIF picture');
        return;
      }
      if (file.type && !file.type.startsWith('image/')) {
        showToast('Please pick a picture');
        return;
      }
      await convertSource(file, '');
    },
    [convertSource]
  );

  const convertFromLink = useCallback(
    async (rawUrl?: string) => {
      const url = (rawUrl ?? imageLink).trim();
      if (!url) {
        showToast('Paste a picture link first');
        setShowLinkInput(true);
        return;
      }
      // data: URLs can be converted locally without the server.
      if (url.startsWith('data:image/')) {
        await convertSource(url, url);
        return;
      }

      // Invalidate in-flight work while we rehost the remote image.
      convertGen.current += 1;
      const resolveToken = convertGen.current;
      stopAnimation();
      setStage('converting');
      setResult(null);
      setProgress({ revealed: 0, total: 0 });
      shareCanvas.current = null;
      clearPreviewObjectUrl();
      setPreviewUrl(null);
      setShowLinkInput(true);

      try {
        const resolved = await resolveImageUrl(url);
        if (resolveToken !== convertGen.current) return;
        const source = resolved.imageDataUrl || resolved.mediaUrl;
        if (!source) {
          throw new Error('We could not open that picture link');
        }
        await convertSource(source, resolved.mediaUrl ?? source);
      } catch (err) {
        if (resolveToken !== convertGen.current) return;
        console.error(err);
        showToast(
          err instanceof Error
            ? err.message
            : 'We could not open that picture link'
        );
        setStage('idle');
      }
    },
    [
      imageLink,
      resolveImageUrl,
      convertSource,
      stopAnimation,
      clearPreviewObjectUrl,
    ]
  );

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void convertFile(file);
  };

  const replay = () => {
    if (!result || stage === 'converting') return;
    const gen = ++animGen.current;
    startDraw(result, gen);
  };

  const copyAscii = async () => {
    if (!result) {
      showToast('Pick a picture first');
      return;
    }
    const ok = await copyText(result.text);
    if (ok) {
      showToast('Text copied');
      return;
    }
    setStage('done');
    if (textDetailsRef.current) textDetailsRef.current.open = true;
    showToast('Could not copy. The text is open below — select it there.');
  };

  const ensureShareCanvas = (): HTMLCanvasElement | null => {
    if (!result) return null;
    if (shareCanvas.current) return shareCanvas.current;
    shareCanvas.current = renderFinalFrame(result.lines, DRAW_THEME);
    return shareCanvas.current;
  };

  const shareStill = async () => {
    if (!result) {
      showToast('Pick a picture first');
      return;
    }
    if (busyShare) return;
    setBusyShare(true);
    showToast('Getting the picture ready…');

    try {
      await new Promise<void>((r) => setTimeout(r, 0));
      const canvas = ensureShareCanvas();
      if (!canvas) {
        showToast('There is nothing to share yet');
        return;
      }
      const dataUrl = canvasToShareDataUrl(canvas);
      const shared = await shareImage(dataUrl);
      setSharedLink(shared.mediaUrl);
      const copied = await copyText(shared.mediaUrl);
      showToast(
        copied
          ? 'Picture link copied. You can paste it in a post or comment.'
          : 'Picture uploaded. Use the link below.'
      );
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Could not share');
    } finally {
      setBusyShare(false);
    }
  };

  const downloadStill = async () => {
    if (!result) {
      showToast('Pick a picture first');
      return;
    }
    if (busyDownload) return;
    setBusyDownload(true);

    try {
      // Yield so the button can show “Please wait…” before the full-res paint.
      await new Promise<void>((r) => setTimeout(r, 0));
      const canvas = ensureShareCanvas();
      if (!canvas) {
        showToast('There is nothing to save yet');
        return;
      }

      const filename = `text-art-${Date.now()}.jpg`;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
      );

      if (!blob) {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        const res = await fetch(dataUrl);
        const fallback = await res.blob();
        await saveBlobFile(fallback, filename, 'image/jpeg');
        showToast('Saving the picture…');
        return;
      }

      await saveBlobFile(blob, filename, 'image/jpeg');
      showToast('Saving the picture…');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Could not save the picture');
    } finally {
      setBusyDownload(false);
    }
  };

  const downloadVideo = async () => {
    if (!result) {
      showToast('Pick a picture first');
      return;
    }

    const ready = videoResultRef.current;
    if (ready) {
      try {
        await saveVideoBlob(ready);
        showToast('Saving the video…');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        showToast(
          err instanceof Error ? err.message : 'Could not save the video'
        );
      }
      return;
    }

    if (busyVideo) {
      showToast('Still making the video. Tap Save again when it is ready.');
      return;
    }

    const gen = convertGen.current;
    showToast('Making the video…');
    try {
      const video = await makeDrawVideo(result.lines, gen);
      if (gen !== convertGen.current || !video) return;
      showToast('Video is ready. Tap Save the video.');
    } catch (err) {
      if (gen !== convertGen.current) return;
      console.error(err);
      showToast(
        err instanceof Error ? err.message : 'Could not save the video'
      );
    }
  };

  const pct =
    progress.total > 0
      ? Math.round((progress.revealed / progress.total) * 100)
      : stage === 'done'
        ? 100
        : 0;

  const hasResult = Boolean(result);
  const isBusy = stage === 'converting' || busyShare || busyDownload;

  return (
    <div className="flex min-h-screen flex-col bg-[#0f1115] text-white">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight">{APP_NAME}</h1>
          <p className="truncate text-xs text-white/50">
            {loading
              ? 'Please wait…'
              : error
                ? error
                : `${username ?? 'you'} · ${totalConversions.toLocaleString()} made by everyone · ${userConversions} made by you`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label
            className={`rounded-full bg-[#d93900] px-3 py-2 text-sm font-semibold hover:bg-[#c23300] active:scale-[0.98] sm:px-4 ${
              stage === 'converting'
                ? 'pointer-events-none opacity-50'
                : 'cursor-pointer'
            }`}
            onClick={() => {
              if (fileRef.current) fileRef.current.value = '';
            }}
          >
            From device
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/*"
              className={fileInputClass}
              tabIndex={-1}
              disabled={stage === 'converting'}
              onChange={onFileChange}
            />
          </label>
          <button
            type="button"
            className="rounded-full border border-white/20 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10 active:scale-[0.98] disabled:opacity-50 sm:px-4"
            disabled={stage === 'converting'}
            onClick={() => setShowLinkInput((v) => !v)}
          >
            From link
          </button>
        </div>
      </header>

      {showLinkInput && (
        <div className="border-b border-white/10 bg-black/30 px-4 py-3">
          <form
            className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              void convertFromLink();
            }}
          >
            <label className="sr-only" htmlFor="image-link">
              Picture link
            </label>
            <input
              id="image-link"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="Paste a picture link here"
              value={imageLink}
              onChange={(e) => setImageLink(e.target.value)}
              disabled={stage === 'converting'}
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              disabled={stage === 'converting' || !imageLink.trim()}
              className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Use this link
            </button>
          </form>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className="flex w-full shrink-0 flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 lg:w-72">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={!hasResult || stage === 'converting'}
              onClick={replay}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Watch again
            </button>
            <button
              type="button"
              disabled={!hasResult || isBusy}
              onClick={() => void copyAscii()}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Copy the text
            </button>
            <button
              type="button"
              disabled={!hasResult || isBusy}
              onClick={() => void downloadStill()}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyDownload ? 'Please wait…' : 'Save the picture'}
            </button>
            <button
              type="button"
              disabled={!hasResult || stage === 'converting'}
              onClick={() => void downloadVideo()}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyVideo
                ? videoProgress > 0
                  ? `Making the video… ${videoProgress}%`
                  : 'Making the video…'
                : 'Save the video'}
            </button>
            {videoUrl && (
              <div className="flex flex-col gap-2">
                <video
                  src={videoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full rounded-xl bg-black"
                />
                <a
                  href={videoUrl}
                  download={videoName}
                  className="rounded-xl bg-[#d93900] px-3 py-2 text-center text-sm font-semibold text-white hover:bg-[#c23300]"
                >
                  Download the video
                </a>
              </div>
            )}
            <button
              type="button"
              disabled={!hasResult || isBusy}
              onClick={() => void shareStill()}
              className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold hover:bg-sky-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyShare ? 'Sending…' : 'Share the picture'}
            </button>
            {sharedLink && (
              <div className="rounded-xl border border-white/10 bg-black/30 p-2">
                <p className="break-all text-[10px] leading-relaxed text-white/55">
                  {sharedLink}
                </p>
                <button
                  type="button"
                  className="mt-1 text-[11px] text-sky-300 hover:text-sky-200"
                  onClick={() => navigateTo(sharedLink)}
                >
                  Open the picture
                </button>
              </div>
            )}
          </div>

          {postStatus === 'posting' && (
            <p className="text-xs text-amber-200/90">
              {postProgress ||
                `Posting as ${username ? `u/${username}` : 'you'} on r/${COMMUNITY_SUBREDDIT}…`}
            </p>
          )}
          {postStatus === 'failed' && (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3">
              <p className="text-xs text-red-200">
                We could not post the pictures as you. Please try again.
              </p>
              {postError && (
                <p className="mt-1 text-[11px] leading-relaxed text-red-200/70">
                  {postError}
                </p>
              )}
              <button
                type="button"
                className="mt-2 w-full rounded-xl bg-[#d93900] px-3 py-2 text-sm font-semibold hover:bg-[#c23300]"
                onClick={() => {
                  const payload = lastPublish.current;
                  if (!payload) return;
                  void runPublish(payload, convertGen.current);
                }}
              >
                Try the pictures again
              </button>
              <button
                type="button"
                className="mt-2 text-xs text-sky-300 hover:text-sky-200"
                onClick={() =>
                  navigateTo(
                    `https://www.reddit.com/r/${COMMUNITY_SUBREDDIT}/new/`
                  )
                }
              >
                See new posts on r/{COMMUNITY_SUBREDDIT}
              </button>
            </div>
          )}
          {videoPostStatus === 'posting' && (
            <p className="text-xs text-amber-200/90">
              {videoPostProgress || 'Posting the video…'}
            </p>
          )}
          {videoPostStatus === 'failed' && (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3">
              <p className="text-xs text-red-200">
                We could not post the video as you. Please try again.
              </p>
              {videoPostError && (
                <p className="mt-1 text-[11px] leading-relaxed text-red-200/70">
                  {videoPostError}
                </p>
              )}
              <button
                type="button"
                className="mt-2 w-full rounded-xl bg-[#d93900] px-3 py-2 text-sm font-semibold hover:bg-[#c23300]"
                onClick={() => {
                  const payload = lastVideoPublish.current;
                  if (!payload) return;
                  void runPublishVideo(payload, convertGen.current);
                }}
              >
                Try the video again
              </button>
            </div>
          )}
          {lastVideoPost && (
            <div className="rounded-xl border border-violet-400/35 bg-violet-500/10 p-3">
              <p className="text-xs font-semibold text-violet-100">
                {lastVideoPost.pending
                  ? `Video sent as ${lastVideoPost.author ? `u/${lastVideoPost.author}` : 'you'}. Reddit is still working on it.`
                  : `Video posted as ${lastVideoPost.author ? `u/${lastVideoPost.author}` : 'you'} on r/${lastVideoPost.subreddit}`}
              </p>
              {lastVideoPost.title && (
                <p className="mt-1 text-[11px] leading-snug text-white/70">
                  {lastVideoPost.title}
                </p>
              )}
              <button
                type="button"
                className="mt-2 w-full rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold hover:bg-violet-500"
                onClick={() => navigateTo(lastVideoPost.url)}
              >
                {lastVideoPost.pending
                  ? `See new posts on r/${lastVideoPost.subreddit}`
                  : 'Open the video'}
              </button>
            </div>
          )}
          {lastPost && (
            <div className="rounded-xl border border-sky-400/35 bg-sky-500/10 p-3">
              <p className="text-xs font-semibold text-sky-100">
                {lastPost.pending
                  ? `Sent as ${lastPost.author ? `u/${lastPost.author}` : 'you'}. Reddit is still working on it.`
                  : `Posted as ${lastPost.author ? `u/${lastPost.author}` : 'you'} on r/${lastPost.subreddit}`}
              </p>
              {lastPost.title && (
                <p className="mt-1 text-[11px] leading-snug text-white/70">
                  {lastPost.title}
                </p>
              )}
              <p className="mt-1 break-all text-[10px] leading-relaxed text-white/45">
                {lastPost.url}
              </p>
              <button
                type="button"
                className="mt-2 w-full rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold hover:bg-sky-500"
                onClick={() => navigateTo(lastPost.url)}
              >
                {lastPost.pending
                  ? `See new posts on r/${lastPost.subreddit}`
                  : 'Open this post'}
              </button>
              <div className="mt-2 flex gap-2">
                {lastPost.author && (
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-white/15 px-2 py-1.5 text-[11px] text-white/70 hover:bg-white/10"
                    onClick={() =>
                      navigateTo(
                        `https://www.reddit.com/user/${lastPost.author}/submitted/`
                      )
                    }
                  >
                    {lastPost.author === username
                      ? 'Your profile'
                      : `u/${lastPost.author} posts`}
                  </button>
                )}
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-white/15 px-2 py-1.5 text-[11px] text-white/70 hover:bg-white/10"
                  onClick={() => {
                    void copyText(lastPost.url).then((ok) => {
                      showToast(ok ? 'Link copied' : lastPost.url);
                    });
                  }}
                >
                  Copy link
                </button>
              </div>
            </div>
          )}

          {recentPosts.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-[11px] font-semibold text-white/70">
                Your last posts
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {recentPosts.slice(0, 5).map((post) => (
                  <li key={post.id}>
                    <button
                      type="button"
                      className="w-full truncate text-left text-[11px] text-sky-300 hover:text-sky-200"
                      onClick={() => navigateTo(post.url)}
                      title={post.title}
                    >
                      {post.title || post.url}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && (
            <p className="text-xs text-white/45">
              {modeWords(result.mode)} · {result.cols} by {result.rows} letters
              {' · '}
              {stageWords(stage, pct)}
            </p>
          )}

          <p className="mt-auto pt-4 text-[11px] leading-relaxed text-white/35">
            This is not AI. We look at how light or dark each part of the
            picture is. We post your picture, the text art, and the video as
            you on r/{COMMUNITY_SUBREDDIT}.
          </p>
        </section>

        <section className="flex min-h-0 flex-1 flex-col items-center gap-3">
          <div className="relative w-full max-w-[min(100%,420px)] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50">
            <div className="relative w-full" style={{ aspectRatio: '9 / 16' }}>
              <canvas
                ref={previewRef}
                className="absolute inset-0 h-full w-full object-contain"
                width={PREVIEW_W}
                height={PREVIEW_H}
              />
              {/* Hit target over painted watermark — canvas pixels are not interactive. */}
              {(stage === 'drawing' || stage === 'done') && (
                <button
                  type="button"
                  aria-label={`Open ${WATERMARK_TEXT} on Reddit`}
                  title={WATERMARK_URL}
                  onClick={() => navigateTo(WATERMARK_URL)}
                  className="absolute bottom-[2.8%] right-[4.4%] z-[5] cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-tight text-transparent hover:bg-white/10 active:bg-white/15 sm:text-xs"
                >
                  {WATERMARK_TEXT}
                </button>
              )}
              {stage === 'idle' && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#141820] p-6 text-center">
                  <div className="text-4xl" aria-hidden>
                    🎨
                  </div>
                  <p className="text-sm text-white/70">
                    Use From device or From link above. We will post your
                    picture, the text art, and the video on r/
                    {COMMUNITY_SUBREDDIT} as you.
                  </p>
                </div>
              )}
              {stage === 'converting' && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 text-sm">
                  Working on your picture…
                </div>
              )}
            </div>
          </div>

          {previewUrl && (
            <div className="flex items-center gap-2 text-xs text-white/40">
              <span>Your picture</span>
              <img
                src={previewUrl}
                alt="Your picture"
                className="h-10 w-10 rounded object-cover ring-1 ring-white/20"
              />
            </div>
          )}

          {result && (stage === 'done' || stage === 'drawing') && (
            <details
              ref={textDetailsRef}
              className="w-full max-w-[min(100%,420px)] rounded-xl border border-white/10 bg-black/40 p-3"
            >
              <summary className="cursor-pointer text-xs text-white/60">
                Show the text
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre font-mono text-[8px] leading-[9px] text-emerald-300/90 select-text sm:text-[9px]">
                {result.text}
              </pre>
            </details>
          )}
        </section>
      </main>

      <footer className="flex justify-center gap-3 border-t border-white/10 py-3 text-xs text-white/40">
        <button
          type="button"
          className="hover:text-white"
          onClick={() => navigateTo(WATERMARK_URL)}
        >
          {WATERMARK_TEXT}
        </button>
        <span className="text-white/20">|</span>
        <button
          type="button"
          className="hover:text-white"
          onClick={() => navigateTo('https://developers.reddit.com/docs')}
        >
          Help
        </button>
        <span className="text-white/20">|</span>
        <button
          type="button"
          className="hover:text-white"
          onClick={() => navigateTo('https://www.reddit.com/r/Devvit')}
        >
          r/Devvit
        </button>
        <span className="text-white/20">|</span>
        <button
          type="button"
          className="hover:text-white"
          onClick={() =>
            navigateTo(
              'https://support.reddithelp.com/hc/en-us/articles/27958169342996'
            )
          }
        >
          Developer Funds
        </button>
      </footer>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
