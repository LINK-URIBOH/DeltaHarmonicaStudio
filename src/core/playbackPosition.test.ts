import { describe, expect, it } from 'vitest';
import { eventPlaybackFraction, notationPlaybackX, playbackScrollLeft, type PlaybackMeasure } from './playbackPosition';

describe('playback display positions', () => {
  const measures: PlaybackMeasure[] = [
    { start: 0, end: 4, anchors: [{ beat: 0, x: 110 }, { beat: 1, x: 150 }, { beat: 3, x: 230 }, { beat: 4, x: 280 }] },
    { start: 4, end: 8, anchors: [{ beat: 4, x: 310 }, { beat: 8, x: 550 }] }
  ];
  it('interpolates precise unsnapped beats between actual layout anchors', () => {
    expect(notationPlaybackX(measures, .13)).toBeCloseTo(115.2);
    expect(notationPlaybackX(measures, 2)).toBe(190);
    expect(notationPlaybackX(measures, 3.5)).toBe(255);
    expect(notationPlaybackX(measures, 4)).toBe(310);
  });
  it('selects a new row at its start and avoids final-row blank columns', () => {
    const next = [{ start: 8, end: 12, anchors: [{ beat: 8, x: 110 }, { beat: 12, x: 280 }] }];
    expect(notationPlaybackX(measures, 8)).toBeNull();
    expect(notationPlaybackX(next, 8)).toBe(110);
    expect(notationPlaybackX(next, 12)).toBeNull();
    expect(notationPlaybackX(measures, null)).toBeNull();
    expect(notationPlaybackX(measures, -1)).toBeNull();
  });
  it('marks rests and simultaneous events only during their original exact intervals', () => {
    const rest = { id: 'r', beat: 1.03, duration: .17, pitch: null };
    const chord = { ...rest, id: 'n', duration: 1, pitch: 60 };
    expect(eventPlaybackFraction(rest, 1.115)).toBeCloseTo(.5);
    expect(eventPlaybackFraction(chord, 1.115)).toBeCloseTo(.085);
    expect(eventPlaybackFraction(rest, 1)).toBeNull();
    expect(eventPlaybackFraction(rest, rest.beat + rest.duration)).toBeNull();
    expect(eventPlaybackFraction(rest, null)).toBeNull();
  });
  it('keeps the timeline cursor at one third and clamps to both scroll boundaries', () => {
    for (const scale of [24, 64, 256]) {
      const left = playbackScrollLeft(20.13, scale, 600, 12000);
      expect(72 + 20.13 * scale - left).toBeCloseTo(200);
    }
    expect(playbackScrollLeft(0, 64, 600, 2000)).toBe(0);
    expect(playbackScrollLeft(100, 64, 600, 2000)).toBe(1400);
    expect(playbackScrollLeft(100, 64, 600, 300)).toBe(0);
  });
});
