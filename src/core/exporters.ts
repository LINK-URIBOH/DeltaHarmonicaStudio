import { endBeat, type Score } from './model';
import { fingeringText, pitchName, planScore } from './harmonica';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function textScore(score: Score, rootMidi: number): string {
  const planned = planScore(score, rootMidi);
  const rows = [
    `《${score.title}》`,
    `BPM: ${score.bpm} | 拍号: ${score.meter.numerator}/${score.meter.denominator} | 移调: ${score.transpose >= 0 ? '+' : ''}${score.transpose} 半音`,
    `音高基准: Z = ${pitchName(rootMidi)}`,
    '规则: Z X C V B N M , = 1 2 3 4 5 6 7 高音1；右键=升八度，左键=降八度，中键=升半音。',
    '起点/音长单位为拍；毫秒时间已计入变速。时值 1 拍在当前 BPM 下约为 60000/BPM 毫秒。',
    '',
    '序号 | 起点(拍) | 音长(拍) | 起点(ms) | 音长(ms) | 音高 | 演奏按键',
    '-----|----------|-----------|----------|----------|------|----------'
  ];
  planned.forEach((entry, index) => rows.push([
    String(index + 1).padStart(3),
    entry.note.beat.toFixed(2).padStart(8),
    entry.note.duration.toFixed(2).padStart(9),
    String(entry.startMs).padStart(8),
    String(entry.durationMs).padStart(8),
    pitchName(entry.note.pitch === null ? null : entry.note.pitch + score.transpose).padEnd(5),
    entry.note.pitch === null ? '休止' : fingeringText(entry.fingering)
  ].join(' | ')));
  if (score.tempoChanges.length) rows.push('', '变速:', ...score.tempoChanges.map(t => `第 ${t.beat.toFixed(2)} 拍 → ${t.bpm} BPM`));
  return rows.join('\r\n') + '\r\n';
}

export function pageHtml(score: Score, rootMidi: number): string {
  const planned = planScore(score, rootMidi);
  const rows = planned.map((entry, index) => `<tr><td>${index + 1}</td><td>${entry.note.beat.toFixed(2)}</td><td>${entry.note.duration.toFixed(2)}</td><td>${entry.startMs}</td><td>${entry.durationMs}</td><td>${escapeHtml(pitchName(entry.note.pitch === null ? null : entry.note.pitch + score.transpose))}</td><td>${escapeHtml(entry.note.pitch === null ? '休止' : fingeringText(entry.fingering))}</td></tr>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm 13mm; }
    * { box-sizing: border-box; } body { margin: 0; padding: 24px; color: #182027; font-family: "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; font-size: 12px; background: white; }
    h1 { font-size: 26px; margin: 0 0 12px; } .meta { display: flex; gap: 25px; border-top: 2px solid #77a13a; border-bottom: 1px solid #d5dfca; padding: 10px 0; margin-bottom: 14px; }
    .note { color: #53616c; line-height: 1.65; margin-bottom: 18px; } table { border-collapse: collapse; width: 100%; table-layout: fixed; } th { background: #eaf0e3; text-align: left; } td, th { border-bottom: 1px solid #e1e6e8; padding: 6px 5px; } tr { break-inside: avoid; } td:last-child { font-weight: 700; color: #3a6715; }
    footer { margin-top: 18px; font-size: 11px; color: #77838b; } @media print { body { padding: 0; } }
  </style></head><body><h1>${escapeHtml(score.title)}</h1><div class="meta"><span>BPM ${score.bpm}</span><span>拍号 ${score.meter.numerator}/${score.meter.denominator}</span><span>移调 ${score.transpose >= 0 ? '+' : ''}${score.transpose} 半音</span><span>总长 ${endBeat(score).toFixed(2)} 拍</span></div>
  <div class="note">Z X C V B N M , = 1 2 3 4 5 6 7 高音1；右键升八度，左键降八度，中键升半音。Z = ${escapeHtml(pitchName(rootMidi))}。起点与音长均按拍记录。</div>
  <table><thead><tr><th>序</th><th>起点/拍</th><th>音长/拍</th><th>起点/ms</th><th>音长/ms</th><th>音高</th><th>键位与修饰</th></tr></thead><tbody>${rows}</tbody></table><footer>口琴谱工作台 · 本地生成</footer></body></html>`;
}
