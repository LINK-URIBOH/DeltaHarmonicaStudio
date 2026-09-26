import { useEffect, useMemo, useRef, useState } from 'react';
import { pitchName } from './core/harmonica';
import { type MidiImportData } from './core/importers';
import { buildMidiScores, midiPreview, type MidiImportMode, type OverlapPolicy } from './core/midiImport';
import { auditionBeat, MidiAudition } from './core/midiAudition';
import { beatToSeconds, endBeat, type Score } from './core/model';

const COLORS = ['#548a39', '#397fa1', '#a96735', '#8865b3', '#ab5277', '#437d70'];
export const formatMidiTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function MiniRoll({ score, colors, position }: { score: Score; colors: ReadonlyMap<string, string>; position: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    function draw() {
      if (!target) return;
      const width = target.clientWidth || 600;
      const height = 220;
      const ratio = window.devicePixelRatio || 1;
      target.width = width * ratio;
      target.height = height * ratio;
      const context = target.getContext('2d');
      if (!context) return;
      context.scale(ratio, ratio);
      context.fillStyle = '#fafcf8'; context.fillRect(0, 0, width, height);
      const pitches = score.notes.filter(note => note.pitch !== null).map(note => note.pitch!);
      const low = Math.min(60, ...pitches);
      const high = Math.max(72, ...pitches);
      const length = Math.max(4, endBeat(score));
      const row = (height - 40) / (high - low + 1);
      const left = 42;
      context.font = '10px Microsoft YaHei';
      for (let pitch = low; pitch <= high; pitch++) {
        const y = 18 + (high - pitch) * row;
        if (pitch % 12 === 0 || pitch === high || pitch === low) {
          context.fillStyle = '#7e927f'; context.fillText(pitchName(pitch), 3, y + Math.min(row, 12));
          context.strokeStyle = '#dfe8dc'; context.beginPath(); context.moveTo(left, y); context.lineTo(width, y); context.stroke();
        }
      }
      const bar = score.meter.numerator * 4 / score.meter.denominator;
      const step = Math.max(bar, Math.ceil(length / bar / 16) * bar);
      for (let beat = 0; beat < length; beat += step) {
        const x = left + beat / length * (width - left - 8);
        context.strokeStyle = '#e1e9df'; context.beginPath(); context.moveTo(x, 16); context.lineTo(x, height - 20); context.stroke();
        context.fillStyle = '#7e927f'; context.fillText(String(Math.round(beat / bar) + 1), x + 2, height - 5);
      }
      for (const note of score.notes) if (note.pitch !== null) {
        context.fillStyle = colors.get(note.id) ?? COLORS[0];
        context.fillRect(left + note.beat / length * (width - left - 8), 18 + (high - note.pitch) * row,
          Math.max(1, note.duration / length * (width - left - 8)), Math.max(2, row - 1));
      }
    }
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(target);
    return () => observer.disconnect();
  }, [score, colors]);
  return <div className="midi-roll"><canvas ref={canvas} role="img" aria-label="MIDI 音符缩略图" />{!score.notes.length && <span>请选择要预览的声部</span>}
    <div className="midi-roll-progress" style={{ left: `calc(${Math.min(1, position) * 100}% + ${42 - Math.min(1, position) * 50}px)` }} />
  </div>;
}

type Props = { data: MidiImportData; title: string; onClose: () => void; onImport: (scores: Score[]) => Promise<void> };
export default function MidiImportDialog({ data, title, onClose, onImport }: Props) {
  const initial = data.parts.find(part => !part.percussion);
  const [chosen, setChosen] = useState(new Set(initial ? [initial.id] : []));
  const [focusedId, setFocusedId] = useState(initial?.id ?? data.parts[0]?.id);
  const [mode, setMode] = useState<MidiImportMode>('separate');
  const [policy, setPolicy] = useState<OverlapPolicy>('highest');
  const [view, setView] = useState<'raw' | 'converted'>('raw');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [playback, setPlayback] = useState({ seconds: 0, playing: false });
  const player = useRef<MidiAudition | null>(null);
  if (!player.current) player.current = new MidiAudition((seconds, playing) => setPlayback({ seconds, playing }));
  const selected = data.parts.filter(part => chosen.has(part.id));
  const previewParts = mode === 'merge' ? selected : data.parts.filter(part => part.id === focusedId);
  const preview = useMemo(() => midiPreview(previewParts, title, policy), [data, chosen, focusedId, mode, policy, title]);
  const score = view === 'raw' ? preview.raw : preview.converted;
  const duration = beatToSeconds(score, endBeat(score));
  const colors = useMemo(() => new Map(data.parts.flatMap((part, index) => part.notes.map(note => [note.id, COLORS[index % COLORS.length]] as const))), [data]);
  const resultCount = mode === 'separate' ? selected.length : selected.length ? 1 : 0;
  useEffect(() => { player.current!.stop(); return () => player.current!.stop(); }, [preview, view]);

  async function submit() {
    if (busyRef.current || !chosen.size) return;
    busyRef.current = true; setBusy(true); setError(''); player.current!.stop();
    try { await onImport(buildMidiScores(data, chosen, mode, policy, title)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function audition() {
    setError('');
    try { await player.current!.play(score); }
    catch (cause) { setError(`试听无法启动：${cause instanceof Error ? cause.message : String(cause)}`); }
  }

  return <div className="modal-backdrop"><div className="modal midi-import-modal" role="dialog" aria-modal="true" aria-label="MIDI 导入预览">
    <button className="modal-close" aria-label="关闭 MIDI 预览" disabled={busy} onClick={onClose}>×</button>
    <span className="eyebrow">MIDI IMPORT</span><h2>选择声部，试听后导入</h2><p className="midi-filename">{title}</p>
    <div className="midi-import-summary" aria-live="polite"><span>原始轨道 <b>{data.originalTrackCount}</b></span><span>可导入声部 <b>{data.parts.length}</b></span><span>鼓声部 <b>{data.parts.filter(part => part.percussion).length}</b></span><span>已选 <b>{selected.length}</b></span><span>将生成 <b>{resultCount}</b> 首谱</span></div>
    <p className="midi-help">轨道可能按通道和乐器拆成多个声部；纯速度或信息轨道不列为可选声部。默认选择不代表主旋律，请先试听确认。</p>
    <div className="midi-import-settings"><label>导入方式<select aria-label="MIDI 导入方式" value={mode} disabled={busy} onChange={event => setMode(event.target.value as MidiImportMode)}><option value="separate">分别成谱</option><option value="merge">合并成谱</option></select></label>
      <label>重叠音符处理<select aria-label="MIDI 重叠音符处理" value={policy} disabled={busy} onChange={event => setPolicy(event.target.value as OverlapPolicy)}><option value="highest">保留最高音</option><option value="lowest">保留最低音</option><option value="first">保留首个音（同拍按列表顺序）</option></select></label></div>
    {error && <div className="midi-import-error" role="alert">{error}</div>}
    <div className="midi-import-body"><div className="midi-part-list" aria-label="MIDI 声部列表">{data.parts.map((part, index) => <div key={part.id} className={`midi-part ${part.id === focusedId ? 'focused' : ''}`}>
      <input type="checkbox" aria-label={`导入声部 ${index + 1}：${part.name}`} checked={chosen.has(part.id)} disabled={busy} onChange={() => setChosen(previous => { const next = new Set(previous); if (next.has(part.id)) next.delete(part.id); else next.add(part.id); return next; })} />
      <button className="midi-part-details" disabled={busy} onClick={() => setFocusedId(part.id)}><strong><i style={{ background: COLORS[index % COLORS.length] }} />{part.name}{part.percussion && <em>鼓声部</em>}</strong><span>{part.instrument} · 通道 {part.channel}</span><span>{part.stats.noteCount} 个音 · {formatMidiTime(part.stats.durationSeconds)} · {pitchName(part.stats.minPitch)}～{pitchName(part.stats.maxPitch)}</span><span>重叠 {part.stats.overlaps} · 超音域 {part.stats.outOfRange}</span></button>
    </div>)}</div>
    <section className="midi-preview"><h3>{mode === 'merge' ? '所选声部合并预览' : data.parts.find(part => part.id === focusedId)?.name}</h3>
      <div className="segmented"><button disabled={busy} className={view === 'raw' ? 'selected' : ''} onClick={() => setView('raw')}>原始音符</button><button disabled={busy} className={view === 'converted' ? 'selected' : ''} onClick={() => setView('converted')}>口琴转换结果</button></div>
      <MiniRoll score={score} colors={colors} position={auditionBeat(score, playback.seconds) / Math.max(4, endBeat(score))} />
      {mode === 'merge' && <div className="midi-legend">{previewParts.map(part => <span key={part.id}><i style={{ background: colors.get(part.notes[0].id) }} />{part.name}</span>)}</div>}
      <div className="midi-conversion-stats">原始 {preview.raw.notes.length} → 转换后 {preview.converted.notes.length} 个音<br />省略 {preview.omitted} · 截短 {preview.shortened} · 转换后超音域 {preview.outOfRange}</div>
      <div className="midi-audition"><button className="subtle-button" disabled={busy || !score.notes.length || playback.playing} onClick={() => void audition()}>试听</button><button className="subtle-button" disabled={!playback.playing} onClick={() => player.current!.stop()}>停止</button><span aria-live="off">{formatMidiTime(playback.seconds)} / {formatMidiTime(duration)}</span></div>
      <progress className="midi-audio-progress" aria-label="试听进度" value={playback.seconds} max={duration || 1} />
      <p className="midi-help">简易音色试听，不还原原乐器。原始音符保留精确时间，转换结果与导入一致。</p>
      {(selected.some(part => part.percussion) || previewParts.some(part => part.percussion)) && <p className="midi-drum-warning">鼓件编号将作为音高导入，不建议用于口琴旋律。</p>}
    </section></div>
    <div className="midi-import-footer"><button className="subtle-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !selected.length} onClick={() => void submit()}>{busy ? '正在写入曲库…' : `导入 ${selected.length} 个声部，生成 ${resultCount} 首谱`}</button></div>
  </div></div>;
}
