import soundtrackUrl from '../audio/demo.mpeg?url';
import { AUDIO_DURATION_SECONDS } from '../../shared/video';

export { soundtrackUrl };

let decoded: Promise<AudioBuffer> | null = null;

export function loadSoundtrackBuffer(): Promise<AudioBuffer> {
  if (!decoded) {
    decoded = (async () => {
      const res = await fetch(soundtrackUrl);
      if (!res.ok) {
        throw new Error('Could not load the music');
      }
      const raw = await res.arrayBuffer();
      const ctx = new AudioContext({ sampleRate: 48_000 });
      try {
        return await ctx.decodeAudioData(raw.slice(0));
      } finally {
        await ctx.close();
      }
    })();
  }
  return decoded;
}

/** Play the soundtrack from the start. Returns a stop function. */
export function playSoundtrack(): () => void {
  const audio = new Audio(soundtrackUrl);
  audio.preload = 'auto';
  void audio.play().catch(() => {
    /* autoplay can be blocked until the next tap */
  });
  return () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  };
}

export function soundtrackDurationSeconds(buffer?: AudioBuffer): number {
  if (buffer && buffer.duration > 0) return buffer.duration;
  return AUDIO_DURATION_SECONDS;
}
