import { blankScore, type Score } from './model';

const DEGREES = [0, 0, 2, 4, 5, 7, 9, 11];
const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function tonicToMidi(value: string): number {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(value.trim());
  if (!match) throw new Error('调名请使用 C4、F#3、Bb4 等格式');
  const offset = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  const midi = (Number(match[3]) + 1) * 12 + NAMES[match[1].toUpperCase()] + offset;
  if (midi < 0 || midi > 127) throw new Error('调名音高超出 MIDI 范围');
  return midi;
}

export function parseJianpu(text: string, opts: { title: string; tonic: string; bpm: number; numerator: number; denominator: number }): Score {
  const score = blankScore(opts.title.trim() || '简谱导入');
  score.source = 'jianpu';
  score.tonicMidi = tonicToMidi(opts.tonic);
  score.bpm = opts.bpm;
  score.meter = { numerator: opts.numerator, denominator: opts.denominator };
  if (!Number.isFinite(score.bpm) || score.bpm < 20 || score.bpm > 400) throw new Error('BPM 需为 20–400');
  if (!Number.isInteger(opts.numerator) || opts.numerator < 1 || opts.numerator > 16 || ![2, 4, 8, 16].includes(opts.denominator)) throw new Error('拍号无效');
  const tokens = text.replace(/\|/g, ' | ').split(/\s+/).filter(Boolean);
  let beat = 0;
  for (const token of tokens) {
    if (token === '|') continue;
    const match = /^([\^_]*)([#b]?)([0-7])(?::(\d+(?:\.\d+)?))?$/.exec(token);
    if (!match) throw new Error(`无法识别「${token}」；示例：1:1 #3:0.5 ^1:2 0:1`);
    const duration = match[4] === undefined ? 1 : Number(match[4]);
    if (!(duration > 0 && duration <= 64)) throw new Error(`「${token}」的音长需大于 0 且不超过 64 拍`);
    const degree = Number(match[3]);
    const octave = [...match[1]].reduce((sum, symbol) => sum + (symbol === '^' ? 1 : -1), 0);
    const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
    const pitch = degree === 0 ? null : score.tonicMidi + DEGREES[degree] + octave * 12 + accidental;
    if (pitch !== null && (pitch < 0 || pitch > 127)) throw new Error(`「${token}」的音高超出 MIDI 范围`);
    score.notes.push({ id: crypto.randomUUID(), beat, duration, pitch });
    beat += duration;
  }
  if (!score.notes.length) throw new Error('请输入至少一个音符或休止符');
  return score;
}
