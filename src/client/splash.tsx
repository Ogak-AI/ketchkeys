import './styles/index.css';

import { navigateTo, requestExpandedMode, context } from '@devvit/web/client';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  isDrawPostData,
  isGalleryPostData,
  type InitResponse,
} from '../shared/api';
import {
  APP_NAME,
  DRAW_SECONDS,
  PREVIEW_H,
  PREVIEW_W,
  WATERMARK_TEXT,
  WATERMARK_URL,
  splashUsesCover,
} from '../shared/config';
import { runDrawAnimation } from './lib/drawCanvas';
import { playSoundtrack } from './lib/soundtrack';

const SLIDES = [
  { id: 'original', label: 'Your picture' },
  { id: 'ascii', label: 'Text art' },
] as const;

/** Cover when the still is taller/narrower than the card (old 9:16 letterboxes). */
function shouldCoverImage(img: HTMLImageElement): boolean {
  const box = img.parentElement;
  if (!box) return true;
  return splashUsesCover(
    img.naturalWidth,
    img.naturalHeight,
    box.clientWidth,
    box.clientHeight
  );
}

const DrawSplash = ({
  originalUrl,
  asciiUrl,
}: {
  originalUrl: string;
  asciiUrl: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelAnim = useRef<(() => void) | null>(null);
  const stopAudio = useRef<(() => void) | null>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const [linesTried, setLinesTried] = useState(false);
  const [slide, setSlide] = useState<'draw' | 'original' | 'ascii'>('draw');

  const playDraw = useCallback((rows: string[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cancelAnim.current?.();
    stopAudio.current?.();
    stopAudio.current = playSoundtrack();
    cancelAnim.current = runDrawAnimation(rows, 'dark', {
      durationMs: DRAW_SECONDS * 1000,
      style: 'typewriter',
      target: { canvas, width: PREVIEW_W, height: PREVIEW_H },
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/init');
        if (!res.ok) return;
        const data: InitResponse = await res.json();
        if (data.type === 'init' && data.drawLines && alive) {
          setLines(data.drawLines);
        }
      } catch {
        /* stills still work */
      } finally {
        if (alive) setLinesTried(true);
      }
    };
    void load();
    return () => {
      alive = false;
      cancelAnim.current?.();
      stopAudio.current?.();
    };
  }, []);

  useEffect(() => {
    if (!lines) return;
    playDraw(lines);
    return () => {
      cancelAnim.current?.();
      stopAudio.current?.();
    };
  }, [lines, playDraw]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-black text-white">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <canvas
          ref={canvasRef}
          width={PREVIEW_W}
          height={PREVIEW_H}
          className={`absolute inset-0 h-full w-full object-contain ${
            slide === 'draw' && lines
              ? 'opacity-100'
              : 'pointer-events-none opacity-0'
          }`}
        />
        {(slide !== 'draw' || !lines) && (
          <img
            src={
              slide === 'original'
                ? originalUrl
                : asciiUrl
            }
            alt={slide === 'original' ? 'Your picture' : 'Text art'}
            className="h-full w-full object-contain"
            draggable={false}
          />
        )}
        {slide === 'ascii' && (
          <button
            type="button"
            aria-label={`Open ${WATERMARK_TEXT} on Reddit`}
            title={WATERMARK_URL}
            onClick={() => navigateTo(WATERMARK_URL)}
            className="absolute bottom-[2.8%] right-[4.4%] z-10 cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-tight text-transparent hover:bg-white/10"
          >
            {WATERMARK_TEXT}
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute top-3 left-0 right-0 flex justify-center">
        <span className="rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white/90 backdrop-blur">
          {slide === 'draw'
            ? lines
              ? 'Watch it draw'
              : linesTried
                ? 'Text art'
                : 'Please wait…'
            : slide === 'original'
              ? 'Your picture'
              : 'Text art'}
        </span>
      </div>

      <div className="absolute bottom-3 left-0 right-0 z-10 flex flex-wrap items-center justify-center gap-2 px-2">
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
            slide === 'draw' ? 'bg-white text-black' : 'bg-black/65 text-white/90'
          }`}
          onClick={() => {
            setSlide('draw');
            if (lines) playDraw(lines);
          }}
        >
          Video
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
            slide === 'original' ? 'bg-white text-black' : 'bg-black/65 text-white/90'
          }`}
          onClick={() => setSlide('original')}
        >
          Picture
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
            slide === 'ascii' ? 'bg-white text-black' : 'bg-black/65 text-white/90'
          }`}
          onClick={() => setSlide('ascii')}
        >
          Text art
        </button>
        <button
          type="button"
          className="rounded-full bg-[#d93900] px-3 py-1.5 text-[11px] font-semibold hover:bg-[#c23300]"
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        >
          Make yours
        </button>
      </div>
    </div>
  );
};

const GallerySplash = ({
  originalUrl,
  asciiUrl,
}: {
  originalUrl: string;
  asciiUrl: string;
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  const imgRefs = useRef<Record<string, HTMLImageElement | null>>({});
  const [index, setIndex] = useState(0);
  const [cover, setCover] = useState<Record<string, boolean>>({});
  const slides = [
    { id: SLIDES[0].id, url: originalUrl, label: SLIDES[0].label },
    { id: SLIDES[1].id, url: asciiUrl, label: SLIDES[1].label },
  ];

  const measureFits = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const slide of SLIDES) {
      const img = imgRefs.current[slide.id];
      if (!img) continue;
      next[slide.id] = shouldCoverImage(img);
    }
    setCover((prev) => {
      const keys = Object.keys(next);
      if (
        keys.length === Object.keys(prev).length &&
        keys.every((k) => prev[k] === next[k])
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureFits());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureFits]);

  const go = (next: number) => {
    const el = scroller.current;
    if (!el) return;
    const i = Math.max(0, Math.min(slides.length - 1, next));
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    setIndex(i);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-black text-white">
      <div
        ref={scroller}
        className="gallery-scroll flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
        style={{ scrollSnapType: 'x mandatory', touchAction: 'pan-x' }}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (!el.clientWidth) return;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {slides.map((slide) => (
          <div
            key={slide.id}
            className="relative h-full w-full shrink-0 snap-center overflow-hidden bg-black"
          >
            <img
              ref={(node) => {
                imgRefs.current[slide.id] = node;
              }}
              src={slide.url}
              alt={slide.label}
              className={`h-full w-full ${
                cover[slide.id] === false ? 'object-contain' : 'object-cover'
              }`}
              draggable={false}
              onLoad={measureFits}
            />
            {slide.id === 'ascii' && (
              <button
                type="button"
                aria-label={`Open ${WATERMARK_TEXT} on Reddit`}
                title={WATERMARK_URL}
                onClick={() => navigateTo(WATERMARK_URL)}
                className="absolute bottom-[2.8%] right-[4.4%] z-10 cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-tight text-transparent hover:bg-white/10 active:bg-white/15"
              >
                {WATERMARK_TEXT}
              </button>
            )}
          </div>
        ))}
      </div>

      {index > 0 && (
        <button
          type="button"
          aria-label="Show the last picture"
          className="absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-lg text-white/90 backdrop-blur hover:bg-black/80"
          onClick={() => go(index - 1)}
        >
          ‹
        </button>
      )}
      {index < slides.length - 1 && (
        <button
          type="button"
          aria-label="Show the next picture"
          className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-lg text-white/90 backdrop-blur hover:bg-black/80"
          onClick={() => go(index + 1)}
        >
          ›
        </button>
      )}

      <div className="pointer-events-none absolute top-3 left-0 right-0 flex justify-center">
        <span className="rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white/90 backdrop-blur">
          {slides[index]?.label} · {index + 1} of {slides.length}
        </span>
      </div>

      <div className="absolute bottom-3 left-0 right-0 z-10 flex items-center justify-center gap-3">
        <div className="flex gap-1.5">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Show ${slide.label}`}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/40'
              }`}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="rounded-full bg-[#d93900] px-3 py-1.5 text-[11px] font-semibold hover:bg-[#c23300]"
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        >
          Make yours
        </button>
      </div>
    </div>
  );
};

const LauncherSplash = () => {
  const [stats, setStats] = useState({
    total: 0,
    user: 0,
    username: context.username ?? '',
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/init');
        if (!res.ok) return;
        const data: InitResponse = await res.json();
        if (data.type === 'init' && alive) {
          setStats({
            total: data.totalConversions,
            user: data.userConversions,
            username: data.username,
          });
        }
      } catch {
        // Splash stays usable without stats
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-5 overflow-hidden bg-[#0b0d10] px-4 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#1a2744_0%,_transparent_55%)]" />

      <div className="relative z-10 flex max-w-md flex-col items-center gap-3 text-center">
        <p className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs tracking-wide text-sky-200/90">
          No AI. Just your picture.
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {APP_NAME}
        </h1>
        <p className="text-sm leading-relaxed text-white/70">
          Pick a picture. Watch it turn into text art. We post it for you on
          r/ketchkeys.
        </p>

        <div className="mt-1 flex gap-6 text-center text-xs text-white/50">
          <div>
            <div className="text-lg font-semibold text-white">
              {stats.total.toLocaleString()}
            </div>
            made by everyone
          </div>
          <div className="w-px bg-white/10" />
          <div>
            <div className="text-lg font-semibold text-white">
              {stats.user.toLocaleString()}
            </div>
            made by you
          </div>
        </div>

        <button
          type="button"
          className="relative z-10 mt-4 flex h-12 items-center justify-center rounded-full bg-[#d93900] px-8 text-base font-semibold text-white transition-colors hover:bg-[#c23300] active:scale-[0.98]"
          onClick={(e) => {
            requestExpandedMode(e.nativeEvent, 'game');
          }}
        >
          Start
        </button>

        <p className="text-xs text-white/40">
          Hi {stats.username || 'there'}. You can start now.
        </p>
      </div>

      <pre className="pointer-events-none absolute bottom-16 select-none text-[7px] leading-[8px] text-emerald-400/40 sm:text-[8px] sm:leading-[9px]">
        {`   /\\_/\\  
  ( o.o ) 
   > ^ <  `}
      </pre>

      <footer className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-3 text-[0.75em] text-white/40">
        <button
          type="button"
          className="cursor-pointer transition-colors hover:text-white"
          onClick={() => navigateTo('https://developers.reddit.com/docs')}
        >
          Help
        </button>
        <span className="text-white/20">|</span>
        <button
          type="button"
          className="cursor-pointer transition-colors hover:text-white"
          onClick={() => navigateTo('https://www.reddit.com/r/Devvit')}
        >
          r/Devvit
        </button>
      </footer>
    </div>
  );
};

export const Splash = () => {
  const draw = isDrawPostData(context.postData) ? context.postData : null;
  if (draw) {
    return (
      <DrawSplash originalUrl={draw.originalUrl} asciiUrl={draw.asciiUrl} />
    );
  }
  const gallery = isGalleryPostData(context.postData) ? context.postData : null;
  if (gallery) {
    return (
      <GallerySplash
        originalUrl={gallery.originalUrl}
        asciiUrl={gallery.asciiUrl}
      />
    );
  }
  return <LauncherSplash />;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
