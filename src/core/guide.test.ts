import { describe, expect, it } from 'vitest';
import { GUIDE_MEASURES, GUIDE_SOURCES, RHYTHM_VALUES, guideDuration, guideJianpu, guideSourceUrl } from './guide';

describe('read-only teaching notation', () => {
  it('keeps each of the four shared example measures at four quarter-note beats', () => {
    const original = JSON.stringify(GUIDE_MEASURES);
    expect(GUIDE_MEASURES).toHaveLength(4);
    for (const measure of GUIDE_MEASURES) {
      expect(measure.notes.reduce((sum, note) => sum + note.duration, 0)).toBe(4);
      for (const [index, note] of measure.notes.entries()) {
        guideDuration(note.duration);
        guideJianpu(note);
        if (note.tieToNext) expect(measure.notes[index + 1].pitch).toBe(note.pitch);
      }
    }
    expect(JSON.stringify(GUIDE_MEASURES)).toBe(original);
  });
  it('distinguishes octave dots, augmentation dots, duration lines and long rests', () => {
    expect(guideJianpu({ pitch: 48, duration: 1 }).octave).toBe(-1);
    expect(guideJianpu({ pitch: 60, duration: 1 }).octave).toBe(0);
    expect(guideJianpu({ pitch: 72, duration: 1 }).octave).toBe(1);
    expect(guideJianpu({ pitch: 60, duration: 1.5 }).dotted).toBe(true);
    expect(guideJianpu({ pitch: 60, duration: .25 }).underlines).toBe(2);
    expect(guideJianpu({ pitch: 60, duration: 4 }).tail).toEqual(['—', '—', '—']);
    expect(guideJianpu({ pitch: null, duration: 4 }).tail).toEqual(['0', '0', '0']);
    expect(guideJianpu({ pitch: 63, duration: 1, accidental: 'b' }).digit).toBe('3');
    expect(guideJianpu({ pitch: 61, duration: 1, accidental: '#' }).digit).toBe('1');
    expect(guideJianpu({ pitch: 60, duration: 3 }).tail).toEqual(['—', '—']);
    for (const value of RHYTHM_VALUES) expect(guideDuration(value.duration)).toEqual({ code: value.code, dotted: false });
  });
  it('only opens preset source identifiers, rejecting arbitrary URLs and values', () => {
    for (const source of GUIDE_SOURCES) expect(guideSourceUrl(source.id)).toBe(source.url);
    for (const value of ['https://example.com', 'file:///C:/Windows', 'javascript:alert(1)', 'staff?x=1', '__proto__', {}, null, 0]) expect(guideSourceUrl(value)).toBeNull();
  });
});
