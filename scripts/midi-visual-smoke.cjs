const { app, BrowserWindow, ipcMain } = require('electron');
const { Midi } = require('@tonejs/midi');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
const root = path.resolve(__dirname, '..');
const library = { version: 1, scores: [], hotkeys: {}, settings: { rootMidi: 60, stopShortcut: 'Ctrl+Alt+Shift+F12', outputMode: 'sendinput' } };
let saves = 0;
ipcMain.handle('library:get', () => library);
ipcMain.handle('library:save', (_, next) => { saves++; Object.assign(library, next); return true; });
ipcMain.handle('window:confirm-close', () => true);
const midi = new Midi();
midi.header.setTempo(120);
for (const [name, channel, pitch] of [['旋律', 0, 72], ['伴奏', 1, 48], ['鼓', 9, 38]]) {
  const track = midi.addTrack(); track.name = Buffer.from(name).toString('latin1'); track.channel = channel;
  for (let i = 0; i < 8; i++) track.addNote({ midi: pitch + (channel === 9 ? 0 : i % 3), ticks: 240 + i * 480, durationTicks: 600 });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.join(root, 'dist-electron/preload.js'), contextIsolation: true, sandbox: true } });
  const run = script => win.webContents.executeJavaScript(script, true);
  const click = text => run(`[...document.querySelectorAll('.midi-import-modal button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const upload = () => run(`(() => { const file = new File([new Uint8Array(${JSON.stringify([...midi.toArray()])})], '多声部检查.mid'); const dt = new DataTransfer(); dt.items.add(file); const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles:true })); })()`);
  try {
    await win.loadFile(path.join(root, 'dist/index.html')); await pause(500);
    await upload(); await pause(400);
    assert.equal(await run("document.querySelectorAll('.midi-part').length"), 3);
    assert.equal(await run("document.querySelectorAll('.midi-part input:checked').length"), 1);
    assert.ok((await run("document.querySelector('.midi-part-details strong').textContent")).includes('旋律'));
    fs.writeFileSync(path.join(root, 'preview-midi-wide-smoke.png'), (await win.webContents.capturePage()).toPNG());
    await click('试听'); await pause(700);
    assert.ok(await run("document.querySelector('.midi-audio-progress').value > .2"), '真实音频试听应更新进度');
    await run("document.querySelectorAll('.midi-part input')[1].click()"); await pause(100);
    assert.equal(await run("document.querySelector('.midi-audio-progress').value"), 0, '切换选择应停止播放');
    await run("const mode=document.querySelector('[aria-label=\"MIDI 导入方式\"]'); mode.value='merge'; mode.dispatchEvent(new Event('change',{bubbles:true}))");
    await click('口琴转换结果'); await pause(100);
    assert.ok((await run("document.querySelector('.midi-conversion-stats').textContent")).includes('原始 16'));
    win.setSize(800, 950); await pause(300);
    const bounds = await run("(() => {const m=document.querySelector('.midi-import-modal');const l=document.querySelector('.midi-part-list').getBoundingClientRect();const p=document.querySelector('.midi-preview').getBoundingClientRect();return {overflow:m.scrollWidth-m.clientWidth,stacked:p.top>=l.bottom};})()");
    assert.ok(bounds.overflow <= 1); assert.equal(bounds.stacked, true);
    fs.writeFileSync(path.join(root, 'preview-midi-narrow-smoke.png'), (await win.webContents.capturePage()).toPNG());
    await click('取消'); assert.equal(saves, 0);
    await upload(); await pause(300);
    await run("document.querySelectorAll('.midi-part input')[1].click()");
    await click('导入 2 个声部，生成 2 首谱'); await pause(400);
    assert.equal(saves, 1); assert.equal(library.scores.length, 2);
    assert.equal(await run("!!document.querySelector('.midi-import-modal')"), false);
    assert.ok(await run("!!document.querySelector('.score-workspace')"));
    console.log('MIDI desktop checks passed: wide/narrow layout, real audio progress and stop, cancel, batch import.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
