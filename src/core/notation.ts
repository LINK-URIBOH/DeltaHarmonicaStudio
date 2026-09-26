import { endBeat, sortedNotes, type Score } from './model';

export type NotationEvent = {
  id: string; sourceId: string; start: number; duration: number;
  pitch: number | null; implicit: boolean; tieIn: boolean; tieOut: boolean;
};
export type NotationSlot = { start: number; duration: number; events: NotationEvent[] };
export type NotationMeasure = { index: number; start: number; duration: number; events: NotationEvent[]; slots: NotationSlot[] };
export type NotationSystem = { measures: { measure: NotationMeasure; width: number }[]; width: number; columns: number };

const VALUES = [4, 3, 2, 1.5, 1, .75, .5, .25];
const EPS = 1e-6;
const snap = (beat: number) => Math.max(0, Math.round(beat * 4) / 4);

function pieces(duration: number): number[] {
  const result: number[] = [];
  let left = duration;
  while (left > EPS) {
    const value = VALUES.find(item => item <= left + EPS) ?? left;
    result.push(value);
    left -= value;
  }
  return result;
}

// Only this read-only representation is quantized. The source score is never changed.
export function buildNotation(score: Score): NotationMeasure[] {
  const notes = sortedNotes(score).map(note => {
    const beat = snap(note.beat);
    return { ...note, beat, duration: Math.max(.25, snap(note.beat + note.duration) - beat) };
  });
  const bar = score.meter.numerator * 4 / score.meter.denominator;
  const count = Math.max(1, Math.ceil(endBeat({ ...score, notes }) / bar));
  const measures: NotationMeasure[] = [];
  const bySource = new Map<string, NotationEvent[]>();
  for (let index = 0; index < count; index++) {
    const start = index * bar;
    const end = start + bar;
    const active = notes.filter(note => note.beat < end - EPS && note.beat + note.duration > start + EPS);
    const boundaries = [...new Set([start, end, ...active.flatMap(note => [Math.max(start, note.beat), Math.min(end, note.beat + note.duration)])])].sort((a, b) => a - b);
    const measure: NotationMeasure = { index, start, duration: bar, events: [], slots: [] };
    for (let i = 0; i < boundaries.length - 1; i++) {
      let cursor = boundaries[i];
      const segmentEnd = boundaries[i + 1];
      while (cursor < segmentEnd - EPS) {
        const nextBeat = Math.abs(cursor - Math.round(cursor)) > EPS ? Math.ceil(cursor) : segmentEnd;
        for (const duration of pieces(Math.min(segmentEnd, nextBeat) - cursor)) {
          const sounding = active.filter(note => note.beat <= cursor + EPS && note.beat + note.duration > cursor + EPS);
          const events: NotationEvent[] = sounding.length ? sounding.map(note => ({
            id: `${note.id}-${cursor}`, sourceId: note.id, start: cursor, duration,
            pitch: note.pitch === null ? null : note.pitch + score.transpose, implicit: false, tieIn: false, tieOut: false
          })) : [{ id: `gap-${index}-${cursor}`, sourceId: `gap-${index}-${cursor}`, start: cursor, duration, pitch: null, implicit: true, tieIn: false, tieOut: false }];
          measure.events.push(...events);
          measure.slots.push({ start: cursor, duration, events });
          for (const event of events) if (event.pitch !== null) {
            const group = bySource.get(event.sourceId) ?? [];
            group.push(event);
            bySource.set(event.sourceId, group);
          }
          cursor += duration;
        }
      }
    }
    measures.push(measure);
  }
  for (const group of bySource.values()) group.forEach((event, index) => {
    event.tieIn = index > 0;
    event.tieOut = index < group.length - 1;
  });
  return measures;
}

export function layoutNotation(measures: NotationMeasure[], available: number): NotationSystem[] {
  const minimum = Math.max(190, ...measures.map(measure => 130 + measure.slots.length * 38));
  const width = Math.max(Math.floor(available), minimum);
  const columns = Math.max(1, Math.floor(width / minimum));
  // Keep the final barline inside the SVG rather than clipping its stroke.
  const cellWidth = (width - 2) / columns;
  const systems: NotationSystem[] = [];
  for (let index = 0; index < measures.length; index += columns) {
    systems.push({ width, columns, measures: measures.slice(index, index + columns).map(measure => ({ measure, width: cellWidth })) });
  }
  return systems;
}

export function notationDuration(duration: number): { code: string; dots: number } {
  const names: Record<number, string> = { 4: 'w', 2: 'h', 1: 'q', .5: '8', .25: '16' };
  if (names[duration]) return { code: names[duration], dots: 0 };
  const base = duration / 1.5;
  if (names[base]) return { code: names[base], dots: 1 };
  return { code: '16', dots: 0 };
}
