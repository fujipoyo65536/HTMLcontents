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
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body && body.message ? body.message : '';
      } catch (e) { /* ignore */ }
      throw new Error('APIエラー (' + res.status + ') ' + detail);
    }
    const data = await res.json();
    cache.set(key, data);
    return data;
  }

  const EgovApi = {
    searchLaws(params) {
      return apiGet('/laws', params).then((d) => d.laws || []);
    },
    getLawData(idOrNum, opts) {
      return apiGet('/law_data/' + encodeURIComponent(idOrNum), opts || {});
    }
  };

  // ---------------------------------------------------------------------
  // 漢数字 ⇔ 算用数字
  // ---------------------------------------------------------------------
  const KANJI_DIGITS = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const KANJI_UNITS = { '十': 10, '百': 100, '千': 1000 };

  function kanjiToInt(str) {
    if (!str) return null;
    if (/^[0-9]+$/.test(str)) return parseInt(str, 10);
    let section = 0;
    let num = 0;
    let matched = false;
    for (const ch of str) {
      if (ch in KANJI_DIGITS) {
        num = KANJI_DIGITS[ch];
        matched = true;
      } else if (ch in KANJI_UNITS) {
        section += (num || 1) * KANJI_UNITS[ch];
        num = 0;
        matched = true;
      }
    }
    if (!matched) return null;
    return section + num;
  }

  function intToKanji(n) {
    if (!Number.isInteger(n) || n <= 0) return null;
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const units = ['', '十', '百', '千'];
    const str = String(n);
    const len = str.length;
    let out = '';
    for (let i = 0; i < len; i++) {
      const d = parseInt(str[i], 10);
      const unitIdx = len - i - 1;
      if (d === 0) continue;
      out += (d === 1 && unitIdx > 0) ? units[unitIdx] : digits[d] + units[unitIdx];
    }
    return out || null;
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ---------------------------------------------------------------------
  // 引用・委任文言スキャナー
  // ---------------------------------------------------------------------
  const KANJI_NUM = '[〇一二三四五六七八九十百千0-9]+';
  const ERA = '(?:明治|大正|昭和|平成|令和)';
  const LAW_SUFFIX = '(?:法律|規則|規程|条例|政令|省令|府令|令|法)';

  // 法令名の前方一致は「除外文字以外なら何でも良い」ため、句読点を挟まない
  // 接続詞・副詞（「専ら」「又は」等）まで法令名として巻き込んでしまうことがある。
  // 既知の語を前方から反復的に取り除くことで緩和する(完全な解決ではない)。
  const CITATION_NOISE_PREFIXES = [
    '又は', '若しくは', '及び', '並びに', 'かつ', 'ただし', '但し', 'なお',
    '専ら', 'もっぱら', '主として', '特に', '直接に', '直接', '別に', '別途', '同じく', '同様に'
  ];
  // 「〜によって認識することができない方法により道路運送車両法（…）」のように、
  // 前方一致のブラックリストでは削り切れない長い修飾句が挟まることがある。
  // これらの語で終わる節は法令名の一部になり得ないため、直近の出現位置より後ろだけを
  // 法令名候補として採用する。
  const CITATION_BOUNDARY_MARKERS = [
    'により', 'によって', 'によつて', 'に基づき', 'に基づいて',
    'に従い', 'に従って', 'に応じて', 'に関し', 'に関して'
  ];
  const SELF_REFERENCE_RE = /^(?:この|同|当該|前記|前項|前条|前号|次項|次条)/;
  const BARE_SUFFIX_ONLY_RE = new RegExp('^' + LAW_SUFFIX + '$');

  function cleanCitationName(raw) {
    let name = raw;
    let bestCut = -1;
    CITATION_BOUNDARY_MARKERS.forEach((marker) => {
      const idx = name.lastIndexOf(marker);
      if (idx !== -1) bestCut = Math.max(bestCut, idx + marker.length);
    });
    if (bestCut > 0 && bestCut < name.length) name = name.slice(bestCut);

    let changed = true;
    while (changed && name.length > 2) {
      changed = false;
      for (const w of CITATION_NOISE_PREFIXES) {
        if (name.startsWith(w) && name.length > w.length) {
          name = name.slice(w.length);
          changed = true;
          break;
        }
      }
    }
    return name;
  }

  function isPlausibleLawName(name) {
    if (!name || name.length < 2) return false;
    if (SELF_REFERENCE_RE.test(name)) return false;
    if (BARE_SUFFIX_ONLY_RE.test(name)) return false;
    return true;
  }

  // 施行令・施行規則は、本文中で「以下「法」という。」等の明示的な定義をせずに、
  // 題名から自明な慣習として親法令を「法」と略すことが多い(例:「道路交通法施行令」
  // の場合、本文の「法」は常に「道路交通法」を指す)。この慣習をタイトルから
  // 機械的に導出し、明示定義が無い場合のフォールバックとしてabbrevMapに補う。
  const CONVENTIONAL_ABBREV_SUFFIXES = ['施行令', '施行規則'];
  function deriveConventionalAbbrevs(lawTitle) {
    const map = {};
    if (!lawTitle) return map;
    for (const suffix of CONVENTIONAL_ABBREV_SUFFIXES) {
      if (lawTitle.length > suffix.length && lawTitle.endsWith(suffix)) {
        map['法'] = { lawName: lawTitle.slice(0, -suffix.length), lawNum: null };
        break;
      }
    }
    return map;
  }
  // グループ: 1=法令名 2=法令番号(分岐A) 3=略称(分岐A,任意) 4=略称(分岐B) 5=第N条(任意) 6=第N項(任意)
  // 分岐A:「道路法（昭和二十七年法律第百八十号。以下「法」という。）」のように
  //        法令番号と略称定義が同じ括弧内に同居するケース。
  // 分岐B:「道路法（以下「法」という。）」のように、法令番号は別の箇所で
  //        既出済みで、この括弧内では略称定義のみ行うケース。
  const EXPLICIT_RE = new RegExp(
    '([^\\s、。，,．.（）「」『』〈〉]{2,50})' +
    '（(?:' +
    '(' + ERA + KANJI_NUM + '年[^（）]{0,20}?第' + KANJI_NUM + '号)(?:[^（）]{0,4}?以下「([^」]{1,12})」という。?)?' +
    '|' +
    '以下「([^」]{1,12})」という。?' +
    ')[^（）]{0,20}?）' +
    '(第' + KANJI_NUM + '条)?' +
    '(の' + KANJI_NUM + ')?' +
    '(第' + KANJI_NUM + '項)?' +
    '(第' + KANJI_NUM + '号)?',
    'g'
  );
  // 委任文言の「◯◯省令」等は列挙で厳密にマッチさせる。可変長の前方一致([^…]{0,N}?)は
  // 正規表現の最左マッチの性質上、直前の無関係な語句(「その他」等)まで巻き込むことがあるため。
  const MINISTRY_ORDINANCES = [
    '内閣府令', '総務省令', '法務省令', '外務省令', '財務省令', '文部科学省令',
    '厚生労働省令', '農林水産省令', '経済産業省令', '国土交通省令', '環境省令', '防衛省令',
    '公正取引委員会規則', '国家公安委員会規則', '個人情報保護委員会規則', 'カジノ管理委員会規則',
    '金融庁令', '消費者庁令', 'デジタル庁令', '復興庁令', 'こども家庭庁令',
    '原子力規制委員会規則', '公害等調整委員会規則', '中央労働委員会規則', '運輸安全委員会規則'
  ];
  const DELEGATE_RE = new RegExp(
    '(' + MINISTRY_ORDINANCES.map(escapeRegex).join('|') + '|政令|規則|条例|省令|府令)で定める',
    'g'
  );

  // 括弧書きの法令番号を伴わない、素の「◯◯法第五条」のような引用。
  // 法令番号がその場に無いため、クリック時に法令名でAPI検索して解決する。
  // 実務上、番号を伴わない引用はほぼ例外なく漢字のみの伝統的な法令名（道路法、
  // 道路交通法等）であるため、法令名部分を漢字限定にする。これにより「〜行為が
  // 道路交通法第七十七条」のように、読点を挟まない長い節の平仮名（が・に・を等）
  // まで巻き込む過剰マッチを構造的に防げる。
  const KANJI_ONLY = '[\\u4E00-\\u9FFF々〇]';
  const BARE_CITATION_RE = new RegExp(
    '(' + KANJI_ONLY + '{2,20}?' + LAW_SUFFIX + ')' +
    '第(' + KANJI_NUM + ')条' +
    '(?:の(' + KANJI_NUM + '))?' +
    '(第' + KANJI_NUM + '項)?' +
    '(第' + KANJI_NUM + '号)?',
    'g'
  );

  function collectMatches(text, ctx) {
    const abbrevMap = (ctx && ctx.abbrevMap) || {};
    const lawNumByName = (ctx && ctx.lawNumByName) || {};
    const matches = [];
    let m;

    EXPLICIT_RE.lastIndex = 0;
    while ((m = EXPLICIT_RE.exec(text))) {
      const rawName = m[1];
      const lawName = cleanCitationName(rawName);
      if (!isPlausibleLawName(lawName)) continue;
      const noiseLen = rawName.length - lawName.length; // 前方から削った雑音語の長さ
      const lawNumHere = m[2] || null;
      const abbrev = m[3] || m[4] || null;
      if (lawNumHere) lawNumByName[lawName] = lawNumHere;
      // 「道路法（以下「法」という。）」のように、この場では法令番号を
      // 再掲していない場合は、同一文書内で既出の番号を引き継ぐ。
      const resolvedLawNum = lawNumHere || lawNumByName[lawName] || null;
      if (abbrev && resolvedLawNum) abbrevMap[abbrev] = { lawName, lawNum: resolvedLawNum };
      if (resolvedLawNum) {
        matches.push({
          start: m.index + noiseLen,
          end: m.index + m[0].length,
          type: 'explicit',
          text: m[0].slice(noiseLen),
          lawName,
          lawNum: resolvedLawNum,
          articleKanji: m[5] ? m[5].replace(/^第|条$/g, '') : null,
          articleSubKanji: m[6] ? m[6].replace(/^の/, '') : null,
          paragraphKanji: m[7] ? m[7].replace(/^第|項$/g, '') : null,
          itemKanji: m[8] ? m[8].replace(/^第|号$/g, '') : null
        });
      }
    }

    // 括弧書きの法令番号を伴わない素の引用（例:「道路運送車両法第二条第二項」）。
    // 法令番号が無くクリック時に名称検索で解決するため、lawNumは付けない。
    BARE_CITATION_RE.lastIndex = 0;
    while ((m = BARE_CITATION_RE.exec(text))) {
      const rawName = m[1];
      const lawName = cleanCitationName(rawName);
      if (!isPlausibleLawName(lawName)) continue;
      const noiseLen = rawName.length - lawName.length;
      matches.push({
        start: m.index + noiseLen,
        end: m.index + m[0].length,
        type: 'explicit',
        text: m[0].slice(noiseLen),
        lawName,
        lawNum: null,
        articleKanji: m[2] || null,
        articleSubKanji: m[3] || null,
        paragraphKanji: m[4] ? m[4].replace(/^第|項$/g, '') : null,
        itemKanji: m[5] ? m[5].replace(/^第|号$/g, '') : null
      });
    }

    DELEGATE_RE.lastIndex = 0;
    while ((m = DELEGATE_RE.exec(text))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        type: 'delegate',
        text: m[0],
        ministryPhrase: m[1] || ''
      });
    }

    // 文書内で既に定義済みの略称（例:「法」「令」）を使った引用も同じ扱いでリンク化する。
    Object.keys(abbrevMap).forEach((abbrev) => {
      const info = abbrevMap[abbrev];
      const re = new RegExp(
        escapeRegex(abbrev) + '(第' + KANJI_NUM + '条)' +
        '(?:の(' + KANJI_NUM + '))?' +
        '(第' + KANJI_NUM + '項)?' +
        '(第' + KANJI_NUM + '号)?',
        'g'
      );
      let am;
      while ((am = re.exec(text))) {
        matches.push({
          start: am.index,
          end: am.index + am[0].length,
          type: 'explicit',
          text: am[0],
          lawName: info.lawName,
          lawNum: info.lawNum,
          articleKanji: am[1].replace(/^第|条$/g, ''),
          articleSubKanji: am[2] || null,
          paragraphKanji: am[3] ? am[3].replace(/^第|項$/g, '') : null,
          itemKanji: am[4] ? am[4].replace(/^第|号$/g, '') : null
        });
      }
    });

    const withContinuations = expandParagraphContinuations(matches, text);

    withContinuations.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const result = [];
    let lastEnd = -1;
    withContinuations.forEach((m2) => {
      if (m2.start < lastEnd) return; // 重複区間は先勝ち
      result.push(m2);
      lastEnd = m2.end;
    });
    return result;
  }

  // 「第二十条第一項及び第二項」「道路法（…）第三十条第一項及び第二項」のように、
  // 条番号を伴わない「第◯項」が列挙で続く場合、直前の引用から項番号だけを
  // 引き継いだ追加リンクを作る。
  const PARA_CONTINUATION_RE = new RegExp('^(?:、|及び|又は|並びに|若しくは)第(' + KANJI_NUM + ')項');
  function expandParagraphContinuations(matches, text) {
    const extra = [];
    matches.forEach((m) => {
      if (m.type !== 'explicit' || !m.paragraphKanji) return;
      let pos = m.end;
      while (true) {
        const rest = text.slice(pos);
        const cm = PARA_CONTINUATION_RE.exec(rest);
        if (!cm) break;
        const literalOffset = cm[0].indexOf('第');
        const literalText = cm[0].slice(literalOffset);
        extra.push(Object.assign({}, m, {
          start: pos + literalOffset,
          end: pos + cm[0].length,
          text: literalText,
          paragraphKanji: cm[1],
          itemKanji: null
        }));
        pos += cm[0].length;
      }
    });
    return matches.concat(extra);
  }

  function scanSentenceText(text, ctx) {
    const frag = document.createDocumentFragment();
    const matches = collectMatches(text, ctx);
    let pos = 0;
    matches.forEach((m) => {
      if (m.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, m.start)));
      if (m.type === 'explicit') {
        const a = document.createElement('a');
        a.className = 'ref-explicit';
        a.href = '#';
        a.textContent = m.text;
        if (m.lawNum) a.dataset.lawNum = m.lawNum;
        a.dataset.lawName = m.lawName;
        const artNum = kanjiToInt(m.articleKanji);
        const artSubNum = kanjiToInt(m.articleSubKanji);
        const paraNum = kanjiToInt(m.paragraphKanji);
        const itemNum = kanjiToInt(m.itemKanji);
        if (artNum) a.dataset.article = String(artNum);
        if (artSubNum) a.dataset.articleSub = String(artSubNum);
        if (paraNum) a.dataset.paragraph = String(paraNum);
        if (itemNum) a.dataset.item = String(itemNum);
        frag.appendChild(a);
      } else {
        const span = document.createElement('span');
        span.className = 'ref-delegate';
        span.textContent = m.text;
        span.dataset.baseLawTitle = (ctx && ctx.lawTitle) || '';
        span.dataset.ministryPhrase = m.ministryPhrase;
        span.dataset.articleNum = (ctx && ctx.currentArticleNum) || '';
        span.dataset.paragraphNum = (ctx && ctx.currentParagraphNum) || '';
        frag.appendChild(span);
      }
      pos = m.end;
    });
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    return frag;
  }

  // ---------------------------------------------------------------------
  // 法令XML(JSON木構造)レンダラー ─ 章・条はツリー(details)表示
  // ---------------------------------------------------------------------
  function textOf(node) {
    let out = '';
    (function walk(n) {
      if (typeof n === 'string') { out += n; return; }
      if (n && n.children) n.children.forEach(walk);
    })(node);
    return out;
  }

  function renderChildren(node, ctx) {
    const frag = document.createDocumentFragment();
    (node.children || []).forEach((child) => {
      const el = renderNode(child, ctx);
      if (el) frag.appendChild(el);
    });
    return frag;
  }

  function renderNode(node, ctx) {
    if (typeof node === 'string') return scanSentenceText(node, ctx);
    if (!node || !node.tag) return null;
    const handler = TAG_HANDLERS[node.tag];
    if (handler === null) return null; // 明示的に非表示にするタグ
    return (handler || defaultHandler)(node, ctx);
  }

  function defaultHandler(node, ctx) {
    const div = document.createElement('div');
    div.className = 'genericNode gn-' + node.tag;
    div.appendChild(renderChildren(node, ctx));
    return div;
  }

  // 章・節などの「見出し + 開閉可能な中身」を持つコンテナ (既定で開いた状態)
  function containerWithTitle(headingTag, headingClass, opts) {
    opts = opts || {};
    return function (node, ctx) {
      const details = document.createElement('details');
      details.className = 'treeNode';
      details.open = true;
      if (opts.idPrefix && node.attr && node.attr.Num) details.id = opts.idPrefix + node.attr.Num;
      const summary = document.createElement('summary');
      summary.className = headingClass;
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'treeBody';
      let summarySet = false;
      (node.children || []).forEach((child) => {
        if (!summarySet && child.tag === headingTag) {
          summary.appendChild(renderChildren(child, ctx));
          summarySet = true;
        } else {
          const el = renderNode(child, ctx);
          if (el) bodyDiv.appendChild(el);
        }
      });
      details.appendChild(summary);
      details.appendChild(bodyDiv);
      return details;
    };
  }

  function itemLikeHandler(cls) {
    return function (node, ctx) {
      const div = document.createElement('div');
      div.className = cls;
      if (node.attr && node.attr.Num) div.dataset.num = node.attr.Num;
      div.appendChild(renderChildren(node, ctx));
      return div;
    };
  }

  const TAG_HANDLERS = {
    TOC: null,
    LawTitle: null,

    Part: containerWithTitle('PartTitle', 'chapterTitle'),
    Chapter: containerWithTitle('ChapterTitle', 'chapterTitle', { idPrefix: 'chap_' }),
    Section: containerWithTitle('SectionTitle', 'sectionTitle'),
    Subsection: containerWithTitle('SubsectionTitle', 'sectionTitle'),
    Division: containerWithTitle('DivisionTitle', 'sectionTitle'),

    // 条は既定で閉じた状態のツリーノード。クリック(summary)で開く。
    Article(node, ctx) {
      const details = document.createElement('details');
      details.className = 'article';
      if (node.attr && node.attr.Num) details.id = 'art_' + node.attr.Num;

      const prevArt = ctx.currentArticleNum;
      ctx.currentArticleNum = node.attr && node.attr.Num;

      const summary = document.createElement('summary');
      summary.className = 'articleHead';
      (node.children || []).forEach((child) => {
        if (child.tag === 'ArticleTitle') {
          const s = document.createElement('span');
          s.appendChild(renderChildren(child, ctx));
          summary.appendChild(s);
        } else if (child.tag === 'ArticleCaption') {
          const s = document.createElement('span');
          s.className = 'articleCaption';
          s.appendChild(renderChildren(child, ctx));
          summary.appendChild(s);
        }
      });
      details.appendChild(summary);

      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'treeBody';
      (node.children || []).forEach((child) => {
        if (child.tag === 'ArticleTitle' || child.tag === 'ArticleCaption') return;
        const el = renderNode(child, ctx);
        if (el) bodyDiv.appendChild(el);
      });
      details.appendChild(bodyDiv);

      ctx.currentArticleNum = prevArt;
      return details;
    },

    Paragraph(node, ctx) {
      const div = document.createElement('div');
      div.className = 'paragraph';
      if (node.attr && node.attr.Num) div.dataset.num = node.attr.Num;
      const prevPara = ctx.currentParagraphNum;
      ctx.currentParagraphNum = node.attr && node.attr.Num;
      div.appendChild(renderChildren(node, ctx));
      ctx.currentParagraphNum = prevPara;
      return div;
    },

    ParagraphNum(node, ctx) {
      const span = document.createElement('span');
      span.className = 'paragraphNum';
      span.appendChild(renderChildren(node, ctx));
      return span;
    },

    Item: itemLikeHandler('item'),
    // 号/イロハの本文が「説明」「速度」等の複数列(Column)に分かれている場合、
    // 何もしないと(genericNodeのdisplay:contentsで)地続きに見えてしまう。
    // 階層が異なる情報を横並びにすると読みにくいため、イロハ等と同様に
    // 行を分けたツリー表示にする。
    Column: itemLikeHandler('itemColumn'),
    ItemTitle(node, ctx) {
      const span = document.createElement('span');
      span.className = 'itemTitle';
      span.appendChild(renderChildren(node, ctx));
      return span;
    },

    // 附則も開閉可能なツリーノードとして扱う(既定は開)
    SupplProvision(node, ctx) {
      const details = document.createElement('details');
      details.className = 'supplProvision';
      details.open = true;
      const summary = document.createElement('summary');
      summary.className = 'suppLabel';
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'treeBody';
      let summarySet = false;
      (node.children || []).forEach((child) => {
        if (!summarySet && child.tag === 'SupplProvisionLabel') {
          summary.appendChild(renderChildren(child, ctx));
          summarySet = true;
        } else {
          const el = renderNode(child, ctx);
          if (el) bodyDiv.appendChild(el);
        }
      });
      if (!summarySet) summary.textContent = '附則';
      details.appendChild(summary);
      details.appendChild(bodyDiv);
      return details;
    },
    SupplProvisionLabel(node, ctx) {
      const div = document.createElement('div');
      div.className = 'suppLabel';
      div.appendChild(renderChildren(node, ctx));
      return div;
    },

    Table(node, ctx) {
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
          td.appendChild(renderChildren(col, ctx));
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      return table;
    }
  };
  for (let i = 1; i <= 10; i++) {
    TAG_HANDLERS['Subitem' + i] = itemLikeHandler('subitem');
    TAG_HANDLERS['Subitem' + i + 'Title'] = TAG_HANDLERS.ItemTitle;
  }

  // ---------------------------------------------------------------------
  // 目次(TOC)の構築 (JSON木を直接走査。XMLのTOCタグは使わず自前生成)
  // ---------------------------------------------------------------------
  function collectToc(root) {
    const toc = [];
    let currentChapter = null;

    (function walk(node) {
      if (!node || typeof node === 'string') return;
      if (node.tag === 'Chapter') {
        const titleNode = (node.children || []).find((c) => c.tag === 'ChapterTitle');
        const chapterEntry = {
          type: 'chapter',
          num: node.attr && node.attr.Num,
          title: titleNode ? textOf(titleNode) : '',
          articles: []
        };
        toc.push(chapterEntry);
        const prevChapter = currentChapter;
        currentChapter = chapterEntry;
        (node.children || []).forEach(walk);
        currentChapter = prevChapter;
        return;
      }
      if (node.tag === 'Article') {
        const titleNode = (node.children || []).find((c) => c.tag === 'ArticleTitle');
        const entry = {
          type: 'article',
          num: node.attr && node.attr.Num,
          title: titleNode ? textOf(titleNode) : ('第' + (node.attr && node.attr.Num) + '条')
        };
        if (currentChapter) currentChapter.articles.push(entry);
        else toc.push(entry);
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
        li.appendChild(tocLink('chap_' + entry.num, entry.title));
        const sub = document.createElement('ol');
        sub.style.listStyle = 'none';
        sub.style.margin = '0';
        sub.style.padding = '0';
        entry.articles.forEach((a) => {
          const subLi = document.createElement('li');
          subLi.className = 'tocArticle';
          subLi.appendChild(tocLink('art_' + a.num, a.title));
          sub.appendChild(subLi);
        });
        li.appendChild(sub);
        ol.appendChild(li);
      } else {
        const li = document.createElement('li');
        li.className = 'tocArticle';
        li.appendChild(tocLink('art_' + entry.num, entry.title));
        ol.appendChild(li);
      }
    });
  }

  function tocLink(id, label) {
    const a = document.createElement('a');
    a.href = '#' + id;
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToId(id, { highlight: false });
    });
    return a;
  }

  // ジャンプ先の <details> と、その祖先の <details> を全て開いてから表示する
  function openAncestorDetails(el) {
    let node = el;
    while (node) {
      if (node.tagName === 'DETAILS') node.open = true;
      node = node.parentElement;
    }
  }

  function scrollToId(id, opts, root) {
    const scope = root || document;
    const el = scope.getElementById ? scope.getElementById(id) : scope.querySelector('#' + id);
    if (!el) return false;
    openAncestorDetails(el);
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (opts && opts.highlight) {
      el.classList.remove('refHighlight');
      void el.offsetWidth; // reflow to restart animation
      el.classList.add('refHighlight');
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // アプリ状態・メイン表示
  // ---------------------------------------------------------------------
  const state = {
    currentLaw: null,
    refStack: [],
    refCurrentEntry: null
  };

  function showError(container, message) {
    container.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'refError';
    p.textContent = message;
    container.appendChild(p);
  }

  function setHash(lawId, article) {
    let h = 'lawId=' + encodeURIComponent(lawId);
    if (article) h += '&art=' + encodeURIComponent(article);
    history.replaceState(null, '', '#' + h);
  }

  async function loadLawIntoMain(idOrNum, opts) {
    opts = opts || {};
    const loading = document.getElementById('contentLoading');
    const contentBody = document.getElementById('contentBody');
    loading.hidden = false;
    try {
      const data = await EgovApi.getLawData(idOrNum, {});
      const info = data.revision_info || {};
      const lawId = (data.law_info && data.law_info.law_id) || idOrNum;
      state.currentLaw = {
        lawId,
        lawTitle: info.law_title,
        lawNum: info.law_num,
        fullText: data.law_full_text
      };
      document.getElementById('lawTitleDisplay').textContent = info.law_title || '(法令名不明)';
      document.getElementById('lawNumDisplay').textContent = info.law_num || '';

      const ctx = { lawTitle: info.law_title, lawId, abbrevMap: deriveConventionalAbbrevs(info.law_title), lawNumByName: {} };
      contentBody.innerHTML = '';
      contentBody.appendChild(renderNode(data.law_full_text, ctx));
      renderToc(collectToc(data.law_full_text));

      const debugLink = document.getElementById('parserDebugLink');
      if (debugLink) debugLink.href = 'parserDebug.html#lawId=' + encodeURIComponent(lawId);

      setHash(lawId, opts.article);

      if (opts.article) {
        requestAnimationFrame(() => scrollToId('art_' + opts.article, { highlight: true }));
      } else {
        contentBody.scrollTop = 0;
      }
    } catch (err) {
      showError(contentBody, '法令の読み込みに失敗しました: ' + err.message);
    } finally {
      loading.hidden = true;
    }
  }

  // ---------------------------------------------------------------------
  // 委任先の後方参照解析
  // 「(略称)第N条(第M項)の◯◯令で定める…は、」のような、被参照法令側の
  // 逆参照文言を検索し、委任元の条項に対応する具体的な条を特定する。
  // ---------------------------------------------------------------------
  function extractAbbrevForLaw(fullTextTree, baseLawTitle) {
    const text = textOf(fullTextTree);
    const re = new RegExp(
      escapeRegex(baseLawTitle) + '（' +
      '(?:' + ERA + KANJI_NUM + '年[^（）]{0,20}?第' + KANJI_NUM + '号)?' +
      '[^（）]{0,4}?以下「([^」]{1,12})」という。?[^（）]{0,20}?）'
    );
    const m = re.exec(text);
    return m ? m[1] : null;
  }

  function collectArticleNodes(root) {
    const list = [];
    (function walk(node) {
      if (!node || typeof node === 'string') return;
      if (node.tag === 'Article') { list.push(node); return; }
      (node.children || []).forEach(walk);
    })(root);
    return list;
  }

  async function findBackReference(lawIdOrNum, baseLawTitle, articleNum, paragraphNum, ministryPhrase) {
    const artKanji = intToKanji(parseInt(articleNum, 10));
    if (!artKanji) return null;

    let data;
    try {
      data = await EgovApi.getLawData(lawIdOrNum, {});
    } catch (e) {
      return null;
    }

    const abbrev = extractAbbrevForLaw(data.law_full_text, baseLawTitle);
    const prefixes = [];
    if (abbrev) prefixes.push(abbrev);
    prefixes.push(baseLawTitle);

    const articleNodes = collectArticleNodes(data.law_full_text);
    const targetPara = paragraphNum ? parseInt(paragraphNum, 10) : null;

    const suffixOptions = [];
    if (ministryPhrase) suffixOptions.push(escapeRegex(ministryPhrase) + 'で定める');
    suffixOptions.push('(?:省令|府令|規則|政令|条例)で定める');

    for (const suffix of suffixOptions) {
      for (const prefix of prefixes) {
        const re = new RegExp(
          escapeRegex(prefix) + '第' + artKanji + '条' +
          '(第(' + KANJI_NUM + ')項)?' +
          '[^。]{0,40}?' + suffix,
          'g'
        );
        for (const artNode of articleNodes) {
          const text = textOf(artNode);
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(text))) {
            const foundPara = m[2] ? kanjiToInt(m[2]) : null;
            if (!targetPara || !foundPara || foundPara === targetPara) {
              return { articleNum: artNode.attr && artNode.attr.Num, lawId: data.law_info && data.law_info.law_id, lawTitle: (data.revision_info || {}).law_title };
            }
          }
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // 参照パネル(引用ジャンプ／委任先候補)
  // ---------------------------------------------------------------------
  function candidateScore(title) {
    let score = 0;
    if (/施行令$/.test(title)) score += 3;
    if (/施行規則$/.test(title)) score += 3;
    if (/施行細則$/.test(title)) score += 2;
    if (/規則$/.test(title)) score += 1;
    return score;
  }

  async function showRefEntry(entry, opts) {
    opts = opts || {};
    const panel = document.getElementById('refPanel');
    const backBtn = document.getElementById('refPanelBack');
    const titleEl = document.getElementById('refPanelTitle');
    const body = document.getElementById('refPanelBody');

    panel.hidden = false;
    if (opts.pushHistory !== false && state.refCurrentEntry) {
      state.refStack.push(state.refCurrentEntry);
    }
    backBtn.hidden = state.refStack.length === 0;
    state.refCurrentEntry = entry;
    titleEl.textContent = entry.title || '';
    body.innerHTML = '読み込み中…';

    try {
      if (entry.kind === 'law') {
        const reqOpts = {};
        if (entry.articleNum) {
          reqOpts.elm = 'MainProvision-Article_' + entry.articleNum + (entry.articleSub ? '_' + entry.articleSub : '');
        }
        const data = await EgovApi.getLawData(entry.idOrNum, reqOpts);
        const info = data.revision_info || {};
        entry.resolvedLawId = (data.law_info && data.law_info.law_id) || entry.idOrNum;
        entry.resolvedTitle = info.law_title;
        titleEl.textContent = info.law_title + (entry.articleNum ? ' 第' + entry.articleNum + '条' + (entry.articleSub ? 'の' + entry.articleSub : '') : '');
        body.innerHTML = '';

        if (entry.autoResolved) {
          const hint = document.createElement('div');
          hint.className = 'refHint';
          hint.textContent = '本文の記載内容から委任先の条文を自動推定しました。';
          if (entry.otherCandidates && entry.otherCandidates.length) {
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = '違う場合: 他の候補を見る';
            link.style.marginLeft = '6px';
            const others = entry.otherCandidates;
            link.addEventListener('click', (e) => {
              e.preventDefault();
              showRefEntry({ kind: 'candidates', candidates: others, title: '委任先の候補' }, { pushHistory: false });
            });
            hint.appendChild(link);
          }
          body.appendChild(hint);
        }

        const ctx = { lawTitle: info.law_title, lawId: entry.resolvedLawId, abbrevMap: deriveConventionalAbbrevs(info.law_title), lawNumByName: {} };
        const rendered = renderNode(data.law_full_text, ctx);
        body.appendChild(rendered);
        if (rendered && rendered.tagName === 'DETAILS') rendered.open = true;

        if (entry.paragraphNum || entry.itemNum) {
          requestAnimationFrame(() => {
            let target = entry.paragraphNum
              ? body.querySelector('.paragraph[data-num="' + entry.paragraphNum + '"]')
              : null;
            if (entry.itemNum) {
              const itemTarget = (target || body).querySelector('.item[data-num="' + entry.itemNum + '"]');
              if (itemTarget) target = itemTarget;
            }
            if (target) {
              openAncestorDetails(target);
              target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              target.classList.remove('refHighlight');
              void target.offsetWidth;
              target.classList.add('refHighlight');
            }
          });
        }
      } else if (entry.kind === 'candidates') {
        body.innerHTML = '';
        const hint = document.createElement('div');
        hint.className = 'refHint';
        hint.textContent = '本文には委任先の法令が明記されていないため、名称から候補を検索しました。正しい法令とは限りません。';
        body.appendChild(hint);
        if (!entry.candidates.length) {
          const p = document.createElement('p');
          p.textContent = '候補が見つかりませんでした。';
          body.appendChild(p);
        } else {
          const ul = document.createElement('ul');
          ul.className = 'refCandidateList';
          entry.candidates.forEach((c) => {
            const li = document.createElement('li');
            const t = document.createElement('div');
            t.className = 'refCandidateTitle';
            t.textContent = c.revision_info.law_title;
            const m = document.createElement('div');
            m.className = 'refCandidateMeta';
            m.textContent = (c.law_info.law_num || '') + ' / ' + (c.law_info.law_type || '');
            li.appendChild(t);
            li.appendChild(m);
            li.addEventListener('click', () => {
              showRefEntry({ kind: 'law', idOrNum: c.law_info.law_id, title: c.revision_info.law_title });
            });
            ul.appendChild(li);
          });
          body.appendChild(ul);
        }
      }
    } catch (err) {
      showError(body, '取得に失敗しました: ' + err.message);
    }
  }

  async function resolveDelegateCandidates(spanEl) {
    const baseLawTitle = spanEl.dataset.baseLawTitle;
    const ministryPhrase = spanEl.dataset.ministryPhrase || '';
    const articleNum = spanEl.dataset.articleNum || '';
    const paragraphNum = spanEl.dataset.paragraphNum || '';

    const panel = document.getElementById('refPanel');
    const titleEl = document.getElementById('refPanelTitle');
    const body = document.getElementById('refPanelBody');
    panel.hidden = false;
    titleEl.textContent = '委任先を検索中…';
    body.innerHTML = '検索中…';

    try {
      const results = await EgovApi.searchLaws({
        law_title: baseLawTitle,
        law_type: ['CabinetOrder', 'MinisterialOrdinance', 'Rule'],
        limit: 30
      });
      const scored = results
        .map((r) => ({ r, score: candidateScore(r.revision_info.law_title) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.r);

      let resolved = null;
      if (articleNum) {
        const topCandidates = scored.slice(0, 5);
        for (const c of topCandidates) {
          const hit = await findBackReference(c.law_info.law_id, baseLawTitle, articleNum, paragraphNum, ministryPhrase);
          if (hit) { resolved = { candidate: c, hit }; break; }
        }
      }

      if (resolved) {
        await showRefEntry({
          kind: 'law',
          idOrNum: resolved.candidate.law_info.law_id,
          articleNum: resolved.hit.articleNum,
          title: resolved.candidate.revision_info.law_title,
          autoResolved: true,
          otherCandidates: scored.filter((c) => c !== resolved.candidate)
        }, { pushHistory: false });
      } else {
        await showRefEntry({ kind: 'candidates', candidates: scored, title: '委任先の候補' }, { pushHistory: false });
      }
    } catch (err) {
      showError(body, '検索に失敗しました: ' + err.message);
    }
  }

  function closeRefPanel() {
    document.getElementById('refPanel').hidden = true;
    state.refStack = [];
    state.refCurrentEntry = null;
  }

  // 抽出した法令名らしき文字列の末尾（法令名の末尾＝第N条の直前）を固定し、
  // 前方から1文字ずつ削りながら、実在する法令名と完全一致するものを探す。
  // 正規表現の前方境界の推定には限界があるため、最終的な正しさはAPIでの
  // 実在確認に委ねる。
  const MIN_LAW_NAME_LEN = 2;
  const MAX_TRIM_ATTEMPTS = 15;
  async function resolveLawByTrimmedName(rawName) {
    const candidates = [];
    for (let cut = 0; rawName.length - cut >= MIN_LAW_NAME_LEN && cut <= MAX_TRIM_ATTEMPTS; cut++) {
      candidates.push(rawName.slice(cut));
    }
    const searchResultsList = await Promise.all(
      candidates.map((c) => EgovApi.searchLaws({ law_title: c, limit: 10 }).catch(() => []))
    );
    for (let i = 0; i < candidates.length; i++) {
      const exact = searchResultsList[i].find((r) => r.revision_info.law_title === candidates[i]);
      if (exact) return exact;
    }
    // 完全一致が無ければ、最も削った(=最も短い)候補の部分一致結果にフォールバック
    const lastResults = searchResultsList[searchResultsList.length - 1];
    return (lastResults && lastResults[0]) || null;
  }

  // 括弧書きの法令番号を伴わない引用(BARE_CITATION_RE由来)は、クリック時に
  // 法令名でAPI検索してからジャンプする。
  async function resolveExplicitByName(a) {
    const lawName = a.dataset.lawName;
    const articleNum = a.dataset.article || null;
    const articleSub = a.dataset.articleSub || null;
    const paragraphNum = a.dataset.paragraph || null;
    const itemNum = a.dataset.item || null;
    const panel = document.getElementById('refPanel');
    const titleEl = document.getElementById('refPanelTitle');
    const body = document.getElementById('refPanelBody');
    panel.hidden = false;
    titleEl.textContent = lawName + ' を検索中…';
    body.innerHTML = '検索中…';
    try {
      const best = await resolveLawByTrimmedName(lawName);
      if (!best) {
        titleEl.textContent = lawName;
        showError(body, '「' + lawName + '」に該当する法令が見つかりませんでした。');
        return;
      }
      await showRefEntry({
        kind: 'law',
        idOrNum: best.law_info.law_id,
        articleNum,
        articleSub,
        paragraphNum,
        itemNum,
        title: best.revision_info.law_title
      });
    } catch (err) {
      showError(body, '検索に失敗しました: ' + err.message);
    }
  }

  function bindRefClicks(container) {
    container.addEventListener('click', (e) => {
      const a = e.target.closest('.ref-explicit');
      if (a) {
        e.preventDefault();
        if (a.dataset.lawNum) {
          showRefEntry({
            kind: 'law',
            idOrNum: a.dataset.lawNum,
            articleNum: a.dataset.article || null,
            articleSub: a.dataset.articleSub || null,
            paragraphNum: a.dataset.paragraph || null,
            itemNum: a.dataset.item || null,
            title: a.dataset.lawName
          });
        } else {
          resolveExplicitByName(a);
        }
        return;
      }
      const d = e.target.closest('.ref-delegate');
      if (d) {
        e.preventDefault();
        resolveDelegateCandidates(d);
      }
    });
  }

  // ---------------------------------------------------------------------
  // 検索ボックス
  // ---------------------------------------------------------------------
  function setupSearchBox() {
    const box = document.getElementById('searchBox');
    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    let debounceTimer = null;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (!q) {
        results.hidden = true;
        results.innerHTML = '';
        return;
      }
      debounceTimer = setTimeout(() => runSearch(q), 350);
    });

    async function runSearch(q) {
      results.hidden = false;
      results.innerHTML = '検索中…';
      try {
        const laws = await EgovApi.searchLaws({ law_title: q, limit: 20 });
        results.innerHTML = '';
        if (!laws.length) {
          const div = document.createElement('div');
          div.className = 'searchResultEmpty';
          div.textContent = '該当する法令が見つかりませんでした。';
          results.appendChild(div);
          return;
        }
        laws.forEach((l) => {
          const div = document.createElement('div');
          div.className = 'searchResultItem';
          const t = document.createElement('div');
          t.className = 'srTitle';
          t.textContent = l.revision_info.law_title;
          const m = document.createElement('div');
          m.className = 'srMeta';
          m.textContent = (l.law_info.law_num || '') + ' / ' + (l.law_info.law_type || '');
          div.appendChild(t);
          div.appendChild(m);
          div.addEventListener('click', () => {
            results.hidden = true;
            input.value = l.revision_info.law_title;
            loadLawIntoMain(l.law_info.law_id, {});
          });
          results.appendChild(div);
        });
      } catch (err) {
        results.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'searchResultError';
        div.textContent = '検索に失敗しました: ' + err.message;
        results.appendChild(div);
      }
    }

    document.addEventListener('click', (e) => {
      if (!box.contains(e.target)) results.hidden = true;
    });
  }

  // ---------------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------------
  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    const params = new URLSearchParams(h);
    return { lawId: params.get('lawId'), art: params.get('art') };
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupSearchBox();
    bindRefClicks(document.getElementById('contentBody'));
    bindRefClicks(document.getElementById('refPanelBody'));

    document.getElementById('refPanelBack').addEventListener('click', () => {
      const prev = state.refStack.pop();
      document.getElementById('refPanelBack').hidden = state.refStack.length === 0;
      if (prev) showRefEntry(prev, { pushHistory: false });
    });
    document.getElementById('refPanelClose').addEventListener('click', closeRefPanel);
    document.getElementById('refPanelPromote').addEventListener('click', () => {
      const entry = state.refCurrentEntry;
      if (!entry || entry.kind !== 'law') return;
      loadLawIntoMain(entry.idOrNum, { article: entry.articleNum });
      closeRefPanel();
    });

    const { lawId, art } = parseHash();
    if (lawId) loadLawIntoMain(decodeURIComponent(lawId), { article: art });
  });
})();
