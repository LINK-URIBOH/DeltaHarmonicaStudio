import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Accidental, Barline, Dot, Formatter, Renderer, Stave, StaveNote, StaveTie } from 'vexflow/core';
import { loadNotationFonts } from './notationFonts';
import { GUIDE_MEASURES, GUIDE_SOURCES, RHYTHM_VALUES, guideDuration, guideJianpu, type GuideNote } from './core/guide';
import './guide.css';

const PITCH_KEYS = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const SCALE: readonly GuideNote[] = [60, 62, 64, 65, 67, 69, 71, 72].map(pitch => ({ pitch, duration: 1 }));
const OCTAVES: readonly GuideNote[] = [48, 60, 72].map(pitch => ({ pitch, duration: 1 }));
const MARKS: readonly GuideNote[] = [{ pitch: 61, duration: 1, accidental: '#' }, { pitch: 60, duration: 1, accidental: 'n' }, { pitch: 63, duration: 1, accidental: 'b' }];
const DOTTED: readonly GuideNote[] = [{ pitch: 60, duration: 1.5 }, { pitch: 62, duration: .5 }];
const TIED: readonly GuideNote[] = [{ pitch: 60, duration: 1, tieToNext: true }, { pitch: 60, duration: 1 }];
const SLURRED: readonly GuideNote[] = [{ pitch: 60, duration: 1 }, { pitch: 64, duration: 1 }];

function pitchKey(note: GuideNote) {
  if (note.pitch === null) return 'b/4';
  const natural = note.pitch - (note.accidental === '#' ? 1 : note.accidental === 'b' ? -1 : 0);
  return `${note.accidental ? PITCH_KEYS[natural % 12].replace('#', '') : PITCH_KEYS[natural % 12]}/${Math.floor(natural / 12) - 1}`;
}

function StaffFigure({ notes, label, clef = 'treble', meter, labels, end = false, slur = false, width = 600, lineLabels = false }: {
  notes: readonly GuideNote[]; label: string; clef?: 'treble' | 'bass'; meter?: string; labels?: readonly string[]; end?: boolean; slur?: boolean; width?: number; lineLabels?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadNotationFonts().then(() => {
      if (!active || !host.current) return;
      const div = host.current;
      div.replaceChildren();
      const renderer = new Renderer(div, Renderer.Backends.SVG);
      renderer.resize(width, 175);
      const context = renderer.getContext();
      const stave = new Stave(10, 30, width - (lineLabels ? 85 : 20));
      stave.addClef(clef);
      if (meter) stave.addTimeSignature(meter);
      if (end) stave.setEndBarType(Barline.type.END);
      stave.setContext(context).draw();
      const rendered = notes.map(item => {
        const { code, dotted } = guideDuration(item.duration);
        const note = new StaveNote({ clef, keys: [item.pitch === null && clef === 'bass' ? 'd/3' : pitchKey(item)], duration: `${code}${dotted ? 'd' : ''}${item.pitch === null ? 'r' : ''}` });
        if (dotted) Dot.buildAndAttach([note], { all: true });
        if (item.accidental) note.addModifier(new Accidental(item.accidental), 0);
        return note;
      });
      // Diagrams sometimes show a scale rather than a complete measure.
      Formatter.FormatAndDraw(context, stave, rendered, { autoBeam: true, alignRests: false });
      notes.forEach((item, index) => {
        if (item.tieToNext && rendered[index + 1]) new StaveTie({ firstNote: rendered[index], lastNote: rendered[index + 1], firstIndexes: [0], lastIndexes: [0] }).setContext(context).draw();
      });
      const svg = div.querySelector('svg')!;
      svg.setAttribute('viewBox', `0 0 ${width} 175`);
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.style.removeProperty('width'); svg.style.removeProperty('height');
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
      const ns = 'http://www.w3.org/2000/svg';
      const text = (x: number, y: number, value: string, anchor = 'middle') => {
        const node = document.createElementNS(ns, 'text');
        node.setAttribute('x', String(x)); node.setAttribute('y', String(y)); node.setAttribute('text-anchor', anchor);
        node.setAttribute('class', 'guide-svg-label');
        node.setAttribute('stroke', 'none');
        // VexFlow sets an inherited music font on its SVG; labels need a text font.
        node.style.fontFamily = 'Microsoft YaHei, sans-serif'; node.style.fontSize = '12px'; node.style.fill = '#5c7466';
        node.textContent = value; svg.appendChild(node);
      };
      labels?.forEach((value, index) => text(rendered[index].getAbsoluteX(), 155, value));
      if (lineLabels) for (let index = 0; index < 5; index++) {
        const y = stave.getYForLine(index);
        const labelY = 50 + index * 18;
        const connector = document.createElementNS(ns, 'path');
        connector.setAttribute('d', `M ${width - 75} ${y} L ${width - 65} ${labelY - 4}`);
        connector.setAttribute('stroke', '#a3b794'); connector.setAttribute('fill', 'none'); svg.appendChild(connector);
        text(width - 60, labelY, `第 ${5 - index} 线`, 'start');
      }
      if (slur && rendered.length > 1) {
        const arc = document.createElementNS(ns, 'path');
        arc.setAttribute('d', `M ${rendered[0].getAbsoluteX()} 55 Q ${(rendered[0].getAbsoluteX() + rendered[1].getAbsoluteX()) / 2} 28 ${rendered[1].getAbsoluteX()} 55`);
        arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', '#304d3a'); arc.setAttribute('stroke-width', '1.5'); svg.appendChild(arc);
      }
    }).catch(() => { if (active) setError('教学谱图加载失败，请重新进入此页。'); });
    return () => { active = false; };
  }, [notes, label, clef, meter, labels, end, slur, width, lineLabels]);
  return <div className="guide-staff" ref={host} aria-busy={!!error}>{error && <p role="alert">{error}</p>}</div>;
}

function JianpuFigure({ notes, label, labels, end = false, slur = false }: { notes: readonly GuideNote[]; label: string; labels?: readonly string[]; end?: boolean; slur?: boolean }) {
  const width = Math.max(240, notes.reduce((total, note) => total + Math.max(1, note.duration) * 70, 30));
  let position = 20;
  const positions = notes.map(note => { const x = position; position += Math.max(1, note.duration) * 70; return x; });
  return <svg className="guide-jianpu" viewBox={`0 0 ${width} 115`} role="img" aria-label={label}>
    {notes.map((note, index) => {
      const symbol = guideJianpu(note);
      const x = positions[index];
      return <g key={index} data-duration={note.duration} data-pitch={note.pitch ?? 'rest'}>
        {note.accidental && <text x={x - 13} y="56" fontSize="22">{note.accidental === '#' ? '♯' : note.accidental === 'b' ? '♭' : '♮'}</text>}
        <text x={x} y="58" className="guide-digit">{symbol.digit}</text>
        {symbol.tail.map((value, part) => <text key={part} x={x + (part + 1) * 70} y="58" className="guide-digit">{value}</text>)}
        {Array.from({ length: Math.abs(symbol.octave) }, (_, dot) => <circle key={dot} cx={x + 8} cy={symbol.octave > 0 ? 30 - dot * 7 : 79 + dot * 7} r="2.3" />)}
        {Array.from({ length: symbol.underlines }, (_, line) => <line key={line} x1={x - 1} x2={x + 18} y1={66 + line * 6} y2={66 + line * 6} stroke="currentColor" strokeWidth="2" />)}
        {symbol.dotted && <circle cx={x + 24} cy="53" r="2.4" />}
        {note.tieToNext && positions[index + 1] !== undefined && <path d={`M ${x + 8} 23 Q ${(x + positions[index + 1]) / 2 + 8} 4 ${positions[index + 1] + 8} 23`} fill="none" stroke="currentColor" strokeWidth="1.5" />}
        {labels?.[index] && <text x={x + 8} y="106" textAnchor="middle" className="guide-svg-label">{labels[index]}</text>}
      </g>;
    })}
    {slur && <path d={`M 28 23 Q ${(28 + positions.at(-1)! + 8) / 2} 4 ${positions.at(-1)! + 8} 23`} fill="none" stroke="currentColor" strokeWidth="1.5" />}
    <line x1={width - 6} x2={width - 6} y1="32" y2="76" stroke="currentColor" />
    {end && <line x1={width - 2} x2={width - 2} y1="32" y2="76" stroke="currentColor" strokeWidth="3" />}
  </svg>;
}

function Section({ id, number, title, intro, children }: { id: string; number: string; title: string; intro: string; children: ReactNode }) {
  return <section className="panel lesson-section" id={`lesson-${id}`} aria-labelledby={`heading-${id}`}>
    <header><span className="lesson-number">{number}</span><div><h3 id={`heading-${id}`}>{title}</h3><p>{intro}</p></div></header>{children}
  </section>;
}
function Figure({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return <figure className="lesson-figure"><h4>{title}</h4>{children}<figcaption>{caption}</figcaption></figure>;
}

export default function MusicGuide() {
  const [sourceError, setSourceError] = useState('');
  const topics = ['认识音高', '读懂简谱', '时值与休止', '拍号与小节', '常见记号', '完整读谱示例'];
  const ids = ['pitch', 'jianpu', 'rhythm', 'meter', 'marks', 'example'];
  return <div className="music-guide">
    <div className="guide-lead panel"><span className="eyebrow">READ YOUR FIRST SCORE</span><h2>从一个音符，读懂一段旋律。</h2><div className="lesson-tags"><span>零基础</span><span>图文对照</span><span>离线可读</span></div></div>
    <nav className="lesson-index" aria-label="读谱教程目录">{topics.map((topic, index) => <button key={topic} onClick={() => document.getElementById(`lesson-${ids[index]}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}><small>0{index + 1}</small>{topic}</button>)}</nav>
    <Section id="pitch" number="01" title="认识音高：位置决定读什么音" intro="音名是 C、D、E、F、G、A、B，之后进入下一个八度。C4 是中央 C，C5 比 C4 高一个八度。">
      <p>五线谱有五条线、四个间，从下往上数。音符在线或间中交替向上时，音名依次前进；相邻线间不一定相差半音。谱号给这些位置确定音名。</p>
      <div className="lesson-pair"><Figure title="高音谱号 · C4 到 C5" caption="第二线是 G4；C4 写在下加一线上。E4 在第一线，F4 在第一间。"><StaffFigure notes={SCALE} label="高音谱号 C4 D4 E4 F4 G4 A4 B4 C5，五条线由下向上编号" labels={['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']} lineLabels /></Figure>
      <Figure title="低音谱号 · 认识定位点" caption="低音谱号两点夹着第四线，第四线是 F3。最后的中央 C4 在上加一线上。"><StaffFigure notes={[43, 45, 47, 48, 50, 52, 53, 55, 57, 59, 60].map(pitch => ({ pitch, duration: 1 }))} clef="bass" label="低音谱号 G2 到 C4，第四线为 F3" labels={['G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4']} /></Figure></div>
      <div className="lesson-note">读谱顺序：先看谱号 → 看音符在线还是间 → 查调号与升降号 → 确定音高。</div>
    </Section>
    <Section id="jianpu" number="02" title="读懂简谱：数字、调名与八度" intro="1～7 表示音阶中的级数，唱作 do、re、mi、fa、sol、la、si。数字本身不固定对应某个绝对音高。">
      <div className="degree-table" role="table" aria-label="C 大调数字唱名音名对照"><div role="row"><b role="rowheader">简谱</b>{['1', '2', '3', '4', '5', '6', '7'].map(x => <strong role="cell" key={x}>{x}</strong>)}</div><div role="row"><b role="rowheader">唱名</b>{['do', 're', 'mi', 'fa', 'sol', 'la', 'si'].map(x => <span role="cell" key={x}>{x}</span>)}</div><div role="row"><b role="rowheader">1=C</b>{['C', 'D', 'E', 'F', 'G', 'A', 'B'].map(x => <span role="cell" key={x}>{x}</span>)}</div></div>
      <div className="lesson-pair"><Figure title="同一个 1，三个八度" caption="下方一点：低一个八度；无点：本组；上方一点：高一个八度。每多一个点再相差一个八度。"><JianpuFigure notes={OCTAVES} label="低音1、中音1、高音1，对应示例 C3 C4 C5" labels={['C3', 'C4', 'C5']} /></Figure><div className="lesson-text-card"><h4>先看左上角的调名</h4><p><strong>1=C</strong>：1 对应 C，2 对应 D。<br /><strong>1=G</strong>：1 对应 G，2 对应 A，7 对应 F♯。</p><p>调名确定音级关系，具体八度还要结合八度点及演奏范围。</p><div className="lesson-note">本项目默认：无八度点的 1 = C4。本页 C 调例谱均按此约定标出八度。</div></div></div>
    </Section>
    <Section id="rhythm" number="03" title="时值与休止：读懂声音的长短" intro="以下统一以四分音符为一拍（4/4 示例）。休止表示在对应时间内不发声，也需要继续数拍。">
      <Figure title="音符由哪些部分组成？" caption="空心或实心的符头、符干、符尾共同表示时值。相邻短音符常用横梁连接，时值不变。"><svg viewBox="0 0 600 140" role="img" aria-label="八分音符的符头、符干和符尾标注" className="note-anatomy"><ellipse cx="270" cy="106" rx="13" ry="8" transform="rotate(-20 270 106)" fill="currentColor"/><line x1="282" y1="104" x2="282" y2="25" stroke="currentColor" strokeWidth="2"/><path d="M282 104 V25 C310 38 318 56 302 77 C306 57 294 52 282 48" fill="currentColor"/><g stroke="#89a87b" fill="none"><path d="M250 107 H175"/><path d="M282 68 H383"/><path d="M307 43 H383"/></g><g className="guide-svg-label"><text x="126" y="111">符头</text><text x="397" y="72">符干</text><text x="397" y="47">符尾</text></g></svg></Figure>
      <div className="rhythm-table-wrap"><table className="lesson-rhythm"><thead><tr><th>名称 / 拍数</th><th>五线谱音符 / 休止</th><th>简谱音符 / 休止</th></tr></thead><tbody>{RHYTHM_VALUES.map(value => <tr key={value.code}><th scope="row">{value.name}<span>{value.duration} 拍</span></th><td><StaffFigure notes={[{ pitch: 60, duration: value.duration }, { pitch: null, duration: value.duration }]} label={`${value.name}与对应休止符`} width={300} /></td><td><JianpuFigure notes={[{ pitch: 60, duration: value.duration }, { pitch: null, duration: value.duration }]} label={`${value.name}简谱与休止表示`} /></td></tr>)}</tbody></table></div>
      <div className="lesson-note">数字下每加一条减时线，时值减半。数字后每条“—”延长一个四分音符时值；长休止写多个 0，不用延长线。五线谱的全休止符也可表示整小节休止，此时长度由该小节决定。</div>
    </Section>
    <Section id="meter" number="04" title="拍号与小节：把音符组织起来" intro="拍号通常写在谱号、调号之后。小节线把音乐分成一组一组的拍子，不表示停顿。">
      <div className="lesson-pair"><div className="lesson-text-card"><div className="meter-visual" role="img" aria-label="四四拍，上面的4表示每小节四拍，下面的4表示四分音符为一拍"><div><b>4</b><b>4</b></div><p><span>← 每小节 4 拍</span><span>← 四分音符为一拍</span></p></div><p><strong>4/4</strong>：数“1、2、3、4”，通常第一拍最强，第三拍次强。<br /><strong>3/4</strong>：数“1、2、3”，通常第一拍最强。</p></div><Figure title="三四拍 · 每小节三拍" caption="三个四分音符正好填满一个 3/4 小节。结束线是一条细线加一条粗线。"><StaffFigure notes={[{ pitch: 60, duration: 1 }, { pitch: 62, duration: 1 }, { pitch: 64, duration: 1 }]} meter="3/4" end label="三四拍 C4 D4 E4，各一拍，末尾结束线" labels={['第 1 拍', '第 2 拍', '第 3 拍']} /></Figure></div>
      <p><strong>速度</strong>决定拍子走多快：例如标明“四分音符 = 120”，就是每分钟 120 个四分音符，每拍约 0.5 秒。音符时值决定占几拍，速度决定这些拍持续多久。</p><div className="lesson-note">本页先学习 4/4 与 3/4。其他拍号的拍单位可能不同，不能把所有乐谱的四分音符都直接当作一拍。</div>
    </Section>
    <Section id="marks" number="05" title="常见记号：几个容易混淆的细节" intro="同一个小圆点或弧线，位置与连接对象不同，意思也会不同。">
      <div className="lesson-pair"><Figure title="附点 · 增加原时值的一半" caption="四分音符右侧的附点：1 + ½ = 1½ 拍；后面再接一个八分音符，合计两拍。"><StaffFigure notes={DOTTED} label="附点四分音符和八分音符" /><JianpuFigure notes={DOTTED} label="简谱右侧附点和减时线" /></Figure><div className="lesson-text-card"><h4>八度点与附点</h4><JianpuFigure notes={[{ pitch: 72, duration: 1 }, { pitch: 60, duration: 1.5 }]} label="上方八度点与右侧附点对照" labels={['改变音高', '改变时值']} /><p><strong>上方 / 下方的点</strong>改变八度。<br /><strong>右侧的点</strong>增加时值。五线谱音符上方的小点还可能是断奏记号，要按位置和语境识别。</p></div>
      <Figure title="延音线 · 同音合成一次持续音" caption="两个同音各一拍，连起来持续两拍，第二个音不重新起音。"><StaffFigure notes={TIED} label="两个 C4 用延音线连接" /><JianpuFigure notes={TIED} label="简谱两个1用延音线连接" /></Figure><Figure title="连奏线 · 一组音连贯演奏" caption="弧线连接不同音时表示连贯的乐句，不把它们合成一个音；每个音仍保留自己的音高和时值。"><StaffFigure notes={SLURRED} slur label="C4 与 E4 上方连奏线" /><JianpuFigure notes={SLURRED} slur label="简谱1与3上方连奏线" /></Figure>
      <Figure title="升号、还原号、降号" caption="♯ 升高半音；♭ 降低半音；♮ 取消当前升降变化，恢复自然音。同一小节、同一八度和音名的临时记号通常持续到小节末。"><StaffFigure notes={MARKS} label="升 C4，还原 C4，降 E4" labels={['C♯4', 'C4', 'E♭4']} /><JianpuFigure notes={MARKS} label="简谱升1，还原1，降3" /></Figure><div className="lesson-text-card"><h4>调号与临时记号</h4><p>五线谱谱号后的成组升降号是<strong>调号</strong>，对相应音名的各个八度生效；音符前的升降号是<strong>临时记号</strong>。</p><p>例如 G 大调有一个 F♯ 调号，所有 F 默认升半音；在简谱中写作 1=G。先看调，再读音符前的临时变化。</p></div></div>
    </Section>
    <Section id="example" number="06" title="完整读谱示例：把四个小节连起来" intro="原创练习 · C 大调 · 4/4 · 四分音符 = 80。先逐小节数拍，再对照上下两种记谱，按从左到右的顺序阅读。">
      <div className="lesson-example-meta"><span>五线谱：高音谱号，C 大调无升降调号</span><span>简谱：1=C，示例中无点 1 对应 C4</span></div>
      <div className="lesson-measures">{GUIDE_MEASURES.map((measure, index) => <figure key={index} className="lesson-measure"><h4>第 {index + 1} 小节</h4><StaffFigure notes={measure.notes} meter={index === 0 ? '4/4' : undefined} label={`示例第${index + 1}小节五线谱`} width={340} end={index === 3} /><JianpuFigure notes={measure.notes} label={`示例第${index + 1}小节简谱`} end={index === 3} /><figcaption>{measure.explanation}</figcaption></figure>)}</div>
      <div className="lesson-note">读谱检查：每小节共四拍；休止照常数拍；遇到延音线保持声音；到小节线继续读，不额外停顿。</div>
    </Section>
    <footer className="panel lesson-sources"><h3>参考资料</h3><p>依据以下资料整理中文说明；教学示意图与练习旋律为本项目原创。查阅日期：2026 年 9 月 26 日。</p>{GUIDE_SOURCES.map(source => <button key={source.id} onClick={async () => { try { await window.studio.openGuideSource(source.id); setSourceError(''); } catch { setSourceError('未能打开资料，请稍后重试。'); } }}>{source.title}<span>在浏览器查看 ↗</span></button>)}{sourceError && <p role="alert">{sourceError}</p>}</footer>
  </div>;
}
