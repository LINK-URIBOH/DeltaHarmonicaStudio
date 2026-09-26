import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { pitchName } from './core/harmonica';
import { endBeat, type Note, type Score } from './core/model';
import { playbackScrollLeft } from './core/playbackPosition';
import { DEFAULT_PX_PER_BEAT, MAX_PX_PER_BEAT, MIN_PX_PER_BEAT, TIMELINE_LEFT, TIMELINE_ROW as ROW, TIMELINE_TOP as TOP, draggedNote, groupPitchDelta, noteRect, notesInRect, snapBeat, timelinePitchBounds, timelineFocusPosition, zoomScrollLeft, type SelectionRect, type TimelineFocus } from './core/timeline';

type Point = { x: number; y: number };
type Gesture = { type: 'pending' | 'box' | 'cancelled'; origin: Point; client: Point; initialClient: Point; pointerId: number } |
  { type: 'drag'; origin: Point; client: Point; pointerId: number; notes: Note[]; kind: 'move' | 'start' | 'end'; group: boolean };
type Props = {
  score: Score; selectedNoteIds: ReadonlySet<string>; onSelect: (id: string | null) => void;
  onMultiSelect: (ids: string[]) => void; onBatchChange: (notes: { id: string; pitch: number | null }[]) => void;
  onAdd: (beat: number, pitch: number | null) => void; onChange: (id: string, patch: Partial<Note>) => void;
  outOfRangeIds: ReadonlySet<string>; onlyOutOfRange: boolean; focusRequest: TimelineFocus | null;
  pxPerBeat: number; onZoom: (scale: number) => void;
  startBeat: number; onStartBeat: (beat: number) => void; playing: boolean; playbackBeat: number | null; onAudition: () => void;
};

export default function ScoreTimeline({ score, selectedNoteIds, onSelect, onMultiSelect, onBatchChange, onAdd, onChange, outOfRangeIds, onlyOutOfRange, focusRequest, pxPerBeat, onZoom, startBeat, onStartBeat, playing, playbackBeat, onAudition }: Props) {
  const [tool, setTool] = useState<'select' | 'note' | 'rest'>('select');
  const [draft, setDraft] = useState<Note[]>([]);
  const draftRef = useRef<Note[]>([]);
  const [box, setBox] = useState<SelectionRect | null>(null);
  const boxRef = useRef<SelectionRect | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const followRef = useRef<() => void>(() => {});
  const { high, low } = timelinePitchBounds(score.notes, score.transpose);
  const visibleNotes = onlyOutOfRange ? score.notes.filter(note => outOfRangeIds.has(note.id)) : score.notes;
  const height = TOP + (high - low + 2) * ROW + 12;
  const width = Math.max(900, TIMELINE_LEFT + (endBeat(score) + 4) * pxPerBeat);
  const barLength = score.meter.numerator * 4 / score.meter.denominator;
  const barCount = Math.ceil((width - TIMELINE_LEFT) / (barLength * pxPerBeat));
  const highlighted = box ? new Set(notesInRect(visibleNotes, box, score.transpose, high, pxPerBeat)) : selectedNoteIds;
  const draftById = new Map(draft.map(note => [note.id, note]));
  followRef.current = () => {
    const scroll = scrollRef.current;
    if (!scroll || playbackBeat === null) return;
    const target = playbackScrollLeft(playbackBeat, pxPerBeat, scroll.clientWidth, scroll.scrollWidth || width);
    if (Math.abs(scroll.scrollLeft - target) > .5) scroll.scrollLeft = target;
  };
  useLayoutEffect(() => { followRef.current(); }, [playbackBeat, pxPerBeat, width]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const follow = () => followRef.current();
    const observer = new ResizeObserver(follow);
    observer.observe(scroll);
    scroll.addEventListener('scroll', follow);
    return () => { observer.disconnect(); scroll.removeEventListener('scroll', follow); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, TOP + (high - 60 + 1) * ROW - 280);
  }, [score.id]);
  useEffect(() => {
    const scroll = scrollRef.current;
    const note = score.notes.find(note => note.id === focusRequest?.noteId);
    if (!scroll || !note || !focusRequest) return;
    const position = timelineFocusPosition(note, score.transpose, high, pxPerBeat, scroll.clientWidth, scroll.clientHeight);
    scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
    scroll.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [focusRequest]);

  function setZoom(next: number, anchorX?: number) {
    if (gesture.current) return;
    const scroll = scrollRef.current;
    const clamped = Math.max(MIN_PX_PER_BEAT, Math.min(MAX_PX_PER_BEAT, Math.round(next)));
    if (!scroll || clamped === pxPerBeat) return;
    const target = zoomScrollLeft(pxPerBeat, clamped, scroll.scrollLeft, anchorX ?? scroll.clientWidth / 2);
    onZoom(clamped);
    requestAnimationFrame(() => { if (playbackBeat === null) scroll.scrollLeft = target; else followRef.current(); });
  }
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom(pxPerBeat * (event.deltaY < 0 ? 1.25 : .8), event.clientX - scroll.getBoundingClientRect().left);
    };
    scroll.addEventListener('wheel', onWheel, { passive: false });
    return () => scroll.removeEventListener('wheel', onWheel);
  }, [pxPerBeat]);

  function local(client: Point): Point {
    const bounds = canvasRef.current!.getBoundingClientRect();
    return { x: client.x - bounds.left, y: client.y - bounds.top };
  }
  function updateGesture() {
    const current = gesture.current;
    if (!current) return;
    const point = local(current.client);
    if (current.type === 'box') {
      const next = { left: Math.min(current.origin.x, point.x), right: Math.max(current.origin.x, point.x), top: Math.min(current.origin.y, point.y), bottom: Math.max(current.origin.y, point.y) };
      boxRef.current = next; setBox(next);
    } else if (current.type === 'drag') {
      const dy = Math.round((point.y - current.origin.y) / ROW);
      const delta = groupPitchDelta(current.notes, -dy);
      const next = current.group ? current.notes.map(note => ({ ...note, pitch: note.pitch === null ? null : note.pitch + delta })) :
        current.notes.map(note => ({ ...note, ...draggedNote(note, current.kind, (point.x - current.origin.x) / pxPerBeat, dy) }));
      draftRef.current = next; setDraft(next);
    }
  }
  function startAutoScroll() {
    const tick = () => {
      const current = gesture.current;
      const scroll = scrollRef.current;
      if (!current || !scroll) return;
      if (current.type === 'box' || current.type === 'drag' && current.group) {
        const bounds = scroll.getBoundingClientRect();
        const velocity = (value: number, min: number, max: number) => value < min + 32 ? -Math.min(10, (min + 32 - value) / 3) : value > max - 32 ? Math.min(10, (value - max + 32) / 3) : 0;
        if (current.type === 'box') scroll.scrollLeft += velocity(current.client.x, bounds.left + TIMELINE_LEFT, bounds.right);
        scroll.scrollTop += velocity(current.client.y, bounds.top + TOP, bounds.bottom);
        updateGesture();
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  function finish(cancel = false) {
    const current = gesture.current;
    if (!current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    gesture.current = null;
    if (canvasRef.current?.hasPointerCapture?.(current.pointerId)) canvasRef.current.releasePointerCapture(current.pointerId);
    if (!cancel) {
      if (current.type === 'pending') onSelect(null);
      if (current.type === 'box' && boxRef.current) onMultiSelect(notesInRect(visibleNotes, boxRef.current, score.transpose, high, pxPerBeat));
      if (current.type === 'drag' && draftRef.current.some((note, index) => note.pitch !== current.notes[index].pitch || note.beat !== current.notes[index].beat || note.duration !== current.notes[index].duration)) {
        if (current.group) onBatchChange(draftRef.current.map(note => ({ id: note.id, pitch: note.pitch })));
        else { const note = draftRef.current[0]; onChange(note.id, { beat: note.beat, duration: note.duration, pitch: note.pitch }); }
      }
    }
    draftRef.current = []; setDraft([]); boxRef.current = null; setBox(null);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); finish(true); } };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); finish(true); };
  }, [score.id, score.notes, onlyOutOfRange, tool]);

  function startDrag(event: PointerEvent<HTMLElement>, note: Note, kind: 'move' | 'start' | 'end') {
    if (event.button !== 0) return;
    event.stopPropagation(); event.preventDefault();
    canvasRef.current!.focus({ preventScroll: true });
    const group = kind === 'move' && selectedNoteIds.size > 1 && selectedNoteIds.has(note.id);
    if (!group) onSelect(note.id);
    const client = { x: event.clientX, y: event.clientY };
    gesture.current = { type: 'drag', origin: local(client), client, pointerId: event.pointerId, kind, group, notes: group ? score.notes.filter(note => selectedNoteIds.has(note.id)) : [note] };
    canvasRef.current!.setPointerCapture?.(event.pointerId);
    startAutoScroll();
  }

  return <>
    <div className="timeline-tools" aria-label="画布工具">
      <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}>选择 / 拖动</button>
      <button className={tool === 'note' ? 'active' : ''} onClick={() => setTool('note')}>点击添加音符</button>
      <button className={tool === 'rest' ? 'active' : ''} onClick={() => setTool('rest')}>点击添加休止</button>
      <button onClick={onAudition} disabled={!playing && startBeat >= endBeat(score)}>{playing ? '停止试听' : '从此处试听'}</button>
      <span className="timeline-start-label">起播 {Number(startBeat.toFixed(4))} 拍</span>
      <div className="timeline-zoom"><button aria-label="缩小时间轴" title="缩小时间轴" onClick={() => setZoom(pxPerBeat * .8)}>−</button><span>{Math.round(pxPerBeat / DEFAULT_PX_PER_BEAT * 100)}%</span><button aria-label="放大时间轴" title="放大时间轴" onClick={() => setZoom(pxPerBeat * 1.25)}>＋</button><button onClick={() => setZoom(DEFAULT_PX_PER_BEAT)}>重置</button></div>
      <span className="timeline-help">点击顶部标尺设置起播 · 空白处长按框选 · 多选后上下拖动改音高 · Ctrl + 滚轮缩放</span>
    </div>
    <div className="timeline-scroll" ref={scrollRef}>
      <div ref={canvasRef} tabIndex={0} aria-label="谱面音符画布" className={`timeline ${tool !== 'select' ? 'is-adding' : ''}`} style={{ width, height }} onPointerDown={event => {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        event.currentTarget.focus({ preventScroll: true });
        const client = { x: event.clientX, y: event.clientY };
        const point = local(client);
        if (tool !== 'select') {
          const beat = snapBeat((point.x - TIMELINE_LEFT) / pxPerBeat);
          const row = Math.round((point.y - TOP - ROW / 2) / ROW);
          onAdd(beat, tool === 'rest' ? null : Math.max(0, Math.min(127, high - row + 1 - score.transpose)));
          return;
        }
        event.preventDefault();
        gesture.current = { type: 'pending', origin: point, initialClient: client, client, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        timer.current = setTimeout(() => {
          const current = gesture.current;
          if (current?.type !== 'pending') return;
          current.type = 'box'; updateGesture(); startAutoScroll();
        }, 350);
      }} onPointerMove={event => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        current.client = { x: event.clientX, y: event.clientY };
        if (current.type === 'pending' && Math.hypot(current.client.x - current.initialClient.x, current.client.y - current.initialClient.y) > 6) current.type = 'cancelled';
        updateGesture();
      }} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}>
        {Array.from({ length: barCount + 1 }, (_, index) => <div key={index} className="bar-line" style={{ left: TIMELINE_LEFT + index * barLength * pxPerBeat }} />)}
        <div className="lane rest-lane" style={{ top: TOP }}><span>休止</span></div>
        {Array.from({ length: high - low + 1 }, (_, index) => <div key={index} className={`lane ${index % 12 === 0 ? 'octave-lane' : ''}`} style={{ top: TOP + (index + 1) * ROW }}><span>{pitchName(high - index)}</span></div>)}
        {visibleNotes.map(note => {
          const shown = draftById.get(note.id) ?? note;
          const rect = noteRect(shown, score.transpose, high, pxPerBeat);
          return <button key={note.id} data-note-id={note.id} className={`timeline-note ${outOfRangeIds.has(note.id) ? 'out-of-range' : ''} ${shown.pitch === null ? 'rest' : ''} ${highlighted.has(note.id) ? 'selected' : ''}`} title={`${pitchName(shown.pitch === null ? null : shown.pitch + score.transpose)} · ${shown.beat} 拍起 · ${shown.duration} 拍${outOfRangeIds.has(note.id) ? ' · 超出音域' : ''}`} style={{ left: rect.left, top: rect.top, width: rect.right - rect.left }} onPointerDown={event => startDrag(event, note, 'move')} onClick={event => { if (event.detail === 0) onSelect(note.id); }}><i className="resize-handle left" aria-label="拖动左边缘调整起点和时值" onPointerDown={event => startDrag(event, note, 'start')} /><span>{shown.pitch === null ? '休止' : pitchName(shown.pitch + score.transpose)}</span><i className="resize-handle right" aria-label="拖动右边缘调整时值" onPointerDown={event => startDrag(event, note, 'end')} /></button>;
        })}
        <div className="timeline-start-line" style={{ left: TIMELINE_LEFT + startBeat * pxPerBeat }} />
        {playbackBeat !== null && <div className="timeline-play-line" style={{ left: TIMELINE_LEFT + playbackBeat * pxPerBeat }} />}
        {box && <div className="timeline-selection-box" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
        <div className="timeline-ruler" aria-label="时间标尺" onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); const bounds = event.currentTarget.getBoundingClientRect(); onStartBeat(snapBeat((event.clientX - bounds.left - TIMELINE_LEFT) / pxPerBeat)); }}>
          {Array.from({ length: barCount + 1 }, (_, index) => <span key={index} style={{ left: TIMELINE_LEFT + index * barLength * pxPerBeat }}>{index + 1}</span>)}
          <i className="timeline-start-marker" style={{ left: TIMELINE_LEFT + startBeat * pxPerBeat }} />
          {playbackBeat !== null && <i className="timeline-play-marker" style={{ left: TIMELINE_LEFT + playbackBeat * pxPerBeat }} />}
        </div>
      </div>
    </div>
  </>;
}
