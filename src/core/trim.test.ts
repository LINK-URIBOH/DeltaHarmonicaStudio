import { describe, expect, it } from 'vitest';
import { beatToSeconds, blankScore, validateScore } from './model';
import { leadingBlankBeats, trimLeadingBlank } from './trim';

describe('trim leading silence', () => {
  it('removes leading rests, clips a crossing rest and preserves exact musical timing', () => {
    const score = blankScore();
    score.notes = [{ id: 'rest', beat: 0, duration: 2, pitch: null }, { id: 'cross', beat: 1, duration: 5, pitch: null }, { id: 'first', beat: 2.13, duration: .17, pitch: 60 }, { id: 'later', beat: 4.56, duration: 1.2, pitch: 64 }];
    const original = structuredClone(score);
    const trimmed = trimLeadingBlank(score);
    expect(leadingBlankBeats(trimmed)).toBe(0);
    expect(trimmed.notes.map(note => note.id)).toEqual(['cross', 'first', 'later']);
    expect(trimmed.notes[0]).toMatchObject({ beat: 0, pitch: null });
    expect(trimmed.notes[0].duration).toBeCloseTo(6 - 2.13);
    expect(trimmed.notes[1]).toMatchObject({ beat: 0, duration: .17, pitch: 60 });
    expect(trimmed.notes[2].beat).toBeCloseTo(4.56 - 2.13);
    expect(trimmed.notes[2].duration).toBe(1.2);
    expect(score).toEqual(original); expect(validateScore(trimmed)).toBe(true);
  });
  it('uses the tempo at the new start and shifts later changes without changing performance timing', () => {
    const score = blankScore(); score.bpm = 120;
    score.tempoChanges = [{ beat: 6, bpm: 90 }, { beat: 1, bpm: 100 }, { beat: 4, bpm: 60 }, { beat: 4, bpm: 80 }];
    score.notes = [{ id: 'a', beat: 4, duration: 4, pitch: 60 }, { id: 'b', beat: 9, duration: 1, pitch: 64 }];
    const trimmed = trimLeadingBlank(score);
    expect(trimmed.bpm).toBe(80);
    expect(trimmed.tempoChanges).toEqual([{ beat: 2, bpm: 90 }]);
    for (const beat of [4, 5, 6, 8, 9, 10]) expect(beatToSeconds(trimmed, beat - 4)).toBeCloseTo(beatToSeconds(score, beat) - beatToSeconds(score, 4));
  });
  it('leaves empty, silent-only and already immediate scores unchanged', () => {
    const score = blankScore(); expect(trimLeadingBlank(score)).toBe(score);
    score.notes = [{ id: 'r', beat: 5, duration: 1, pitch: null }];
    expect(trimLeadingBlank(score)).toBe(score);
    score.notes.push({ id: 'n', beat: 0, duration: 1, pitch: 0 });
    expect(trimLeadingBlank(score)).toBe(score);
  });
});
