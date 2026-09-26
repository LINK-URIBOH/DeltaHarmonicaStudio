import type { Note } from './model';

export const DEFAULT_PX_PER_BEAT = 64;
export const MIN_PX_PER_BEAT = 24;
export const MAX_PX_PER_BEAT = 256;
export const TIMELINE_LEFT = 72;
export const TIMELINE_ROW = 28;
export const TIMELINE_TOP = 32;
export type TimelineFocus = { noteId: string; sequence: number };

export type SelectionRect = { left: number; top: number; right: number; bottom: number };
export function noteRect(note: Note, transpose: number, high: number, scale: number): SelectionRect {
  const left = TIMELINE_LEFT + note.beat * scale + 2;
  const row = note.pitch === null ? 0 : high - (note.pitch + transpose) + 1;
  const top = TIMELINE_TOP + row * TIMELINE_ROW + 3;
  return { left, top, right: left + Math.max(24, note.duration * scale - 4), bottom: top + 22 };
}
export function notesInRect(notes: readonly Note[], rect: SelectionRect, transpose: number, high: number, scale: number): string[] {
  return notes.filter(note => {
    const n = noteRect(note, transpose, high, scale);
    return n.left <= rect.right && n.right >= rect.left && n.top <= rect.bottom && n.bottom >= rect.top;
  }).map(note => note.id);
}
export function groupPitchDelta(notes: readonly Note[], requested: number): number {
  const pitches = notes.filter(note => note.pitch !== null).map(note => note.pitch!);
  if (!pitches.length) return 0;
  return Math.max(-Math.min(...pitches), Math.min(127 - Math.max(...pitches), Math.round(requested)));
}

export function timelinePitchBounds(notes: readonly Note[], transpose: number) {
  const pitches = notes.filter(note => note.pitch !== null).map(note => note.pitch! + transpose);
  return {
    high: Math.ceil(Math.max(84, ...pitches) / 12) * 12,
    low: Math.floor(Math.min(48, ...pitches) / 12) * 12
  };
}

export function nextOutOfRange(orderedNotes: readonly Note[], ids: ReadonlySet<string>, selectedId: string | null, direction: -1 | 1): Note | null {
  const candidates = orderedNotes.filter(note => ids.has(note.id));
  if (!candidates.length) return null;
  const current = orderedNotes.findIndex(note => note.id === selectedId);
  if (current < 0) return direction === 1 ? candidates[0] : candidates[candidates.length - 1];
  for (let offset = 1; offset <= orderedNotes.length; offset++) {
    const index = (current + direction * offset + orderedNotes.length) % orderedNotes.length;
    if (ids.has(orderedNotes[index].id)) return orderedNotes[index];
  }
  return null;
}

export function timelineFocusPosition(note: Note, transpose: number, high: number, scale: number, viewportWidth: number, viewportHeight: number) {
  const left = TIMELINE_LEFT + note.beat * scale + 2;
  const noteWidth = Math.max(24, note.duration * scale - 4);
  const row = note.pitch === null ? 0 : high - (note.pitch + transpose) + 1;
  return {
    left: Math.max(0, noteWidth > viewportWidth - 40 ? left - 20 : left + noteWidth / 2 - viewportWidth / 2),
    top: Math.max(0, TIMELINE_TOP + row * TIMELINE_ROW + 14 - viewportHeight / 2)
  };
}

export function snapBeat(value: number): number {
  return Math.max(0, Math.round(value * 4) / 4);
}

export function zoomScrollLeft(oldScale: number, newScale: number, scrollLeft: number, anchorX: number): number {
  const beat = (scrollLeft + anchorX - TIMELINE_LEFT) / oldScale;
  return Math.max(0, TIMELINE_LEFT + beat * newScale - anchorX);
}

export function draggedNote(note: Note, kind: 'move' | 'start' | 'end', horizontalBeats: number, verticalSemitones: number): Pick<Note, 'beat' | 'duration' | 'pitch'> {
  const delta = Math.round(horizontalBeats * 4) / 4;
  if (kind === 'start') {
    const beat = snapBeat(Math.min(note.beat + note.duration - .25, note.beat + delta));
    return { beat, duration: Math.max(.25, Math.round((note.beat + note.duration - beat) * 4) / 4), pitch: note.pitch };
  }
  if (kind === 'end') return { beat: note.beat, duration: Math.max(.25, Math.round((note.duration + delta) * 4) / 4), pitch: note.pitch };
  return { beat: snapBeat(note.beat + delta), duration: note.duration, pitch: note.pitch === null ? null : Math.max(0, Math.min(127, note.pitch - verticalSemitones)) };
}
