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
    getLawData: (idOrNum, opts) => apiGet('/law_data/' + encodeURIComponent(idOrNum), opts || {}),
    searchKeyword: (params) => apiGet('/keyword', params).then((d) => d.items || []).catch(() => [])
  };

  const LP = window.LegalParser;

  function escapeRegexForSearch(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // -----------------------------------------------------------------------
  // 状態
  // -----------------------------------------------------------------------
  const state = {
    parseResult: null,
    tokenRegistry: [],   // { token, node } のフラットリスト。DOM上は data-tok-idx で参照
    lawStack: [],        // 「同法」「外部法令参照」で辿った際の戻り先 (idOrNum)
    currentIdOrNum: null,
    selectedTokEl: null,
    defViewStack: []     // 定義内容ビューの積み重ね。各要素: { token, node, contentEl }
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
    'SubsectionTitle', 'DivisionTitle', 'PartTitle', 'SupplProvisionLabel', 'ItemTitle',
    'EnactStatement', 'Preamble'
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

    // 号・イロハ(Subitem1〜10)・Column(号の本文が複数列に分かれている場合の各列)は、
    // いずれもJSON上の階層が一段深いことを表す。何もしないと汎用フォールバック
    // (inline span)に落ちて地続きに表示されてしまうため、行を分けたツリー表示にする。
    function renderItemLike(node, cls, titleTag) {
      const div = document.createElement('div');
      div.className = cls;
      const [itNum] = String((node.attr && node.attr.Num) || '').split('_');
      if (itNum) div.dataset.coordKey = itNum;
      (node.children || []).forEach((c) => {
        if (titleTag && c.tag === titleTag) {
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
        case 'Item':
          return renderItemLike(node, 'srcItem', 'ItemTitle');
        case 'Subitem1': case 'Subitem2': case 'Subitem3': case 'Subitem4': case 'Subitem5':
        case 'Subitem6': case 'Subitem7': case 'Subitem8': case 'Subitem9': case 'Subitem10':
          return renderItemLike(node, 'srcSubitem', node.tag + 'Title');
        case 'Column':
          return renderItemLike(node, 'srcItemColumn', null);
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
              if (col.attr) {
                if (col.attr.rowspan) td.rowSpan = parseInt(col.attr.rowspan, 10) || 1;
                if (col.attr.colspan) td.colSpan = parseInt(col.attr.colspan, 10) || 1;
              }
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
  async function showCallStack(tokIdx, fromLevelIndex) {
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

    // ここから先は「定義内容ビュー」(メインビュー下部)を構築する過程。実行時に行う
    // API取得・ノード検索・ハイライトの各ステップも、静的な解決トレースと同じ見た目で
    // コールスタックに積んでいく。ビュー本体はメインビュー下部のスタックに1段積む。
    await pushDefViewLevel(token, node, body, fromLevelIndex);

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

  // トークンをクリックした際に、実際に指している内容を描画する「定義内容ビュー」。
  // 構築に至るステップ(ノード検索・API取得・ハイライト)もコールスタックに積む。
  function appendStackFrame(container, step, detail) {
    const div = document.createElement('div');
    div.className = 'stackFrame stackFrameView';
    const s = document.createElement('div');
    s.className = 'stackFrameStep';
    s.textContent = step;
    const d = document.createElement('div');
    d.className = 'stackFrameDetail';
    d.textContent = detail;
    div.appendChild(s);
    div.appendChild(d);
    container.appendChild(div);
    return div;
  }

  // -----------------------------------------------------------------------
  // 定義内容ビューの積み重ね(スタック)
  // 必要ないときは閉じており、本文またはビュー内のトークンをクリックすると
  // 新しい段(レベル)が一番下に積まれる。既存の段の中でクリックした場合は、
  // その段より後ろを一旦破棄してから新しい段を積む(分岐のやり直し)。
  // -----------------------------------------------------------------------
  function updateDefViewPaneVisibility() {
    const pane = document.getElementById('defViewPane');
    if (state.defViewStack.length === 0) pane.classList.add('empty');
    else pane.classList.remove('empty');
  }

  function closeDefViewLevel(index) {
    state.defViewStack = state.defViewStack.slice(0, index);
    updateDefViewPaneVisibility();
    renderDefViewStackDom();
  }

  function renderDefViewStackDom() {
    const stackEl = document.getElementById('defViewStack');
    stackEl.innerHTML = '';
    let lastSection = null;
    state.defViewStack.forEach((level, i) => {
      const section = document.createElement('div');
      section.className = 'defViewLevel';
      section.dataset.defviewLevel = String(i);

      const header = document.createElement('div');
      header.className = 'defViewLevelHeader';
      const depth = document.createElement('span');
      depth.className = 'defViewLevelDepth';
      depth.textContent = 'Lv' + (i + 1);
      const label = document.createElement('span');
      label.className = 'defViewLevelLabel';
      label.textContent = '「' + level.token.text + '」';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'defViewLevelClose';
      closeBtn.textContent = '✕ 閉じる';
      closeBtn.title = 'この段より下をすべて閉じます';
      closeBtn.addEventListener('click', () => closeDefViewLevel(i));
      header.appendChild(depth);
      header.appendChild(label);
      header.appendChild(closeBtn);
      section.appendChild(header);

      const bodyEl = document.createElement('div');
      bodyEl.className = 'defViewLevelBody';
      if (level.contentEl) {
        bodyEl.appendChild(level.contentEl);
      } else {
        bodyEl.innerHTML = '<p class="hint">読み込み中…</p>';
      }
      section.appendChild(bodyEl);

      stackEl.appendChild(section);
      lastSection = section;
    });
    // 最新の段の見出しが見えるようにスクロール(段の中身がどれだけ長くても先頭が見えるように)
    if (lastSection) lastSection.scrollIntoView({ block: 'start' });
  }

  async function pushDefViewLevel(token, node, stackTraceBody, fromLevelIndex) {
    if (fromLevelIndex == null || fromLevelIndex < 0) {
      state.defViewStack = [];
    } else {
      state.defViewStack = state.defViewStack.slice(0, fromLevelIndex + 1);
    }
    const level = { token, node, contentEl: null };
    state.defViewStack.push(level);
    updateDefViewPaneVisibility();
    renderDefViewStackDom();

    const holder = document.createElement('div');
    await renderDefinitionView(token, node, stackTraceBody, holder);
    if (!holder.childNodes.length) {
      holder.innerHTML = '<p class="hint">このトークンには表示可能な参照内容がありません。</p>';
    }
    level.contentEl = holder;
    renderDefViewStackDom();
  }

  function appendDefView(viewBody, labelText, contentEl) {
    const label = document.createElement('div');
    label.className = 'defViewSourceLabel';
    label.textContent = labelText;
    viewBody.appendChild(label);
    viewBody.appendChild(contentEl);
    return contentEl;
  }

  // 指定した座標の中で、できるだけ細かい単位(号 > 項 > 条全体)をハイライトする。
  function highlightWithinClone(clone, coord) {
    let target = null;
    if (coord.paragraphNum) {
      const p = clone.querySelector('.srcParagraph[data-coord-key="' + CSS.escape(String(coord.paragraphNum)) + '"]');
      if (coord.itemNum && p) {
        target = p.querySelector('.srcItem[data-coord-key="' + CSS.escape(String(coord.itemNum)) + '"]') || p;
      } else {
        target = p;
      }
    }
    (target || clone).classList.add('defViewHighlight');
  }

  // 同一法令内の座標に対応する、すでに描画済みのDOMノードを複製してハイライトする。
  // (再描画せず既存ノードを複製することで、トークンの色分けやリンクをそのまま保つ)
  function cloneCoordPreview(coord) {
    const key = 'M:' + (coord.articleNum || '') + '_' + (coord.articleSub || '');
    const artEl = document.querySelector('#sourceBody [data-article-key="' + CSS.escape(key) + '"]');
    if (!artEl) return null;
    const clone = artEl.cloneNode(true);
    if (clone.tagName === 'DETAILS') clone.open = true;
    highlightWithinClone(clone, coord);
    return clone;
  }

  async function renderDefinitionView(token, node, stackBody, viewBody) {
    if (token.type === 'definition-use') {
      const sym = state.parseResult.symbolTable.find((s) => s.id === token.symbolId);
      if (!sym) return;
      appendStackFrame(stackBody, 'VIEW', '定義内容ビューを構築中… (定義箇所: ' + LP.describeCoord(sym.definedAtCoord) + ')');
      const clone = cloneCoordPreview(sym.definedAtCoord);
      if (clone) {
        appendStackFrame(stackBody, 'VIEW', '同一法令内のノードを取得し、定義箇所をハイライトしました');
        appendDefView(viewBody, '定義内容', clone);
      } else {
        appendStackFrame(stackBody, 'VIEW', '定義箇所のノードが見つかりませんでした');
      }
      return;
    }

    if ((token.type === 'relative-simple' || token.type === 'direct' || token.type === 'direct-range' || token.type === 'direct-exclude') && token.resolvedCoord) {
      appendStackFrame(stackBody, 'VIEW', '定義内容ビューを構築中… (' + LP.describeCoord(token.resolvedCoord) + ')');
      const clone = cloneCoordPreview(token.resolvedCoord);
      if (clone) {
        appendStackFrame(stackBody, 'VIEW', '同一法令内のノードを取得し、該当箇所をハイライトしました');
        appendDefView(viewBody, '参照内容', clone);
      } else {
        appendStackFrame(stackBody, 'VIEW', '該当ノードが見つかりませんでした(未制定・削除された条文の可能性)');
      }
      return;
    }

    if (token.type === 'relative-count' && token.resolvedCoords && token.resolvedCoords.length) {
      appendStackFrame(stackBody, 'VIEW', '定義内容ビューを構築中… (' + token.resolvedCoords.length + '件)');
      const wrap = document.createElement('div');
      let found = 0;
      token.resolvedCoords.forEach((c) => {
        const clone = cloneCoordPreview(c);
        if (clone) { wrap.appendChild(clone); found++; }
      });
      if (found) {
        appendStackFrame(stackBody, 'VIEW', found + '件のノードをハイライトして表示しました');
        appendDefView(viewBody, '参照内容(複数)', wrap);
      } else {
        appendStackFrame(stackBody, 'VIEW', '該当ノードが見つかりませんでした');
      }
      return;
    }

    if (token.type === 'external' || token.type === 'same-law') {
      if (!token.lawName) return;
      appendStackFrame(stackBody, 'VIEW', '外部法令「' + token.lawName + '」の参照内容ビューを構築中…');
      try {
        let lawIdOrNum = token.lawNum;
        if (!lawIdOrNum) {
          appendStackFrame(stackBody, 'VIEW', '法令番号が不明なため、名称でAPI検索します: ' + token.lawName);
          const results = await EgovApi.searchLaws({ law_title: token.lawName, limit: 5 });
          const best = results.find((r) => r.revision_info.law_title === token.lawName) || results[0];
          if (!best) {
            appendStackFrame(stackBody, 'VIEW', '「' + token.lawName + '」に該当する法令が見つかりませんでした');
            return;
          }
          lawIdOrNum = best.law_info.law_id;
          appendStackFrame(stackBody, 'VIEW', '候補が見つかりました: ' + best.revision_info.law_title);
        }

        if (!token.articleNum) {
          const data = await EgovApi.getLawData(lawIdOrNum, {});
          const title = data.revision_info && data.revision_info.law_title;
          appendStackFrame(stackBody, 'VIEW', '取得完了: ' + title + '(条番号の指定がないため法令の概要のみ表示)');
          const info = document.createElement('div');
          info.className = 'defViewLawInfo';
          info.textContent = (title || '') + '　' + ((data.revision_info && data.revision_info.law_num) || '');
          appendDefView(viewBody, '参照先の法令', info);
          return;
        }

        const articleKey = token.articleNum + (token.articleSub ? '_' + token.articleSub : '');
        const articleLabel = '第' + token.articleNum + '条' + (token.articleSub ? 'の' + token.articleSub : '');
        appendStackFrame(stackBody, 'VIEW', articleLabel + 'のデータを取得中…');
        const data = await EgovApi.getLawData(lawIdOrNum, { elm: 'MainProvision-Article_' + articleKey });
        const title = data.revision_info && data.revision_info.law_title;
        appendStackFrame(stackBody, 'VIEW', '取得完了: ' + title + ' ' + articleLabel);
        const pr = LP.parseLaw(data.law_full_text, {});
        const tree = buildSourceTree(data.law_full_text, pr.sentenceNodes);
        if (tree && tree.classList) {
          if (tree.tagName === 'DETAILS') tree.open = true;
          tree.querySelectorAll && tree.querySelectorAll('details').forEach((d) => { d.open = true; });
          highlightWithinClone(tree, token);
        }
        appendStackFrame(stackBody, 'VIEW', '該当箇所をハイライトしました');
        appendDefView(viewBody, title + ' の参照内容', tree);
      } catch (err) {
        appendStackFrame(stackBody, 'VIEW', '取得に失敗しました: ' + err.message);
      }
      return;
    }

    if (token.type === 'delegate') {
      const baseLawTitle = state.parseResult && state.parseResult.lawMeta && state.parseResult.lawMeta.lawTitle;
      const articleNum = node.coord && node.coord.articleNum;
      const paragraphNum = node.coord && node.coord.paragraphNum;
      if (!baseLawTitle || !articleNum) {
        appendStackFrame(stackBody, 'VIEW', '委任元の法令名または条番号が不明なため、候補を検索できません');
        return;
      }
      const artKanji = LP.intToKanji(parseInt(articleNum, 10));
      if (!artKanji) {
        appendStackFrame(stackBody, 'VIEW', '条番号を漢数字化できなかったため、検索できません');
        return;
      }
      try {
        const kwQuery = baseLawTitle + '第' + artKanji + '条';
        appendStackFrame(stackBody, 'VIEW', 'キーワード検索: 「' + kwQuery + '」を含む法令を検索中…');
        const kwResults = await EgovApi.searchKeyword({ keyword: kwQuery, limit: 100 });
        const ORDINANCE_TYPES = ['CabinetOrder', 'MinisterialOrdinance', 'Rule'];
        let candidates = kwResults.filter((r) => ORDINANCE_TYPES.indexOf(r.law_info.law_type) !== -1);
        appendStackFrame(stackBody, 'VIEW', 'キーワード検索結果: 政令・省令・規則が' + candidates.length + '件該当');

        // キーワード検索は本文中に「基となる法令のフルネーム＋条番号」がそのまま
        // 書かれている場合しか拾えない。施行令・施行規則側は「法第◯条」のように
        // 略称で書くのが通例のため、そのケースではキーワード検索がヒットしない。
        // そこで「{基の法令名}施行令」「{基の法令名}施行規則」という命名慣習からの
        // 直接タイトル一致も別途試し、見つかれば最有力候補として扱う。
        appendStackFrame(stackBody, 'VIEW', '題名の慣習(「' + baseLawTitle + '施行令」等)からも直接検索中…');
        const TITLE_GUESS_SUFFIXES = ['施行令', '施行規則'];
        const titleGuessResults = await Promise.all(
          TITLE_GUESS_SUFFIXES.map((suffix) =>
            EgovApi.searchLaws({ law_title: baseLawTitle + suffix, limit: 5 }).catch(() => [])
          )
        );
        const titleGuessHits = [];
        titleGuessResults.forEach((results, i) => {
          const guessTitle = baseLawTitle + TITLE_GUESS_SUFFIXES[i];
          const exact = results.find((r) => r.revision_info.law_title === guessTitle);
          if (exact) titleGuessHits.push(exact);
        });
        if (titleGuessHits.length) {
          appendStackFrame(stackBody, 'VIEW', '題名一致: ' + titleGuessHits.map((r) => '「' + r.revision_info.law_title + '」').join('、'));
        }

        if (!candidates.length && !titleGuessHits.length) {
          appendStackFrame(stackBody, 'VIEW', '候補が見つからないため、法令名(部分一致)でも検索します');
          const titleResults = await EgovApi.searchLaws({ law_title: baseLawTitle, law_type: ORDINANCE_TYPES, limit: 30 });
          if (!titleResults.length) {
            appendStackFrame(stackBody, 'VIEW', '委任先の候補が見つかりませんでした');
            return;
          }
          appendStackFrame(stackBody, 'VIEW', titleResults.length + '件の候補が見つかりました。一覧を表示します');
          renderDelegateCandidateList(viewBody, titleResults);
          return;
        }

        // 制定文(enactstatement)にヒットしている候補と、題名が命名慣習に一致する候補は
        // どちらも強いシグナルだが、あくまで「委任先の可能性が高い」という程度の情報。
        // 一つの法令に複数の政令・省令が存在し、条文ごとに委任先が異なることもあるため
        // (例:道路法の一般的な施行令とは別に、道路標識だけを定める命令がある)、
        // どちらのシグナルを持つ候補でも、実際に本文中の後方参照で当たるまで複数試す。
        const scored = candidates.map((c) => {
          const hasEnact = (c.sentences || []).some((s) => s.position === 'enactstatement');
          return { c, score: hasEnact ? 2 : 1, reason: hasEnact ? '制定文に根拠として明記されている' : null };
        });
        titleGuessHits.forEach((c) => {
          const already = scored.find((s) => s.c.law_info.law_id === c.law_info.law_id);
          if (already) { if (!already.reason) already.reason = '題名が命名慣習に一致している'; }
          else scored.push({ c, score: 2, reason: '題名が命名慣習に一致している' });
        });
        scored.sort((a, b) => b.score - a.score);

        let top = scored[0].c;
        let topReasonLabel = scored[0].reason || '';
        appendStackFrame(stackBody, 'VIEW', '最有力候補: 「' + top.revision_info.law_title + '」' + (topReasonLabel ? '(' + topReasonLabel + ')' : ''));

        let hitArticle = null;
        const triable = scored.filter((s) => s.score >= 2);
        for (const s of triable) {
          appendStackFrame(stackBody, 'VIEW', '「' + s.c.revision_info.law_title + '」の本文から該当条文を探索中…');
          const found = await findBackReferenceArticle(s.c.law_info.law_id, baseLawTitle, articleNum, paragraphNum, token.ministryPhrase);
          if (found) {
            hitArticle = found;
            top = s.c;
            topReasonLabel = s.reason || '';
            break;
          }
        }

        if (hitArticle) {
          appendStackFrame(stackBody, 'VIEW', '該当条文が見つかりました: 「' + top.revision_info.law_title + '」第' + hitArticle + '条');
          const data = await EgovApi.getLawData(top.law_info.law_id, { elm: 'MainProvision-Article_' + hitArticle });
          const pr = LP.parseLaw(data.law_full_text, {});
          const tree = buildSourceTree(data.law_full_text, pr.sentenceNodes);
          if (tree && tree.classList) {
            if (tree.tagName === 'DETAILS') tree.open = true;
            tree.querySelectorAll && tree.querySelectorAll('details').forEach((d) => { d.open = true; });
            tree.classList.add('defViewHighlight');
          }
          appendStackFrame(stackBody, 'VIEW', '該当箇所をハイライトしました');
          appendDefView(viewBody, top.revision_info.law_title + ' の参照内容(自動推定)', tree);
        } else if (scored[0].score >= 2) {
          // 条文単位までは特定できなくても、題名の命名慣習または制定文への明記という
          // 強いシグナルがある命令は委任先そのものである確度が高いため、その内容を
          // 表示する(候補一覧は補助的に添える)。
          top = scored[0].c;
          topReasonLabel = scored[0].reason || '';
          appendStackFrame(stackBody, 'VIEW', '条文単位までは特定できませんでしたが、' + topReasonLabel + 'ためこの命令を表示します');
          const data = await EgovApi.getLawData(top.law_info.law_id, {});
          const pr = LP.parseLaw(data.law_full_text, {});
          const tree = buildSourceTree(data.law_full_text, pr.sentenceNodes);
          const note = document.createElement('div');
          note.className = 'defViewLawInfo';
          note.textContent = '委任元の条項に対応する具体的な条文までは特定できていません(' + topReasonLabel + 'のみ)。';
          const others = scored.slice(1).map((s) => s.c);
          if (others.length) {
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = ' 違う場合: 他の候補を見る';
            link.addEventListener('click', (e) => {
              e.preventDefault();
              renderDelegateCandidateList(viewBody, [top].concat(others));
            });
            note.appendChild(link);
          }
          const wrap = document.createElement('div');
          wrap.appendChild(note);
          wrap.appendChild(tree);
          appendDefView(viewBody, top.revision_info.law_title + ' の内容(自動推定・条文未特定)', wrap);
        } else {
          appendStackFrame(stackBody, 'VIEW', '後方参照の具体的な条文までは特定できませんでした。候補の一覧を表示します');
          renderDelegateCandidateList(viewBody, scored.map((s) => s.c));
        }
      } catch (err) {
        appendStackFrame(stackBody, 'VIEW', '検索に失敗しました: ' + err.message);
      }
    }
  }

  function renderDelegateCandidateList(viewBody, laws) {
    const hint = document.createElement('div');
    hint.className = 'defViewLawInfo';
    hint.textContent = '本文からは委任先を一意に特定できなかったため、候補を表示します。クリックすると条文を取得します。';
    const ul = document.createElement('ul');
    ul.className = 'defViewCandidateList';
    laws.forEach((l) => {
      const li = document.createElement('li');
      const t = document.createElement('div');
      t.className = 'defViewCandidateTitle';
      t.textContent = l.revision_info.law_title;
      const m = document.createElement('div');
      m.className = 'defViewCandidateMeta';
      m.textContent = (l.law_info.law_num || '') + ' / ' + (l.law_info.law_type || '');
      li.appendChild(t);
      li.appendChild(m);
      li.addEventListener('click', async () => {
        li.classList.add('tok-selected');
        const data = await EgovApi.getLawData(l.law_info.law_id, {});
        const pr = LP.parseLaw(data.law_full_text, {});
        const tree = buildSourceTree(data.law_full_text, pr.sentenceNodes);
        viewBody.innerHTML = '';
        appendDefView(viewBody, l.revision_info.law_title + ' の内容', tree);
      });
      ul.appendChild(li);
    });
    const wrap = document.createElement('div');
    wrap.appendChild(hint);
    wrap.appendChild(ul);
    appendDefView(viewBody, '委任先の候補', wrap);
  }

  // 被参照法令側の「(略称)第N条第M項の◯◯令で定める…は、」のような後方参照文言を
  // 検索し、委任元の条項に対応する具体的な条を特定する。
  async function findBackReferenceArticle(lawIdOrNum, baseLawTitle, articleNum, paragraphNum, ministryPhrase) {
    const artKanji = LP.intToKanji(parseInt(articleNum, 10));
    if (!artKanji) return null;
    let data;
    try {
      data = await EgovApi.getLawData(lawIdOrNum, {});
    } catch (e) {
      return null;
    }
    const fullText = textOfNode(data.law_full_text);
    const abbrevRe = new RegExp(
      escapeRegexForSearch(baseLawTitle) + '（' +
      '(?:(?:明治|大正|昭和|平成|令和)[〇一二三四五六七八九十百千0-9]+年[^（）]{0,20}?第[〇一二三四五六七八九十百千0-9]+号)?' +
      '[^（）]{0,4}?以下「([^」]{1,12})」という。?[^（）]{0,20}?）'
    );
    const am = abbrevRe.exec(fullText);
    const abbrev = am ? am[1] : null;
    const prefixes = [];
    if (abbrev) prefixes.push(abbrev);
    prefixes.push(baseLawTitle);

    const articleNodes = [];
    (function walk(n) {
      if (!n || typeof n === 'string') return;
      if (n.tag === 'Article') { articleNodes.push(n); return; }
      (n.children || []).forEach(walk);
    })(data.law_full_text);

    const targetPara = paragraphNum ? parseInt(paragraphNum, 10) : null;
    const suffixOptions = [];
    if (ministryPhrase) suffixOptions.push(escapeRegexForSearch(ministryPhrase) + 'で定める');
    suffixOptions.push('(?:省令|府令|規則|政令|条例)で定める');

    const lawNumOptional = '(?:（(?:明治|大正|昭和|平成|令和)[〇一二三四五六七八九十百千0-9]+年[^（）]{0,20}?第[〇一二三四五六七八九十百千0-9]+号）)?';
    for (const suffix of suffixOptions) {
      for (const prefix of prefixes) {
        const re = new RegExp(
          escapeRegexForSearch(prefix) + lawNumOptional + '第' + artKanji + '条(?!の[〇一二三四五六七八九十百千0-9])' +
          '(第([〇一二三四五六七八九十百千0-9]+)項)?' +
          '[^。]{0,40}?' + suffix,
          'g'
        );
        for (const artNode of articleNodes) {
          const text = textOfNode(artNode);
          re.lastIndex = 0;
          let m;
          let guard = 0;
          while ((m = re.exec(text))) {
            guard++;
            if (guard > 1000) break;
            const foundPara = m[2] ? LP.kanjiToInt(m[2]) : null;
            if (!targetPara || !foundPara || foundPara === targetPara) {
              return artNode.attr && artNode.attr.Num;
            }
          }
        }
      }
    }
    return null;
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
      state.defViewStack = [];
      updateDefViewPaneVisibility();
      document.getElementById('defViewStack').innerHTML = '';

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

  function setupSourceClicks(container) {
    container.addEventListener('click', (e) => {
      const tok = e.target.closest('.tok');
      if (tok) {
        if (state.selectedTokEl) state.selectedTokEl.classList.remove('tok-selected');
        tok.classList.add('tok-selected');
        state.selectedTokEl = tok;
        // 既存の定義内容ビューの段の中でクリックした場合は、その段から
        // さらに1段下に積む。本文でクリックした場合はスタックをやり直す。
        const levelEl = tok.closest('[data-defview-level]');
        const fromLevelIndex = levelEl ? parseInt(levelEl.dataset.defviewLevel, 10) : null;
        showCallStack(parseInt(tok.dataset.tokIdx, 10), fromLevelIndex);
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
    setupSourceClicks(document.getElementById('sourceBody'));
    setupSourceClicks(document.getElementById('defViewStack'));
    setupDrawer();
    const { lawId } = parseHash();
    if (lawId) loadAndParse(decodeURIComponent(lawId), {});
  });
})();
