// Teaching examples are independent of the editable library and use quarter-note units.
export type GuideNote = { pitch: number | null; duration: number; accidental?: '#' | 'b' | 'n'; tieToNext?: boolean };
export { GUIDE_SOURCES, guideSourceUrl } from '../../electron/guideSources';
export const RHYTHM_VALUES = [
  { name: '全音符', duration: 4, code: 'w' },
  { name: '二分音符', duration: 2, code: 'h' },
  { name: '四分音符', duration: 1, code: 'q' },
  { name: '八分音符', duration: .5, code: '8' },
  { name: '十六分音符', duration: .25, code: '16' }
] as const;
export function guideDuration(duration: number) {
  const exact = RHYTHM_VALUES.find(value => value.duration === duration);
  if (exact) return { code: exact.code, dotted: false };
  const dotted = RHYTHM_VALUES.find(value => value.duration * 1.5 === duration);
  if (dotted) return { code: dotted.code, dotted: true };
  throw new Error(`教学示例不支持的时值：${duration}`);
}
export function guideJianpu(note: GuideNote) {
  const { code, dotted } = guideDuration(note.duration);
  const names = ['1', '1', '2', '2', '3', '4', '4', '5', '5', '6', '6', '7'];
  const naturalPitch = note.pitch === null ? 60 : note.pitch - (note.accidental === '#' ? 1 : note.accidental === 'b' ? -1 : 0);
  return {
    digit: note.pitch === null ? '0' : names[naturalPitch % 12],
    octave: note.pitch === null ? 0 : Math.floor(naturalPitch / 12) - 5,
    underlines: code === '8' ? 1 : code === '16' ? 2 : 0,
    dotted: dotted && note.duration < 2,
    // Long rests repeat zero; dashes lengthen sounding notes only.
    tail: note.duration >= 2 ? Array.from({ length: note.duration - 1 }, () => note.pitch === null ? '0' : '—') : []
  };
}
export const GUIDE_MEASURES: readonly { notes: readonly GuideNote[]; explanation: string }[] = [
  { notes: [{ pitch: 60, duration: 1 }, { pitch: 62, duration: .5 }, { pitch: 64, duration: .5 }, { pitch: 65, duration: 1 }, { pitch: null, duration: 1 }], explanation: 'C4 一拍，D4、E4 各半拍，F4 一拍，最后休止一拍。数“1、2 和、3、4”。' },
  { notes: [{ pitch: 67, duration: 1.5 }, { pitch: 69, duration: .5 }, { pitch: 67, duration: 2 }], explanation: '附点四分音符 G4 持续一拍半，A4 半拍，G4 两拍。延长线表示继续保持同一个音。' },
  { notes: [{ pitch: 72, duration: 2, tieToNext: true }, { pitch: 72, duration: 2 }], explanation: '两个 C5 用延音线连接，共持续四拍；第二个音不重新起音。简谱上方的点表示高一个八度。' },
  { notes: [{ pitch: 64, duration: 1 }, { pitch: 62, duration: 1 }, { pitch: 60, duration: 1 }, { pitch: null, duration: 1 }], explanation: 'E4、D4、C4 各一拍，再休止一拍；粗细双线表示这段示例结束。' }
];
