import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

if (process.env.STUDIO_USER_DATA_DIR) app.setPath('userData', process.env.STUDIO_USER_DATA_DIR);
app.disableHardwareAcceleration();

type NoteEvent = { startMs: number; durationMs: number; key: string; octave: number; sharp: boolean };
type SavedScore = { id: string; title: string; notes: unknown[]; [key: string]: unknown };
type Library = { version: 1; scores: SavedScore[]; hotkeys: Record<string, string>; settings: { rootMidi: number; stopShortcut: string; outputMode?: 'sendinput' | 'postmessage' } };

const freshLibrary = (): Library => ({ version: 1, scores: [], hotkeys: {}, settings: { rootMidi: 60, stopShortcut: 'Ctrl+Alt+Shift+F12', outputMode: 'sendinput' } });
let mainWindow: BrowserWindow | null = null;
let closeApproved = false;
let library: Library = freshLibrary();
let armed = false;
let helper: ChildProcessWithoutNullStreams | null = null;
let heartbeat: NodeJS.Timeout | null = null;

function libraryPath() { return path.join(app.getPath('userData'), 'library.json'); }
function sendStatus(message: string) { mainWindow?.webContents.send('playback:status', message); }
function isScore(score: unknown): score is SavedScore {
  if (!score || typeof score !== 'object') return false;
  const s = score as Record<string, unknown>;
  const meter = s.meter as Record<string, unknown> | undefined;
  return typeof s.id === 'string' && typeof s.title === 'string' && s.title.length <= 500 &&
    Array.isArray(s.notes) && s.notes.length <= 10000 && s.notes.every((note: unknown) => {
      if (!note || typeof note !== 'object') return false;
      const n = note as Record<string, unknown>;
      return typeof n.id === 'string' && Number.isFinite(n.beat) && Number(n.beat) >= 0 &&
        Number.isFinite(n.duration) && Number(n.duration) > 0 &&
        (n.pitch === null || (Number.isInteger(n.pitch) && Number(n.pitch) >= 0 && Number(n.pitch) <= 127));
    }) &&
    Number.isFinite(s.bpm) && Number(s.bpm) > 0 && Number.isInteger(s.transpose) &&
    Number.isInteger(s.tonicMidi) && Number(s.tonicMidi) >= 0 && Number(s.tonicMidi) <= 127 &&
    Array.isArray(s.tempoChanges) && s.tempoChanges.every((change: unknown) => {
      if (!change || typeof change !== 'object') return false;
      const t = change as Record<string, unknown>;
      return Number.isFinite(t.beat) && Number(t.beat) >= 0 && Number.isFinite(t.bpm) && Number(t.bpm) > 0;
    }) &&
    !!meter && Number.isInteger(meter.numerator) && Number(meter.numerator) > 0 &&
    Number.isInteger(meter.denominator) && [2, 4, 8, 16].includes(Number(meter.denominator));
}
function isLibrary(value: unknown): value is Library {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const settings = v.settings as Record<string, unknown> | undefined;
  return v.version === 1 && Array.isArray(v.scores) && v.scores.every(isScore) &&
    !!v.hotkeys && typeof v.hotkeys === 'object' && !!settings &&
    Number.isInteger(settings.rootMidi) && Number(settings.rootMidi) >= 0 && Number(settings.rootMidi) <= 127 &&
    typeof settings.stopShortcut === 'string' && (settings.outputMode === undefined || ['sendinput', 'postmessage'].includes(String(settings.outputMode)));
}

function loadLibrary() {
  try {
    const parsed = JSON.parse(fs.readFileSync(libraryPath(), 'utf8'));
    if (isLibrary(parsed)) library = { ...parsed, settings: { ...parsed.settings, rootMidi: 60, outputMode: 'sendinput' } };
  } catch { library = freshLibrary(); }
}
function saveLibrary() {
  fs.mkdirSync(path.dirname(libraryPath()), { recursive: true });
  const destination = libraryPath();
  const temp = destination + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(library, null, 2), 'utf8');
  fs.renameSync(temp, destination);
}

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'helper', 'DeltaHarmonicaInput.exe')
    : path.join(app.getAppPath(), 'helper', 'DeltaHarmonicaInput.exe');
}
function helperWrite(command: string) {
  if (!helper || !helper.stdin.writable) throw new Error('输入辅助进程未运行');
  helper.stdin.write(command + '\n');
}
function stopPlayback() {
  try { helperWrite('STOP'); } catch { /* helper may already have exited */ }
  sendStatus('已停止，并请求释放所有按键');
}
function stopHelper() {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  try { helperWrite('QUIT'); } catch { /* already closed */ }
  if (helper) {
    const old = helper;
    setTimeout(() => { if (!old.killed) old.kill(); }, 1000).unref();
    helper = null;
  }
}
function startHelper() {
  const executable = helperPath();
  if (!fs.existsSync(executable)) throw new Error('未找到 Windows 输入辅助进程。请先运行 npm run helper:build。');
  helper = spawn(executable, [String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const current = helper;
  readline.createInterface({ input: current.stdout }).on('line', line => {
    const [code, detail] = line.split('\t', 2);
    if (code === 'ERROR') sendStatus(`输入错误：${detail ?? '未知错误'}`);
    else if (code === 'COUNTDOWN') sendStatus(`准备演奏：${detail} 秒`);
    else if (code === 'PLAYING') sendStatus('正在自动演奏');
    else if (code === 'FINISHED') sendStatus('已发送全部音符；请以游戏实际发声判断是否成功');
    else if (code === 'STOPPED') sendStatus('已停止');
    else if (code === 'READY') sendStatus('输入辅助进程已就绪');
  });
  current.stderr.on('data', data => sendStatus(`输入辅助进程：${String(data).trim()}`));
  current.on('exit', () => {
    if (helper === current) {
      helper = null;
      armed = false;
      globalShortcut.unregisterAll();
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      mainWindow?.webContents.send('armed:changed', false);
      sendStatus('输入辅助进程已退出，演奏准备已关闭');
    }
  });
  heartbeat = setInterval(() => {
    try { helperWrite('PING'); } catch { stopHelper(); }
  }, 250);
}

function shortcutEntries(data: Library) {
  const list: [string, string][] = [['__stop__', data.settings.stopShortcut]];
  for (const score of data.scores) {
    const shortcut = data.hotkeys[score.id];
    if (shortcut) list.push([score.id, shortcut]);
  }
  const seen = new Set<string>();
  for (const [, shortcut] of list) {
    if (!/^(?:(?:(?:Ctrl|Alt|Shift)\+){1,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(shortcut)) throw new Error(`快捷键格式无效：${shortcut || '空白'}`);
    if (seen.has(shortcut.toLowerCase())) throw new Error(`快捷键冲突：${shortcut}`);
    seen.add(shortcut.toLowerCase());
  }
  return list;
}
function probeChangedShortcuts(next: Library) {
  const oldEntries = new Map<string, string>([['__stop__', library.settings.stopShortcut], ...library.scores.map(score => [score.id, library.hotkeys[score.id] || ''] as [string, string])]);
  const candidates = shortcutEntries(next).filter(([id, shortcut]) => oldEntries.get(id) !== shortcut);
  const registered: string[] = [];
  try {
    for (const [, shortcut] of candidates) {
      if (!globalShortcut.register(shortcut, () => {})) throw new Error(`系统无法注册快捷键 ${shortcut}，可能已被其他程序占用。请换一个组合键`);
      registered.push(shortcut);
    }
  } finally {
    for (const shortcut of registered) globalShortcut.unregister(shortcut);
  }
}
function registerShortcuts(data: Library) {
  globalShortcut.unregisterAll();
  for (const [id, shortcut] of shortcutEntries(data)) {
    const ok = globalShortcut.register(shortcut, () => {
      if (!armed) return;
      if (id === '__stop__') stopPlayback();
      else mainWindow?.webContents.send('playback:request', id);
    });
    if (!ok) { globalShortcut.unregisterAll(); throw new Error(`系统无法注册快捷键 ${shortcut}，可能已被其他程序占用`); }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420, height: 900, minWidth: 1024, minHeight: 680,
    title: '口琴谱工作台', backgroundColor: '#101822', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.on('close', event => {
    if (closeApproved) return;
    event.preventDefault();
    mainWindow?.webContents.send('window:close-request');
  });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; armed = false; globalShortcut.unregisterAll(); stopHelper(); });
}

function exportPath(defaultName: string, extension: string) {
  return dialog.showSaveDialog(mainWindow!, {
    defaultPath: `${defaultName}.${extension}`,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
  });
}

app.whenReady().then(() => {
  loadLibrary();
  createWindow();
  ipcMain.handle('window:confirm-close', () => {
    closeApproved = true;
    mainWindow?.close();
    return true;
  });
  ipcMain.handle('library:get', () => library);
  ipcMain.handle('library:save', (_event, value: unknown) => {
    if (!isLibrary(value)) throw new Error('曲库数据格式无效');
    const next = value as Library;
    shortcutEntries(next);
    if (armed) {
      stopPlayback();
      try { registerShortcuts(next); }
      catch (error) {
        try { registerShortcuts(library); }
        catch {
          armed = false; stopHelper();
          mainWindow?.webContents.send('armed:changed', false);
        }
        throw error;
      }
    } else probeChangedShortcuts(next);
    next.settings.rootMidi = 60;
    next.settings.outputMode = 'sendinput';
    const previous = library;
    library = next;
    try { saveLibrary(); }
    catch (error) {
      library = previous;
      if (armed) {
        try { registerShortcuts(previous); }
        catch {
          armed = false; stopHelper();
          mainWindow?.webContents.send('armed:changed', false);
        }
      }
      throw error;
    }
    return true;
  });
  ipcMain.handle('playback:arm', (_event, requested: boolean) => {
    if (!requested) {
      armed = false; globalShortcut.unregisterAll(); stopPlayback(); stopHelper();
      mainWindow?.webContents.send('armed:changed', false);
      return false;
    }
    if (process.platform !== 'win32') throw new Error('自动输入仅支持 Windows');
    if (!armed) {
      startHelper();
      try { registerShortcuts(library); }
      catch (error) { stopHelper(); throw error; }
      armed = true;
      mainWindow?.webContents.send('armed:changed', true);
    }
    return true;
  });
  ipcMain.handle('playback:stop', () => { stopPlayback(); return true; });
  ipcMain.handle('playback:start', (_event, scoreId: string, events: NoteEvent[]) => {
    if (!armed) throw new Error('请先启用演奏准备');
    if (!library.scores.some(score => score.id === scoreId)) throw new Error('曲库中找不到这首谱');
    if (!Array.isArray(events) || !events.length || events.length > 10000) throw new Error('可演奏音符数量无效');
    for (const note of events) {
      if (!Number.isInteger(note.startMs) || note.startMs < 0 || note.startMs > 3600000 ||
          !Number.isInteger(note.durationMs) || note.durationMs < 1 || note.durationMs > 60000 ||
          !'ZXCVBNM,'.includes(note.key) || note.key.length !== 1 ||
          ![-1, 0, 1].includes(note.octave) || typeof note.sharp !== 'boolean') throw new Error('演奏事件无效');
    }
    const rows = events.map(note => `${note.startMs}|${note.durationMs}|${note.key}|${note.octave}|${Number(note.sharp)}`).join(';');
    helperWrite('PLAY\t' + Buffer.from(rows, 'ascii').toString('base64'));
    return true;
  });
  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: [{ name: '口琴谱项目', extensions: ['dfhproj'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 10 * 1024 * 1024) throw new Error('项目文件超过 10 MB');
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || (data as Record<string, unknown>).version !== 1 || !isScore((data as Record<string, unknown>).score)) throw new Error('项目文件格式无效');
    return (data as { score: SavedScore }).score;
  });
  ipcMain.handle('project:save', async (_event, score: unknown) => {
    if (!isScore(score)) throw new Error('乐谱数据无效');
    const chosen = await exportPath((score as SavedScore).title, 'dfhproj');
    if (chosen.canceled || !chosen.filePath) return false;
    fs.writeFileSync(chosen.filePath, JSON.stringify({ version: 1, score }, null, 2), 'utf8');
    return true;
  });
  ipcMain.handle('export:text', async (_event, title: string, content: string) => {
    if (typeof content !== 'string' || content.length > 5_000_000) throw new Error('文本导出数据过大');
    const chosen = await exportPath(title, 'txt');
    if (chosen.canceled || !chosen.filePath) return false;
    fs.writeFileSync(chosen.filePath, content, 'utf8');
    return true;
  });
  ipcMain.handle('export:page', async (_event, title: string, html: string, format: 'pdf' | 'png', rowCount: number) => {
    if (typeof html !== 'string' || html.length > 5_000_000 || !['pdf', 'png'].includes(format) || !Number.isInteger(rowCount) || rowCount < 0) throw new Error('页面导出数据无效');
    if (format === 'png' && rowCount > 300) throw new Error('图片导出最多支持 300 个事件；请使用可自动分页的 PDF');
    const chosen = await exportPath(title, format);
    if (chosen.canceled || !chosen.filePath) return false;
    const imageHeight = Math.min(16000, Math.max(700, 350 + rowCount * 35));
    const printWindow = new BrowserWindow({ show: false, width: format === 'png' ? 1280 : 794, height: format === 'png' ? imageHeight : 1123, useContentSize: true,
      webPreferences: { javascript: false, sandbox: true, nodeIntegration: false, contextIsolation: true } });
    try {
      await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      if (format === 'pdf') {
        const buffer = await printWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
        fs.writeFileSync(chosen.filePath, buffer);
      } else {
        const image = await printWindow.webContents.capturePage();
        fs.writeFileSync(chosen.filePath, image.toPNG());
      }
    } finally { printWindow.destroy(); }
    return true;
  });
});

app.on('before-quit', () => { armed = false; globalShortcut.unregisterAll(); stopHelper(); });
app.on('window-all-closed', () => app.quit());
