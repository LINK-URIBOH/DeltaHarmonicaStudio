import { useEffect, useMemo, useRef, useState } from 'react';
import { Accidental, Dot, Formatter, Renderer, Stave, StaveNote } from 'vexflow/core';
import { loadNotationFonts } from './notationFonts';
import { buildNotation, layoutNotation, notationDuration, type NotationEvent, type NotationSystem } from './core/notation';
import type { Score } from './core/model';
import { notationPlaybackX, type PlaybackMeasure } from './core/playbackPosition';

const DEGREES = ['1', '♯1', '2', '♯2', '3', '4', '♯4', '5', '♯5', '6', '♯6', '7'];
const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
function midiKey(pitch: number): string {
  const safe = Math.max(0, Math.min(127, pitch));
  return `${NAMES[safe % 12]}/${Math.floor(safe / 12) - 1}`;
}

function ProgressLine({ x }: { x: number | null }) {
  return x === null ? null : <div className="notation-play-line" aria-hidden="true" style={{ left: x }} />;
}

function StaffSystem({ system, score, playbackBeat }: { system: NotationSystem; score: Score; playbackBeat: number | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ system: NotationSystem; measures: PlaybackMeasure[] } | null>(null);
  useEffect(() => {
    const div = host.current;
    if (!div) return;
    div.replaceChildren();
    try {
      const renderer = new Renderer(div, Renderer.Backends.SVG);
      renderer.resize(system.width, 205);
      const context = renderer.getContext();
      let x = 0;
      const playback: PlaybackMeasure[] = [];
      const preceding = new Map<string, { note: StaveNote; x: number; y: number }>();
      const simultaneousRests: { x: number; code: string; dots: number }[] = [];
      const arcs: { start: number; end: number; y: number }[] = [];
      for (const { measure, width } of system.measures) {
        const stave = new Stave(x, 42, width);
        if (x === 0) stave.addClef('treble').addTimeSignature(`${score.meter.numerator}/${score.meter.denominator}`);
        stave.setContext(context).draw();
        const notes = measure.slots.map(slot => {
          const { code, dots } = notationDuration(slot.duration);
          const pitched = slot.events.filter(event => event.pitch !== null);
          const pitches = [...new Set(pitched.map(event => event.pitch!))].sort((a, b) => a - b);
          const duration = `${code}${dots ? 'd' : ''}${pitches.length ? '' : 'r'}`;
          const note = new StaveNote({ keys: pitches.length ? pitches.map(midiKey) : ['b/4'], duration });
          pitches.forEach((pitch, keyIndex) => {
            if (NAMES[Math.max(0, Math.min(127, pitch)) % 12].includes('#') && pitched.some(event => event.pitch === pitch && !event.tieIn)) note.addModifier(new Accidental('#'), keyIndex);
          });
          if (dots) Dot.buildAndAttach([note], { all: true });
          return note;
        });
        if (notes.length) {
          Formatter.FormatAndDraw(context, stave, notes, { autoBeam: true, alignRests: true });
          playback.push({ start: measure.start, end: measure.start + measure.duration, anchors: [
            ...measure.slots.map((slot, index) => ({ beat: slot.start, x: notes[index].getAbsoluteX() })),
            { beat: measure.start + measure.duration, x: x + width }
          ] });
          measure.slots.forEach((slot, index) => {
            const note = notes[index];
            const noteX = note.getAbsoluteX();
            const pitches = [...new Set(slot.events.filter(event => event.pitch !== null).map(event => event.pitch!))].sort((a, b) => a - b);
            if (pitches.length && slot.events.some(event => event.pitch === null)) simultaneousRests.push({ x: noteX, ...notationDuration(slot.duration) });
            for (const event of slot.events) {
              const noteY = note.getYs()[Math.max(0, pitches.indexOf(event.pitch!))] ?? 85;
              if (event.pitch !== null) {
                const previous = preceding.get(event.sourceId);
                if (event.tieIn && previous) arcs.push({ start: previous.x + 5, end: noteX - 5, y: Math.max(previous.y, noteY) + 15 });
                else if (event.tieIn) arcs.push({ start: x + 8, end: noteX - 5, y: noteY + 15 });
                if (event.tieOut) preceding.set(event.sourceId, { note, x: noteX, y: noteY });
                else preceding.delete(event.sourceId);
              }
            }
          });
        }
        x += width;
      }
      const svg = div.querySelector('svg');
      if (svg) {
        const ns = 'http://www.w3.org/2000/svg';
        for (const arc of arcs) {
          const path = document.createElementNS(ns, 'path');
          const mid = (arc.start + arc.end) / 2;
          path.setAttribute('d', `M ${arc.start} ${arc.y} Q ${mid} ${arc.y + 12} ${arc.end} ${arc.y}`);
          path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#385740'); path.setAttribute('stroke-width', '1.5');
          svg.appendChild(path);
        }
        for (const [sourceId, previous] of preceding) {
          const last = system.measures.at(-1)?.measure.events.find(event => event.sourceId === sourceId && event.tieOut);
          if (!last) continue;
          const path = document.createElementNS(ns, 'path');
          path.setAttribute('d', `M ${previous.x + 5} ${previous.y + 15} Q ${(previous.x + x) / 2} ${previous.y + 27} ${x - 6} ${previous.y + 15}`);
          path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#385740'); path.setAttribute('stroke-width', '1.5');
          svg.appendChild(path);
        }
        const restGlyphs: Record<string, string> = { w: '\uE4E3', h: '\uE4E4', q: '\uE4E5', '8': '\uE4E6', '16': '\uE4E7' };
        for (const item of simultaneousRests) {
          const label = document.createElementNS(ns, 'text');
          label.setAttribute('x', String(item.x)); label.setAttribute('y', '150'); label.setAttribute('text-anchor', 'middle');
          label.setAttribute('font-family', 'Bravura'); label.setAttribute('font-size', '32'); label.textContent = restGlyphs[item.code] + (item.dots ? '\uE1E7' : '');
          svg.appendChild(label);
        }
      }
      setLayout({ system, measures: playback });
    } catch (error) {
      setLayout(null);
      div.textContent = `五线谱预览暂时无法显示：${error instanceof Error ? error.message : String(error)}`;
    }
  }, [system, score.meter.numerator, score.meter.denominator]);
  return <div className="notation-system staff-system" data-columns={system.columns} style={{ width: system.width, height: 205 }}><div ref={host} /><ProgressLine x={layout?.system === system ? notationPlaybackX(layout.measures, playbackBeat) : null} /></div>;
}

function JianpuNote({ event, x }: { event: NotationEvent; x: number }) {
  const octave = event.pitch === null ? 0 : Math.floor(event.pitch / 12) - 5;
  const degree = event.pitch === null ? '0' : DEGREES[((event.pitch % 12) + 12) % 12];
  const { code, dots } = notationDuration(event.duration);
  const lines = code === '16' ? 2 : code === '8' ? 1 : 0;
  const long = event.duration >= 2 ? Math.floor(event.duration) - 1 : 0;
  return <g className="jianpu-note"><text x={x} y="77" textAnchor="middle">{degree}</text>
    {Array.from({ length: Math.abs(octave) }, (_, i) => <circle key={i} cx={x} cy={octave > 0 ? 52 - i * 6 : 85 + lines * 5 + i * 6} r="1.6" />)}
    {Array.from({ length: lines }, (_, i) => <line key={i} x1={x - 10} x2={x + 10} y1={90 + i * 5} y2={90 + i * 5} />)}
    {Array.from({ length: Math.min(3, long) }, (_, i) => <text key={i} x={x + 20 + i * 17} y="77">—</text>)}
    {dots > 0 && event.duration < 2 && <circle cx={x + 16} cy="72" r="1.8" />}
  </g>;
}

function buildJianpuSystem(system: NotationSystem, score: Score) {
  let x = 0;
  const playback: PlaybackMeasure[] = [];
  const positions: { event: NotationEvent; x: number; y: number }[] = [];
  const extraHeight = 55 * Math.max(0, ...system.measures.flatMap(({ measure }) => measure.slots.map(slot => slot.events.length - 1)));
  const groups = system.measures.map(({ measure, width }, index) => {
    const origin = x;
    x += width;
    const innerStart = origin + (index === 0 ? 110 : 20);
    const usable = width - (index === 0 ? 130 : 42);
    const weights = measure.slots.map(slot => Math.max(1, Math.min(4, slot.duration)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let offset = 0;
    const anchors = measure.slots.map((slot, eventIndex) => {
      const noteX = innerStart + (offset + .35) / Math.max(1, total) * usable;
      offset += weights[eventIndex];
      return { beat: slot.start, x: noteX };
    });
    playback.push({ start: measure.start, end: measure.start + measure.duration, anchors: [...anchors, { beat: measure.start + measure.duration, x: origin + width }] });
    return <g key={measure.index}>
      {index === 0 && <text x="8" y="76" className="jianpu-signature">1=C4　{score.meter.numerator}/{score.meter.denominator}</text>}
      {measure.slots.map((slot, eventIndex) => {
        const noteX = anchors[eventIndex].x;
        return <g key={slot.start} data-beat={slot.start}>{slot.events.map((event, chordIndex) => {
          positions.push({ event, x: noteX, y: 39 + chordIndex * 55 });
          return <g key={event.id} transform={`translate(0 ${chordIndex * 55})`}><JianpuNote event={event} x={noteX} /></g>;
        })}</g>;
      })}
      <line x1={origin + width} x2={origin + width} y1="43" y2={107 + extraHeight} className="jianpu-barline" />
      <text x={origin + 5} y="28" className="jianpu-bar-number">{measure.index + 1}</text>
    </g>;
  });
  const arcs: { id: string; start: number; end: number; y: number }[] = [];
  const previous = new Map<string, { x: number; y: number }>();
  for (const item of positions) {
    if (item.event.tieIn) arcs.push({ id: item.event.id, start: previous.get(item.event.sourceId)?.x ?? 8, end: item.x, y: item.y });
    if (item.event.tieOut) previous.set(item.event.sourceId, { x: item.x, y: item.y });
    else previous.delete(item.event.sourceId);
  }
  const contentEnd = system.measures.reduce((sum, item) => sum + item.width, 0);
  for (const [id, item] of previous) arcs.push({ id: `${id}-out`, start: item.x, end: contentEnd - 6, y: item.y });
  const svg = <svg className="notation-system jianpu-system" data-columns={system.columns} width={system.width} height={150 + extraHeight} viewBox={`0 0 ${system.width} ${150 + extraHeight}`} role="img" aria-label="简谱连续谱行">
    {groups}
    {arcs.map(arc => <path key={arc.id} className="jianpu-tie" d={`M ${arc.start} ${arc.y} Q ${(arc.start + arc.end) / 2} ${arc.y - 24} ${arc.end} ${arc.y}`} fill="none" stroke="#385740" strokeWidth="1.5" />)}
  </svg>;
  return { svg, playback, height: 150 + extraHeight };
}

function JianpuSystem({ system, score, playbackBeat }: { system: NotationSystem; score: Score; playbackBeat: number | null }) {
  const layout = useMemo(() => buildJianpuSystem(system, score), [system, score.meter.numerator, score.meter.denominator]);
  return <div className="jianpu-playback-system" style={{ width: system.width, height: layout.height }}>{layout.svg}<ProgressLine x={notationPlaybackX(layout.playback, playbackBeat)} /></div>;
}

export default function ScorePreview({ score, playbackBeat = null }: { score: Score; playbackBeat?: number | null }) {
  const [mode, setMode] = useState<'jianpu' | 'staff'>('jianpu');
  const [fontsReady, setFontsReady] = useState(false);
  const [fontError, setFontError] = useState('');
  const [available, setAvailable] = useState(900);
  const container = useRef<HTMLDivElement>(null);
  const measures = useMemo(() => buildNotation(score), [score]);
  const systems = useMemo(() => layoutNotation(measures, available), [measures, available]);
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const observer = new ResizeObserver(entries => setAvailable(Math.max(320, Math.floor(entries[0].contentRect.width))));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (mode !== 'staff') return;
    let active = true;
    void loadNotationFonts().then(() => { if (active) setFontsReady(true); }).catch(error => { if (active) setFontError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [mode]);
  return <div className="panel preview-panel"><div className="panel-heading"><div><span className="eyebrow">SCORE PREVIEW</span><h3>谱面预览</h3></div><div className="segmented"><button className={mode === 'jianpu' ? 'selected' : ''} onClick={() => setMode('jianpu')}>简谱</button><button className={mode === 'staff' ? 'selected' : ''} onClick={() => setMode('staff')}>五线谱</button></div></div><p className="preview-help">只读预览 · 小节对齐 · 预览吸附到四分之一拍，演奏时间保持原值</p><div className="notation-page" ref={container}>{mode === 'staff' && fontError ? <div className="notation-loading">五线谱字体加载失败：{fontError}</div> : mode === 'staff' && !fontsReady ? <div className="notation-loading">五线谱加载中…</div> : systems.map((system, index) => <div className="notation-line" key={`${mode}-${index}`}>{mode === 'staff' ? <StaffSystem system={system} score={score} playbackBeat={playbackBeat} /> : <JianpuSystem system={system} score={score} playbackBeat={playbackBeat} />}</div>)}</div></div>;
}
