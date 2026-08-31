(function () {
  'use strict';

  const API_BASE = 'https://laws.e-gov.go.jp/api/2';
  const cache = new Map();

  async function apiGet(path, params) {
    const url = new URL(API_BASE + path);
    url.searchParams.set('response_format', 'json');
    if (params) {
      Object.keys(params).forEach((k) => {
        const v = params[k];
        if (v === undefined || v === null || v === '') return;
        url.searchParams.set(k, Array.isArray(v) ? v.join(',') : v);
      });
    }
    const key = url.toString();
    if (cache.has(key)) return cache.get(key);
    const res = await fetch(key, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('APIエラー (' + res.status + ')');
    const data = await res.json();
    cache.set(key, data);
    return data;
  }
  const EgovApi = {
    searchLaws: (params) => apiGet('/laws', params).then((d) => d.laws || []),
    getLawData: (idOrNum, opts) => apiGet('/law_data/' + encodeURIComponent(idOrNum), opts || {})
  };

  const LP = window.LegalParser;

  // -----------------------------------------------------------------------
  // 状態
  // -----------------------------------------------------------------------
  const state = {
    parseResult: null,
    tokenRegistry: [],   // { token, node } のフラットリスト。DOM上は data-tok-idx で参照
    lawStack: [],        // 「同法」「外部法令参照」で辿った際の戻り先 (idOrNum)
    currentIdOrNum: null,
    selectedTokEl: null
  };

  function registerToken(token, node) {
    state.tokenRegistry.push({ token, node });
    return state.tokenRegistry.length - 1;
  }

  // -----------------------------------------------------------------------
  // 法令ツリー → デバッガー用ソース表示 (座標追跡はlegalParser.jsのflattenと同じ順序を辿る)
  // -----------------------------------------------------------------------
  const LEAF_TEXT_TAGS = new Set([
    'Sentence', 'ArticleCaption', 'ArticleTitle', 'ChapterTitle', 'SectionTitle',
    'SubsectionTitle', 'DivisionTitle', 'PartTitle', 'SupplProvisionLabel', 'ItemTitle'
  ]);
  for (let i = 1; i <= 10; i++) LEAF_TEXT_TAGS.add('Subitem' + i + 'Title');

  function renderTokenizedText(sentenceNodes, cursor, plain) {
    const node = sentenceNodes[cursor.i++];
    const frag = document.createDocumentFragment();
    if (!node) return frag;
    if (plain) {
      // 条見出し(「第一条」等)はそれ自体が直接参照の正規表現に自己マッチしてしまうため、
      // トークン化せず生テキストとして表示する(カーソルは進める=座標同期は保つ)。
      frag.appendChild(document.createTextNode(node.text));
      return frag;
    }
    let pos = 0;
    (node.tokens || []).forEach((t) => {
      if (t.start > pos) frag.appendChild(document.createTextNode(node.text.slice(pos, t.start)));
      const span = document.createElement('span');
      span.className = 'tok tok-' + t.type;
      span.textContent = t.text;
      span.dataset.tokIdx = String(registerToken(t, node));
      frag.appendChild(span);
      pos = t.end;
    });
    if (pos < node.text.length) frag.appendChild(document.createTextNode(node.text.slice(pos)));
    return frag;
  }

  function buildSourceTree(root, sentenceNodes) {
    const cursor = { i: 0 };

    function renderChildren(node) {
      const frag = document.createDocumentFragment();
      (node.children || []).forEach((c) => {
        const el = render(c);
        if (el) frag.appendChild(el);
      });
      return frag;
    }

    // 章・節・款・目・編に共通の「見出し + ブロック内容」コンテナ。
    // これを用意せず汎用フォールバック(inline span)に落とすと、見出しどうしが
    // 改行なしで連結して表示されてしまう(節を持つ章で顕在化するレイアウト崩れ)。
    function renderSectionLike(node, titleTag, wrapperClass, titleClass, keyPrefix) {
      const div = document.createElement('div');
      div.className = wrapperClass;
      div.dataset.articleKey = keyPrefix + ':' + ((node.attr && node.attr.Num) || '');
      (node.children || []).forEach((c) => {
        if (c.tag === titleTag) {
          const h = document.createElement('div');
          h.className = titleClass;
          h.appendChild(renderTokenizedText(sentenceNodes, cursor));
          div.appendChild(h);
        } else {
          const el = render(c);
          if (el) div.appendChild(el);
        }
      });
      return div;
    }

    function render(node) {
      if (typeof node === 'string') return document.createTextNode(node);
      if (!node || !node.tag) return null;
      if (LEAF_TEXT_TAGS.has(node.tag)) {
        const span = document.createElement('span');
        span.appendChild(renderTokenizedText(sentenceNodes, cursor));
        return span;
      }
      switch (node.tag) {
        case 'TOC':
        case 'LawTitle':
          return null;
        case 'Chapter':
          return renderSectionLike(node, 'ChapterTitle', 'srcChapter', 'srcChapterTitle', 'chap');
        case 'Section':
          return renderSectionLike(node, 'SectionTitle', 'srcSection', 'srcSectionTitle', 'sect');
        case 'Subsection':
          return renderSectionLike(node, 'SubsectionTitle', 'srcSection', 'srcSectionTitle', 'subsect');
        case 'Division':
          return renderSectionLike(node, 'DivisionTitle', 'srcSection', 'srcSectionTitle', 'div');
        case 'Part':
          return renderSectionLike(node, 'PartTitle', 'srcChapter', 'srcChapterTitle', 'part');
        case 'Article': {
          const details = document.createElement('details');
          details.className = 'srcArticle';
          const [a, asub] = String((node.attr && node.attr.Num) || '').split('_');
          details.dataset.articleKey = 'M:' + (a || '') + '_' + (asub || '');
          const summary = document.createElement('summary');
          (node.children || []).forEach((c) => {
            if (c.tag === 'ArticleTitle') {
              const s = document.createElement('span');
              s.className = 'srcArticleHead';
              s.appendChild(renderTokenizedText(sentenceNodes, cursor, true));
              summary.appendChild(s);
            } else if (c.tag === 'ArticleCaption') {
              const s = document.createElement('span');
              s.className = 'srcArticleCaption';
              s.appendChild(renderTokenizedText(sentenceNodes, cursor));
              summary.appendChild(s);
            }
          });
          details.appendChild(summary);
          const body = document.createElement('div');
          body.className = 'srcArticleBody';
          (node.children || []).forEach((c) => {
            if (c.tag === 'ArticleTitle' || c.tag === 'ArticleCaption') return;
            const el = render(c);
            if (el) body.appendChild(el);
          });
          details.appendChild(body);
          return details;
        }
        case 'Paragraph': {
          const div = document.createElement('div');
          div.className = 'srcParagraph';
          div.dataset.coordKey = (node.attr && node.attr.Num) || '1';
          div.appendChild(renderChildren(node));
          return div;
        }
        case 'ParagraphNum': {
          const span = document.createElement('span');
          span.className = 'srcParagraphNum';
          span.appendChild(renderChildren(node));
          return span;
        }
        case 'Item': {
          const div = document.createElement('div');
          div.className = 'srcItem';
          (node.children || []).forEach((c) => {
            if (c.tag === 'ItemTitle') {
              const s = document.createElement('span');
              s.className = 'srcItemTitle';
              s.appendChild(renderTokenizedText(sentenceNodes, cursor));
              div.appendChild(s);
            } else {
              const el = render(c);
              if (el) div.appendChild(el);
            }
          });
          return div;
        }
        case 'SupplProvision': {
          const div = document.createElement('div');
          div.className = 'srcSuppl';
          (node.children || []).forEach((c) => {
            if (c.tag === 'SupplProvisionLabel') {
              const h = document.createElement('div');
              h.className = 'srcSupplLabel';
              h.appendChild(renderTokenizedText(sentenceNodes, cursor));
              div.appendChild(h);
            } else {
              const el = render(c);
              if (el) div.appendChild(el);
            }
          });
          return div;
        }
        case 'Table': {
          const table = document.createElement('table');
          table.className = 'lawTable';
          (node.children || []).forEach((row) => {
            if (row.tag !== 'TableRow') return;
            const tr = document.createElement('tr');
            (row.children || []).forEach((col) => {
              if (col.tag !== 'TableColumn') return;
              const td = document.createElement('td');
              td.appendChild(renderChildren(col));
              tr.appendChild(td);
            });
            table.appendChild(tr);
          });
          return table;
        }
        default: {
          const span = document.createElement('span');
          span.style.display = 'contents';
          span.appendChild(renderChildren(node));
          return span;
        }
      }
    }

    return render(root);
  }

  // -----------------------------------------------------------------------
  // 目次
  // -----------------------------------------------------------------------
  function textOfNode(node) {
    let out = '';
    (function walk(n) {
      if (typeof n === 'string') { out += n; return; }
      if (n && n.children) n.children.forEach(walk);
    })(node);
    return out;
  }

  function collectToc(root) {
    const toc = [];
    let currentChapter = null;
    (function walk(node) {
      if (!node || typeof node === 'string') return;
      if (node.tag === 'Chapter') {
        const titleNode = (node.children || []).find((c) => c.tag === 'ChapterTitle');
        const entry = { type: 'chapter', num: node.attr && node.attr.Num, title: titleNode ? textOfNode(titleNode) : '', articles: [] };
        toc.push(entry);
        const prev = currentChapter;
        currentChapter = entry;
        (node.children || []).forEach(walk);
        currentChapter = prev;
        return;
      }
      if (node.tag === 'Article') {
        const titleNode = (node.children || []).find((c) => c.tag === 'ArticleTitle');
        const entry = { type: 'article', num: node.attr && node.attr.Num, title: titleNode ? textOfNode(titleNode) : ('第' + (node.attr && node.attr.Num) + '条') };
        if (currentChapter) currentChapter.articles.push(entry); else toc.push(entry);
        return;
      }
      (node.children || []).forEach(walk);
    })(root);
    return toc;
  }

  function renderToc(toc) {
    const ol = document.getElementById('tocList');
    ol.innerHTML = '';
    toc.forEach((entry) => {
      if (entry.type === 'chapter') {
        const li = document.createElement('li');
        li.className = 'tocChapter';
        li.appendChild(tocLink('chap:' + entry.num, entry.title, true));
        const sub = document.createElement('ol');
        sub.style.listStyle = 'none'; sub.style.margin = '0'; sub.style.padding = '0';
        entry.articles.forEach((a) => {
          const subLi = document.createElement('li');
          subLi.className = 'tocArticle';
          subLi.appendChild(tocLink('M:' + a.num + '_', a.title, false));
          sub.appendChild(subLi);
        });
        li.appendChild(sub);
        ol.appendChild(li);
      } else {
        const li = document.createElement('li');
        li.className = 'tocArticle';
        li.appendChild(tocLink('M:' + entry.num + '_', entry.title, false));
        ol.appendChild(li);
      }
    });
  }

  function tocLink(articleKey, label, isChapter) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToArticleKey(articleKey);
    });
    return a;
  }

  function jumpToArticleKey(key) {
    const el = document.querySelector('#sourceBody [data-article-key="' + CSS.escape(key) + '"]');
    if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    let p = el.parentElement;
    while (p) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('refFlash'); void el.offsetWidth; el.classList.add('refFlash');
  }

  // -----------------------------------------------------------------------
  // コールスタック パネル
  // -----------------------------------------------------------------------
  function showCallStack(tokIdx) {
    const entry = state.tokenRegistry[tokIdx];
    if (!entry) return;
    const { token, node } = entry;
    document.getElementById('callStackTokenLabel').textContent = '「' + token.text + '」';
    const body = document.getElementById('callStackBody');
    body.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'stackFrameHeader';
    header.textContent = LP.describeTokenType(token.type) + ' @ ' + LP.describeCoord(node.coord);
    body.appendChild(header);

    (token.trace || []).forEach((frame, i) => {
      const div = document.createElement('div');
      div.className = 'stackFrame';
      const step = document.createElement('div');
      step.className = 'stackFrameStep';
      step.textContent = '#' + (i + 1) + ' ' + frame.step;
      const detail = document.createElement('div');
      detail.className = 'stackFrameDetail';
      detail.textContent = frame.detail;
      div.appendChild(step);
      div.appendChild(detail);
      body.appendChild(div);
    });

    if (token.resolvedCoord) {
      const btn = document.createElement('button');
      btn.className = 'jumpBtn';
      btn.textContent = '解決先へジャンプ: ' + LP.describeCoord(token.resolvedCoord);
      btn.addEventListener('click', () => jumpToCoord(token.resolvedCoord));
      body.appendChild(btn);
    }
    if (token.type === 'definition-use') {
      const sym = state.parseResult.symbolTable.find((s) => s.id === token.symbolId);
      if (sym) {
        const btn = document.createElement('button');
        btn.className = 'jumpBtn';
        btn.textContent = '定義箇所へジャンプ: ' + LP.describeCoord(sym.definedAtCoord);
        btn.addEventListener('click', () => jumpToCoord(sym.definedAtCoord));
        body.appendChild(btn);
      }
    }
    if (token.type === 'external' || token.type === 'same-law') {
      if (token.lawName) {
        const btn = document.createElement('button');
        btn.className = 'jumpBtn';
        btn.textContent = '「' + token.lawName + '」を解析する';
        btn.addEventListener('click', () => openExternalLaw(token.lawName, token.lawNum));
        body.appendChild(btn);
      }
    }
  }

  function jumpToCoord(coord) {
    if (!coord) return;
    const key = 'M:' + (coord.articleNum || '') + '_' + (coord.articleSub || '');
    const artEl = document.querySelector('#sourceBody [data-article-key="' + CSS.escape(key) + '"]');
    if (!artEl) return;
    artEl.open = true;
    if (coord.paragraphNum) {
      const pEl = artEl.querySelector('.srcParagraph[data-coord-key="' + CSS.escape(coord.paragraphNum) + '"]');
      const target = pEl || artEl;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.remove('refFlash'); void target.offsetWidth; target.classList.add('refFlash');
    } else {
      artEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      artEl.classList.remove('refFlash'); void artEl.offsetWidth; artEl.classList.add('refFlash');
    }
  }

  // -----------------------------------------------------------------------
  // スコープ パネル
  // -----------------------------------------------------------------------
  function showScopeAt(node) {
    document.getElementById('scopeCoordLabel').textContent = LP.describeCoord(node.coord);
    const body = document.getElementById('scopeBody');
    body.innerHTML = '';
    const active = state.parseResult.symbolTable.filter((s) => s.alias && LP.isInScope(s, node.coord, node.seq));
    if (!active.length) {
      body.innerHTML = '<p class="hint">この位置で有効な定義済み語句はありません。</p>';
      return;
    }
    const groups = new Map();
    active.forEach((s) => {
      const label = s.scope.type === 'law' ? '法令全体' : s.scope.type === 'fromHere' ? 'この地点以降' : s.scope.type === 'article' ? 'この条のみ' : s.scope.type;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(s);
    });
    groups.forEach((syms, label) => {
      const g = document.createElement('div');
      g.className = 'scopeGroup';
      const gt = document.createElement('div');
      gt.className = 'scopeGroupTitle';
      gt.textContent = label;
      g.appendChild(gt);
      syms.forEach((s) => {
        const e = document.createElement('div');
        e.className = 'scopeEntry';
        const a = document.createElement('div');
        a.className = 'scopeEntryAlias';
        a.textContent = s.alias;
        const d = document.createElement('div');
        d.className = 'scopeEntryDef';
        d.textContent = s.definitionText ? s.definitionText.slice(0, 80) : '(定義本体: ' + s.sourceText.slice(0, 60) + '…)';
        e.appendChild(a); e.appendChild(d);
        e.addEventListener('click', () => jumpToCoord(s.definedAtCoord));
        g.appendChild(e);
      });
      body.appendChild(g);
    });
  }

  // -----------------------------------------------------------------------
  // 下部ドロワー: シンボルテーブル/準用/外部参照 一覧
  // -----------------------------------------------------------------------
  function renderDrawer(parseResult) {
    const symBody = document.getElementById('drawerSymbols');
    symBody.innerHTML = '';
    const symTable = document.createElement('table');
    symTable.className = 'drawerTable';
    symTable.innerHTML = '<tr><th>語句</th><th>種別</th><th>スコープ</th><th>定義位置</th><th>定義</th></tr>';
    parseResult.symbolTable.filter((s) => s.alias).forEach((s) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(s.alias) + '</td>' +
        '<td>' + (s.kind === 'scope-definition' ? '文脈定義' : '略称') + '</td>' +
        '<td>' + escapeHtml(LP.describeScope(s.scope)) + '</td>' +
        '<td>' + escapeHtml(LP.describeCoord(s.definedAtCoord)) + '</td>' +
        '<td>' + escapeHtml((s.definitionText || s.sourceText).slice(0, 60)) + '</td>';
      tr.addEventListener('click', () => jumpToCoord(s.definedAtCoord));
      symTable.appendChild(tr);
    });
    symBody.appendChild(symTable);

    const quasiBody = document.getElementById('drawerQuasi');
    quasiBody.innerHTML = '';
    if (!parseResult.quasiApplications.length) {
      quasiBody.innerHTML = '<p class="hint">準用・読み替えの定型文は見つかりませんでした。</p>';
    } else {
      const t = document.createElement('table');
      t.className = 'drawerTable';
      t.innerHTML = '<tr><th>出現位置</th><th>準用元</th><th>準用先(対象)</th><th>読み替え</th></tr>';
      parseResult.quasiApplications.forEach((q) => {
        const tr = document.createElement('tr');
        const subs = q.substitutions.map((s) => '「' + s.from + '」→「' + s.to + '」').join('、') || '(なし)';
        tr.innerHTML =
          '<td>' + escapeHtml(LP.describeCoord(q.atCoord)) + '</td>' +
          '<td>第' + q.sourceArticle + (q.sourceArticleSub ? 'の' + q.sourceArticleSub : '') + '条' + (q.sourceParagraph ? '第' + q.sourceParagraph + '項' : '') + '</td>' +
          '<td>' + escapeHtml((q.targetScopeText || '').slice(0, 50)) + '</td>' +
          '<td>' + escapeHtml(subs) + '</td>';
        tr.addEventListener('click', () => jumpToCoord(q.atCoord));
        t.appendChild(tr);
      });
      quasiBody.appendChild(t);
    }

    const extBody = document.getElementById('drawerExternals');
    extBody.innerHTML = '';
    if (!parseResult.externalLawRefs.length) {
      extBody.innerHTML = '<p class="hint">外部法令への参照は見つかりませんでした。</p>';
    } else {
      const t = document.createElement('table');
      t.className = 'drawerTable';
      t.innerHTML = '<tr><th>法令名</th><th>法令番号</th></tr>';
      parseResult.externalLawRefs.forEach((r) => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + escapeHtml(r.lawName) + '</td><td>' + escapeHtml(r.lawNum || '(番号記載なし)') + '</td>';
        tr.addEventListener('click', () => openExternalLaw(r.lawName, r.lawNum));
        t.appendChild(tr);
      });
      extBody.appendChild(t);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // -----------------------------------------------------------------------
  // 法令の読み込み・解析
  // -----------------------------------------------------------------------
  async function loadAndParse(idOrNum, opts) {
    opts = opts || {};
    const loading = document.getElementById('sourceLoading');
    const sourceBody = document.getElementById('sourceBody');
    loading.hidden = false;
    try {
      const data = await EgovApi.getLawData(idOrNum, {});
      const info = data.revision_info || {};
      const lawId = (data.law_info && data.law_info.law_id) || idOrNum;
      state.currentIdOrNum = lawId;
      state.tokenRegistry = [];

      const parseResult = LP.parseLaw(data.law_full_text, { lawId, lawTitle: info.law_title, lawNum: info.law_num });
      state.parseResult = parseResult;

      document.getElementById('lawTitleDisplay').textContent = info.law_title || '(法令名不明)';
      document.getElementById('lawNumDisplay').textContent = info.law_num || '';

      sourceBody.innerHTML = '';
      const tree = buildSourceTree(data.law_full_text, parseResult.sentenceNodes);
      sourceBody.appendChild(tree);
      renderToc(collectToc(data.law_full_text));
      renderDrawer(parseResult);

      history.replaceState(null, '', '#lawId=' + encodeURIComponent(lawId));

      if (opts.jumpArticleKey) jumpToArticleKey(opts.jumpArticleKey);
    } catch (err) {
      sourceBody.innerHTML = '';
      const p = document.createElement('p');
      p.style.color = '#b3261e';
      p.textContent = '解析に失敗しました: ' + err.message;
      sourceBody.appendChild(p);
    } finally {
      loading.hidden = true;
    }
  }

  async function openExternalLaw(lawName, lawNum) {
    if (state.currentIdOrNum) state.lawStack.push(state.currentIdOrNum);
    try {
      if (lawNum) {
        await loadAndParse(lawNum, {});
        return;
      }
      const results = await EgovApi.searchLaws({ law_title: lawName, limit: 5 });
      const best = results.find((r) => r.revision_info.law_title === lawName) || results[0];
      if (best) await loadAndParse(best.law_info.law_id, {});
    } catch (e) { /* ignore, keep current view */ }
  }

  // -----------------------------------------------------------------------
  // イベント配線
  // -----------------------------------------------------------------------
  function setupSearchBox() {
    const box = document.getElementById('searchBox');
    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { results.hidden = true; results.innerHTML = ''; return; }
      timer = setTimeout(() => runSearch(q), 350);
    });
    async function runSearch(q) {
      results.hidden = false;
      results.innerHTML = '検索中…';
      try {
        const laws = await EgovApi.searchLaws({ law_title: q, limit: 20 });
        results.innerHTML = '';
        if (!laws.length) { results.innerHTML = '<div class="searchResultEmpty">該当する法令が見つかりませんでした。</div>'; return; }
        laws.forEach((l) => {
          const div = document.createElement('div');
          div.className = 'searchResultItem';
          div.innerHTML = '<div class="srTitle"></div><div class="srMeta"></div>';
          div.querySelector('.srTitle').textContent = l.revision_info.law_title;
          div.querySelector('.srMeta').textContent = (l.law_info.law_num || '') + ' / ' + (l.law_info.law_type || '');
          div.addEventListener('click', () => {
            results.hidden = true;
            input.value = l.revision_info.law_title;
            state.lawStack = [];
            loadAndParse(l.law_info.law_id, {});
          });
          results.appendChild(div);
        });
      } catch (err) {
        results.innerHTML = '<div class="searchResultError">検索に失敗しました: ' + escapeHtml(err.message) + '</div>';
      }
    }
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) results.hidden = true; });
  }

  function setupSourceClicks() {
    const sourceBody = document.getElementById('sourceBody');
    sourceBody.addEventListener('click', (e) => {
      const tok = e.target.closest('.tok');
      if (tok) {
        if (state.selectedTokEl) state.selectedTokEl.classList.remove('tok-selected');
        tok.classList.add('tok-selected');
        state.selectedTokEl = tok;
        showCallStack(parseInt(tok.dataset.tokIdx, 10));
        return;
      }
      const para = e.target.closest('.srcParagraph');
      if (para) {
        // 段落クリックでスコープパネルを更新するため、対応する座標を近似的に取得する
        const coordKeyGuess = para.dataset.coordKey;
        const artEl = para.closest('details.srcArticle');
        if (artEl) {
          const [, rest] = artEl.dataset.articleKey.split(':');
          const [artNum, artSub] = rest.split('_');
          showScopeAt({ coord: { isSupplProvision: false, articleNum: artNum, articleSub: artSub || null, paragraphNum: coordKeyGuess }, seq: findSeqForCoord(artNum, artSub, coordKeyGuess) });
        }
      }
    });
  }

  function findSeqForCoord(artNum, artSub, paragraphNum) {
    const nodes = state.parseResult ? state.parseResult.sentenceNodes : [];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const c = nodes[i].coord;
      if (String(c.articleNum) === String(artNum) && String(c.articleSub || '') === String(artSub || '') && String(c.paragraphNum || '') === String(paragraphNum || '')) {
        return nodes[i].seq;
      }
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function setupDrawer() {
    const drawer = document.getElementById('drawer');
    const toggle = document.getElementById('drawerToggle');
    toggle.addEventListener('click', () => {
      drawer.classList.toggle('collapsed');
      toggle.textContent = drawer.classList.contains('collapsed') ? '▲' : '▼';
    });
    document.querySelectorAll('.drawerTab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.drawerTab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.drawerPage').forEach((p) => { p.hidden = true; });
        const key = tab.dataset.tab;
        const map = { symbols: 'drawerSymbols', quasi: 'drawerQuasi', externals: 'drawerExternals' };
        document.getElementById(map[key]).hidden = false;
        if (drawer.classList.contains('collapsed')) {
          drawer.classList.remove('collapsed');
          toggle.textContent = '▼';
        }
      });
    });
  }

  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    const params = new URLSearchParams(h);
    return { lawId: params.get('lawId') };
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupSearchBox();
    setupSourceClicks();
    setupDrawer();
    const { lawId } = parseHash();
    if (lawId) loadAndParse(decodeURIComponent(lawId), {});
  });
})();
