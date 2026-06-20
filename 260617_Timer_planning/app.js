const sample = {
  totalTime: 3600,
  programs: [
    { id: 'p1', name: '開会挨拶', baseline: 300, min: 180, max: 600, dontShrinkPriority:5, skipPriority:1, skipThreshold:60, extendPriority:3 },
    { id: 'p2', name: '発表A', baseline: 1200, min: 600, max: 1800, dontShrinkPriority:3, skipPriority:2, skipThreshold:120, extendPriority:2 },
    { id: 'p3', name: '休憩', baseline: 600, min: 300, max: 900, dontShrinkPriority:2, skipPriority:3, skipThreshold:60, extendPriority:1 },
    { id: 'p4', name: '発表B', baseline: 900, min: 300, max: 1200, dontShrinkPriority:4, skipPriority:2, skipThreshold:120, extendPriority:4 }
  ]
};

const $ = id => document.getElementById(id);
const jsonInput = $('jsonInput');
const totalTimeInput = $('totalTime');
const bars = $('bars');
const programEditor = $('programEditor');
const mainClockName = $('mainClockName');
const mainClockTimer = $('mainClockTimer');

let data = null;

function loadSample(){
  jsonInput.value = JSON.stringify(sample, null, 2);
  data = JSON.parse(JSON.stringify(sample));
  // 内部フラグをクリア
  for(const p of data.programs) delete p._skipped;
  syncUIFromData();
}

function render(){
  if(!data) return;
  renderBars();
  renderProgramEditor();
  updateMainClockDisplay();
  renderTimelineDetails();
}

function formatSignedHMS(deltaSec){
  const sign = deltaSec>0?'+': (deltaSec<0?'-':'+');
  const s = Math.abs(Math.round(deltaSec));
  const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec = s%60;
  if(h>0) return `${sign}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${sign}${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function renderTimelineDetails(){
  const containerId = 'timelineDetails';
  let container = document.getElementById(containerId);
  if(!container){
    container = document.createElement('div'); container.id = containerId;
    const timeLineBox = document.getElementById('timeLineBox') || document.getElementById('timelinePane');
    if(timeLineBox) timeLineBox.appendChild(container);
  }
  // summary: assigned total / totalTime and current wall clock
  const assignedTotal = data.programs.reduce((s,p)=>s+p.current_time,0);
  const total = data.totalTime || sample.totalTime;
  const now = new Date();
  const nowStr = now.toLocaleTimeString();

  let html = `<div class="timeline-summary">経過(割当合計): ${formatHMS(assignedTotal)} / 総時間: ${formatHMS(total)} <span class="small">(現在時刻: ${nowStr})</span></div>`;

  // per-programTable
  html += '<table class="timeline-table"><thead><tr><th>プログラム</th><th>baseline</th><th>割当</th><th>差分</th></tr></thead><tbody>';
  for(const p of data.programs){
    const base = formatHMS(p.baseline||0);
    const assigned = formatHMS(p.current_time||0);
    const diff = (p.current_time||0) - (p.baseline||0);
    html += `<tr><td>${escapeHtml(p.name||'')}</td><td>${base}</td><td>${assigned}</td><td class="diff ${diff>0?'pos':(diff<0?'neg':'zero')}">${formatSignedHMS(diff)}</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderBars(){
  bars.innerHTML = '';
  const total = Math.max(1, data.programs.reduce((s,p)=>s+p.current_time,0));
  for(const p of data.programs){
    const el = document.createElement('div');
    el.className = 'bar';
    const ratio = p.current_time / total;
    el.style.flex = `${Math.max(1,p.current_time)} 0 auto`;
    el.style.background = colorFor(p);
    el.title = `${p.name} — ${Math.round(p.current_time)}s`;
    // 内部コンテンツを構築: 名称、baseline と割当、差分
    const nameEl = document.createElement('div'); nameEl.className = 'bar-name'; nameEl.textContent = p.name;
    const timesEl = document.createElement('div'); timesEl.className = 'bar-times';
    const baseText = formatHMS(p.baseline || 0);
    const assignedText = formatHMS(p.current_time || 0);
    const diff = (p.current_time||0) - (p.baseline||0);
    const diffText = formatSignedHMS(diff);
    timesEl.innerHTML = `<span class="bar-baseline">B:${baseText}</span><span class="bar-assigned">A:${assignedText}</span><span class="bar-diff ${diff>0?'pos':(diff<0?'neg':'zero')}">${diffText}</span>`;
    el.appendChild(nameEl);
    el.appendChild(timesEl);
    bars.appendChild(el);
  }
}

// prog list removed — editor table is authoritative


function renderProgramEditor(){
  programEditor.innerHTML = '';
  const table = document.createElement('table'); table.className='programTable';
  const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>名称</th><th>基準</th><th>最小</th><th>最大</th><th>縮小<br>抵抗</th><th>省略<br>抵抗</th><th>拡張<br>抵抗</th></tr>';
  const tbody = document.createElement('tbody');
  data.programs.forEach((p, idx)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="namecol"><input data-field="name" value="${escapeHtml(p.name)}"></td>
      <td><input class="time-input" data-field="baseline" type="text" value="${formatHMS(p.baseline)}"></td>
      <td><input class="time-input" data-field="min" type="text" value="${formatHMS(p.min)}"></td>
      <td><input class="time-input" data-field="max" type="text" value="${formatHMS(p.max)}"></td>
      <td><select data-field="dontShrinkPriority">${optionRange(p.dontShrinkPriority)}</select></td>
      <td><select data-field="skipPriority">${optionRange(p.skipPriority)}</select></td>
      <td><select data-field="extendPriority">${optionRange(p.extendPriority)}</select></td>
    `;
    // 入力要素にイベントを接続
    // 一般的な入力処理（name、select 等）
    tr.querySelectorAll('input[data-field]:not(.time-input), select[data-field]').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        const field = inp.getAttribute('data-field');
        const val = inp.type==='number' ? Number(inp.value) : inp.value;
        data.programs[idx][field] = val;
        if(field==='baseline' || field==='min' || field==='max') data.programs[idx][field] = Number(val);
        data.programs[idx].current_time = data.programs[idx].baseline;
        syncUIFromData(false);
      });
    });
    // 時間入力: フォーカス時はHHMMSS（6桁）、フォーカス外ではhh:mm:ssを表示
    tr.querySelectorAll('.time-input').forEach(inp=>{
      const field = inp.getAttribute('data-field');
      // set display value already set above
      inp.addEventListener('focus', ()=>{
        // convert current seconds to HHMMSS fixed 6-digit string
        const sec = Number(data.programs[idx][field]) || 0;
        inp.value = secondsToHHMMSSDigits(sec);
        // 上書きしやすいよう全選択
        setTimeout(()=> inp.select(), 0);
      });
      inp.addEventListener('blur', ()=>{
        const v = inp.value.trim();
        const sec = parseFlexibleTimeInput(v);
        data.programs[idx][field] = sec;
        // keep current_time in sync with baseline when baseline changed
        if(field==='baseline') data.programs[idx].current_time = sec;
        // update displayed formatted value
        inp.value = formatHMS(sec);
        syncUIFromData(false);
      });
      // Enterで確定
      inp.addEventListener('keydown', (e)=>{
        if(e.key==='Enter') { inp.blur(); return; }
        if(e.key==='ArrowUp' || e.key==='ArrowDown'){
          e.preventDefault();
          // 60秒単位で増減
          let cur = parseFlexibleTimeInput(inp.value);
          cur += (e.key==='ArrowUp' ? 60 : -60);
          if(cur < 0) cur = 0;
          // update visible digit-format while focused
          inp.value = secondsToHHMMSSDigits(cur);
          // 内部データを即時更新
          data.programs[idx][field] = cur;
          if(field === 'baseline') data.programs[idx].current_time = cur;
          // エディタ内容以外の表示を更新
          renderBars();
          updateMainClockDisplay();
          // キャレットを末尾へ移動
          setTimeout(()=>{ try{ inp.setSelectionRange(inp.value.length, inp.value.length); }catch(e){} },0);
        }
      });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody); programEditor.appendChild(table);
}

function optionRange(selected){
  let s=''; for(let i=1;i<=5;i++){ s += `<option value="${i}" ${i===selected?'selected':''}>${i}</option>` }
  return s;
}

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function syncUIFromData(updateJson=true){
  // current_time が存在することを保証
  for(const p of data.programs) if(typeof p.current_time==='undefined') p.current_time = p.baseline;
  totalTimeInput.value = data.totalTime || sample.totalTime;
  renderBars(); renderProgramEditor();
  updateMainClockDisplay();
  if(updateJson) jsonInput.value = JSON.stringify(data, null, 2);
}

function updateDataFromJson(){
  try{
    const d = JSON.parse(jsonInput.value);
    data = d;
    for(const p of data.programs){ p.current_time = p.baseline; delete p._skipped; }
    syncUIFromData(false);
  }catch(e){ alert('JSONが不正です'); }
}

function formatTime(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60); const s = sec%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// 人間向けの hh:mm:ss フォーマッタ
function formatHMS(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// 秒を HHMMSS（固定6桁）に変換
function secondsToHHMMSSDigits(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return `${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}${String(s).padStart(2,'0')}`;
}

// 柔軟な時間入力をパース: hh:mm:ss、または123456 (HHMMSS)のような数字、短いものは例:130 -> 1:30
function parseFlexibleTimeInput(str){
  if(!str) return 0;
  str = String(str).trim();
  // コロンを含む場合
  if(str.indexOf(':')>=0){
    const parts = str.split(':').map(x=>x.trim());
    // support H:MM:SS, MM:SS, SS
    let h=0,m=0,s=0;
    if(parts.length===3){ h = Number(parts[0])||0; m = Number(parts[1])||0; s = Number(parts[2])||0; }
    else if(parts.length===2){ m = Number(parts[0])||0; s = Number(parts[1])||0; }
    else { s = Number(parts[0])||0; }
    return h*3600 + m*60 + s;
  }
  // 数字のみの場合
  const digits = str.replace(/\D/g,'');
  if(digits.length===0) return 0;
  if(digits.length<=2) return Number(digits);
  if(digits.length<=4){
    const sec = Number(digits.slice(-2));
    const min = Number(digits.slice(0, digits.length-2))||0;
    return min*60 + sec;
  }
  // 5桁以上: 下2桁を秒、次の2桁を分、それより上を時間として扱う
  const sec = Number(digits.slice(-2))||0;
  const min = Number(digits.slice(-4, -2))||0;
  const hrs = Number(digits.slice(0, digits.length-4))||0;
  return hrs*3600 + min*60 + sec;
}

function updateMainClockDisplay(){
  if(!data) return;
  const cur = data.programs.find(p=>p.current_time>0) || null;
  if(cur){
    if(mainClockName) mainClockName.textContent = cur.name;
    if(mainClockTimer) mainClockTimer.textContent = formatTime(cur.current_time);
  } else {
    if(mainClockName) mainClockName.textContent = '';
    if(mainClockTimer) mainClockTimer.textContent = '00:00:00';
  }
}

function colorFor(p){
  const w = Math.min(1, p.current_time / Math.max(1, p.baseline));
  const base = [74,144,226];
  const r = Math.round(base[0] * w + 60*(1-w));
  const g = Math.round(base[1] * w + 60*(1-w));
  const b = Math.round(base[2] * w + 60*(1-w));
  return `rgb(${r},${g},${b})`;
}

function adjustTimes(){
  const T_total = (typeof totalTimeInput !== 'undefined') ? parseFlexibleTimeInput(totalTimeInput.value) : sample.totalTime;
  // current_time を初期化
  for(const p of data.programs){ p.current_time = p.baseline; delete p._skipped; }
  let S = data.programs.reduce((s,p)=>s+p.current_time,0);
  if(S === T_total){ render(); return; }

  if(S > T_total){
    let D = S - T_total;
    // 優先度 5→1 の順で縮小とスキップを実行
    for(let pr=5; pr>=1 && D>0; pr--){
      // 縮小フェーズ（比例配分）
      const G = data.programs.filter(it => it.dontShrinkPriority===pr && it.current_time>it.min);
      const sumPot = G.reduce((s,it)=>s+Math.max(0,it.current_time-it.min),0);
      if(sumPot>0){
        for(const it of G){
          const pot = Math.max(0,it.current_time-it.min);
          const delta = Math.min(pot, D*(pot/sumPot));
          it.current_time -= delta; D -= delta; if(D<=0) break;
        }
      }
      if(D<=0) break;
      // スキップフェーズ
      const K = data.programs.filter(it => it.skipPriority===pr && it.current_time>0);
      for(const it of K){
        const delta = it.current_time;
        it.current_time = 0;
        it._skipped = true; // スキップ済みとしてマーク（後続の再配分で復活させない）
        D -= delta; if(D<=0) break;
      }
    }
    // 最終チェック: Dが負（過剰にスキップした）場合の再配分
    if(D<0){
      let E = -D; // extra time to give back
      // dontShrinkPriority の順に順次復元（縮小時と同じ順序）
      // スキップ済みのプログラムには復元しない
      for(let pr=5; pr>=1 && E>0; pr--){
        const candidates = data.programs.filter(it => it.dontShrinkPriority===pr && it.current_time < it.baseline && !it._skipped);
        for(const it of candidates){
          const want = it.baseline - it.current_time;
          const give = Math.min(want, E);
          it.current_time += give;
          E -= give;
          if(E<=0) break;
        }
      }
      // any remaining E is left unassigned; skipped items remain skipped
    }
  } else { // S < T_total -> 拡張
    let E = T_total - S;
    // runIfTimeLeft が真でない限り、スキップ済みは拡張対象から除外
    const weights = data.programs.map(p=>((p._skipped && !p.runIfTimeLeft) ? 0 : p.extendPriority * Math.max(0,p.max - p.current_time)));
    let sumW = weights.reduce((a,b)=>a+b,0);
    if(sumW>0){
      for(let i=0;i<data.programs.length;i++){
        const pr = data.programs[i];
        const extPot = Math.max(0, pr.max - pr.current_time);
        const w = weights[i];
        const delta = Math.min(extPot, E * (w/sumW));
        pr.current_time += delta; E -= delta; if(E<=0) break;
      }
    }
  }

  render();
}

document.addEventListener('DOMContentLoaded', ()=>{
  $('resetBtn').addEventListener('click', loadSample);
  jsonInput.addEventListener('change', ()=> updateDataFromJson());
  loadSample();
  // make totalTime input behave like time-inputs: show hh:mm:ss, focus shows HHMMSS digits, arrow keys +/-1min
  if(totalTimeInput){
    try{ totalTimeInput.type = 'text'; }catch(e){}
    // initialize display
    totalTimeInput.value = formatHMS(parseFlexibleTimeInput(totalTimeInput.value || String(sample.totalTime)));
    const debounce = (fn, wait=200)=>{ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), wait); }; };
    const debouncedAdjust = debounce(()=>{ if(!data) data = JSON.parse(JSON.stringify(sample)); data.totalTime = parseFlexibleTimeInput(totalTimeInput.value); try{ adjustTimes(); }catch(e){} }, 200);
    totalTimeInput.addEventListener('focus', ()=>{
      totalTimeInput.value = secondsToHHMMSSDigits(parseFlexibleTimeInput(totalTimeInput.value));
      setTimeout(()=> totalTimeInput.select(), 0);
    });
    totalTimeInput.addEventListener('input', ()=>{
      // update underlying value live (but debounced recalculation)
      if(!data) data = JSON.parse(JSON.stringify(sample));
      data.totalTime = parseFlexibleTimeInput(totalTimeInput.value);
      // immediate UI update for bars/main clock
      try{ renderBars(); updateMainClockDisplay(); }catch(e){}
      debouncedAdjust();
    });
    totalTimeInput.addEventListener('blur', ()=>{
      const sec = parseFlexibleTimeInput(totalTimeInput.value);
      if(!data) data = JSON.parse(JSON.stringify(sample));
      data.totalTime = sec;
      totalTimeInput.value = formatHMS(sec);
      try{ adjustTimes(); }catch(e){}
    });
    totalTimeInput.addEventListener('keydown', (e)=>{
      if(e.key==='ArrowUp' || e.key==='ArrowDown'){
        e.preventDefault();
        let cur = parseFlexibleTimeInput(totalTimeInput.value);
        cur += (e.key==='ArrowUp' ? 60 : -60);
        if(cur<0) cur = 0;
        totalTimeInput.value = secondsToHHMMSSDigits(cur);
        if(!data) data = JSON.parse(JSON.stringify(sample));
        data.totalTime = cur;
        try{ renderBars(); updateMainClockDisplay(); }catch(e){}
        debouncedAdjust();
      }
    });
  }
  // additional control hooks (placeholders)
  $('playBtn').addEventListener('click', ()=> alert('開始（未実装）'));
  $('pauseBtn').addEventListener('click', ()=> alert('一時停止（未実装）'));
  $('stepBtn').addEventListener('click', ()=> alert('次へ（未実装）'));
});
