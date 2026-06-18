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
  syncUIFromData();
}

function render(){
  if(!data) return;
  renderBars();
  renderProgramEditor();
  updateMainClockDisplay();
}

function renderBars(){
  bars.innerHTML = '';
  const total = Math.max(1, data.programs.reduce((s,p)=>s+p.current_time,0));
  for(const p of data.programs){
    const el = document.createElement('div');
    el.className = 'bar';
    const ratio = p.current_time / total;
    el.style.flex = `${p.current_time} 0 auto`;
    el.style.background = colorFor(p);
    el.title = `${p.name} — ${Math.round(p.current_time)}s`;
    el.textContent = p.name;
    bars.appendChild(el);
  }
}

// prog list removed — editor table is authoritative


function renderProgramEditor(){
  programEditor.innerHTML = '';
  const table = document.createElement('table'); table.className='program-table';
  const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>名称</th><th>baseline</th><th>min</th><th>max</th><th>dontShrink</th><th>skip</th><th>extend</th></tr>';
  const tbody = document.createElement('tbody');
  data.programs.forEach((p, idx)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="namecol"><input data-field="name" value="${escapeHtml(p.name)}"></td>
      <td><input data-field="baseline" type="number" value="${p.baseline}"></td>
      <td><input data-field="min" type="number" value="${p.min}"></td>
      <td><input data-field="max" type="number" value="${p.max}"></td>
      <td><select data-field="dontShrinkPriority">${optionRange(p.dontShrinkPriority)}</select></td>
      <td><select data-field="skipPriority">${optionRange(p.skipPriority)}</select></td>
      <td><select data-field="extendPriority">${optionRange(p.extendPriority)}</select></td>
    `;
    // wire inputs
    tr.querySelectorAll('[data-field]').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        const field = inp.getAttribute('data-field');
        const val = inp.type==='number' ? Number(inp.value) : inp.value;
        data.programs[idx][field] = val;
        if(field==='baseline' || field==='min' || field==='max') data.programs[idx][field] = Number(val);
        data.programs[idx].current_time = data.programs[idx].baseline;
        syncUIFromData(false);
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
  // ensure current_time exists
  for(const p of data.programs) if(typeof p.current_time==='undefined') p.current_time = p.baseline;
  totalTimeInput.value = data.totalTime || sample.totalTime;
  renderBars(); renderProgramEditor();
  updateMainClockDisplay();
  if(updateJson) jsonInput.value = JSON.stringify(data, null, 2);
}

function updateDataFromJson(){
  try{ const d = JSON.parse(jsonInput.value); data = d; for(const p of data.programs) p.current_time = p.baseline; syncUIFromData(false); }catch(e){ alert('JSONが不正です'); }
}

function formatTime(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60); const s = sec%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
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
  const T_total = Number(totalTimeInput.value) || sample.totalTime;
  // init current_time
  for(const p of data.programs){ p.current_time = p.baseline; }
  let S = data.programs.reduce((s,p)=>s+p.current_time,0);
  if(S === T_total){ render(); return; }

  if(S > T_total){
    let D = S - T_total;
    // shrink and skip by priority 5->1
    for(let pr=5; pr>=1 && D>0; pr--){
      // shrink phase (proportional)
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
      // skip phase
      const K = data.programs.filter(it => it.skipPriority===pr && it.current_time>0);
      for(const it of K){
        const delta = it.current_time;
        it.current_time = 0; D -= delta; if(D<=0) break;
      }
    }
    // final check: if negative D (we skipped too much), redistribute leftover as simple proportional restore
    if(D<0){
      let E = -D; // extra time to give back
      const reducible = data.programs.filter(it=>it.current_time<it.baseline);
      const need = reducible.reduce((s,it)=>s+(it.baseline-it.current_time),0);
      if(need>0){
        for(const it of reducible){ const want = it.baseline-it.current_time; const give = Math.min(want, E*(want/need)); it.current_time += give; E -= give; if(E<=0) break; }
      }
    }
  } else { // S < T_total -> extend
    let E = T_total - S;
    const weights = data.programs.map(p=>p.extendPriority * Math.max(0,p.max - p.current_time));
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
  $('applyBtn').addEventListener('click', ()=>{ try{ updateDataFromJson(); adjustTimes(); }catch(e){ alert('JSONを確認してください'); } });
  $('resetBtn').addEventListener('click', loadSample);
  jsonInput.addEventListener('change', ()=> updateDataFromJson());
  loadSample();
  // additional control hooks (placeholders)
  $('playBtn').addEventListener('click', ()=> alert('開始（未実装）'));
  $('pauseBtn').addEventListener('click', ()=> alert('一時停止（未実装）'));
  $('stepBtn').addEventListener('click', ()=> alert('次へ（未実装）'));
});
