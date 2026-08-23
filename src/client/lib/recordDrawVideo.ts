import { buildDrawOrder } from '../../shared/ascii';
import {
  AUDIO_BITRATE,
  VIDEO_BITRATE,
  VIDEO_FPS,
  revealedForVideoFrame,
  videoDrawFrames,
  videoDurationSeconds,
  videoTotalFrames,
} from '../../shared/video';
import {
  createOffscreenCanvas,
  paintAsciiFrame,
  type DrawTheme,
} from './drawCanvas';
import { loadSoundtrackBuffer } from './soundtrack';

export type DrawVideoResult = {
  blob: Blob;
  mime: string;
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** 16-aligned 9:16 sizes. 720×1280 sits on H.264 level 3.1’s frame cap. */
const ENCODE_SIZES = [
  { w: 640, h: 1136 },
  { w: 540, h: 960 },
  { w: 720, h: 1280 },
] as const;

const AVC_CODECS = ['avc1.42001e', 'avc1.42001f', 'avc1.4d001e'] as const;

function supportsWebCodecs(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof VideoEncoder.isConfigSupported === 'function'
  );
}

async function pickAvcConfig(
  fps: number
): Promise<{ codec: string; width: number; height: number } | null> {
  for (const { w, h } of ENCODE_SIZES) {
    for (const codec of AVC_CODECS) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width: w,
          height: h,
          bitrate: VIDEO_BITRATE,
          framerate: fps,
        });
        if (support.supported) return { codec, width: w, height: h };
      } catch {
        /* try the next pair */
      }
    }
  }
  return null;
}

function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = [
    'video/mp4',
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function mountHiddenCanvas(canvas: HTMLCanvasElement): () => void {
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(canvas);
  return () => {
    canvas.remove();
  };
}

function supportsAacEncoder(): boolean {
  return (
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioData !== 'undefined' &&
    typeof AudioEncoder.isConfigSupported === 'function'
  );
}

async function encodeSoundtrackAac(
  buffer: AudioBuffer,
  onChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void
): Promise<{ sampleRate: number; numberOfChannels: number }> {
  const sampleRate = buffer.sampleRate;
  const numberOfChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const codec = 'mp4a.40.2';
  const support = await AudioEncoder.isConfigSupported({
    codec,
    sampleRate,
    numberOfChannels,
    bitrate: AUDIO_BITRATE,
  });
  if (!support.supported) {
    throw new Error('This phone or computer cannot add music to the video');
  }

  const encoder = new AudioEncoder({
    output: (chunk, meta) => onChunk(chunk, meta),
    error: (err) => {
      throw err;
    },
  });
  encoder.configure({
    codec,
    sampleRate,
    numberOfChannels,
    bitrate: AUDIO_BITRATE,
  });

  const frameSize = 1024;
  const total = buffer.length;
  for (let offset = 0; offset < total; offset += frameSize) {
    const n = Math.min(frameSize, total - offset);
    const planar = new Float32Array(n * numberOfChannels);
    for (let c = 0; c < numberOfChannels; c++) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      planar.set(src.subarray(offset, offset + n), c * n);
    }
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: planar,
    });
    encoder.encode(data);
    data.close();
  }

  await encoder.flush();
  encoder.close();
  return { sampleRate, numberOfChannels };
}

async function encodeWithWebCodecs(
  lines: string[],
  theme: DrawTheme,
  onProgress?: (done: number, total: number) => void
): Promise<DrawVideoResult> {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const fps = VIDEO_FPS;
  const picked = await pickAvcConfig(fps);
  if (!picked) {
    throw new Error('This phone or computer cannot make the video');
  }
  const { codec, width: w, height: h } = picked;
  const drawFrames = videoDrawFrames();
  const totalFrames = videoTotalFrames();
  const durationSeconds = videoDurationSeconds();
  const order = buildDrawOrder(lines, 'typewriter');
  const { canvas, ctx } = createOffscreenCanvas(w, h);

  const audioChunks: Array<{
    chunk: EncodedAudioChunk;
    meta?: EncodedAudioChunkMetadata;
  }> = [];
  let audioTrack:
    | { sampleRate: number; numberOfChannels: number }
    | null = null;
  try {
    const soundtrack = await loadSoundtrackBuffer();
    if (supportsAacEncoder()) {
      audioTrack = await encodeSoundtrackAac(soundtrack, (chunk, meta) => {
        if (meta) audioChunks.push({ chunk, meta });
        else audioChunks.push({ chunk });
      });
    }
  } catch (error) {
    console.error('Soundtrack encode failed', error);
    audioTrack = null;
    audioChunks.length = 0;
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: w,
      height: h,
      frameRate: fps,
    },
    ...(audioTrack
      ? {
          audio: {
            codec: 'aac' as const,
            numberOfChannels: audioTrack.numberOfChannels,
            sampleRate: audioTrack.sampleRate,
          },
        }
      : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      throw err;
    },
  });
  encoder.configure({
    codec,
    width: w,
    height: h,
    bitrate: VIDEO_BITRATE,
    framerate: fps,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  });

  for (const item of audioChunks) {
    if (item.meta) muxer.addAudioChunk(item.chunk, item.meta);
    else muxer.addAudioChunk(item.chunk);
  }

  const frameDuration = 1_000_000 / fps;

  for (let i = 0; i < totalFrames; i++) {
    const revealed = revealedForVideoFrame(i, order.length, drawFrames);
    const drawing = i < drawFrames;
    paintAsciiFrame(ctx, lines, order, revealed, theme, {
      showCursor: drawing && revealed < order.length,
      blinkOn: drawing && i % 4 < 2,
    });

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();

    if (i % 8 === 0) {
      onProgress?.(i + 1, totalFrames);
      await yieldToUi();
    }
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const { buffer } = muxer.target as { buffer: ArrayBuffer };
  const blob = new Blob([buffer], { type: 'video/mp4' });
  onProgress?.(totalFrames, totalFrames);

  return {
    blob,
    mime: 'video/mp4',
    durationSeconds,
    width: w,
    height: h,
    hasAudio: Boolean(audioTrack),
  };
}

async function encodeWithMediaRecorder(
  lines: string[],
  theme: DrawTheme,
  onProgress?: (done: number, total: number) => void
): Promise<DrawVideoResult> {
  const w = ENCODE_SIZES[0].w;
  const h = ENCODE_SIZES[0].h;
  const fps = VIDEO_FPS;
  const drawFrames = videoDrawFrames();
  const totalFrames = videoTotalFrames();
  const durationSeconds = videoDurationSeconds();
  const order = buildDrawOrder(lines, 'typewriter');
  const { canvas, ctx } = createOffscreenCanvas(w, h);
  const unmount = mountHiddenCanvas(canvas);

  const mime = pickRecorderMime();
  if (!mime) {
    unmount();
    throw new Error('This phone or computer cannot make the video');
  }

  let audioCtx: AudioContext | null = null;
  let mixed: MediaStream | null = null;
  try {
    mixed = canvas.captureStream(fps);
    try {
      const soundtrack = await loadSoundtrackBuffer();
      audioCtx = new AudioContext();
      const source = audioCtx.createBufferSource();
      source.buffer = soundtrack;
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      source.start();
      mixed = new MediaStream([
        ...mixed.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);
    } catch (error) {
      console.error('Soundtrack record failed', error);
    }

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(mixed, {
      mimeType: mime,
      videoBitsPerSecond: VIDEO_BITRATE,
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('Video recording failed'));
    });

    paintAsciiFrame(ctx, lines, order, 0, theme, {
      showCursor: false,
    });
    recorder.start(500);

    const frameMs = 1000 / fps;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const i = Math.min(
          totalFrames - 1,
          Math.floor((now - start) / frameMs)
        );
        const revealed = revealedForVideoFrame(i, order.length, drawFrames);
        const drawing = i < drawFrames;
        paintAsciiFrame(ctx, lines, order, revealed, theme, {
          showCursor: drawing && revealed < order.length,
          blinkOn: drawing && Math.floor(now / 250) % 2 === 0,
        });
        onProgress?.(i + 1, totalFrames);
        if (now - start >= durationSeconds * 1000) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' });
    return {
      blob,
      mime: blob.type || 'video/webm',
      durationSeconds,
      width: w,
      height: h,
      hasAudio: Boolean(audioCtx),
    };
  } finally {
    mixed?.getTracks().forEach((track) => track.stop());
    await audioCtx?.close().catch(() => undefined);
    unmount();
  }
}

/**
 * Build a 9:16 video of the typewriter draw, with audio/demo.mpeg mixed in.
 * Length matches the soundtrack (~82s). Uses WebCodecs (offline encode).
 * Falls back to a real-time MediaRecorder pass when needed.
 */
export async function recordDrawVideo(
  lines: string[],
  theme: DrawTheme,
  onProgress?: (done: number, total: number) => void
): Promise<DrawVideoResult> {
  if (supportsWebCodecs()) {
    try {
      return await encodeWithWebCodecs(lines, theme, onProgress);
    } catch (error) {
      console.error('WebCodecs draw video failed', error);
    }
  }
  return await encodeWithMediaRecorder(lines, theme, onProgress);
}
