import { describe, expect, it } from 'vitest';
import { blankScore } from './model';
import { buildNotation, layoutNotation, notationDuration } from './notation';
import { draggedNote, groupPitchDelta, noteRect, notesInRect, nextOutOfRange, timelineFocusPosition, timelinePitchBounds, zoomScrollLeft } from './timeline';
import { pitchName } from './harmonica';

describe('timeline editing', () => {
  const note = { id: 'n', beat: 2, duration: 1, pitch: 60 };

  it('keeps the beat under the pointer fixed while zooming', () => {
    const before = (120 + 180 - 72) / 64;
    const after = (zoomScrollLeft(64, 128, 120, 180) + 180 - 72) / 128;
    expect(after).toBeCloseTo(before);
  });

  it('resizes from either edge without moving the note body or pitch', () => {
    expect(draggedNote(note, 'start', .5, 3)).toEqual({ beat: 2.5, duration: .5, pitch: 60 });
    expect(draggedNote(note, 'end', .5, 3)).toEqual({ beat: 2, duration: 1.5, pitch: 60 });
    expect(draggedNote(note, 'move', .5, 3)).toEqual({ beat: 2.5, duration: 1, pitch: 57 });
  });
  it('selects intersecting short, long and rest blocks at different scales', () => {
    const notes = [note, { id: 'long', beat: 4, duration: 12, pitch: 60 }, { id: 'rest', beat: 2, duration: .01, pitch: null }];
    for (const scale of [24, 64, 256]) {
      const rect = noteRect(notes[1], 12, 96, scale);
      expect(notesInRect(notes, { left: rect.right - 2, right: rect.right + 2, top: rect.top + 1, bottom: rect.bottom }, 12, 96, scale)).toEqual(['long']);
      const rest = noteRect(notes[2], 0, 84, scale);
      expect(rest.right - rest.left).toBe(24);
      expect(notesInRect(notes, rest, 0, 84, scale)).toEqual(['rest']);
    }
  });
  it('constrains a whole group together and excludes rests from pitch limits', () => {
    const notes = [{ ...note, pitch: 2 }, { ...note, id: 'top', pitch: 125 }, { ...note, id: 'r', pitch: null }];
    expect(groupPitchDelta(notes, 12)).toBe(2);
    expect(groupPitchDelta(notes, -12)).toBe(-2);
    expect(groupPitchDelta([notes[2]], 12)).toBe(0);
    expect(groupPitchDelta([note], 1.4)).toBe(1);
  });
});

describe('out-of-range navigation', () => {
  const notes = [
    { id: 'a', beat: 1, duration: 1, pitch: 40 },
    { id: 'b', beat: 1, duration: 1, pitch: 60 },
    { id: 'c', beat: 1, duration: 1, pitch: 90 },
    { id: 'rest', beat: 2, duration: 1, pitch: null }
  ];
  const ids = new Set(['a', 'c']);
  it('wraps in both directions and respects stable same-beat ordering', () => {
    expect(nextOutOfRange(notes, ids, null, 1)?.id).toBe('a');
    expect(nextOutOfRange(notes, ids, null, -1)?.id).toBe('c');
    expect(nextOutOfRange(notes, ids, 'b', 1)?.id).toBe('c');
    expect(nextOutOfRange(notes, ids, 'b', -1)?.id).toBe('a');
    expect(nextOutOfRange(notes, ids, 'c', 1)?.id).toBe('a');
    expect(nextOutOfRange(notes, ids, 'a', -1)?.id).toBe('c');
  });
  it('handles empty, single and stale selections', () => {
    expect(nextOutOfRange(notes, new Set(), 'a', 1)).toBeNull();
    expect(nextOutOfRange(notes, new Set(['c']), 'c', 1)?.id).toBe('c');
    expect(nextOutOfRange(notes, new Set(['c']), 'c', -1)?.id).toBe('c');
    expect(nextOutOfRange(notes, ids, 'deleted', -1)?.id).toBe('c');
  });
  it('covers transposed pitches beyond MIDI limits and formats their labels', () => {
    expect(timelinePitchBounds([{ id: 'low', beat: 0, duration: 1, pitch: 0 }], -12)).toEqual({ high: 84, low: -12 });
    expect(timelinePitchBounds([{ id: 'high', beat: 0, duration: 1, pitch: 127 }], 12)).toEqual({ high: 144, low: 48 });
    expect(pitchName(-1)).toBe('B-2');
    expect(pitchName(139)).toBe('G10');
  });
  it('centers short notes at the current scale and exposes long-note starts', () => {
    const note = { id: 'n', beat: 20, duration: .25, pitch: 90 };
    const short = timelineFocusPosition(note, 0, 96, 128, 500, 240);
    expect(short.left).toBe(2398);
    expect(short.top).toBe(122);
    expect(timelineFocusPosition({ ...note, duration: 10 }, 0, 96, 128, 500, 240).left).toBe(2614);
  });
});

describe('continuous notation data', () => {
  it('splits off-beat notes at the next beat without changing timing', () => {
    const score = blankScore();
    score.notes = [{ id: 'syncopation', beat: 1.5, duration: 1, pitch: 60 }];
    const events = buildNotation(score)[0].events.filter(event => event.sourceId === 'syncopation');
    expect(events.map(event => [event.start, event.duration])).toEqual([[1.5, .5], [2, .5]]);
    expect(events[0].tieOut).toBe(true);
    expect(events[1].tieIn).toBe(true);
  });
  it('splits notes across measures and ties both parts', () => {
    const score = blankScore();
    score.notes = [{ id: 'long', beat: 3, duration: 2, pitch: 60 }];
    const [first, second] = buildNotation(score);
    expect(first.events.find(event => event.sourceId === 'long')).toMatchObject({ start: 3, duration: 1, tieOut: true });
    expect(second.events.find(event => event.sourceId === 'long')).toMatchObject({ start: 4, duration: 1, tieIn: true });
    expect(first.events[0]).toMatchObject({ pitch: null, implicit: true, duration: 3 });
  });

  it('quantizes only preview boundaries and keeps source timing intact', () => {
    const score = blankScore();
    score.transpose = 2;
    score.notes = [{ id: 'odd', beat: .3, duration: .7, pitch: 60 }];
    const original = structuredClone(score);
    const event = buildNotation(score)[0].events.find(item => item.sourceId === 'odd');
    expect(event).toMatchObject({ start: .25, duration: .75, pitch: 62 });
    expect(notationDuration(event!.duration)).toEqual({ code: '8', dots: 1 });
    expect(score).toEqual(original);
  });

  it('keeps short notes and groups coincident notes without duplicating time', () => {
    const score = blankScore();
    score.notes = [{ id: 'a', beat: .01, duration: .03, pitch: 60 }, { id: 'b', beat: .04, duration: .02, pitch: 64 }];
    const measure = buildNotation(score)[0];
    expect(measure.slots[0].duration).toBe(.25);
    expect(measure.slots[0].events.map(event => event.sourceId)).toEqual(['a', 'b']);
    expect(measure.slots.reduce((sum, slot) => sum + slot.duration, 0)).toBe(4);
  });

  it('ties notes through overlapping slots and barlines', () => {
    const score = blankScore();
    score.notes = [{ id: 'long', beat: 3.1, duration: 2, pitch: 60 }, { id: 'short', beat: 3.2, duration: .5, pitch: 64 }];
    const measures = buildNotation(score);
    const long = measures.flatMap(measure => measure.events).filter(event => event.sourceId === 'long');
    expect(long[0].tieOut).toBe(true);
    expect(long.at(-1)?.tieIn).toBe(true);
    expect(long.reduce((sum, event) => sum + event.duration, 0)).toBe(2);
  });

  it('aligns every column and reserves blank space on an incomplete last row', () => {
    const score = blankScore();
    score.notes = Array.from({ length: 20 }, (_, index) => ({ id: String(index), beat: index, duration: 1, pitch: 60 }));
    const measures = buildNotation(score);
    const rows = layoutNotation(measures, 900);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.width)).toEqual([900, 900]);
    expect(rows[0].columns).toBe(3);
    expect(rows[1].measures).toHaveLength(2);
    for (const item of rows.flatMap(row => row.measures)) expect(item.width).toBeCloseTo(898 / 3);
    expect(layoutNotation(measures, 600).map(row => row.measures.length)).toEqual([2, 2, 1]);
    expect(rows.flatMap(row => row.measures)).toHaveLength(measures.length);
  });
});
