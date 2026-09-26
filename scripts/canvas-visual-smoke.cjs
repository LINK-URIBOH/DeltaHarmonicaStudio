const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
const root = path.resolve(__dirname, '..');
const score = { id: 'canvas', title: '定位试听与批量编辑', source: 'blank', tonicMidi: 60, bpm: 120, meter: { numerator: 4, denominator: 4 }, tempoChanges: [{ beat: 4, bpm: 90 }], transpose: 0,
  notes: [{ id: 'a', beat: 1.03, duration: 2, pitch: 60 }, { id: 'b', beat: 4, duration: .5, pitch: 64 }, { id: 'r', beat: 6, duration: 1, pitch: null }, { id: 'out', beat: 16, duration: 1, pitch: 40 }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const library = { version: 1, scores: [score], hotkeys: {}, settings: { rootMidi: 60, stopShortcut: 'Ctrl+Alt+Shift+F12', outputMode: 'sendinput' } };
let saves = 0;
ipcMain.handle('library:get', () => library);
ipcMain.handle('library:save', (_, next) => { saves++; Object.assign(library, next); return true; });
ipcMain.handle('window:confirm-close', () => true);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { preload: path.join(root, 'dist-electron/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } });
  const run = code => win.webContents.executeJavaScript(code, true);
  const click = text => run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
  const mouse = (type, point) => win.webContents.sendInputEvent({ type, x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
  const selected = () => run("[...document.querySelectorAll('.timeline-note.selected')].map(n=>n.dataset.noteId)");
  async function box() {
    const points = await run("(() => {const a=document.querySelector('[data-note-id=a]').getBoundingClientRect();const b=document.querySelector('[data-note-id=b]').getBoundingClientRect();return {start:{x:a.left-12,y:b.top-10},end:{x:b.right+12,y:a.bottom+10}};})()");
    mouse('mouseMove', points.start); mouse('mouseDown', points.start); await pause(380);
    mouse('mouseMove', points.end); await pause(60); mouse('mouseUp', points.end); await pause(80);
  }
  try {
    await win.loadFile(path.join(root, 'dist/index.html')); await pause(450); await click('谱面编辑'); await pause(150);
    await run("document.querySelector('.score-workspace').scrollIntoView({block:'start'})"); await pause(120);
    await box(); assert.deepEqual(await selected(), ['a', 'b']); assert.equal(saves, 0); await pause(250);
    fs.writeFileSync(path.join(root, 'preview-canvas-multi-smoke.png'), (await win.webContents.capturePage()).toPNG());
    const a = await run("(() => {const r=document.querySelector('[data-note-id=a]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+11};})()");
    mouse('mouseMove', a); mouse('mouseDown', a); mouse('mouseMove', { x: a.x + 64, y: a.y - 28 }); await pause(70); mouse('mouseUp', { x: a.x + 64, y: a.y - 28 }); await pause(100);
    assert.deepEqual(await selected(), ['a', 'b']); assert.equal(saves, 0);
    await click('保存到曲库'); await pause(100);
    assert.deepEqual(library.scores[0].notes.slice(0, 2), score.notes.slice(0, 2).map(n=>({ ...n, pitch:n.pitch+1 })));
    const ruler = await run("(() => {const r=document.querySelector('.timeline-ruler').getBoundingClientRect();return {x:r.left+72+128,y:r.top+12};})()");
    mouse('mouseMove', ruler); mouse('mouseDown', ruler); mouse('mouseUp', ruler); await pause(50);
    assert.equal(await run("document.querySelector('.timeline-start-label').textContent"), '起播 2 拍');
    await run("document.querySelector('.timeline-tools button:nth-child(4)').click()"); await pause(450);
    const play = await run("({line:parseFloat(document.querySelector('.timeline-play-line').style.left),scroll:document.querySelector('.timeline-scroll').scrollLeft,width:document.querySelector('.timeline-scroll').clientWidth})");
    assert.ok(play.line > 200); assert.ok(Math.abs(play.scroll - Math.max(0, play.line - play.width / 3)) < 2);
    fs.writeFileSync(path.join(root, 'preview-canvas-play-smoke.png'), (await win.webContents.capturePage()).toPNG());
    await run("document.querySelector('.timeline-tools button:nth-child(4)').click()"); assert.equal(await run("!!document.querySelector('.timeline-play-line')"), false);
    await box();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' }); await pause(80);
    assert.equal(await run("document.querySelectorAll('.timeline-note').length"), 2);
    await click('撤销'); assert.equal(await run("document.querySelectorAll('.timeline-note').length"), 4);
    // Exercise edge auto-scroll with a genuine captured mouse pointer, then cancel.
    const edge = await run("(() => {const r=document.querySelector('.timeline-scroll').getBoundingClientRect();return {start:{x:r.left+100,y:r.bottom-60},end:{x:r.right-5,y:r.bottom-5},before:document.querySelector('.timeline-scroll').scrollTop};})()");
    mouse('mouseMove', edge.start); mouse('mouseDown', edge.start); await pause(380); mouse('mouseMove', edge.end); await pause(250);
    assert.ok(await run(`document.querySelector('.timeline-scroll').scrollTop > ${edge.before}`));
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); mouse('mouseUp', edge.end); await pause(80);
    assert.equal(await run("!!document.querySelector('.timeline-selection-box')"), false);
    await click('去除开头空白'); await pause(100);
    assert.equal(await run("document.querySelector('[data-note-id=a]').style.left"), '74px');
    assert.equal(await run("document.querySelector('.timeline-start-label').textContent"), '起播 0 拍');
    assert.equal(saves, 1);
    await click('保存到曲库'); await pause(80);
    assert.equal(library.scores[0].notes.find(note => note.id === 'a').beat, 0);
    assert.ok(Math.abs(library.scores[0].tempoChanges[0].beat - 2.97) < 1e-8);
    win.setSize(1000, 1100); await pause(200);
    assert.ok(await run("document.querySelector('.timeline-tools').scrollWidth <= document.querySelector('.timeline-tools').clientWidth"));
    console.log('Canvas desktop checks passed: genuine long press/capture, group pitch drag, positioned audio and play line, Delete/undo, edge auto-scroll and Esc, narrow tools.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
