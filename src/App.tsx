import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, BookOpen, CircleAlert, CircleCheck, CirclePlay, Clock3, Copy, FileMusic, FilePlus2, FolderOpen, Guitar, Keyboard, ListMusic, Pause, Plus, RotateCcw, RotateCw, Save, Search, Settings2, ShieldAlert, SlidersHorizontal, Trash2, Upload, Volume2, WandSparkles, X } from 'lucide-react';
import { blankScore, cloneScore, emptyLibrary, endBeat, validateScore, type Library, type Note, type Score } from './core/model';
import { fingeringText, pitchName, planScore, suggestTranspose, type PlannedNote } from './core/harmonica';
import { parseJianpu } from './core/jianpu';
import { parseMidiImport, musicXmlParts, overlapCount, scoreFromPart, type ImportPart, type MidiImportData } from './core/importers';
import { pageHtml, textScore } from './core/exporters';
import ScoreTimeline from './ScoreTimeline';
import ScorePreview from './ScorePreview';
import MidiImportDialog from './MidiImportDialog';
import { auditionBeat, MidiAudition } from './core/midiAudition';
import { DEFAULT_PX_PER_BEAT, nextOutOfRange, type TimelineFocus } from './core/timeline';

type Page = 'library' | 'editor' | 'convert' | 'export' | 'guide' | 'settings';
const nav: { id: Page; label: string; icon: typeof ListMusic }[] = [
  { id: 'library', label: '我的曲库', icon: ListMusic },
  { id: 'editor', label: '谱面编辑', icon: FileMusic },
  { id: 'convert', label: '按法转换', icon: WandSparkles },
  { id: 'export', label: '导出分享', icon: ArrowDownToLine },
  { id: 'guide', label: '乐理入门', icon: BookOpen },
  { id: 'settings', label: '设置', icon: Settings2 }
];

const keyLabel = (key: string) => key === ',' ? '逗号 ,' : key;
const now = () => new Date().toISOString();
const cleanName = (name: string) => name.replace(/\.(midi|mid|musicxml|xml|mxl)$/i, '');
const totalMs = (score: Score, planned: PlannedNote[]) => planned.length ? Math.max(...planned.map(n => n.startMs + n.durationMs)) : 0;
const scoreFingerprint = (score: Score) => JSON.stringify({ title: score.title, tonicMidi: score.tonicMidi, bpm: score.bpm, meter: score.meter, tempoChanges: score.tempoChanges, transpose: score.transpose, notes: score.notes });

function shortcutFromEvent(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  event.preventDefault();
  if (event.key === 'Backspace' || event.key === 'Delete') return '';
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean);
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.key;
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  if (!functionKey && (!modifiers.length || !/^[A-Z0-9]$/.test(key))) return null;
  return [...modifiers, key].join('+');
}

export default function App() {
  const [library, setLibrary] = useState<Library>(emptyLibrary());
  const libraryRef = useRef(library);
  const savedRef = useRef(library);
  const saveQueue = useRef(Promise.resolve());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('library');
  const [draftScore, setDraftScore] = useState<Score | null>(null);
  const draftScoreRef = useRef<Score | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [pendingLeave, setPendingLeave] = useState<{ action: () => void; closing: boolean } | null>(null);
  const [leavingBusy, setLeavingBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('本地工作台已就绪');
  const [error, setError] = useState('');
  const [armed, setArmed] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [importParts, setImportParts] = useState<{ title: string; parts: ImportPart[] } | null>(null);
  const [midiImport, setMidiImport] = useState<{ title: string; data: MidiImportData } | null>(null);
  const midiSaveRef = useRef<Promise<boolean> | null>(null);
  const [partIndex, setPartIndex] = useState(0);
  const [overlapPolicy, setOverlapPolicy] = useState<'highest' | 'lowest' | 'first'>('highest');
  const [jianpuOpen, setJianpuOpen] = useState(false);
  const [jianpuTitle, setJianpuTitle] = useState('我的简谱');
  const [jianpuText, setJianpuText] = useState('1:1 2:1 3:1 4:1 | 5:2 0:1 5:1 | ^1:2 7:1 6:1');
  const [jianpuTonic, setJianpuTonic] = useState('C4');
  const [jianpuBpm, setJianpuBpm] = useState(120);
  const [jianpuNumerator, setJianpuNumerator] = useState(4);
  const [jianpuDenominator, setJianpuDenominator] = useState(4);
  const [selectedNoteId, setPrimaryNoteId] = useState<string | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [startBeat, setStartBeat] = useState(0);
  const [editorView, setEditorView] = useState<'timeline' | 'keys'>('timeline');
  const [noteFilter, setNoteFilter] = useState<'all' | 'out'>('all');
  const [canvasFilter, setCanvasFilter] = useState<'all' | 'out'>('all');
  const [timelineScale, setTimelineScale] = useState(DEFAULT_PX_PER_BEAT);
  const [focusRequest, setFocusRequest] = useState<TimelineFocus | null>(null);
  const focusSequence = useRef(0);
  const [auditioning, setAuditioning] = useState(false);
  const [auditionSeconds, setAuditionSeconds] = useState(0);
  const audioRef = useRef<MidiAudition | null>(null);
  if (!audioRef.current) audioRef.current = new MidiAudition((seconds, playing) => { setAuditionSeconds(seconds); setAuditioning(playing); });
  const historyRef = useRef<Record<string, { past: Score[]; future: Score[] }>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.studio.getLibrary().then(value => {
      libraryRef.current = value;
      savedRef.current = value;
      setLibrary(value);
      setSelectedId(value.scores[0]?.id ?? null);
    }).catch(cause => setError(String(cause)));
    const offRequest = window.studio.onPlayRequest(id => void playScore(id));
    const offStatus = window.studio.onStatus(setStatus);
    const offArmed = window.studio.onArmed(setArmed);
    const offClose = window.studio.onCloseRequest(() => {
      stopAudition();
      if (midiSaveRef.current) { void midiSaveRef.current.then(saved => { if (saved) void window.studio.confirmClose(); }); }
      else if (dirtyRef.current) setPendingLeave({ action: () => { void window.studio.confirmClose(); }, closing: true });
      else void window.studio.confirmClose();
    });
    return () => { offRequest(); offStatus(); offArmed(); offClose(); stopAudition(); };
  }, []);

  const selected = page === 'editor' && draftScore?.id === selectedId ? draftScore : library.scores.find(score => score.id === selectedId) ?? null;
  const planned = useMemo(() => selected ? planScore(selected, 60) : [], [selected]);
  const outOfRange = planned.filter(entry => entry.note.pitch !== null && !entry.fingering);
  const outOfRangeIds = new Set(outOfRange.map(entry => entry.note.id));
  const misses = outOfRange.length;
  const visibleNotes = noteFilter === 'out' ? outOfRange : planned;
  const canvasNotes = canvasFilter === 'out' ? outOfRange : planned;
  const outOfRangeIndex = outOfRange.findIndex(entry => entry.note.id === selectedNoteId);
  const suggestedShift = selected ? suggestTranspose({ ...selected, transpose: 0 }, 60) : 0;
  const selectedNote = selected?.notes.find(note => note.id === selectedNoteId) ?? null;
  const matching = library.scores.filter(score => score.title.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    setCanvasFilter('all');
    setFocusRequest(null);
    setStartBeat(0);
    setPrimaryNoteId(null);
    setSelectedNoteIds(new Set());
  }, [selectedId]);

  useEffect(() => { stopAudition(); }, [selected, page]);
  useEffect(() => {
    const valid = new Set(selected?.notes.map(note => note.id));
    setSelectedNoteIds(previous => [...previous].every(id => valid.has(id)) ? previous : new Set([...previous].filter(id => valid.has(id))));
    if (selectedNoteId && !valid.has(selectedNoteId)) setPrimaryNoteId(null);
  }, [selected?.notes]);
  useEffect(() => { setSelectedNoteIds(new Set()); setPrimaryNoteId(null); }, [canvasFilter, noteFilter]);

  function setSelectedNoteId(id: string | null) {
    setPrimaryNoteId(id);
    setSelectedNoteIds(new Set(id ? [id] : []));
    const note = selected?.notes.find(item => item.id === id);
    if (note) setStartBeat(note.beat);
  }

  function selectNotes(ids: string[]) {
    setSelectedNoteIds(new Set(ids));
    setPrimaryNoteId(ids[0] ?? null);
  }

  function updateNotes(patches: { id: string; pitch: number | null }[]) {
    const byId = new Map(patches.map(note => [note.id, note.pitch]));
    editScore(score => ({ ...score, notes: score.notes.map(note => byId.has(note.id) ? { ...note, pitch: byId.get(note.id)! } : note) }));
  }

  function jumpOutOfRange(direction: -1 | 1) {
    const note = nextOutOfRange(planned.map(entry => entry.note), outOfRangeIds, selectedNoteId, direction);
    if (!note) return;
    setSelectedNoteId(note.id);
    setEditorView('timeline');
    setFocusRequest({ noteId: note.id, sequence: ++focusSequence.current });
  }

  function persist(next: Library, successMessage?: string, onFailure?: (cause: Error) => void): Promise<boolean> {
    libraryRef.current = next;
    setLibrary(next);
    const operation = saveQueue.current.then(async () => {
      if (!await window.studio.saveLibrary(next)) throw new Error('曲库写入未成功，请重试。');
      savedRef.current = next;
      setError('');
      if (successMessage) setStatus(successMessage);
      return true;
    }).catch(cause => {
      if (libraryRef.current === next) {
        libraryRef.current = savedRef.current;
        setLibrary(savedRef.current);
      }
      setError(cause instanceof Error ? cause.message : String(cause));
      onFailure?.(cause instanceof Error ? cause : new Error(String(cause)));
      if (successMessage) setStatus('快捷键未保存，请根据提示换一个键');
      return false;
    });
    saveQueue.current = operation.then(() => {});
    return operation;
  }

  function setDraft(score: Score | null) {
    draftScoreRef.current = score;
    setDraftScore(score);
    const saved = libraryRef.current.scores.find(item => item.id === score?.id);
    const hasChanges = !!score && !!saved && scoreFingerprint(score) !== scoreFingerprint(saved);
    dirtyRef.current = hasChanges;
    setDirty(hasChanges);
  }

  async function saveDraft(): Promise<boolean> {
    const score = draftScoreRef.current;
    if (!score || !dirtyRef.current) return true;
    const next = { ...libraryRef.current, scores: libraryRef.current.scores.map(item => item.id === score.id ? score : item) };
    const saved = await persist(next);
    if (saved) {
      const latest = draftScoreRef.current;
      setDraft(latest && scoreFingerprint(latest) !== scoreFingerprint(score) ? latest : null);
      setStatus(`已保存到曲库：${score.title}`);
    }
    return saved;
  }

  function requestLeave(action: () => void, closing = false) {
    stopAudition();
    if (page === 'editor' && dirtyRef.current) setPendingLeave({ action, closing });
    else action();
  }

  function requestPage(next: Page) {
    if (next === page) return;
    requestLeave(() => { setDraft(null); setPage(next); });
  }

  async function resolveLeave(choice: 'save' | 'discard' | 'cancel') {
    const pending = pendingLeave;
    if (!pending) return;
    if (choice === 'cancel') { setPendingLeave(null); return; }
    if (choice === 'save') {
      setLeavingBusy(true);
      const saved = await saveDraft();
      setLeavingBusy(false);
      if (!saved) return;
    } else {
      const id = draftScoreRef.current?.id;
      if (id) delete historyRef.current[id];
      setDraft(null);
    }
    setPendingLeave(null);
    pending.action();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (page === 'editor' && event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveDraft();
      }
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (page === 'editor' && !pendingLeave && !midiImport && !importParts && !jianpuOpen && !event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 'Delete' || event.key === 'Backspace') && !target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
        if (selectedNoteIds.size) { event.preventDefault(); deleteNote(); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [page, selectedNoteIds, pendingLeave, midiImport, importParts, jianpuOpen]);

  function addScore(score: Score) {
    const next = { ...libraryRef.current, scores: [score, ...libraryRef.current.scores] };
    persist(next);
    setSelectedId(score.id);
    setDraft(null);
    setSelectedNoteId(null);
    setPage('editor');
    setStatus(`已加入曲库：${score.title}`);
  }

  function editScore(transform: (score: Score) => Score) {
    stopAudition();
    const current = page === 'editor' && draftScoreRef.current?.id === selectedId ? draftScoreRef.current : libraryRef.current.scores.find(score => score.id === selectedId);
    if (!current) return;
    const history = historyRef.current[current.id] ?? { past: [], future: [] };
    history.past.push(cloneScore(current));
    if (history.past.length > 100) history.past.shift();
    history.future = [];
    historyRef.current[current.id] = history;
    const updated = transform(cloneScore(current));
    updated.updatedAt = now();
    if (page === 'editor') setDraft(updated);
    else void persist({ ...libraryRef.current, scores: libraryRef.current.scores.map(score => score.id === current.id ? updated : score) });
  }

  function replaceScore(score: Score) {
    if (page === 'editor') setDraft(score);
    else void persist({ ...libraryRef.current, scores: libraryRef.current.scores.map(item => item.id === score.id ? score : item) });
  }

  function historyMove(direction: 'undo' | 'redo') {
    stopAudition();
    const current = page === 'editor' && draftScoreRef.current?.id === selectedId ? draftScoreRef.current : libraryRef.current.scores.find(score => score.id === selectedId);
    if (!current) return;
    const history = historyRef.current[current.id];
    const source = direction === 'undo' ? history?.past : history?.future;
    const target = direction === 'undo' ? history?.future : history?.past;
    const previous = source?.pop();
    if (!previous || !target) return;
    target.push(cloneScore(current));
    replaceScore(previous);
  }

  function updateNote(noteId: string, patch: Partial<Note>) {
    editScore(score => ({ ...score, notes: score.notes.map(note => note.id === noteId ? { ...note, ...patch } : note) }));
  }

  function addNote(rest = false, atBeat?: number, atPitch?: number | null) {
    if (!selected) return;
    const end = endBeat(selected);
    const note: Note = { id: crypto.randomUUID(), beat: atBeat ?? end, duration: 1, pitch: rest ? null : atPitch ?? 60 };
    editScore(score => ({ ...score, notes: [...score.notes, note] }));
    setSelectedNoteId(note.id);
    setStartBeat(note.beat);
  }

  function duplicateNote() {
    if (!selectedNote) return;
    const copy = { ...selectedNote, id: crypto.randomUUID(), beat: selectedNote.beat + selectedNote.duration };
    editScore(score => ({ ...score, notes: [...score.notes, copy] }));
    setSelectedNoteId(copy.id);
    setStartBeat(copy.beat);
  }

  function deleteNote() {
    if (!selectedNoteIds.size) return;
    editScore(score => ({ ...score, notes: score.notes.filter(note => !selectedNoteIds.has(note.id)) }));
    setSelectedNoteId(null);
  }

  function quantize() {
    editScore(score => ({ ...score, notes: score.notes.map(note => ({
      ...note, beat: Math.max(0, Math.round(note.beat * 4) / 4),
      duration: Math.max(0.25, Math.round(note.duration * 4) / 4)
    })) }));
    setStatus('已将起点和音长对齐到 1/4 拍');
  }

  async function importFile(file: File) {
    stopAudition();
    try {
      setError('');
      const buffer = await file.arrayBuffer();
      if (file.name.toLowerCase().endsWith('.dfhproj')) {
        const parsed = JSON.parse(new TextDecoder().decode(buffer));
        if (parsed.version !== 1 || !validateScore(parsed.score)) throw new Error('项目文件格式无效');
        addScore({ ...parsed.score, id: crypto.randomUUID(), source: 'project', createdAt: now(), updatedAt: now() });
        return;
      }
      if (/\.(mid|midi)$/i.test(file.name)) {
        const data = parseMidiImport(buffer);
        if (!data.parts.length) throw new Error('文件中没有可导入的音符');
        stopAudition();
        setMidiImport({ title: cleanName(file.name), data });
        return;
      }
      const parts = musicXmlParts(file.name, buffer);
      if (!parts.length) throw new Error('文件中没有可导入的音符');
      setImportParts({ title: cleanName(file.name), parts });
      setPartIndex(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function confirmMidiImport(scores: Score[]) {
    if (!scores.length || midiSaveRef.current) return;
    if (scores.some(score => score.notes.length > 10000)) throw new Error('每首谱最多支持 10000 个音符，请减少所选声部或使用分别成谱。');
    if (!scores.every(validateScore)) throw new Error('生成的谱面格式不受支持，请检查 MIDI 的拍号和音符数据。');
    let failure: Error | undefined;
    const operation = persist({ ...libraryRef.current, scores: [...scores, ...libraryRef.current.scores] }, undefined, cause => { failure = cause; });
    midiSaveRef.current = operation;
    const saved = await operation;
    midiSaveRef.current = null;
    if (!saved) throw failure ?? new Error('写入曲库失败，请重试。');
    setMidiImport(null);
    setSelectedId(scores[0].id);
    setDraft(null);
    setSelectedNoteId(null);
    setPage('editor');
    setStatus(`已导入 ${scores.length} 首谱：${scores[0].title}`);
  }

  function confirmImport() {
    if (!importParts) return;
    addScore(scoreFromPart(importParts.parts[partIndex], importParts.title, overlapPolicy));
    setImportParts(null);
  }

  function importJianpu() {
    try {
      addScore(parseJianpu(jianpuText, { title: jianpuTitle, tonic: jianpuTonic, bpm: jianpuBpm, numerator: jianpuNumerator, denominator: jianpuDenominator }));
      setJianpuOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  function changeHotkey(scoreId: string, shortcut: string) {
    const next = { ...libraryRef.current, hotkeys: { ...libraryRef.current.hotkeys, [scoreId]: shortcut } };
    persist(next, shortcut ? `快捷键 ${shortcut} 已保存` : '曲目快捷键已清除');
  }

  async function prepareHotkeyEdit() {
    if (armed) {
      try {
        await window.studio.arm(false);
        setArmed(false);
        setStatus('已关闭演奏准备，可以修改快捷键');
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }
  }

  function captureHotkey(event: React.KeyboardEvent<HTMLInputElement>, scoreId?: string) {
    const value = shortcutFromEvent(event);
    if (value === null) {
      if (!['Control', 'Alt', 'Shift', 'Escape'].includes(event.key)) setError('请按 F1–F24，或 Ctrl／Alt／Shift 加字母、数字、F 键。单独的字母和数字不能用作全局快捷键。');
      return;
    }
    if (value === '' && !scoreId) { setError('停止快捷键不能清空'); return; }
    if (scoreId) changeHotkey(scoreId, value);
    else persist({ ...libraryRef.current, settings: { ...libraryRef.current.settings, stopShortcut: value } }, `停止快捷键 ${value} 已保存`);
  }

  function removeScore(scoreId: string) {
    if (!confirm('确定从曲库删除这首谱吗？')) return;
    const next = { ...libraryRef.current,
      scores: libraryRef.current.scores.filter(score => score.id !== scoreId),
      hotkeys: Object.fromEntries(Object.entries(libraryRef.current.hotkeys).filter(([id]) => id !== scoreId)) };
    persist(next);
    if (selectedId === scoreId) setSelectedId(next.scores[0]?.id ?? null);
  }

  async function toggleArm() {
    try {
      if (!armed && !understood) throw new Error('请先勾选并确认自动输入风险，再启用演奏准备');
      const value = await window.studio.arm(!armed);
      setArmed(value);
      setStatus(value ? '演奏准备已开启：切回口琴界面后按曲目快捷键' : '演奏准备已关闭');
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function playScore(id: string) {
    const current = libraryRef.current.scores.find(score => score.id === id);
    if (!current) return;
    const arrangement = planScore(current, 60);
    const impossible = arrangement.filter(entry => entry.note.pitch !== null && !entry.fingering);
    if (impossible.length) { setError(`「${current.title}」有 ${impossible.length} 个音超出口琴音域，请先移调或编辑`); return; }
    const events = arrangement.filter(entry => entry.fingering).map(entry => ({
      startMs: entry.startMs, durationMs: entry.durationMs, key: entry.fingering!.key,
      octave: entry.fingering!.octave, sharp: entry.fingering!.sharp
    }));
    try {
      await window.studio.start(id, events);
      if (!dirtyRef.current) setSelectedId(id);
      setStatus(`即将演奏：${current.title}`);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  function stopAudition() {
    audioRef.current?.stop();
  }

  async function audition(fromBeat = 0) {
    if (auditioning) { stopAudition(); return; }
    if (!selected) return;
    try { await audioRef.current!.play(selected, fromBeat); }
    catch (cause) { setError(`试听无法启动：${cause instanceof Error ? cause.message : String(cause)}`); }
  }

  async function exportResult(format: 'project' | 'text' | 'pdf' | 'png') {
    if (!selected) return;
    try {
      let success = false;
      if (format === 'project') success = await window.studio.saveProject(selected);
      else if (format === 'text') success = await window.studio.exportText(selected.title, textScore(selected, 60));
      else success = await window.studio.exportPage(selected.title, pageHtml(selected, 60), format, selected.notes.length);
      if (success) setStatus(`${selected.title} 已导出 ${format.toUpperCase()}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const pageTitle: Record<Page, string> = { library: '我的曲库', editor: '谱面编辑', convert: '按法转换', export: '导出分享', guide: '乐理入门', settings: '工作台设置' };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Guitar size={23} strokeWidth={2.5} /></div><div><strong>口琴谱工作台</strong><small>DELTA HARMONICA STUDIO</small></div></div>
      <div className="sidebar-group-label">工作区域</div>
      <nav>{nav.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => requestPage(item.id)}><item.icon size={19} /><span>{item.label}</span>{page === item.id && <span className="nav-indicator" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="side-callout"><ShieldAlert size={18} /><span>自动输入存在账号风险<br />请仅在理解规则后使用</span></div><span className="version">LOCAL DESKTOP · V0.1</span></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><span className="eyebrow">WORKSPACE / {page.toUpperCase()}</span><h1>{pageTitle[page]}</h1></div><div className="topbar-right"><div className={`status-pill ${armed ? 'armed' : ''}`}><Activity size={15} />{armed ? '演奏准备中' : '本地模式'}</div><button className="icon-button" title="停止演奏" onClick={() => void window.studio.stop()}><Pause size={18} /></button></div></header>
      <div className="content">
        {midiImport && <MidiImportDialog title={midiImport.title} data={midiImport.data} onClose={() => setMidiImport(null)} onImport={confirmMidiImport} />}
        {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
        <div className="status-line"><CircleCheck size={15} />{status}</div>

        {page === 'library' && <>
          <section className="hero"><div><div className="eyebrow accent">YOUR MUSIC, READY TO PLAY</div><h2>把每首旋律，整理成你的口琴曲库。</h2><p>导入乐谱、编排按法、绑定快捷键。所有谱面都保存在这台电脑上。</p><div className="hero-actions"><button className="primary-button" onClick={() => addScore(blankScore())}><FilePlus2 size={17} /> 新建空白谱</button><button className="ghost-light" onClick={() => fileRef.current?.click()}><Upload size={17} /> 导入文件</button><button className="ghost-light" onClick={() => setJianpuOpen(true)}><Keyboard size={17} /> 输入简谱</button></div></div><div className="hero-visual"><div className="hero-notes">1&nbsp; 2&nbsp; ♯3&nbsp; 5&nbsp; 6&nbsp; 1̇</div><div className="hero-keys">Z&nbsp;&nbsp; X&nbsp;&nbsp; C&nbsp;&nbsp; B&nbsp;&nbsp; N&nbsp;&nbsp; ,</div><div className="hero-orbit" /></div></section>
          <input ref={fileRef} type="file" accept=".mid,.midi,.xml,.musicxml,.mxl,.dfhproj" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ''; }} />
          <div className="section-heading"><div><span className="eyebrow">LIBRARY</span><h2>全部乐谱 <span className="count">{library.scores.length}</span></h2></div><label className="search-box"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索乐谱名称" /></label></div>
          {matching.length ? <div className="score-grid">{matching.map(score => <article className={`score-card ${selectedId === score.id ? 'chosen' : ''}`} key={score.id} onClick={() => setSelectedId(score.id)}><div className="score-card-top"><span className="score-icon"><FileMusic size={22} /></span><span className="source-tag">{score.source.toUpperCase()}</span></div><h3>{score.title}</h3><p>{score.notes.length} 个音符 · {score.bpm} BPM · {score.meter.numerator}/{score.meter.denominator} 拍</p><div className="card-divider" /><div className="score-card-bottom"><label>演奏快捷键</label><input className="hotkey-input" readOnly aria-label={`设置${score.title}的演奏快捷键`} title="点击后按 F1–F24 或含 Ctrl、Alt、Shift 的组合键；退格键清除" placeholder="点击后按 F 键或组合键" value={library.hotkeys[score.id] || ''} onFocus={() => void prepareHotkeyEdit()} onKeyDown={event => captureHotkey(event, score.id)} onClick={event => event.stopPropagation()} /><button className="card-open" onClick={event => { event.stopPropagation(); setSelectedId(score.id); setPage('editor'); }}>编辑 →</button></div></article>)}</div> : <div className="empty-state"><FileMusic size={38} /><h3>{search ? '没有找到匹配的乐谱' : '曲库还是空的'}</h3><p>{search ? '换个关键词试试。' : '新建一首谱，或导入 MIDI、MusicXML、MXL 文件。'}</p></div>}
          {!!selected && <div className="library-actions"><span>已选择：<strong>{selected.title}</strong></span><button className="subtle-button danger" onClick={() => removeScore(selected.id)}><Trash2 size={15} /> 删除所选</button></div>}
        </>}

        {page === 'editor' && <>{selected ? <>
          <div className="editor-header panel"><div className="editor-title"><span className="eyebrow">SCORE EDITOR</span><input aria-label="乐谱标题" value={selected.title} onChange={event => editScore(score => ({ ...score, title: event.target.value }))} /><span>{selected.notes.length} 个事件 · {endBeat(selected).toFixed(2)} 拍 {dirty && <strong className="unsaved-badge">· 未保存</strong>}</span></div><div className="editor-actions"><button className="subtle-button" onClick={() => historyMove('undo')}><RotateCcw size={16} /> 撤销</button><button className="subtle-button" onClick={() => historyMove('redo')}><RotateCw size={16} /> 重做</button><button className="subtle-button" onClick={() => void audition()}>{auditioning ? <Pause size={16} /> : <Volume2 size={16} />}{auditioning ? '停止试听' : '本地试听'}</button><button className="subtle-button" onClick={() => void exportResult('project')}><Save size={16} /> 另存项目文件</button><button className="primary-button small" disabled={!dirty} onClick={() => void saveDraft()}><Save size={16} /> 保存到曲库</button></div></div>
          <div className="parameter-row panel"><label>BPM<input type="number" min="20" max="400" value={selected.bpm} onChange={event => editScore(score => ({ ...score, bpm: Math.max(20, Math.min(400, Number(event.target.value) || 120)) }))} /></label><label>每小节拍数<input type="number" min="1" max="16" value={selected.meter.numerator} onChange={event => editScore(score => ({ ...score, meter: { ...score.meter, numerator: Math.max(1, Math.min(16, Number(event.target.value) || 4)) } }))} /></label><label>拍号单位<select value={selected.meter.denominator} onChange={event => editScore(score => ({ ...score, meter: { ...score.meter, denominator: Number(event.target.value) } }))}>{[2, 4, 8, 16].map(n => <option key={n} value={n}>{n}</option>)}</select></label><label>移调 / 半音<input type="number" min="-12" max="12" value={selected.transpose} onChange={event => editScore(score => ({ ...score, transpose: Math.max(-12, Math.min(12, Number(event.target.value) || 0)) }))} /></label><div className="param-note">音高基准 Z = C4</div></div>
          <div className="workspace-grid"><div className="panel score-workspace"><div className="panel-heading"><div><span className="eyebrow">COMPOSITION</span><h3>谱面画布</h3></div><div className="segmented"><button className={editorView === 'timeline' ? 'selected' : ''} onClick={() => setEditorView('timeline')}>小节时间轴</button><button className={editorView === 'keys' ? 'selected' : ''} onClick={() => setEditorView('keys')}>键位谱</button></div></div>
            <div className="canvas-range-tools" aria-label="画布音域工具"><label>画布筛选 <select aria-label="画布音域筛选" value={canvasFilter} onChange={event => setCanvasFilter(event.target.value as 'all' | 'out')}><option value="all">全部音符</option><option value="out">仅超出音域</option></select></label><span className="canvas-range-count" aria-live="polite">{misses ? `超出音域 ${misses} 个${outOfRangeIndex >= 0 ? ` · ${outOfRangeIndex + 1} / ${misses}` : ''}` : '没有超出音域的音符'}</span><button className="subtle-button" disabled={!misses} onClick={() => jumpOutOfRange(-1)}>上一个</button><button className="subtle-button" disabled={!misses} onClick={() => jumpOutOfRange(1)}>下一个</button></div>
            {editorView === 'timeline' ? <ScoreTimeline score={selected} selectedNoteIds={selectedNoteIds} onSelect={setSelectedNoteId} onMultiSelect={selectNotes} onBatchChange={updateNotes} startBeat={startBeat} onStartBeat={setStartBeat} playing={auditioning} playbackBeat={auditioning ? auditionBeat(selected, auditionSeconds) : null} onAudition={() => void audition(startBeat)} onAdd={(beat, pitch) => addNote(pitch === null, beat, pitch)} onChange={updateNote} outOfRangeIds={outOfRangeIds} onlyOutOfRange={canvasFilter === 'out'} focusRequest={focusRequest} pxPerBeat={timelineScale} onZoom={setTimelineScale} /> : <div className="key-flow">{canvasNotes.map(entry => <button key={entry.note.id} className={`key-chip ${selectedNoteIds.has(entry.note.id) ? 'selected' : ''} ${outOfRangeIds.has(entry.note.id) ? 'invalid' : ''}`} onClick={() => setSelectedNoteId(entry.note.id)}><small>{entry.note.beat.toFixed(2)} 拍</small><strong>{entry.note.pitch === null ? '休止' : fingeringText(entry.fingering)}</strong><span>{entry.note.duration} 拍</span></button>)}</div>}
            <div className="toolbar"><button className="subtle-button" onClick={() => addNote(false)}><Plus size={15} /> 加音符</button><button className="subtle-button" onClick={() => addNote(true)}><Clock3 size={15} /> 加休止</button><button className="subtle-button" onClick={duplicateNote} disabled={!selectedNote || selectedNoteIds.size > 1}><Copy size={15} /> 复制</button><button className="subtle-button" onClick={deleteNote} disabled={!selectedNoteIds.size}><Trash2 size={15} /> {selectedNoteIds.size > 1 ? `删除 ${selectedNoteIds.size} 个事件` : '删除'}</button><button className="subtle-button" onClick={quantize}><SlidersHorizontal size={15} /> 对齐 1/4 拍</button></div>
          </div><aside className="panel inspector"><span className="eyebrow">NOTE INSPECTOR</span><h3>音符属性</h3>{selectedNoteIds.size > 1 ? <div className="inspector-multi"><strong>已选 {selectedNoteIds.size} 个事件</strong><p>上下拖动已选音符的中间区域，整体调整音高；起点和时值保持原值，休止不改变音高。</p><p>点击删除或按 Delete / Backspace 批量删除。左右边缘仍用于单音时值调整。</p></div> : selectedNote ? <><div className="inspector-preview"><span>{pitchName(selectedNote.pitch)}</span><small>{selectedNote.pitch === null ? '休止符' : fingeringText(planned.find(entry => entry.note.id === selectedNote.id)?.fingering ?? null)}</small></div><label>开始拍<input type="number" min="0" step="0.25" value={selectedNote.beat} onChange={event => updateNote(selectedNote.id, { beat: Math.max(0, Number(event.target.value) || 0) })} /></label><label>持续拍数<input type="number" min="0.01" step="0.25" value={selectedNote.duration} onChange={event => updateNote(selectedNote.id, { duration: Math.max(0.01, Number(event.target.value) || 0.25) })} /></label><label>音高<select value={selectedNote.pitch === null ? 'rest' : selectedNote.pitch} onChange={event => updateNote(selectedNote.id, { pitch: event.target.value === 'rest' ? null : Number(event.target.value) })}><option value="rest">休止符</option>{selectedNote.pitch !== null && (selectedNote.pitch < 36 || selectedNote.pitch > 95) && <option value={selectedNote.pitch}>{pitchName(selectedNote.pitch)}</option>}{Array.from({ length: 60 }, (_, i) => i + 36).map(n => <option value={n} key={n}>{pitchName(n)}</option>)}</select></label><p className="hint">中键升半音会在按法转换时自动选择。也可在此直接选升半音音高。</p></> : <div className="inspector-empty">在时间轴或键位谱中选择一个音符，即可修改位置、音高与时值。</div>}</aside></div>
          <ScorePreview score={selected} /><div className="panel list-panel"><div className="panel-heading"><h3>音符清单</h3><div className="list-controls"><span className="muted">按开始时间排列</span><label>筛选 <select aria-label="音符清单筛选" value={noteFilter} onChange={event => setNoteFilter(event.target.value as typeof noteFilter)}><option value="all">全部音符</option><option value="out">超出音域 ({misses})</option></select></label></div></div><div className="table-scroll"><table><thead><tr><th>序号</th><th>开始 / 拍</th><th>音长 / 拍</th><th>原音高</th><th>游戏按法</th></tr></thead><tbody>{visibleNotes.map((entry, index) => <tr key={entry.note.id} className={selectedNoteIds.has(entry.note.id) ? 'row-selected' : ''} onClick={() => setSelectedNoteId(entry.note.id)}><td>{String(index + 1).padStart(2, '0')}</td><td>{entry.note.beat.toFixed(2)}</td><td>{entry.note.duration.toFixed(2)}</td><td>{pitchName(entry.note.pitch)}</td><td className={!entry.fingering && entry.note.pitch !== null ? 'warning-text' : ''}>{entry.note.pitch === null ? '休止' : fingeringText(entry.fingering)}</td></tr>)}</tbody></table>{!visibleNotes.length && <div className="list-empty">{noteFilter === 'out' ? '没有超出音域的音符' : '还没有音符'}</div>}</div></div>
        </> : <MissingScore onLibrary={() => setPage('library')} />}</>}

        {page === 'convert' && <>{selected ? <><div className="summary-row"><div className="metric panel"><span>可演奏音符</span><strong>{planned.filter(p => p.fingering).length}<small> / {planned.filter(p => p.note.pitch !== null).length}</small></strong></div><div className="metric panel"><span>超出音域</span><strong className={misses ? 'warning-text' : ''}>{misses}</strong></div><div className="metric panel"><span>预计时长</span><strong>{(totalMs(selected, planned) / 1000).toFixed(1)}<small> 秒</small></strong></div><div className="metric panel"><span>当前移调</span><strong>{selected.transpose >= 0 ? '+' : ''}{selected.transpose}<small> 半音</small></strong></div></div><div className="panel conversion-panel"><div className="panel-heading"><div><span className="eyebrow">ARRANGEMENT</span><h3>从原谱到游戏按法</h3></div><button className="primary-button small" onClick={() => editScore(score => ({ ...score, transpose: suggestedShift }))}><WandSparkles size={16} /> 应用建议移调 {suggestedShift >= 0 ? '+' : ''}{suggestedShift}</button></div><p>建议移调以减少超界音符为目标，应用前可先核对下方每个音的按法。</p><div className="transpose-slider"><span>-12</span><input type="range" min="-12" max="12" value={selected.transpose} onChange={event => editScore(score => ({ ...score, transpose: Number(event.target.value) }))} /><span>+12</span></div><div className="table-scroll"><table><thead><tr><th>序号</th><th>开始</th><th>原音</th><th>移调后</th><th>按键</th><th>八度修饰</th><th>半音修饰</th><th>结果</th></tr></thead><tbody>{planned.map((entry, index) => <tr key={entry.note.id}><td>{index + 1}</td><td>{entry.startMs} ms</td><td>{pitchName(entry.note.pitch)}</td><td>{pitchName(entry.note.pitch === null ? null : entry.note.pitch + selected.transpose)}</td><td>{entry.fingering ? keyLabel(entry.fingering.key) : '—'}</td><td>{entry.fingering?.octave === 1 ? '右键 ↑' : entry.fingering?.octave === -1 ? '左键 ↓' : '—'}</td><td>{entry.fingering?.sharp ? '中键 ♯' : '—'}</td><td><span className={`result-badge ${entry.note.pitch !== null && !entry.fingering ? 'bad' : ''}`}>{entry.note.pitch === null ? '休止' : entry.fingering ? '可演奏' : '需调整'}</span></td></tr>)}</tbody></table></div></div></> : <MissingScore onLibrary={() => setPage('library')} />}</>}

        {page === 'export' && <>{selected ? <><div className="export-intro panel"><div><span className="eyebrow">EXPORT CENTER</span><h2>{selected.title}</h2><p>当前版本保留 {selected.notes.length} 个事件、{selected.bpm} BPM、{selected.meter.numerator}/{selected.meter.denominator} 拍。导出前请检查超出音域的提示。</p></div><FileMusic size={65} /></div><div className="export-grid"><ExportCard icon={Save} title="项目文件" ext=".dfhproj" description="保留全部音符、曲速、拍号与移调，日后可重新导入编辑。" action={() => void exportResult('project')} /><ExportCard icon={ListMusic} title="文本键位谱" ext=".txt" description="逐音列出起点、音长、毫秒时间、按键和鼠标修饰。" action={() => void exportResult('text')} /><ExportCard icon={FileMusic} title="打印乐谱" ext=".pdf" description="A4 版式，包含乐谱信息和完整按键清单。" action={() => void exportResult('pdf')} /><ExportCard icon={ArrowDownToLine} title="谱面图片" ext=".png" description="清晰的本地图片，便于查看或分享。" action={() => void exportResult('png')} /></div></> : <MissingScore onLibrary={() => setPage('library')} />}</>}

        {page === 'guide' && <Guide />}

        {page === 'settings' && <div className="settings-layout"><div className="panel settings-card"><span className="eyebrow">HOTKEY CONTROL</span><h3>快捷键和停止</h3><p>为每首谱在曲库卡片中绑定快捷键。启动演奏准备后，快捷键在其他窗口也会响应。</p><label>紧急停止快捷键<input className="hotkey-input wide" readOnly aria-label="设置紧急停止快捷键" title="点击后按 F1–F24 或含 Ctrl、Alt、Shift 的组合键" value={library.settings.stopShortcut} onFocus={() => void prepareHotkeyEdit()} onKeyDown={event => captureHotkey(event)} /></label><div className="hint">使用标准模拟输入。可单独使用 F1–F24，或使用 Ctrl、Alt、Shift 加字母、数字、F 键。若系统提示停止键被占用，请在这里换一个键。</div></div><div className="panel settings-card wide-card"><span className="eyebrow">PLAYBACK GUARDRAIL</span><h3>游戏内自动演奏</h3><p>请先在游戏中打开口琴界面，再启动演奏准备并切回该窗口。按曲目快捷键后有 3 秒倒计时；切出窗口、停止或程序失联时会结束演奏并请求释放按键。</p><label className="check-line"><input type="checkbox" checked={understood} onChange={event => setUnderstood(event.target.checked)} /><span>我理解自动输入违反游戏现行禁用规则，可能导致封号；程序无法保证 ACE 不会检测。</span></label><div className="settings-actions"><button className={`primary-button ${armed ? 'stop-button' : ''}`} onClick={() => void toggleArm()}>{armed ? <Pause size={17} /> : <CirclePlay size={17} />}{armed ? '关闭演奏准备' : '启用演奏准备'}</button><button className="subtle-button" onClick={() => void window.studio.stop()}><Pause size={16} /> 立即停止</button></div></div></div>}
      </div>
    </main>

    {importParts && <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={() => setImportParts(null)}><X size={19} /></button><span className="eyebrow">IMPORT MUSIC</span><h2>选择要转成口琴谱的声部</h2><p>文件「{importParts.title}」包含 {importParts.parts.length} 个可用声部。游戏口琴一次只能演奏一个音。</p><label>声部<select value={partIndex} onChange={event => setPartIndex(Number(event.target.value))}>{importParts.parts.map((part, index) => <option value={index} key={index}>{part.name} · {part.notes.length} 个音</option>)}</select></label><label>同一时间有多个音时<select value={overlapPolicy} onChange={event => setOverlapPolicy(event.target.value as typeof overlapPolicy)}><option value="highest">保留最高音</option><option value="lowest">保留最低音</option><option value="first">保留第一个音</option></select></label><div className="notice"><CircleAlert size={18} /><span>所选声部检测到约 {overlapCount(importParts.parts[partIndex].notes)} 处重叠。导入后可在编辑页逐音检查。</span></div><button className="primary-button modal-action" onClick={confirmImport}>导入并打开编辑器 →</button></div></div>}
    {jianpuOpen && <div className="modal-backdrop"><div className="modal wide-modal"><button className="modal-close" onClick={() => setJianpuOpen(false)}><X size={19} /></button><span className="eyebrow">JIANPU INPUT</span><h2>输入文本简谱</h2><p>空格分隔音符。写成 <code>音级:拍数</code>，例如 <code>1:1 #3:0.5 ^1:2 0:1</code>。<code>^</code> 高八度，<code>_</code> 低八度，<code>0</code> 是休止。</p><div className="form-grid"><label>标题<input value={jianpuTitle} onChange={event => setJianpuTitle(event.target.value)} /></label><label>1 = 调名<input value={jianpuTonic} onChange={event => setJianpuTonic(event.target.value)} placeholder="C4" /></label><label>BPM<input type="number" value={jianpuBpm} onChange={event => setJianpuBpm(Number(event.target.value))} /></label><label>拍号<input type="number" value={jianpuNumerator} onChange={event => setJianpuNumerator(Number(event.target.value))} /></label><label>拍号单位<select value={jianpuDenominator} onChange={event => setJianpuDenominator(Number(event.target.value))}>{[2, 4, 8, 16].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div><label>简谱正文<textarea rows={8} value={jianpuText} onChange={event => setJianpuText(event.target.value)} /></label><button className="primary-button modal-action" onClick={importJianpu}>转成口琴谱 →</button></div></div>}
    {pendingLeave && <div className="modal-backdrop"><div className="modal leave-modal" role="dialog" aria-modal="true" aria-label="未保存的谱面"><span className="eyebrow">UNSAVED CHANGES</span><h2>谱面尚未保存</h2><p>{pendingLeave.closing ? '关闭程序前' : '离开谱面编辑前'}，请决定如何处理当前修改。</p><div className="leave-actions"><button className="subtle-button" disabled={leavingBusy} onClick={() => void resolveLeave('cancel')}>取消</button><button className="subtle-button danger" disabled={leavingBusy} onClick={() => void resolveLeave('discard')}>放弃修改</button><button className="primary-button" disabled={leavingBusy} onClick={() => void resolveLeave('save')}>{leavingBusy ? '保存中…' : '保存到曲库'}</button></div></div></div>}
  </div>;
}

function MissingScore({ onLibrary }: { onLibrary: () => void }) {
  return <div className="empty-state large"><FolderOpen size={42} /><h3>先选择一首乐谱</h3><p>在曲库中导入文件、输入简谱或新建空白谱。</p><button className="primary-button" onClick={onLibrary}>前往曲库 →</button></div>;
}

function ExportCard({ icon: Icon, title, ext, description, action }: { icon: typeof Save; title: string; ext: string; description: string; action: () => void }) {
  return <article className="export-card panel"><div className="export-icon"><Icon size={23} /></div><div><span className="eyebrow">{ext.toUpperCase()}</span><h3>{title}</h3><p>{description}</p></div><button className="subtle-button" onClick={action}><ArrowDownToLine size={16} /> 导出文件</button></article>;
}

function Guide() {
  return <div className="guide-layout"><div className="guide-lead panel"><span className="eyebrow">MUSIC THEORY / START HERE</span><h2>看懂一首谱，再把它变成八个键。</h2><p>这份说明按工作台的简谱输入规则编写。输入谱面后，转换页会自动找出口琴按法。</p></div><div className="guide-grid"><article className="panel guide-card"><span className="step">01 / 简谱与调名</span><h3>默认 1 = C4</h3><p>口琴的 1 对应 C4。输入简谱时，默认调名也是 C4；若导入其他调的乐谱，可在输入时指定其主音。</p><div className="example">1=C4　 1:1 2:1 3:1 4:1</div></article><article className="panel guide-card"><span className="step">02 / 音高记号</span><h3>高低八度与升降音</h3><p><code>^1</code> 是高八度的 1，<code>_1</code> 是低八度的 1；<code>#3</code> 比 3 高半音，<code>b3</code> 比 3 低半音。游戏口琴的中键固定升半音，转换器会寻找等音按法。</p><div className="example">_5:1　 5:1　 #5:1　 ^5:1</div></article><article className="panel guide-card"><span className="step">03 / 节奏与休止</span><h3>冒号后写音长</h3><p><code>1:1</code> 持续 1 拍，<code>2:0.5</code> 持续半拍，<code>0:1</code> 休止 1 拍。BPM=120 时，一拍约 0.5 秒；4/4 表示每小节 4 个四分音符拍。竖线仅便于阅读。</p><div className="example">1:1 2:0.5 3:0.5 0:1 | 5:1</div></article><article className="panel guide-card"><span className="step">04 / 五线谱与导入</span><h3>音符位置变成绝对音高</h3><p>五线谱由谱号、线间位置、调号、临时升降号和时值决定音高与节奏。高音谱号第二线为 G4，低音谱号第四线为 F3。请从制谱软件导出 MusicXML/MXL；导入时先选声部，再处理和弦。</p><div className="example">高音谱号 · E4 F4 G4 A4 → MIDI 64 65 67 69</div></article></div></div>;
}

