// グローバルデータ
// stb.dataには、入力データ(JSONと対応)を格納
// stb.programsには、各プログラムの現在の割り当て時間などの状態を格納
let stb = {
  timerRunning: false,
  currentProgramIndex: 0,
  data: null,
  programs: [],
  timerObject: null, // タイマーのsetIntervalオブジェクト
  settings:{
    timeInterval: 200, // タイマーの更新間隔（ミリ秒）
  }
};

const sample = {
  totalTime: 1200,
  programs: [
    { id: 'p1', name: '開会挨拶', baseline: 10, min: 10, max: 600, dontShrinkPriority:5, skipPriority:1, skipThreshold:60, extendPriority:3 },
    { id: 'p2', name: '発表A', baseline: 1200, min: 600, max: 1800, dontShrinkPriority:3, skipPriority:2, skipThreshold:120, extendPriority:2 },
    { id: 'p3', name: '休憩', baseline: 600, min: 300, max: 900, dontShrinkPriority:2, skipPriority:3, skipThreshold:60, extendPriority:1 },
    { id: 'p4', name: '発表B', baseline: 900, min: 300, max: 1200, dontShrinkPriority:4, skipPriority:2, skipThreshold:120, extendPriority:4 }
  ]
};


// HTML要素の定義
const $ = id => document.getElementById(id);
const jsonInput = $('jsonInput');
const totalTimeInput = $('totalTime');
const bars = $('bars');
const programEditor = $('programEditor');
const mainClockName = $('mainClockName');
const mainClockTimer = $('mainClockTimer');
const barTemplate = $('bar-template');
const programRowTemplate = $('program-row-template');
const startBtn = $('playBtn');
const pauseBtn = $('pauseBtn');
const stepBtn = $('stepBtn');


// 起動時

document.addEventListener('DOMContentLoaded', ()=>{
  // 初期データのロード
  loadSample();

  // イベントリスナーの設定
  $('resetBtn').addEventListener('click', loadSample);
  jsonInput.addEventListener('change', ()=> syncJsonInputToData());
  if(totalTimeInput){
    // フォーカス時は HHMMSS 形式（数字のみ）で編集できるようにし、blur で hh:mm:ss に戻す
    totalTimeInput.addEventListener('focus', ()=>{
      const sec = parseFlexibleTimeInput(totalTimeInput.value);
      totalTimeInput.value = secToHMS(sec).replace(/:/g,'');
      setTimeout(()=>{ try{ totalTimeInput.select(); }catch(e){} },0);
    });
    totalTimeInput.addEventListener('blur', ()=>{
      const sec = parseFlexibleTimeInput(totalTimeInput.value);
      totalTimeInput.value = secToHMS(sec);
      // 値確定時は即時反映
      stb.data.totalTime = sec;
      adjustTimes();
      render("TimeChange");
    });
    // 入力中は即時に再計算
    totalTimeInput.addEventListener('input', ()=>{
      const sec = parseFlexibleTimeInput(totalTimeInput.value);
      stb.data.totalTime = sec;
      adjustTimes();
      render("TimeChange");
    });
    // 上下キーで ±60秒
    totalTimeInput.addEventListener('keydown', (e)=>{
      if(e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      let sec = parseFlexibleTimeInput(totalTimeInput.value);
      sec += (e.key === 'ArrowUp') ? 60 : -60;
      sec = Math.max(0, sec);
      // 編集中は数字表示（HHMMSS）にし、即時反映
      totalTimeInput.value = secToHMS(sec).replace(/:/g,'');
      stb.data.totalTime = sec;
      adjustTimes();
      render("TimeChange");
      setTimeout(()=>{ try{ 
        totalTimeInput.setSelectionRange(totalTimeInput.value.length, totalTimeInput.value.length);
      }catch(e){} },0);
    });
  }
  // ★その他のUI部品のリスナーは追って設定


  // additional control hooks (placeholders)
  startBtn.addEventListener('click', ()=> startTimer());
  pauseBtn.addEventListener('click', ()=> pauseTimer());
  stepBtn.addEventListener('click', ()=> stepTimer());

  // 初期計算・レンダリング
  resetPrograms();
  render("ALL");
});

function loadSample(){
  jsonInput.value = JSON.stringify(sample, null, 2);
  syncJsonInputToData();
}

function syncJsonInputToData(){
  try{
    const d = JSON.parse(jsonInput.value);
    stb.data = d;
    syncDataToUI();
  }catch(e){
    console.error('Invalid JSON:', e);
  }
}

function syncDataToJsonInput(){
  if(!stb.data) return;
  jsonInput.value = JSON.stringify(stb.data, null, 2);
}

function syncDataToUI(){
  if(!stb.data) return;
  totalTimeInput.value = secToHMS(stb.data.totalTime);
  render("ALL");
}

// UIの内容をstb.dataに反映
function syncUIToData(){
  if(!stb.data) return;
  stb.data.totalTime = parseFlexibleTimeInput(totalTimeInput.value);
  // program editorの内容をstb.data.programsに反映
  const rows = programEditor.querySelectorAll('tbody tr');
  rows.forEach((tr, idx)=>{
    const p = stb.data.programs[idx];
    p.name = tr.querySelector('input[data-field="name"]').value;
    p.baseline = parseFlexibleTimeInput(tr.querySelector('input[data-field="baseline"]').value);
    p.min = parseFlexibleTimeInput(tr.querySelector('input[data-field="min"]').value);
    p.max = parseFlexibleTimeInput(tr.querySelector('input[data-field="max"]').value);
    p.dontShrinkPriority = Number(tr.querySelector('select[data-field="dontShrinkPriority"]').value);
    p.skipPriority = Number(tr.querySelector('select[data-field="skipPriority"]').value);
    p.extendPriority = Number(tr.querySelector('select[data-field="extendPriority"]').value);
  });
}

// タイマー系
function startTimer(){
  if(stb.timerRunning) return;
  stb.timerRunning = true;
  stb.programs[stb.currentProgramIndex].timerRunning = true;
  stb.programs[stb.currentProgramIndex].lastStartTime = Date.now();
  stb.timerObject = setInterval(()=>{
    adjustTimes();
    render("TimeChange");
    updateMainClock();
  }, stb.settings.timeInterval);
}

function pauseTimer(){
  if(!stb.timerRunning) return;
  stb.programs[stb.currentProgramIndex].lastStopCount = stb.programs[stb.currentProgramIndex].getCountedTime();
  clearInterval(stb.timerObject);
  stb.programs[stb.currentProgramIndex].timerRunning = false;
  stb.timerRunning = false;
  render("TimeChange");
}

function stepTimer(){
  pauseTimer();
  stb.programs[stb.currentProgramIndex].finished = true; // 終了フラグ（必要に応じて）
  stb.programs[stb.currentProgramIndex].assignedTime = stb.programs[stb.currentProgramIndex].getCountedTime(); // 最終的な割り当て時間を確定

  // 次のプログラムに移動
  // skippedフラグが立っている場合はスキップして次へ
  let nextIndex = stb.currentProgramIndex + 1;
  while(nextIndex < stb.programs.length && stb.programs[nextIndex].skipped){
    nextIndex++;
  }
  if(nextIndex < stb.programs.length){
    stb.currentProgramIndex = nextIndex;
    startTimer();
  }
}

// レンダー系

// レンダー関数
// 引数で描画レベルを指定（"ALL" or "ProgramChange"など）。必要に応じて部分的な再描画を行う。
function render(level="ALL"){
  switch(level){
    case "ALL":
      constructProgramEditor();
      renderBars("constructDOM");
      updateMainClock();
      break;
    case "ProgramChange":
      constructProgramEditor();
      renderBars("constructDOM");
      updateMainClock();
      break;
    case "TimeChange":
      renderBars("updateValues");
      updateMainClock();
      break;
  }
}

// プログラムエディタの構築
// render("ALL")またはrender("ProgramChange")で呼び出される
function constructProgramEditor(){
  if(!stb.data) return;
  programEditor.innerHTML = '';
  const table = document.createElement('table'); table.className='programTable';
  const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>名称</th><th>基準</th><th>最小</th><th>最大</th><th>縮小<br>抵抗</th><th>省略<br>抵抗</th><th>拡張<br>抵抗</th></tr>';
  const tbody = document.createElement('tbody');
  stb.data.programs.forEach((p, idx)=>{
    const tr = programRowTemplate.content.firstElementChild.cloneNode(true);
    tr.querySelector('input[data-field="name"]').value = p.name || '';
    tr.querySelector('input[data-field="baseline"]').value = secToHMS(p.baseline || 0);
    tr.querySelector('input[data-field="min"]').value = secToHMS(p.min || 0);
    tr.querySelector('input[data-field="max"]').value = secToHMS(p.max || 0);
    tr.querySelector('select[data-field="dontShrinkPriority"]').innerHTML = optionRange(5, p.dontShrinkPriority);
    tr.querySelector('select[data-field="skipPriority"]').innerHTML = optionRange(5, p.skipPriority);
    tr.querySelector('select[data-field="extendPriority"]').innerHTML = optionRange(5, p.extendPriority);
    tbody.appendChild(tr);

    // イベントリスナーの設定
    tr.querySelectorAll('input, select').forEach(input => {
      const handler = () => { syncUIToData(); adjustTimes(); render("TimeChange"); };
      // input要素は打鍵中にも反映したいので 'input' と 'change' を両方登録
      if(input.tagName === 'INPUT'){
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      } else {
        // select要素などは 'change' で十分
        input.addEventListener('change', handler);
      }
    });

    // Enterキーで blur して変更を確定
    tr.querySelectorAll('input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if(e.key === 'Enter'){
          e.preventDefault();
          input.blur();
        }
      });
    });

    ['baseline','min','max'].forEach(field => {
      // 時間フィールドの focus/blur: focus 時は HHMMSS (数字のみ)、blur 時は hh:mm:ss 表示に戻す
      const inp = tr.querySelector(`input[data-field="${field}"]`);
      if(!inp) return;
      inp.addEventListener('focus', ()=>{
        const sec = parseFlexibleTimeInput(inp.value);
        inp.value = secToHMS(sec).replace(/:/g,'');
        setTimeout(()=>{ try{ inp.select(); }catch(e){} },0);
      });
      inp.addEventListener('blur', ()=>{
        const sec = parseFlexibleTimeInput(inp.value);
        // 表示を hh:mm:ss に戻す
        inp.value = secToHMS(sec);
        // changeを発火させて、データとUIを更新
        inp.dispatchEvent(new Event('change'));
      });
      //上下キー押下で時間を60秒単位で増減
      inp.addEventListener('keydown', (e)=>{
        if(e.key === 'ArrowUp' || e.key === 'ArrowDown'){
          e.preventDefault();
          let sec = parseFlexibleTimeInput(inp.value);
          sec += (e.key === 'ArrowUp' ? 60 : -60);
          sec = Math.max(0, sec); // 負の時間は許さない
          inp.value = secToHMS(sec).replace(/:/g,'');
          setTimeout(()=>{ try{ inp.dispatchEvent(new Event('input')); }catch(e){} },0);
        }
      });

    });
    
  });
 

  table.appendChild(thead);
  table.appendChild(tbody);
  programEditor.appendChild(table);
}

// バーの再描画（assignedTimeの変化に応じてflex値・値を更新する） DOM構築済みのバーを再描画する場合に使用
function renderBars(mode="updateValues"){
  if(mode === "constructDOM"){
    bars.innerHTML = '';
    stb.programs.forEach(p=>{
      const node = barTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector('.bar-name').textContent = p.name;
      bars.appendChild(node);
    });
  }

  const total = Math.max(1, stb.programs.reduce((s,p)=>s+Math.max(p.assignedTime || 0, p.getCountedTime() || 0),0));
  const barNodes = bars.querySelectorAll('.bar');
  stb.programs.forEach((p, idx)=>{
    const node = barNodes[idx];
    if(!node) return;
    const flexVal = Math.max(1, Math.round(p.assignedTime || 0));
    node.style.flex = `${flexVal} 0 auto`;
    const countedText = secToHMS(p.getCountedTime() || 0);
    const assignedText = secToHMS(p.assignedTime || 0);
    const baseText = secToHMS(p.baseline || 0);
    const diff = (p.assignedTime||0) - (p.baseline||0);
    const diffText = formatSignedHMS(diff);

    node.querySelector('.bar-counted').textContent = `${countedText}`;
    node.querySelector('.bar-assigned').textContent = `${assignedText}`;
    node.querySelector('.bar-baseline').textContent = `${baseText}`;
    const diffEl = node.querySelector('.bar-diff');
    if(diffEl){ diffEl.textContent = diffText; diffEl.classList.remove('pos','neg','zero'); diffEl.classList.add(diff>0?'pos':(diff<0?'neg':'zero')); }
  });

}

function updateMainClock(){
  if(!stb.programs || stb.programs.length === 0) return;
  const currentProgram = stb.programs[stb.currentProgramIndex];
  mainClockName.textContent = currentProgram.name;
  const remaining = (currentProgram.assignedTime || 0) - currentProgram.getCountedTime();
  mainClockTimer.textContent = formatSignedHMS(remaining,false);
}

// stb.dataに基づき、stb.programsを構築
// contedTimeがリセットされるので、タイマーを最初からやり直すときなどしか呼ばない
function resetPrograms(){
  if(!stb.data) return;
  stb.programs = stb.data.programs.map(p => ({
    ...p,
    assignedTime: p.baseline || 0, // 割り当て時間
    getCountedTime: function(){
      if(!this.timerRunning){
        return this.lastStopCount;
      }else{
        return this.lastStopCount + (Date.now() - this.lastStartTime) / 1000;
      }
    },
    getShrinkableTime: function(){
      // 単純に、現在の割り当て時間から最小値を引いたものを返す。
      // 実際に削減しようとしたとき、経過時間より削ろうとしても削れないが、そのロジックはadjustTimesの中で行う。
      if(this.skipped) return 0; // スキップ対象は縮小不可
      if(this.finished) return 0; // 終了済みも縮小不可
      return Math.max(0, this.assignedTime - this.min);
    },
    getExtendableTime: function(){
      if(this.finished) return 0; // 終了済みは拡張不可
      // 拡張可能時間は、現在の割り当て時間から最大値を引いたもの。
      // 実際に拡張しようとしたとき、経過時間がベース時間を超えている場合はそれも含めて拡張されることになるが、そのロジックはadjustTimesの中で行う。
      return Math.max(0, this.max - this.assignedTime);
    },
    lastStopCount : 0, // タイマーが最後にスタートしたときの countedTime（タイマー連動時の経過時間計算に使用）
    lastStartTime: 0, // タイマーが最後にスタートしたときの実時間（Date.now()）
    skipped: false,
  }));
  adjustTimes();
  render("TimeChange");
}

// stb.programsのcurrentTimeを、stb.data.totalTimeに合わせて調整
function adjustTimes(){
  if(!stb.data || !stb.programs) return;
  const T_total = stb.data.totalTime;

  // 計算結果を初期化
  for(let index in stb.programs){
    const p = stb.programs[index];
    const d = stb.data.programs[index];
    // dataから必要な値をコピー（UIで変更された可能性があるため）
    p.baseline = d.baseline || 0;
    p.min = d.min || 0;
    p.max = d.max || 0;
    p.dontShrinkPriority = d.dontShrinkPriority || 1;
    p.skipPriority = d.skipPriority || 1;
    p.skipThreshold = d.skipThreshold || 0;
    p.extendPriority = d.extendPriority || 1;

    // 割り当て時間を基準値で初期化
    p.assignedTime = d.baseline || 0;
    p.skipped = false; // スキップ状態のリセット（再計算のたびに初期化）
  }

  // 現状の割り当て時間合計と総時間の差分を計算
  // 計算時、割り当て時間または経過済み時間の大きい方を採用
  function sumAssignedTime(){
    return stb.programs.reduce((s,p) => s + Math.max(p.assignedTime, p.getCountedTime()), 0);
  }

  let sumAssigned = sumAssignedTime();
  let diff = sumAssigned - T_total;

  function shrink(pr){
    const shrinkablePrograms = stb.programs.filter(p => !p.finished && p.dontShrinkPriority === pr && p.assignedTime > p.min);
    const totalShrinkPotential = shrinkablePrograms.reduce((s,p) => s + Math.max(0, p.assignedTime - p.min), 0);
    if(totalShrinkPotential > 0){
      shrinkablePrograms.forEach(p => {
        const potential = Math.max(0, p.assignedTime - p.min);
        let reduction = Math.min(potential, diff * (potential / totalShrinkPotential));
        // すでに経過してしまった時間より削減することはできない
        // 例: assignedTime=300, getCountedTime()=250, min=200 の場合、削減可能な最大値は50（300-250）となる
        reduction = Math.min(reduction, Math.max(0, p.assignedTime - p.getCountedTime()));
        p.assignedTime -= reduction;
        diff -= reduction;
      });
    };
  }

  function skip(pr){
    const skippablePrograms = stb.programs.filter(p => !p.finished && p.skipPriority === pr && p.assignedTime > 0 && p.getCountedTime() === 0 && !p.skipped);
    for(const p of skippablePrograms){
      const reduction = p.assignedTime;
      p.assignedTime = 0;
      p.skipped = true; // スキップ済みとしてマーク（後続の再配分で復活させない）
      diff -= reduction;
      if(diff <= 0) break;
    }
  }

  function extend(pr){
    const extendablePrograms = stb.programs.filter(p => !p.finished && p.extendPriority === pr && !p.skipped && p.assignedTime < p.max);
    const totalExtendPotential = extendablePrograms.reduce((s,p) => s + Math.max(0, p.max - p.assignedTime), 0);
    if(totalExtendPotential > 0){
      extendablePrograms.forEach(p => {
        const potential = Math.max(0, p.max - p.assignedTime);
        let extension = Math.min(potential, -diff * (potential / totalExtendPotential));
        p.assignedTime += extension;
        diff += extension;
      });
    }
  }

  // ここから、diffを解消するための調整ロジック
  if(diff > 0){
    // 削減が必要な場合のロジック
    // 優先度に基づいて、縮小とスキップを実行
    for(let pr=5; pr>=1 && diff>0; pr--){
      shrink(pr); // 縮小フェーズ
      if(diff <= 0) break;
      skip(pr); // スキップフェーズ
      if(diff <= 0) break;
    }
    // 最終チェック: diffが負（過剰にスキップした）場合の再配分
    if(diff < 0){
      //すべてのassignedTimeをリセットし(skipフラグは維持)、再度縮小処理
      stb.programs.forEach(p => {
        if(!p.skipped) p.assignedTime = p.baseline || 0;
      });
      diff = sumAssignedTime() - T_total; // 再計算
      for(let pr=5; pr>=1 && diff>0; pr--){
        shrink(pr); // 縮小フェーズ（この場合は拡張として機能）
        if(diff <= 0) break;
      }
    }
  } else if(diff < 0){
    // 拡張が必要な場合のロジック（省略済みは拡張対象外）
    for(let pr=5; pr>=1 && diff<0; pr--){
      extend(pr);
      if(diff >= 0) break;
    }
  }
}

// 汎用関数

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
  if(digits.length>=5){
    const sec = Number(digits.slice(-2));
    const min = Number(digits.slice(-4, -2))||0;
    const hrs = Number(digits.slice(0, digits.length-4))||0;
    return hrs*3600 + min*60 + sec;
  }
}

// 秒を hh:mm:ss に変換
function secToHMS(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// 差分を符号付きで表示するフォーマッタ
function formatSignedHMS(deltaSec, showPlusSign=true){
  const sign = deltaSec>0?'+': (deltaSec<0?'-':'+');
  const s = Math.abs(Math.round(deltaSec));
  const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec = s%60;
  if(h>0) return `${showPlusSign?sign:''}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${showPlusSign?sign:''}${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// 1-5のoptionを生成
function optionRange(range,selected){
  let s=''; for(let i=1;i<=range;i++){ s += `<option value="${i}" ${i===selected?'selected':''}>${i}</option>` }
  return s;
}

// HTMLエスケープ
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }