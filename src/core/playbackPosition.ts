import type { Note } from './model';
import { TIMELINE_LEFT } from './timeline';

export type PlaybackMeasure = { start: number; end: number; anchors: { beat: number; x: number }[] };
export function notationPlaybackX(measures: readonly PlaybackMeasure[], beat: number | null): number | null {
  if (beat === null) return null;
  const measure = measures.find(item => beat >= item.start && beat < item.end);
  if (!measure?.anchors.length) return null;
  const anchors = measure.anchors;
  for (let index = 1; index < anchors.length; index++) {
    const a = anchors[index - 1], b = anchors[index];
    if (beat < b.beat) return a.x + (b.x - a.x) * Math.max(0, (beat - a.beat) / (b.beat - a.beat));
  }
  return anchors.at(-1)!.x;
}
export function eventPlaybackFraction(note: Note, beat: number | null): number | null {
  return beat !== null && beat >= note.beat && beat < note.beat + note.duration ? (beat - note.beat) / note.duration : null;
}
export function playbackScrollLeft(beat: number, scale: number, viewport: number, content: number): number {
  return Math.max(0, Math.min(Math.max(0, content - viewport), TIMELINE_LEFT + beat * scale - viewport / 3));
}
