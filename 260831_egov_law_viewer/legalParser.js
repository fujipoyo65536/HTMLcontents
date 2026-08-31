/**
 * legalParser.js
 * 日本法令の相互参照解析エンジン (DOM非依存)。
 * 入力: e-Gov法令API v2 の law_full_text JSON木 ({tag, attr, children} の再帰構造)
 * 出力: 座標付き文リスト・シンボルテーブル・参照トークン(解決トレース付き)・準用/読み替え一覧
 *
 * 参照: legal_reference_parsing_rules.md
 * ビューア(egovLawViewer.js)からは独立して動作し、DOM要素は一切生成しない。
 */
(function (global) {
  'use strict';

  // -----------------------------------------------------------------------
  // 0. 基本ユーティリティ
  // -----------------------------------------------------------------------
  const KANJI_DIGITS = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const KANJI_UNITS = { '十': 10, '百': 100, '千': 1000 };

  function kanjiToInt(str) {
    if (!str) return null;
    if (/^[0-9]+$/.test(str)) return parseInt(str, 10);
    let section = 0, num = 0, matched = false;
    for (const ch of str) {
      if (ch in KANJI_DIGITS) { num = KANJI_DIGITS[ch]; matched = true; }
      else if (ch in KANJI_UNITS) { section += (num || 1) * KANJI_UNITS[ch]; num = 0; matched = true; }
    }
    if (!matched) return null;
    return section + num;
  }

  function intToKanji(n) {
    if (!Number.isInteger(n) || n <= 0) return null;
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const units = ['', '十', '百', '千'];
    const str = String(n);
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const d = parseInt(str[i], 10);
      const unitIdx = str.length - i - 1;
      if (d === 0) continue;
      out += (d === 1 && unitIdx > 0) ? units[unitIdx] : digits[d] + units[unitIdx];
    }
    return out || null;
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function textOf(node) {
    let out = '';
    (function walk(n) {
      if (typeof n === 'string') { out += n; return; }
      if (n && n.children) n.children.forEach(walk);
    })(node);
    return out;
  }

  // -----------------------------------------------------------------------
  // 1. 座標(coordinate)モデル (§0)
  // -----------------------------------------------------------------------
  function emptyCoord() {
    return {
      isSupplProvision: false,
      chapterNum: null,
      sectionNum: null,
      articleNum: null,
      articleSub: null,
      paragraphNum: null,
      itemNum: null,
      itemSub: null,
      subPath: [] // Subitem1..10 の番号列(表示用、解決アルゴリズムでは未使用)
    };
  }

  function coordKey(c) {
    return [
      c.isSupplProvision ? 'S' : 'M',
      c.articleNum || '', c.articleSub || '',
      c.paragraphNum || '',
      c.itemNum || '', c.itemSub || ''
    ].join(':');
  }

  function articleKey(c) {
    return (c.isSupplProvision ? 'S' : 'M') + ':' + (c.articleNum || '') + '_' + (c.articleSub || '');
  }

  function describeCoord(c) {
    if (!c) return '(不明)';
    let s = c.isSupplProvision ? '附則' : '';
    if (!c.articleNum && c.chapterNum) {
      s += '第' + (intToKanji(parseInt(c.chapterNum, 10)) || c.chapterNum) + '章';
    }
    if (c.articleNum) {
      const a = intToKanji(parseInt(c.articleNum, 10));
      s += '第' + (a || c.articleNum) + '条' + (c.articleSub ? 'の' + (intToKanji(parseInt(c.articleSub, 10)) || c.articleSub) : '');
    }
    if (c.paragraphNum) s += '第' + c.paragraphNum + '項';
    if (c.itemNum) {
      const i = intToKanji(parseInt(c.itemNum, 10));
      s += '第' + (i || c.itemNum) + '号' + (c.itemSub ? 'の' + (intToKanji(parseInt(c.itemSub, 10)) || c.itemSub) : '');
    }
    return s || (c.isSupplProvision ? '附則冒頭' : '法令冒頭');
  }

  // -----------------------------------------------------------------------
  // 2. e-Gov JSON木 → フラットな文リスト
  // -----------------------------------------------------------------------
  const LEAF_TEXT_TAGS = new Set([
    'Sentence', 'ArticleCaption', 'ArticleTitle', 'ChapterTitle', 'SectionTitle',
    'SubsectionTitle', 'DivisionTitle', 'PartTitle', 'SupplProvisionLabel', 'ItemTitle'
  ]);
  for (let i = 1; i <= 10; i++) LEAF_TEXT_TAGS.add('Subitem' + i + 'Title');

  function splitNum(numStr) {
    if (!numStr) return [null, null];
    const parts = String(numStr).split('_');
    return [parts[0], parts[1] || null];
  }

  function flattenToSentenceNodes(root) {
    const nodes = [];
    let ctx = emptyCoord();
    let seq = 0;

    function withCtx(overrides, fn) {
      const saved = ctx;
      ctx = Object.assign({}, ctx, overrides);
      fn();
      ctx = saved;
    }

    function walk(node) {
      if (!node || typeof node === 'string') return;
      if (LEAF_TEXT_TAGS.has(node.tag)) {
        const text = textOf(node);
        if (text) nodes.push({ seq: seq++, coord: ctx, tag: node.tag, text });
        return;
      }
      switch (node.tag) {
        case 'TOC':
          // 目次内にも ChapterTitle 等の見出しタグが再掲されるが、これは本文ではなく
          // 座標(条・項)を持たないため、ここで完全にスキップする。
          // (ビューア側レンダラのTOCスキップと歩調を合わせないと、以降の文の
          //  座標カーソルがずれてしまう)
          return;
        case 'SupplProvision':
          withCtx({ isSupplProvision: true, chapterNum: null, sectionNum: null, articleNum: null, articleSub: null, paragraphNum: null, itemNum: null, itemSub: null }, () => {
            (node.children || []).forEach(walk);
          });
          return;
        case 'Chapter': {
          const [c] = splitNum(node.attr && node.attr.Num);
          withCtx({ chapterNum: c }, () => (node.children || []).forEach(walk));
          return;
        }
        case 'Section': {
          const [s] = splitNum(node.attr && node.attr.Num);
          withCtx({ sectionNum: s }, () => (node.children || []).forEach(walk));
          return;
        }
        case 'Article': {
          const [a, asub] = splitNum(node.attr && node.attr.Num);
          withCtx({ articleNum: a, articleSub: asub, paragraphNum: null, itemNum: null, itemSub: null }, () => {
            (node.children || []).forEach(walk);
          });
          return;
        }
        case 'Paragraph': {
          const pNum = (node.attr && node.attr.Num) || '1';
          withCtx({ paragraphNum: pNum, itemNum: null, itemSub: null }, () => {
            (node.children || []).forEach(walk);
          });
          return;
        }
        case 'Item': {
          const [it, isub] = splitNum(node.attr && node.attr.Num);
          withCtx({ itemNum: it, itemSub: isub }, () => (node.children || []).forEach(walk));
          return;
        }
        default:
          if (/^Subitem[0-9]+$/.test(node.tag)) {
            const [sub] = splitNum(node.attr && node.attr.Num);
            withCtx({ subPath: ctx.subPath.concat([sub]) }, () => (node.children || []).forEach(walk));
            return;
          }
          (node.children || []).forEach(walk);
      }
    }
    walk(root);
    return nodes;
  }

  // -----------------------------------------------------------------------
  // 3. シンボルテーブル (§1 定義参照)
  // -----------------------------------------------------------------------
  const SCOPE_DEF_RE = /この(法律|政令|省令|規則|条例|章|節|款|条|項)(?:において|で)、?「([^」]+)」とは、(.+?)を(?:いう|いいます)。/g;
  const ALIAS_DEF_RE = /(?:([^、。\s]{1,60}?))(?:を)?\(?（(?:以下)?(?:単に)?「([^」]+)」という。?\)?）/g;
  const SORE_IZURE_ONAJI_RE = /以下同じ。/g;

  let symbolIdCounter = 0;

  function buildSymbolTable(sentenceNodes) {
    const table = [];

    sentenceNodes.forEach((node) => {
      const text = node.text;
      let m;

      SCOPE_DEF_RE.lastIndex = 0;
      while ((m = SCOPE_DEF_RE.exec(text))) {
        const scopeWord = m[1];
        const term = m[2];
        const definition = m[3];
        let scope;
        if (scopeWord === '法律' || scopeWord === '政令' || scopeWord === '省令' || scopeWord === '規則' || scopeWord === '条例') {
          scope = { type: 'law' };
        } else if (scopeWord === '章') {
          scope = { type: 'chapter', chapterNum: node.coord.chapterNum };
        } else if (scopeWord === '節') {
          scope = { type: 'section', sectionNum: node.coord.sectionNum };
        } else { // 款/条/項 はまとめて条スコープとして扱う(款スコープは実務上稀)
          scope = { type: 'article', articleNum: node.coord.articleNum, articleSub: node.coord.articleSub, isSupplProvision: node.coord.isSupplProvision };
        }
        table.push({
          id: 'sym' + (symbolIdCounter++),
          alias: term,
          definitionText: definition,
          scope,
          definedAtCoord: node.coord,
          definedAtSeq: node.seq,
          sourceText: text,
          kind: 'scope-definition'
        });
      }

      ALIAS_DEF_RE.lastIndex = 0;
      while ((m = ALIAS_DEF_RE.exec(text))) {
        const alias = m[2];
        // SCOPE_DEF_RE で既に登録済みの用語は二重登録しない
        if (table.some((s) => s.definedAtSeq === node.seq && s.alias === alias)) continue;
        table.push({
          id: 'sym' + (symbolIdCounter++),
          alias,
          definitionText: null, // 直前の語句が定義本体だが、境界の自動判定は行わない(トレース上に原文を出す)
          scope: { type: 'fromHere' },
          definedAtCoord: node.coord,
          definedAtSeq: node.seq,
          sourceText: text,
          kind: 'alias-definition'
        });
      }

      SORE_IZURE_ONAJI_RE.lastIndex = 0;
      if (SORE_IZURE_ONAJI_RE.test(text)) {
        table.push({
          id: 'sym' + (symbolIdCounter++),
          alias: null,
          definitionText: text,
          scope: { type: 'note' },
          definedAtCoord: node.coord,
          definedAtSeq: node.seq,
          sourceText: text,
          kind: 'scope-note' // 「以下同じ。」宣言。特定の語へのリンクは行わず、注記としてのみ保持
        });
      }
    });

    return table;
  }

  function isInScope(symbol, coord, seq) {
    if (symbol.kind === 'scope-note') return false; // リンク対象にしない
    switch (symbol.scope.type) {
      case 'law':
        return true;
      case 'chapter':
        return !coord.isSupplProvision && coord.chapterNum === symbol.scope.chapterNum;
      case 'section':
        return !coord.isSupplProvision && coord.sectionNum === symbol.scope.sectionNum;
      case 'article':
        return coord.isSupplProvision === symbol.scope.isSupplProvision &&
          coord.articleNum === symbol.scope.articleNum && coord.articleSub === symbol.scope.articleSub;
      case 'fromHere':
        return coord.isSupplProvision === symbol.definedAtCoord.isSupplProvision && seq >= symbol.definedAtSeq;
      default:
        return false;
    }
  }

  function describeScope(scope) {
    switch (scope.type) {
      case 'law': return '法令全体';
      case 'chapter': return '第' + (intToKanji(parseInt(scope.chapterNum, 10)) || scope.chapterNum) + '章の中のみ';
      case 'section': return '当該節の中のみ';
      case 'article': return describeCoord({ isSupplProvision: scope.isSupplProvision, articleNum: scope.articleNum, articleSub: scope.articleSub }) + 'の中のみ';
      case 'fromHere': return '定義箇所からこの法令の末尾まで';
      default: return '(不明)';
    }
  }

  // -----------------------------------------------------------------------
  // 4. トークナイザ (§2 相対参照, §3 直接/外部参照, §5 法的擬制, §7 接続語)
  // -----------------------------------------------------------------------
  const KANJI_NUM = '[〇一二三四五六七八九十百千0-9]+';
  const ERA = '(?:明治|大正|昭和|平成|令和)';
  const LAW_SUFFIX = '(?:法律|規則|規程|条例|政令|省令|府令|令|法)';
  const LAW_SUFFIX_END_RE = new RegExp(LAW_SUFFIX + '$');
  const KANJI_ONLY = '[\\u4E00-\\u9FFF々〇]';

  const REL_SIMPLE_RE = /(前|次|同|本)(条|項|号)/g;
  const REL_COUNT_RE = /(前|次)([一二三四五六七八九十]+)(条|項)/g;
  const REL_ALL_RE = /前各(項|号)/g;
  const REL_TOUGAI_RE = /当該/g;
  const REL_SEGMENT_RE = /(前段|後段|本文|ただし書)/g;

  const RANGE_RE = new RegExp('第(' + KANJI_NUM + ')条から第(' + KANJI_NUM + ')条まで', 'g');
  const EXCLUDE_RE = new RegExp('第(' + KANJI_NUM + ')条(?:の(' + KANJI_NUM + '))?（第(' + KANJI_NUM + ')項を除く。）', 'g');
  const DIRECT_RE = new RegExp(
    '第(' + KANJI_NUM + ')条(?:の(' + KANJI_NUM + '))?' +
    '(?:第(' + KANJI_NUM + ')項)?' +
    '(?:第(' + KANJI_NUM + ')号(?:の(' + KANJI_NUM + '))?)?',
    'g'
  );

  const EXTERNAL_RE = new RegExp(
    '([^\\s、。，,．.（）「」『』〈〉]{2,50})' +
    '（(?:' +
    '(' + ERA + KANJI_NUM + '年[^（）]{0,20}?第' + KANJI_NUM + '号)(?:[^（）]{0,4}?以下「([^」]{1,12})」という。?)?' +
    '|' +
    '以下「([^」]{1,12})」という。?' +
    ')[^（）]{0,20}?）' +
    '(第' + KANJI_NUM + '条)?' +
    '(第' + KANJI_NUM + '項)?',
    'g'
  );
  const BARE_CITATION_RE = new RegExp(
    '(' + KANJI_ONLY + '{2,20}?' + LAW_SUFFIX + ')' +
    '第(' + KANJI_NUM + ')条' +
    '(第' + KANJI_NUM + '項)?',
    'g'
  );
  const SAME_LAW_RE = /同(法律|法|令|規則|条例)/g;

  const LEGAL_EFFECT_RE = /と(みなす|推定する)。/g;
  const CONNECTIVE_RE = /(その他の|その他|又は|若しくは|及び|並びに)/g;

  const CITATION_NOISE_PREFIXES = [
    '又は', '若しくは', '及び', '並びに', 'かつ', 'ただし', '但し', 'なお',
    '専ら', 'もっぱら', '主として', '特に', '直接に', '直接', '別に', '別途', '同じく', '同様に'
  ];
  const SELF_REFERENCE_RE = /^(?:この|同|当該|前記)/;
  const BARE_SUFFIX_ONLY_RE = new RegExp('^' + LAW_SUFFIX + '$');

  function cleanCitationName(raw) {
    let name = raw, changed = true;
    while (changed && name.length > 2) {
      changed = false;
      for (const w of CITATION_NOISE_PREFIXES) {
        if (name.startsWith(w) && name.length > w.length) { name = name.slice(w.length); changed = true; break; }
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

  // 1文からトークン候補(未解決)を抽出する。resolveDocumentで解決・トレース付与する。
  function tokenizeSentence(text) {
    const tokens = [];
    let m;

    RANGE_RE.lastIndex = 0;
    while ((m = RANGE_RE.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'direct-range',
        fromArticle: kanjiToInt(m[1]), toArticle: kanjiToInt(m[2]) });
    }
    EXCLUDE_RE.lastIndex = 0;
    while ((m = EXCLUDE_RE.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'direct-exclude',
        articleNum: kanjiToInt(m[1]), articleSub: m[2] ? kanjiToInt(m[2]) : null, excludedParagraph: kanjiToInt(m[3]) });
    }
    DIRECT_RE.lastIndex = 0;
    while ((m = DIRECT_RE.exec(text))) {
      tokens.push({
        start: m.index, end: m.index + m[0].length, text: m[0], type: 'direct',
        articleNum: kanjiToInt(m[1]), articleSub: m[2] ? kanjiToInt(m[2]) : null,
        paragraphNum: m[3] ? kanjiToInt(m[3]) : null,
        itemNum: m[4] ? kanjiToInt(m[4]) : null, itemSub: m[5] ? kanjiToInt(m[5]) : null
      });
    }

    EXTERNAL_RE.lastIndex = 0;
    while ((m = EXTERNAL_RE.exec(text))) {
      const rawName = m[1];
      const lawName = cleanCitationName(rawName);
      // 「新規登録を受けた自動車（以下「新規登録自動車」という。）」のような、
      // 国内の一般的な語句への略称定義を外部法令引用と誤認しないよう、
      // 法令名は必ず「法/令/規則」等のサフィックスで終わることを要求する。
      if (!isPlausibleLawName(lawName) || !LAW_SUFFIX_END_RE.test(lawName)) continue;
      const noiseLen = rawName.length - lawName.length;
      tokens.push({
        start: m.index + noiseLen, end: m.index + m[0].length, text: m[0].slice(noiseLen), type: 'external',
        lawName, lawNum: m[2] || null, abbrev: m[3] || m[4] || null,
        articleNum: m[5] ? kanjiToInt(m[5].replace(/^第|条$/g, '')) : null,
        paragraphNum: m[6] ? kanjiToInt(m[6].replace(/^第|項$/g, '')) : null
      });
    }
    BARE_CITATION_RE.lastIndex = 0;
    while ((m = BARE_CITATION_RE.exec(text))) {
      const rawName = m[1];
      const lawName = cleanCitationName(rawName);
      if (!isPlausibleLawName(lawName)) continue;
      const noiseLen = rawName.length - lawName.length;
      tokens.push({
        start: m.index + noiseLen, end: m.index + m[0].length, text: m[0].slice(noiseLen), type: 'external',
        lawName, lawNum: null, abbrev: null,
        articleNum: kanjiToInt(m[2]), paragraphNum: m[3] ? kanjiToInt(m[3].replace(/^第|項$/g, '')) : null
      });
    }
    SAME_LAW_RE.lastIndex = 0;
    while ((m = SAME_LAW_RE.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'same-law' });
    }

    REL_COUNT_RE.lastIndex = 0;
    while ((m = REL_COUNT_RE.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'relative-count',
        dir: m[1], count: kanjiToInt(m[2]), unit: m[3] });
    }
    REL_ALL_RE.lastIndex = 0;
    while ((m = REL_ALL_RE.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'relative-all', unit: m[1] });
    }
    REL_SIMPLE_RE.lastIndex = 0;
    while ((m = REL_SIMPLE_RE.exec(text))) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6);
      let qualifier = null;
      if (m[1] === '前' && m[2] === '項') {
        if (after.startsWith('の場合')) qualifier = 'case-whole';
        else if (after.startsWith('に規定する')) qualifier = 'case-partial';
      }
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'relative-simple',
        dir: m[1], unit: m[2], qualifier });
    }
    REL_TOUGAI_RE.lastIndex = 0;
    while ((m = REL_TOUGAI_RE.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'relative-entity' });
    }
    REL_SEGMENT_RE.lastIndex = 0;
    while ((m = REL_SEGMENT_RE.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'relative-segment', segment: m[1] });
    }

    LEGAL_EFFECT_RE.lastIndex = 0;
    while ((m = LEGAL_EFFECT_RE.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'legal-effect', effect: m[1] });
    }
    CONNECTIVE_RE.lastIndex = 0;
    while ((m = CONNECTIVE_RE.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'connective', word: m[1] });
    }

    return tokens;
  }

  function dedupeTokens(tokens) {
    const PRIORITY = { 'direct-range': 0, 'direct-exclude': 0, external: 1, 'same-law': 1, direct: 2 };
    tokens.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || (PRIORITY[a.type] || 9) - (PRIORITY[b.type] || 9));
    const out = [];
    let lastEnd = -1;
    tokens.forEach((t) => {
      if (t.start < lastEnd) return;
      out.push(t);
      lastEnd = t.end;
    });
    return out.sort((a, b) => a.start - b.start);
  }

  // -----------------------------------------------------------------------
  // 5. 文書全体を通した解決 (§2.5, §3.3) ― カーソル + 直近参照スタック
  // -----------------------------------------------------------------------
  function buildExistenceIndex(sentenceNodes) {
    const articles = new Set();
    const paragraphs = new Set();
    sentenceNodes.forEach((n) => {
      articles.add(articleKey(n.coord));
      if (n.coord.paragraphNum) paragraphs.add(articleKey(n.coord) + ':' + n.coord.paragraphNum);
    });
    return { articles, paragraphs };
  }

  function resolveDocument(sentenceNodes, symbolTable) {
    const existence = buildExistenceIndex(sentenceNodes);
    const externalLawRefs = [];
    const externalLawSeen = new Map();

    const state = {
      lastArticleCoord: null,   // 直近で言及/所在した条 (同条・当該用)
      lastParagraphCoord: null, // 直近で言及/所在した項 (同項用)
      lastItemCoord: null,      // 直近で言及/所在した号 (同号用)
      lastExternalLaw: null,    // 直近で言及した外部法令 (同法用)
      lastEntity: null          // 当該が指す直近の対象(表示用テキスト)
    };

    function articleExists(coord) { return existence.articles.has(articleKey(coord)); }
    function paragraphExists(coord, pNum) { return existence.paragraphs.has(articleKey(coord) + ':' + pNum); }

    sentenceNodes.forEach((node) => {
      // 現在の条/項が変わるたびに「今読んでいる場所」を直近参照として更新しておく
      // (同条などが「直前に明示引用された条」だけでなく「今いる条」も指せるようにするため)
      if (node.coord.articleNum && (!state.lastArticleCoord || articleKey(state.lastArticleCoord) !== articleKey(node.coord))) {
        state.lastArticleCoord = node.coord;
      }
      if (node.coord.paragraphNum) state.lastParagraphCoord = node.coord;

      const rawTokens = tokenizeSentence(node.text);
      const tokens = dedupeTokens(rawTokens);

      tokens.forEach((t) => {
        t.trace = [{ step: 'token', detail: 'トークン "' + t.text + '" を検出 (種別: ' + describeTokenType(t.type) + ')' }];
        t.currentCoordAtToken = node.coord;

        switch (t.type) {
          case 'relative-simple':
            resolveRelativeSimple(t, node.coord, state, articleExists, paragraphExists);
            break;
          case 'relative-count':
            resolveRelativeCount(t, node.coord, articleExists, paragraphExists);
            break;
          case 'relative-all':
            resolveRelativeAll(t, node.coord);
            break;
          case 'relative-entity':
            t.trace.push({ step: 'stack', detail: '直近の対象: ' + (state.lastEntity || '(まだ何も参照されていません)') });
            t.resolvedDescription = state.lastEntity;
            break;
          case 'relative-segment':
            t.trace.push({ step: 'note', detail: '文中の意味的な区切り(' + t.segment + ')。読点ではなく内容で分割されるため自動抽出は行わない' });
            break;
          case 'direct':
          case 'direct-range':
          case 'direct-exclude':
            resolveDirect(t, node.coord, articleExists, paragraphExists);
            state.lastArticleCoord = { isSupplProvision: node.coord.isSupplProvision, articleNum: t.articleNum != null ? String(t.articleNum) : node.coord.articleNum, articleSub: t.articleSub != null ? String(t.articleSub) : null };
            state.lastEntity = describeCoord(state.lastArticleCoord) + 'の規定';
            break;
          case 'external':
            resolveExternal(t);
            state.lastExternalLaw = { lawName: t.lawName, lawNum: t.lawNum };
            state.lastEntity = t.lawName;
            if (!externalLawSeen.has(t.lawName)) {
              externalLawSeen.set(t.lawName, true);
              externalLawRefs.push({ lawName: t.lawName, lawNum: t.lawNum });
            }
            break;
          case 'same-law':
            resolveSameLaw(t, state);
            break;
          case 'legal-effect':
            t.trace.push({ step: 'tag', detail: (t.effect === 'みなす' ? '法的擬制(みなす): 反証不可' : '推定規定: 反証可能') });
            break;
          case 'connective':
            t.trace.push({ step: 'tag', detail: describeConnective(t.word) });
            break;
          default:
            break;
        }
      });

      // 定義済み語句(シンボルテーブル)の本文中の使用箇所を検出する
      const usageTokens = findDefinitionUses(node, symbolTable);
      const merged = dedupeTokens(tokens.concat(usageTokens));
      node.tokens = merged;
    });

    return { externalLawRefs };
  }

  function describeTokenType(type) {
    const map = {
      'relative-simple': '相対位置参照', 'relative-count': '相対位置参照(複数)', 'relative-all': '相対位置参照(全て)',
      'relative-entity': '履歴参照(当該)', 'relative-segment': '文内区分', 'direct': '直接参照',
      'direct-range': '直接参照(範囲)', 'direct-exclude': '直接参照(除外)', 'external': '外部法令参照',
      'same-law': '外部法令参照(同法)', 'legal-effect': '法的擬制', 'connective': '列挙接続語',
      'definition-use': '定義済み語句'
    };
    return map[type] || type;
  }

  function describeConnective(word) {
    switch (word) {
      case '又は': return '同じ階層の選択肢(or・フラット)';
      case '若しくは': return '入れ子になった下位階層の選択(or・ネスト)';
      case '及び': return '同じ階層の並列(and・フラット)';
      case '並びに': return '入れ子になった上位階層の並列(and・ネスト)';
      case 'その他の': return '直前の語句は直後の広い概念の例示の一部(包含関係)';
      case 'その他': return '前後が並列関係(等位接続)';
      default: return word;
    }
  }

  function resolveRelativeSimple(t, coord, state, articleExists, paragraphExists) {
    t.trace.push({ step: 'cursor', detail: '現在位置: ' + describeCoord(coord) });
    if (t.qualifier) {
      t.trace.push({
        step: 'disambiguate',
        detail: t.qualifier === 'case-whole'
          ? '直後が「の場合」→ 前項の内容全体を受ける'
          : '直後が「に規定する」→ 前項中の仮定条件部分のみを受ける'
      });
    }
    if (t.dir === '本') {
      t.resolvedCoord = coord;
      t.trace.push({ step: 'resolve', detail: '解決結果: ' + describeCoord(coord) + '(自己参照)' });
      return;
    }
    if (t.dir === '同') {
      const base = t.unit === '条' ? state.lastArticleCoord : t.unit === '項' ? state.lastParagraphCoord : state.lastItemCoord;
      t.trace.push({ step: 'stack', detail: '直近参照スタックを確認 (' + t.unit + '): ' + (base ? describeCoord(base) : '(未設定)') });
      t.resolvedCoord = base || null;
      t.trace.push({ step: 'resolve', detail: base ? '解決結果: ' + describeCoord(base) : '解決できませんでした(直近の参照がありません)' });
      return;
    }
    // 前条/次条/前項/次項/前号/次号
    const delta = t.dir === '前' ? -1 : 1;
    let target = null;
    if (t.unit === '条') {
      const n = parseInt(coord.articleNum, 10) + delta;
      target = { isSupplProvision: coord.isSupplProvision, articleNum: String(n), articleSub: null };
      t.trace.push({ step: 'rule', detail: '規則: ' + t.text + ' → 条番号を' + (delta > 0 ? '+1' : '-1') });
      t.trace.push({ step: 'compute', detail: '計算結果: ' + describeCoord(target) });
      t.trace.push({ step: 'lookup', detail: articleExists(target) ? '該当条文が見つかりました' : '該当条文が見つかりません' });
    } else if (t.unit === '項') {
      const n = parseInt(coord.paragraphNum || '1', 10) + delta;
      target = Object.assign({}, coord, { paragraphNum: String(n) });
      t.trace.push({ step: 'rule', detail: '規則: ' + t.text + ' → 同一条内で項番号を' + (delta > 0 ? '+1' : '-1') });
      t.trace.push({ step: 'compute', detail: '計算結果: ' + describeCoord(target) });
      t.trace.push({ step: 'lookup', detail: (n >= 1 && paragraphExists(coord, String(n))) ? '該当項が見つかりました' : '該当項が見つかりません' });
    } else { // 号
      const n = parseInt(coord.itemNum || '1', 10) + delta;
      target = Object.assign({}, coord, { itemNum: String(n) });
      t.trace.push({ step: 'rule', detail: '規則: ' + t.text + ' → 同一項内で号番号を' + (delta > 0 ? '+1' : '-1') });
      t.trace.push({ step: 'compute', detail: '計算結果: ' + describeCoord(target) });
    }
    t.resolvedCoord = target;
  }

  function resolveRelativeCount(t, coord, articleExists, paragraphExists) {
    t.trace.push({ step: 'cursor', detail: '現在位置: ' + describeCoord(coord) });
    const delta = t.dir === '前' ? -1 : 1;
    const targets = [];
    for (let k = 1; k <= t.count; k++) {
      if (t.unit === '条') {
        const n = parseInt(coord.articleNum, 10) + delta * k;
        targets.push({ isSupplProvision: coord.isSupplProvision, articleNum: String(n) });
      } else {
        const n = parseInt(coord.paragraphNum || '1', 10) + delta * k;
        targets.push(Object.assign({}, coord, { paragraphNum: String(n) }));
      }
    }
    t.trace.push({ step: 'rule', detail: '規則: ' + t.text + ' → ' + t.dir + 'から' + t.count + '個分の' + t.unit + 'を列挙' });
    t.trace.push({ step: 'compute', detail: '対象: ' + targets.map(describeCoord).join('、') });
    t.resolvedCoords = targets;
  }

  function resolveRelativeAll(t, coord) {
    t.trace.push({ step: 'cursor', detail: '現在位置: ' + describeCoord(coord) });
    if (t.unit === '項') {
      const upTo = parseInt(coord.paragraphNum || '1', 10) - 1;
      t.trace.push({ step: 'rule', detail: '規則: 前各項 → 同一条内で現在の項より前にある全ての項' });
      t.trace.push({ step: 'compute', detail: upTo >= 1 ? '第1項〜第' + upTo + '項' : '(現在が第1項のため対象なし)' });
    } else {
      t.trace.push({ step: 'rule', detail: '規則: 前各号 → 同一項内で現在の号より前にある全ての号' });
    }
  }

  function resolveDirect(t, coord, articleExists, paragraphExists) {
    const target = { isSupplProvision: coord.isSupplProvision, articleNum: String(t.articleNum), articleSub: t.articleSub != null ? String(t.articleSub) : null };
    if (t.paragraphNum != null) target.paragraphNum = String(t.paragraphNum);
    if (t.itemNum != null) target.itemNum = String(t.itemNum);
    t.trace.push({ step: 'parse', detail: '条番号:' + t.articleNum + (t.articleSub ? 'の' + t.articleSub : '') + (t.paragraphNum ? ' 項:' + t.paragraphNum : '') + (t.itemNum ? ' 号:' + t.itemNum : '') });
    t.trace.push({ step: 'cursor', detail: '同一法令内の参照と仮定(法令名の指定なし)' });
    const found = articleExists(target);
    t.trace.push({ step: 'lookup', detail: found ? '同一法令内に該当条文が見つかりました: ' + describeCoord(target) : '同一法令内に該当条文が見つかりませんでした' });
    t.resolvedCoord = found ? target : null;

    if (t.type === 'direct-range') {
      t.trace.push({ step: 'rule', detail: '範囲参照: 第' + t.fromArticle + '条から第' + t.toArticle + '条まで' });
    }
    if (t.type === 'direct-exclude') {
      t.trace.push({ step: 'rule', detail: '除外参照: 第' + t.articleNum + '条から第' + t.excludedParagraph + '項を除く' });
    }
  }

  function resolveExternal(t) {
    if (t.abbrev) {
      t.trace.push({ step: 'define', detail: '略称定義を検出: 以後「' + t.abbrev + '」は' + t.lawName + 'を指す' });
    }
    t.trace.push({ step: 'lookup-law', detail: t.lawNum ? '法令番号 "' + t.lawNum + '" として認識' : '法令番号の記載なし(クリック時に名称でAPI検索)' });
    t.trace.push({ step: 'resolve', detail: '解決結果: 外部法令「' + t.lawName + '」' + (t.articleNum ? ' 第' + t.articleNum + '条' : '') });
  }

  function resolveSameLaw(t, state) {
    t.trace.push({ step: 'stack', detail: '直近参照スタック(外部法令)を確認: ' + (state.lastExternalLaw ? state.lastExternalLaw.lawName : '(未設定)') });
    if (state.lastExternalLaw) {
      t.lawName = state.lastExternalLaw.lawName;
      t.lawNum = state.lastExternalLaw.lawNum;
      t.trace.push({ step: 'resolve', detail: '解決結果: ' + state.lastExternalLaw.lawName });
    } else {
      t.trace.push({ step: 'resolve', detail: '解決できませんでした(直近に参照された外部法令がありません)' });
    }
  }

  function findDefinitionUses(node, symbolTable) {
    const text = node.text;
    const out = [];
    symbolTable.forEach((sym) => {
      if (!sym.alias) return;
      if (!isInScope(sym, node.coord, node.seq)) return;
      if (sym.definedAtSeq === node.seq) return; // 定義そのものの文はリンクしない
      let idx = 0;
      while ((idx = text.indexOf(sym.alias, idx)) !== -1) {
        const before = text[idx - 1];
        const after = text[idx + sym.alias.length];
        if (before !== '「' || after !== '」') {
          out.push({
            start: idx, end: idx + sym.alias.length, text: sym.alias, type: 'definition-use',
            symbolId: sym.id,
            trace: [
              { step: 'token', detail: '語句 "' + sym.alias + '" を検出 (種別: 定義済み語句)' },
              { step: 'symbol-lookup', detail: 'シンボルテーブルを検索...' },
              { step: 'scope-check', detail: 'スコープ: ' + describeScope(sym.scope) + ' — 現在位置(' + describeCoord(node.coord) + ')は範囲内' },
              { step: 'resolve', detail: sym.definitionText ? '定義: ' + sym.definitionText : '定義箇所: ' + describeCoord(sym.definedAtCoord) }
            ]
          });
        }
        idx += sym.alias.length;
      }
    });
    return out;
  }

  // -----------------------------------------------------------------------
  // 6. 準用・読み替え (§4.2)
  // -----------------------------------------------------------------------
  const QUASI_RE = new RegExp(
    '第(' + KANJI_NUM + ')条(?:の(' + KANJI_NUM + '))?(?:第(' + KANJI_NUM + ')項)?の規定は、(.+?)について準用する。' +
    '(?:この場合において、(.+?)と読み替えるものとする。)?',
    'g'
  );
  const SUBSTITUTION_RE = /「([^」]+)」とあ(?:るのは|り)、?「([^」]+)」と/g;

  function detectQuasiApplications(sentenceNodes) {
    // 同一条・項内の文を連結して段落単位で定型文を検出する(準用文が複数Sentenceに跨ることがあるため)
    const byParagraph = new Map();
    sentenceNodes.forEach((n) => {
      if (n.tag !== 'Sentence') return;
      const key = articleKey(n.coord) + ':' + (n.coord.paragraphNum || '');
      if (!byParagraph.has(key)) byParagraph.set(key, { coord: n.coord, text: '' });
      byParagraph.get(key).text += n.text;
    });

    const results = [];
    byParagraph.forEach(({ coord, text }) => {
      QUASI_RE.lastIndex = 0;
      let m;
      while ((m = QUASI_RE.exec(text))) {
        const substitutions = [];
        if (m[5]) {
          SUBSTITUTION_RE.lastIndex = 0;
          let sm;
          while ((sm = SUBSTITUTION_RE.exec(m[5]))) substitutions.push({ from: sm[1], to: sm[2] });
        }
        results.push({
          atCoord: coord,
          sourceArticle: kanjiToInt(m[1]),
          sourceArticleSub: m[2] ? kanjiToInt(m[2]) : null,
          sourceParagraph: m[3] ? kanjiToInt(m[3]) : null,
          targetScopeText: m[4],
          substitutions,
          sourceText: m[0]
        });
      }
    });
    return results;
  }

  // -----------------------------------------------------------------------
  // 7. エントリポイント
  // -----------------------------------------------------------------------
  function parseLaw(lawFullTextTree, lawMeta) {
    const sentenceNodes = flattenToSentenceNodes(lawFullTextTree);
    const symbolTable = buildSymbolTable(sentenceNodes);
    const { externalLawRefs } = resolveDocument(sentenceNodes, symbolTable);
    const quasiApplications = detectQuasiApplications(sentenceNodes);

    return {
      lawMeta: lawMeta || {},
      sentenceNodes,
      symbolTable,
      externalLawRefs,
      quasiApplications
    };
  }

  global.LegalParser = {
    parseLaw,
    kanjiToInt,
    intToKanji,
    describeCoord,
    describeScope,
    describeTokenType,
    coordKey,
    articleKey,
    isInScope
  };
})(window);
