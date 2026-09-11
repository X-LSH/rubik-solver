/* =========================================================================
 * roux.js — Roux 桥式解法（四阶段）
 *
 * Roux 与层先法/CFOP 思路完全不同：不做底层十字，而是先在左右两侧各搭一个
 * 1×2×3 的「桥块」，再单独处理顶层四角，最后只剩 6 条棱。
 *
 *   ① FB（First Block）  左桥：底棱 DL + 棱角对 [BL,DLB] + 棱角对 [FL,DLF]
 *   ② SB（Second Block） 右桥：底棱 DR + 棱角对 [BR,DRB] + 棱角对 [FR,DRF]
 *   ③ CMLL               顶层四角：朝向 + 归位，用 14 条保桥公式 BFS
 *   ④ LSE                最后六棱：只用 M / U，查预计算表求最短解
 *
 * ── 为什么桥块用「棱角对」而不是逐块摆放 ──────────────────────────────
 * 桥块的块全部贴在同一个面上（FB 全在 L 层、SB 全在 R 层），任何一次该面的
 * 转动都会同时搬动好几个块。若按「逐块摆放 + 锁住已完成的块」搜索，后放的块
 * 会被自己的先验冻死（实测逐块单放只有 6/10 成功）。
 * 改用「底棱 + 两个棱角对」后，每一步的目标是 1~2 个块同时就位，且搜索空间用
 * 「目标块的 (位置, 朝向)」作键（2 块时仅 24×24 = 576 态），既可深搜又不爆炸。
 *
 * ── 为什么 CMLL 必须用「保桥公式」 ───────────────────────────────────
 * R 转动会把 FR 棱搬进 U 层，随后的 U 又把它挪走，R' 带回来的是别的块 ——
 * 所以 R U R' 这类短序列并不保桥。实测深度 ≤4 的保桥序列只有 4 种（全是 U 旋转）。
 * 真正的 CMLL 公式（Sune / Antisune / Pi / Y / Aa …）长度 7~12 步，通过前后抵消
 * 才净保持双桥。这里内置 14 条已验证保桥的公式作为生成元，BFS 可覆盖全部
 * 648 个顶层角状态（4!×3^3）。
 * ========================================================================= */
(function (global) {
  'use strict';

  var E = (typeof module !== 'undefined' && module.exports) ? require('./cube-engine.js') : global.CubeEngine;
  var FACES = E.FACES, SC = E.STD_COLORS;
  var SOLVED = E.solvedState();

  /* ---------------- 置换工具（与 solver.js 同语义：applyP 执行 out[j]=st[P[j]]） ---------------- */

  function compose(P, Q) { var o = new Array(54); for (var j = 0; j < 54; j++) o[j] = P[Q[j]]; return o; }
  function applyP(state, P) { var o = new Array(54); for (var j = 0; j < 54; j++) o[j] = state[P[j]]; return o; }

  var PERM_CACHE = {};
  function permOfMove(m) {
    if (!PERM_CACHE[m]) { var p = E.parseMove(m); PERM_CACHE[m] = E.PERMS[p.face][p.times - 1]; }
    return PERM_CACHE[m];
  }
  function permOfSeq(seq) {
    var R = [];
    for (var j = 0; j < 54; j++) R[j] = j;
    E.normalizeSeq(seq).forEach(function (m) { R = compose(R, permOfMove(m)); });
    return R;
  }
  var IDENT = [];
  for (var i0 = 0; i0 < 54; i0++) IDENT[i0] = i0;

  /* ---------------- 位置 / 块工具（用数值色号，避免字符串排序拖慢 BFS） ---------------- */

  var COLOR_IDX = {};
  ['U', 'R', 'F', 'D', 'L', 'B'].forEach(function (f, i) { COLOR_IDX[SC[f]] = i; });
  var HUE = Object.keys(COLOR_IDX).length;   // 6 种颜色

  function posOf(kind, i) { return kind === 'edge' ? E.EDGE_POS[i] : E.CORNER_POS[i]; }
  function faceletsOf(kind, i) { return E.faceletsAt(posOf(kind, i)); }
  function colorIdsOf(kind, i) { return faceletsOf(kind, i).map(function (f) { return COLOR_IDX[SOLVED[f]]; }); }

  // 位置色号签名：棱用 min*6+max（0..35），角用排序三色（0..215）
  var SIG_HOME = { edge: [], corner: [] };
  (function () {
    for (var e = 0; e < 12; e++) {
      var ids = colorIdsOf('edge', e).slice().sort(function (a, b) { return a - b; });
      SIG_HOME.edge.push(ids[0] * HUE + ids[1]);
    }
    for (var c = 0; c < 8; c++) {
      var ids2 = colorIdsOf('corner', c).slice().sort(function (a, b) { return a - b; });
      SIG_HOME.corner.push((ids2[0] * HUE + ids2[1]) * HUE + ids2[2]);
    }
  })();

  function sigAt(state, kind, i) {
    var fs = faceletsOf(kind, i);
    if (kind === 'edge') {
      var a = COLOR_IDX[state[fs[0]]], b = COLOR_IDX[state[fs[1]]];
      return (a < b ? a : b) * HUE + (a < b ? b : a);
    }
    var v = [COLOR_IDX[state[fs[0]]], COLOR_IDX[state[fs[1]]], COLOR_IDX[state[fs[2]]]];
    v.sort(function (x, y) { return x - y; });
    return (v[0] * HUE + v[1]) * HUE + v[2];
  }

  // 位置 i 上装着哪个块（返回其 home 位置索引），取不到返回 -1
  function pieceAt(state, kind, i) {
    var s = sigAt(state, kind, i);
    return SIG_HOME[kind].indexOf(s);
  }
  function pieceHome(state, kind, i) {
    var fs = faceletsOf(kind, i);
    for (var k = 0; k < fs.length; k++) if (state[fs[k]] !== SOLVED[fs[k]]) return false;
    return true;
  }
  // 块 home 索引 idx 的 (位置, 朝向) 编码：24 态（棱 2 朝向 / 角 3 朝向）
  function pieceState(state, kind, idx) {
    var nPos = kind === 'edge' ? 12 : 8;
    var hf = faceletsOf(kind, idx);
    var c0 = SOLVED[hf[0]];
    for (var i = 0; i < nPos; i++) {
      if (sigAt(state, kind, i) !== SIG_HOME[kind][idx]) continue;
      var cf = faceletsOf(kind, i);
      for (var k = 0; k < cf.length; k++) if (state[cf[k]] === c0) return i * 3 + k;
    }
    return -1;
  }

  /* ---------------- 宏池：枚举保持指定块集的最小序列 ---------------- */

  var MOVE_ALPHABETS = {};
  function alphabetOf(faces) {
    var k = faces.join('');
    if (!MOVE_ALPHABETS[k]) {
      var out = [];
      faces.forEach(function (f) { [1, 2, 3].forEach(function (t) { out.push(f + (t === 1 ? '' : t === 2 ? '2' : "'")); }); });
      MOVE_ALPHABETS[k] = out;
    }
    return MOVE_ALPHABETS[k];
  }
  var ALL21 = alphabetOf(['U', 'R', 'F', 'D', 'L', 'B', 'M']);
  var RUM9 = alphabetOf(['R', 'U', 'M']);

  var POOL_CACHE = {};

  // 供宏池判断：FB + SB 共 10 块是否都在原位
  var BRIDGE = [
    { kind: 'edge', idx: 0 }, { kind: 'edge', idx: 1 }, { kind: 'edge', idx: 2 },
    { kind: 'corner', idx: 0 }, { kind: 'corner', idx: 1 },
    { kind: 'edge', idx: 8 }, { kind: 'edge', idx: 9 }, { kind: 'edge', idx: 10 },
    { kind: 'corner', idx: 4 }, { kind: 'corner', idx: 5 }
  ];
  function bridgeHome(state) {
    for (var i = 0; i < BRIDGE.length; i++)
      if (!pieceHome(state, BRIDGE[i].kind, BRIDGE[i].idx)) return false;
    return true;
  }

  /* ---------------- 池过滤：只留「不破坏已就位块」的宏（按先验集签名缓存） ---------------- */

  var FILTER_CACHE = {};

  /* ---------------- 通用序列型池（FB/SB 用）：深度 ≤3 的全序列 ---------------- */

  var SEQ_POOLS = {};
  function seqPool(alphabet, maxD) {
    var key = alphabet.length + ':' + maxD;
    if (SEQ_POOLS[key]) return SEQ_POOLS[key];
    var seen = {}, out = [];
    (function rec(seq) {
      if (seq.length) {
        var p = permOfSeq(seq), k = p.join(',');
        if (!seen[k]) { seen[k] = 1; out.push({ seq: seq.slice(), perm: p }); }
      }
      if (seq.length === maxD) return;
      for (var i = 0; i < alphabet.length; i++) {
        if (seq.length && seq[seq.length - 1][0] === alphabet[i][0]) continue;
        seq.push(alphabet[i]); rec(seq); seq.pop();
      }
    })([]);
    SEQ_POOLS[key] = out;
    return out;
  }

  var POOL_ALL3 = null;   // 211 步池（含 M），深度 3
  var POOL_RUM3 = null;   // R/U/M 深度 3
  function pools() {
    if (!POOL_ALL3) { POOL_ALL3 = seqPool(ALL21, 3); POOL_RUM3 = seqPool(RUM9, 3); }
  }

  /* ---------------- 摆放：单块 / 成组 ----------------
   * 关键优化：宏对某个块的净效果只取决于「该块当前的 (位置, 朝向)」。
   * 于是对过滤后的宏池预计算一张 24 态转移表（用置换的逆直接算出，
   * 不必真的去搬 54 个贴纸），BFS 阶段就只剩查表 —— 比逐跳 applyP 快两个数量级。
   */

  var VISIT_CAP = 200000;

  function prepare(pool, state, priors, tag) {
    var sig = tag + '|' + priors.map(function (p) { return p.kind + p.idx; }).join(',');
    if (FILTER_CACHE[sig]) return FILTER_CACHE[sig];
    var out = [];
    for (var i = 0; i < pool.length; i++) {
      var ns = applyP(state, pool[i].perm), ok = true;
      for (var j = 0; j < priors.length; j++) {
        if (!pieceHome(ns, priors[j].kind, priors[j].idx)) { ok = false; break; }
      }
      if (ok) out.push(pool[i]);
    }
    // 短序列优先：BFS 求的是「宏个数」最少，同宏数下先撞到短宏能显著压低总步数
    out.sort(function (a, b) { return a.seq.length - b.seq.length; });
    FILTER_CACHE[sig] = out;
    return out;
  }

  var STRIDE = 36;   // 块状态编码 i*3+k 的上界（棱 12*3、角 8*3 均 < 36）
  var POS_INDEX_CACHE = {};
  function posTables(kind) {
    if (POS_INDEX_CACHE[kind]) return POS_INDEX_CACHE[kind];
    var POS = kind === 'edge' ? E.EDGE_POS : E.CORNER_POS;
    var FS = POS.map(function (p) { return E.faceletsAt(p); });
    var byFacelet = new Int8Array(54).fill(-1);
    FS.forEach(function (fs, i) { fs.forEach(function (f) { byFacelet[f] = i; }); });
    POS_INDEX_CACHE[kind] = { FS: FS, byFacelet: byFacelet };
    return POS_INDEX_CACHE[kind];
  }
  // 为「某个目标块」建立 pool[i] 作用于 36 个状态码的转移表
  function buildMap(pool, kind) {
    var T = posTables(kind);
    var out = new Int8Array(pool.length * STRIDE);
    var pinv = new Int8Array(54);
    for (var mi = 0; mi < pool.length; mi++) {
      var P = pool[mi].perm;
      for (var f = 0; f < 54; f++) pinv[P[f]] = f;      // pinv[目标位置] = 源位置
      for (var i = 0; i < T.FS.length; i++) {
        for (var k = 0; k < T.FS[i].length; k++) {
          var src = pinv[T.FS[i][k]];                    // 该贴纸搬到了 src
          var i2 = T.byFacelet[src];
          var k2 = T.FS[i2].indexOf(src);
          out[mi * STRIDE + (i * 3 + k)] = i2 * 3 + k2;
        }
      }
    }
    return out;
  }

  function placeSingle(state, kind, idx, priors, pool, tag, maxDepth) {
    if (pieceHome(state, kind, idx)) return { moves: [] };
    var pf = prepare(pool, state, priors, tag);
    if (!pf.length) return { moves: null, pool: 0 };
    var map = buildMap(pf, kind);
    var goal = idx * 3;                      // 归位态的编码（位置=home，且首贴纸对齐）
    var start = pieceState(state, kind, idx);
    var seen = new Int8Array(STRIDE).fill(0);
    seen[start] = 1;
    var q = [{ st: state, path: [] }], n = 0;
    while (q.length) {
      var nd = q.shift();
      if (nd.path.length >= maxDepth) continue;
      for (var i = 0; i < pf.length; i++) {
        var nk = map[i * STRIDE + pieceState(nd.st, kind, idx)];
        if (seen[nk]) continue;
        if (++n > VISIT_CAP) { q.length = 0; break; }
        seen[nk] = 1;
        var ns = applyP(nd.st, pf[i].perm);
        var np = nd.path.concat([pf[i].seq]);
        if (nk === goal && pieceHome(ns, kind, idx)) return { moves: np, pool: pf.length };
        q.push({ st: ns, path: np });
      }
    }
    return { moves: null, pool: pf.length };
  }

  function placeGroup(state, targets, priors, pool, tag, maxMacros) {
    var pf = prepare(pool, state, priors, tag);
    if (!pf.length) return { moves: null, pool: 0 };
    var maps = targets.map(function (t) { return buildMap(pf, t.kind); });
    var starts = targets.map(function (t) { return pieceState(state, t.kind, t.idx); });
    var goals = targets.map(function (t) { return t.idx * 3; });
    function done(st) {
      for (var i = 0; i < targets.length; i++)
        if (!pieceHome(st, targets[i].kind, targets[i].idx)) return false;
      return true;
    }
    if (done(state)) return { moves: [] };
    var keyOf = targets.length === 1
      ? function (ks) { return ks[0]; }
      : function (ks) { return ks[0] * STRIDE + ks[1]; };
    var startKey = keyOf(starts);
    var seen = {}; seen[startKey] = 1;
    var q = [{ st: state, ks: starts, path: [] }], n = 0;
    while (q.length) {
      var nd = q.shift();
      if (nd.path.length >= maxMacros) continue;
      for (var i = 0; i < pf.length; i++) {
        var nks = new Array(targets.length);
        for (var t2 = 0; t2 < targets.length; t2++) nks[t2] = maps[t2][i * STRIDE + nd.ks[t2]];
        var nk = keyOf(nks);
        if (seen[nk]) continue;
        if (++n > VISIT_CAP) { q.length = 0; break; }
        seen[nk] = 1;
        var ns = applyP(nd.st, pf[i].perm);
        var np = nd.path.concat([pf[i].seq]);
        if (done(ns)) return { moves: np, pool: pf.length };
        q.push({ st: ns, ks: nks, path: np });
      }
    }
    return { moves: null, pool: pf.length };
  }

  /* ---------------- 桥块任务表 ---------------- */

  // 左桥 / 右桥互为镜像，共用同一套「底棱 → 后对 → 前对」结构
  var FB_TASKS = [
    { single: { kind: 'edge', idx: 0 }, label: '底棱 DL' },                       // DL
    { pair: [{ kind: 'edge', idx: 1 }, { kind: 'corner', idx: 0 }], label: '后棱角对（BL + DLB）' },
    { pair: [{ kind: 'edge', idx: 2 }, { kind: 'corner', idx: 1 }], label: '前棱角对（FL + DLF）' }
  ];
  var SB_TASKS = [
    { single: { kind: 'edge', idx: 8 }, label: '底棱 DR' },                       // DR
    { pair: [{ kind: 'edge', idx: 9 }, { kind: 'corner', idx: 4 }], label: '后棱角对（BR + DRB）' },
    { pair: [{ kind: 'edge', idx: 10 }, { kind: 'corner', idx: 5 }], label: '前棱角对（FR + DRF）' }
  ];
  // 备用顺序：万一某个对卡住，换个次序往往就能走通
  var FB_ALT = [
    [{ kind: 'edge', idx: 0 }, { kind: 'edge', idx: 1 }, { kind: 'edge', idx: 2 }],
    [{ kind: 'corner', idx: 0 }, { kind: 'corner', idx: 1 }]
  ];
  var SB_ALT = [
    [{ kind: 'edge', idx: 8 }, { kind: 'edge', idx: 9 }, { kind: 'edge', idx: 10 }],
    [{ kind: 'corner', idx: 4 }, { kind: 'corner', idx: 5 }]
  ];

  /* ---------------- CMLL：14 条已验证「保持双桥」的公式 ---------------- */

  var CMLL_ALGS = [
    { name: 'Sune', seq: "R U R' U R U2 R'" },
    { name: 'Antisune', seq: "R U2 R' U' R U' R'" },
    { name: 'H', seq: "R U R' U R U' R' U R U2 R'" },
    { name: 'Pi', seq: "R U2 R2 U' R2 U' R2 U2 R" },
    { name: 'T', seq: "R U R' U' R' F R F'" },
    { name: 'U', seq: "R2 D R' U2 R D' R' U2 R'" },
    { name: 'L', seq: "F R' F' R U R U' R'" },
    { name: 'Aa', seq: "R' F R' B2 R F' R' B2 R2" },
    { name: '角三循环', seq: "R U R' F' R U R' U' R' F R2 U' R'" },
    { name: 'Y', seq: "F R U' R' U' R U R' F' R U R' U' R' F R F'" },
    { name: 'AUF', seq: "U" },
    { name: 'Sune2', seq: "R U R' U' R' F R F' U R U R' U R U2 R'" },
    { name: 'Pi2', seq: "R' U2 R2 U R2 U R2 U2 R'" },
    { name: 'H2', seq: "R U2 R' U' R U R' U' R U' R'" }
  ];
  var CMLL_POS = [2, 3, 6, 7];   // ULB, UFL, UBR, URF

  var CMLL_POOL = null;
  function cmllPool() {
    if (CMLL_POOL) return CMLL_POOL;
    CMLL_POOL = CMLL_ALGS.map(function (a) {
      return { name: a.name, seq: E.normalizeSeq(a.seq), perm: permOfSeq(a.seq) };
    }).filter(function (a) { return bridgeHome(applyP(SOLVED, a.perm)); });
    return CMLL_POOL;
  }

  function cmllKey(state) {
    var k = 0;
    for (var i = 0; i < 4; i++) {
      var p = pieceAt(state, 'corner', CMLL_POS[i]);
      if (p < 0) return -1;
      var home = CMLL_POS.indexOf(p);
      if (home < 0) return -1;                 // 顶角位混入非顶角块（不该发生）
      var fs = faceletsOf('corner', CMLL_POS[i]), ori = -1;
      var c0 = SOLVED[fs[0]];
      // 朝向沿用「本位置首贴纸在复原态的颜色」作为参照
      for (var k2 = 0; k2 < 3; k2++) if (state[fs[k2]] === c0) { ori = k2; break; }
      if (ori < 0) ori = 0;
      k = k * 12 + home * 3 + ori;
    }
    return k;
  }
  function cmllDone(state) {
    for (var i = 0; i < 4; i++) if (!pieceHome(state, 'corner', CMLL_POS[i])) return false;
    return true;
  }
  // 用保桥公式作生成元，在 648 态空间 BFS（公式集合已被验证可完全覆盖）
  function solveCMLL(state) {
    if (cmllDone(state)) return { moves: [], algs: [] };
    var pool = cmllPool();
    var goal = cmllKey(SOLVED);
    var start = cmllKey(state);
    if (start < 0) throw new Error('CMLL 失败：顶层角位异常');
    if (start === goal) return { moves: [], algs: [] };
    var seen = {}, prev = {};
    seen[start] = 1;
    var q = [state], keys = [start];
    while (q.length) {
      var st = q.shift(), sk = keys.shift();
      for (var i = 0; i < pool.length; i++) {
        var ns = applyP(st, pool[i].perm), nk = cmllKey(ns);
        if (nk < 0 || seen[nk]) continue;
        seen[nk] = 1; prev[nk] = { from: sk, alg: i };
        if (nk === goal) {
          // 回溯
          var path = [], cur = nk;
          while (cur !== start) {
            var info = prev[cur];
            path.unshift(pool[info.alg]);
            cur = info.from;
          }
          var moves = [], names = [];
          path.forEach(function (a) { moves = moves.concat(a.seq); names.push(a.name); });
          return { moves: moves, algs: names };
        }
        q.push(ns); keys.push(nk);
      }
    }
    throw new Error('CMLL 失败：保桥公式集合无法覆盖该状态');
  }

  /* ---------------- LSE：预计算表（仅用 M / U） ----------------
   * ⚠ 编码必须包含「中心块旋转」与「顶角旋转」两个附加坐标，否则会漏解：
   *   · M 会轮换 x=0 层的 4 个中心（U/F/D/B）
   *   · U 会轮换 U 层 4 个角（CMLL 刚摆好）
   * 实测确实存在「六条 LSE 棱全部归位、中心块也归位，但顶角被整体转过 U2」的
   * 状态（40 例里 2 例），此时若只按六棱编码就会被误判为「已完成」。
   * 于是状态 = 六棱置换(720) × 六棱朝向(64) × 中心旋转(4) × 顶角旋转(4)。
   * 后两个坐标都能由状态本身唯一确定（中心看 4 个中心色、顶角看哪个块在 URF），
   * 所以是合法坐标而非路径量。BFS 只存编码，靠 decodeLse 还原代表性状态。
   */

  var LSE_POS = [[0, 1, 1], [0, 1, -1], [0, -1, -1], [0, -1, 1], [-1, 1, 0], [1, 1, 0]];
  var LSE_GENS = ['M', "M'", 'M2', 'U', "U'", 'U2'];
  var MSC = [4, 22, 31, 49];                 // x=0 层的 4 个中心贴纸位置（U/F/D/B）
  var CMLL_POS_L = [2, 3, 6, 7];             // U 层四角（ULB, UFL, UBR, URF）
  var LETTERS = [];                          // COLOR_IDX 的反查
  ['U', 'R', 'F', 'D', 'L', 'B'].forEach(function (f, i) { LETTERS[i] = SC[f]; });

  var LSE_POS_FS, SIG_TO_PERM, SIG_TO_CORNER, Y_NORMAL, PIECE_UD, PIECE_OTHER,
      LSE_UD_IDX, MSC_ROT, UPOW, CORNER_ROT, SCRATCH_PERM;
  var PERMS6 = [], LSE_GEN_PERMS = [];
  var LSE_TABLE = null;
  var LSE_BUILD_MS = 0;

  // Lehmer 码 → 置换（与下面的编码互逆）
  function unLehmer(code, n) {
    var avail = [], perm = [];
    for (var i = 0; i < n; i++) avail.push(i);
    for (var k = 0; k < n; k++) {
      var f = 1;
      for (var t = 2; t <= n - 1 - k; t++) f *= t;
      var idx = Math.floor(code / f); code = code % f;
      perm.push(avail.splice(idx, 1)[0]);
    }
    return perm;
  }

  (function initLse() {
    LSE_POS_FS = LSE_POS.map(function (p) { return E.faceletsAt(p); });
    SIG_TO_PERM = new Int8Array(HUE * HUE).fill(-1);
    LSE_POS_FS.forEach(function (fs, i) {
      var a = COLOR_IDX[SOLVED[fs[0]]], b = COLOR_IDX[SOLVED[fs[1]]];
      SIG_TO_PERM[(a < b ? a : b) * HUE + (a < b ? b : a)] = i;
    });
    // 角块签名 → home 索引（三色排序后编码）
    SIG_TO_CORNER = new Int16Array(HUE * HUE * HUE).fill(-1);
    for (var c = 0; c < 8; c++) {
      var ids = colorIdsOf('corner', c).slice().sort(function (a, b) { return a - b; });
      SIG_TO_CORNER[(ids[0] * HUE + ids[1]) * HUE + ids[2]] = c;
    }
    Y_NORMAL = LSE_POS_FS.map(function (fs) {
      return fs.map(function (f) { return E.PNS[f].nrm[1] !== 0; });
    });
    PIECE_UD = LSE_POS_FS.map(function (fs) {
      for (var k = 0; k < fs.length; k++) {
        var cc = SOLVED[fs[k]];
        if (cc === SC.U || cc === SC.D) return cc;
      }
      return null;
    });
    PIECE_OTHER = LSE_POS_FS.map(function (fs, i) {
      for (var k = 0; k < fs.length; k++) if (SOLVED[fs[k]] !== PIECE_UD[i]) return SOLVED[fs[k]];
      return null;
    });
    LSE_UD_IDX = [COLOR_IDX[SC.U], COLOR_IDX[SC.D]];
    SCRATCH_PERM = new Int8Array(6);
    for (var n = 0; n < 720; n++) PERMS6.push(unLehmer(n, 6));
    LSE_GEN_PERMS = LSE_GENS.map(function (m) { return permOfMove(m); });

    // 中心旋转 / 顶角旋转 的观测量 → 旋转量 映射（用 M^k / U^k 作用于复原态标定）
    var UP = permOfMove('U');
    UPOW = [IDENT.slice()];
    for (var k = 1; k < 4; k++) UPOW.push(compose(UPOW[k - 1], UP));
    MSC_ROT = new Int16Array(HUE * HUE * HUE * HUE).fill(-1);
    CORNER_ROT = new Int16Array(8 * 8 * 8 * 8).fill(-1);
    var MP = permOfMove('M');
    var MPOW = [IDENT.slice()];
    for (var k2 = 1; k2 < 4; k2++) MPOW.push(compose(MPOW[k2 - 1], MP));
    for (var r = 0; r < 4; r++) {
      var sc = applyP(SOLVED, MPOW[r]);
      MSC_ROT[((COLOR_IDX[sc[MSC[0]]] * HUE + COLOR_IDX[sc[MSC[1]]]) * HUE + COLOR_IDX[sc[MSC[2]]]) * HUE + COLOR_IDX[sc[MSC[3]]]] = r;
      var su = applyP(SOLVED, UPOW[r]);
      var key = 0;
      for (var i2 = 0; i2 < 4; i2++) key = key * 8 + SIG_TO_CORNER[(function () {
        var fs = E.faceletsAt(E.CORNER_POS[CMLL_POS_L[i2]]);
        var ids2 = [COLOR_IDX[su[fs[0]]], COLOR_IDX[su[fs[1]]], COLOR_IDX[su[fs[2]]]].sort(function (a, b) { return a - b; });
        return (ids2[0] * HUE + ids2[1]) * HUE + ids2[2];
      })()];
      CORNER_ROT[key] = r;
    }
  })();

  function sigOfFs(state, fs) {
    var a = COLOR_IDX[state[fs[0]]], b = COLOR_IDX[state[fs[1]]];
    return (a < b ? a : b) * HUE + (a < b ? b : a);
  }
  function lseOriN(state) {
    var o = 0, mul = 1;
    for (var i = 0; i < 6; i++) {
      var fs = LSE_POS_FS[i], bit = 1;
      for (var k = 0; k < 2; k++) {
        var c = COLOR_IDX[state[fs[k]]];
        if ((c === LSE_UD_IDX[0] || c === LSE_UD_IDX[1]) && Y_NORMAL[i][k]) { bit = 0; break; }
      }
      o += bit * mul; mul *= 2;
    }
    return o;
  }
  function centerRotN(state) {
    return MSC_ROT[((COLOR_IDX[state[MSC[0]]] * HUE + COLOR_IDX[state[MSC[1]]]) * HUE +
      COLOR_IDX[state[MSC[2]]]) * HUE + COLOR_IDX[state[MSC[3]]]];
  }
  function cornerRotN(state) {
    var key = 0;
    for (var i = 0; i < 4; i++) {
      var fs = E.faceletsAt(E.CORNER_POS[CMLL_POS_L[i]]);
      var ids = [COLOR_IDX[state[fs[0]]], COLOR_IDX[state[fs[1]]], COLOR_IDX[state[fs[2]]]].sort(function (a, b) { return a - b; });
      var h = SIG_TO_CORNER[(ids[0] * HUE + ids[1]) * HUE + ids[2]];
      if (h < 0) return -1;
      key = key * 8 + h;
    }
    return CORNER_ROT[key];
  }
  /* ---- LSE 转移表：把「六棱」与「中心/顶角旋转」解耦 ----
   * M/U 对六棱的作用与「中心旋转」「顶角旋转」彼此独立（中心只受 M 影响、
   * 顶角只受 U 影响，且都是固定增量）。于是：
   *   1) 先为 46,080 个六棱状态建一张转移表（只解码 46,080 次）
   *   2) 再在 737,280 个联合状态上 BFS，转移全是查表 + 取模 —— 极快
   */
  var ETRANS = null, CDELTA = null, UDELTA = null;
  var NEDGE = 720 * 64;

  function edgeEncode(state) {
    for (var i = 0; i < 6; i++) {
      var j = SIG_TO_PERM[sigOfFs(state, LSE_POS_FS[i])];
      if (j < 0) return -1;
      SCRATCH_PERM[i] = j;
    }
    var code = 0;
    for (var a = 0; a < 6; a++) {
      var c = 0;
      for (var b = a + 1; b < 6; b++) if (SCRATCH_PERM[b] < SCRATCH_PERM[a]) c++;
      code = code * (6 - a) + c;
    }
    return code * 64 + lseOriN(state);
  }
  function edgeDecode(ec, out) {
    var ori = ec % 64, perm = PERMS6[(ec / 64) | 0];
    var st = out || SOLVED.slice();
    for (var z = 0; z < 54; z++) st[z] = SOLVED[z];
    for (var j = 0; j < 6; j++) {
      var fs = LSE_POS_FS[j], p = perm[j];
      var ud = PIECE_UD[p], other = PIECE_OTHER[p];
      var ySlot = Y_NORMAL[j][0] ? fs[0] : fs[1];
      var zSlot = Y_NORMAL[j][0] ? fs[1] : fs[0];
      if (((ori >> j) & 1) === 0) { st[ySlot] = ud; st[zSlot] = other; }
      else { st[ySlot] = other; st[zSlot] = ud; }
    }
    return st;
  }
  function buildETrans(cur, genIdx, out) {
    var P = LSE_GEN_PERMS[genIdx];
    for (var j = 0; j < 54; j++) out[j] = cur[P[j]];
    return out;
  }
  function buildLseTrans() {
    if (ETRANS) return;
    var A = SOLVED.slice(), B = SOLVED.slice();
    ETRANS = new Int32Array(NEDGE * 6);   // 必须 Int32：编码上限 46,079 > Int16 的 32,767
    for (var ec = 0; ec < NEDGE; ec++) {
      edgeDecode(ec, A);
      for (var g = 0; g < 6; g++) {
        buildETrans(A, g, B);
        ETRANS[ec * 6 + g] = edgeEncode(B);
      }
    }
    // 生成元对「中心旋转 / 顶角旋转」的固定增量（用复原态标定）
    CDELTA = new Int8Array(6); UDELTA = new Int8Array(6);
    for (var g2 = 0; g2 < 6; g2++) {
      var ns = applyP(SOLVED, LSE_GEN_PERMS[g2]);
      CDELTA[g2] = centerRotN(ns);
      UDELTA[g2] = cornerRotN(ns);
    }
  }
  // 联合编码：((六棱 * 4 + 中心旋转) * 4 + 顶角旋转)
  function lseEncode(state) {
    var ec = edgeEncode(state);
    if (ec < 0) return -1;
    var cr = centerRotN(state);
    if (cr < 0) return -1;
    var ur = cornerRotN(state);
    if (ur < 0) return -1;
    return (ec * 4 + cr) * 4 + ur;
  }
  function lseBuildTable() {
    if (LSE_TABLE) return LSE_TABLE;
    var t0 = Date.now();
    buildLseTrans();
    var N = NEDGE * 16;
    var dist = new Int8Array(N); dist.fill(-1);
    var q = new Int32Array(N), head = 0, tail = 0;
    dist[0] = 0; q[tail++] = 0;
    while (head < tail) {
      var c = q[head++], d = dist[c];
      var ec = (c / 16) | 0, cr = ((c / 4) | 0) & 3, ur = c & 3;
      for (var g = 0; g < 6; g++) {
        var nc = ETRANS[ec * 6 + g] * 16 + ((cr + CDELTA[g]) & 3) * 4 + ((ur + UDELTA[g]) & 3);
        if (dist[nc] < 0) { dist[nc] = d + 1; q[tail++] = nc; }
      }
    }
    LSE_TABLE = dist;
    LSE_BUILD_MS = Date.now() - t0;
    return dist;
  }
  function lseStep(cur, g) {
    // 一步转移（作用于真实 54 态）
    var P = LSE_GEN_PERMS[g], out = SOLVED.slice();
    for (var j = 0; j < 54; j++) out[j] = cur[P[j]];
    return out;
  }
  function lseSolve(state) {
    var dist = lseBuildTable();
    var c0 = lseEncode(state);
    if (c0 < 0) throw new Error('LSE 失败：状态含非 LSE 棱');
    if (c0 === 0) return { moves: [] };
    if (dist[c0] < 0) throw new Error('LSE 失败：状态不可达（c=' + c0 + '）');
    var cur = state.slice(), moves = [];
    while (lseEncode(cur) !== 0) {
      var c = lseEncode(cur), best = -1;
      for (var g = 0; g < 6; g++) {
        var ns = lseStep(cur, g);
        var nc = lseEncode(ns);
        if (nc < 0) continue;
        if (dist[nc] === dist[c] - 1) { best = g; break; }
      }
      if (best < 0) throw new Error('LSE 失败：贪心下降中断（c=' + c + '）');
      cur = lseStep(cur, best);
      moves.push(LSE_GENS[best]);
    }
    return { moves: moves };
  }

  /* ---------------- 桥块构建 ---------------- */

  // 依次执行任务表；任一任务失败返回 { ok:false, at }
  function runTasks(state, tasks, priors, pool, tag, kindOf) {
    var moves = [], log = [];
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i], r;
      if (t.single) {
        r = placeSingle(state, t.single.kind, t.single.idx, priors, pool, tag, 6);
      } else {
        r = placeGroup(state, t.pair, priors, pool, tag, 6);
      }
      if (!r.moves) return { ok: false, at: t.label, moves: moves, log: log };
      r.moves.forEach(function (sq) { state = applyP(state, permOfSeq(sq)); });
      if (t.single) priors.push(t.single);
      else priors = priors.concat(t.pair);
      var flat = [];
      r.moves.forEach(function (sq) { flat = flat.concat(sq); });
      moves = moves.concat(flat);
      log.push({ label: t.label, moves: flat });
    }
    return { ok: true, state: state, moves: moves, log: log, priors: priors };
  }

  function buildBlock(state, side, initialPriors) {
    pools();
    var tasks = side === 'FB' ? FB_TASKS : SB_TASKS;
    var tag = side + ':';
    var base = (initialPriors || []).slice();
    // 主策略：底棱 → 后对 → 前对
    var r = runTasks(state, tasks, base.slice(), POOL_ALL3, tag + 'pair' + POOL_ALL3.length, null);
    if (r.ok) return r;
    // 备选：三条棱逐个放，再两角成组
    var alt = side === 'FB' ? FB_ALT : SB_ALT;
    var tasks2 = alt[0].map(function (t) { return { single: t, label: '棱 ' + t.idx }; })
      .concat([{ pair: alt[1], label: '双角 ' + alt[1].map(function (t) { return t.idx; }).join('+') }]);
    var r2 = runTasks(state, tasks2, base.slice(), POOL_ALL3, tag + 'alt' + POOL_ALL3.length, null);
    if (r2.ok) return r2;
    return { ok: false, at: r.at || r2.at };
  }

  /* ---------------- 对外接口 ---------------- */

  function solve(state, options) {
    options = options || {};
    var t0 = Date.now();
    var cur = state.slice();
    var steps = [];
    var onStage = options.onStage || function () { };

    function record(group, title, desc, moves) {
      if (!moves || !moves.length) return;
      steps.push({ group: group, title: title, desc: desc, moves: E.normalizeSeq(moves.join(' ')), state: cur.slice() });
    }

    // ① 左桥
    var fb = buildBlock(cur, 'FB');
    if (!fb.ok) throw new Error('Roux 左桥构建失败（' + fb.at + '）');
    fb.log.forEach(function (l) {
      steps.push({ group: 'roux-fb', title: '左桥 · ' + l.label, desc: '把左桥的' + l.label + '归位（已完成的块全程不受影响）', moves: E.normalizeSeq(l.moves.join(' ')), state: cur.slice() });
    });
    cur = fb.state;
    if (![0, 1, 2].every(function (e) { return pieceHome(cur, 'edge', e); }) ||
        ![0, 1].every(function (c) { return pieceHome(cur, 'corner', c); })) {
      throw new Error('Roux 左桥校验失败');
    }
    onStage('FB', cur.slice());

    // ② 右桥（左桥五块全程作为先验受保护）
    var base = cur.slice();
    var sb = buildBlock(cur, 'SB', BRIDGE.slice(0, 5));
    if (!sb.ok) throw new Error('Roux 右桥构建失败（' + sb.at + '）');
    sb.log.forEach(function (l) {
      steps.push({ group: 'roux-sb', title: '右桥 · ' + l.label, desc: '把右桥的' + l.label + '归位（左桥全程不受影响）', moves: E.normalizeSeq(l.moves.join(' ')), state: base.slice() });
    });
    cur = sb.state;
    if (!bridgeHome(cur)) throw new Error('Roux 右桥校验失败（双桥被破坏）');
    onStage('SB', cur.slice());

    // ③ CMLL
    var cmll = solveCMLL(cur);
    if (cmll.moves.length) {
      steps.push({
        group: 'roux-cmll', title: '顶层四角（CMLL）',
        desc: '用保桥公式同时完成顶层四角的朝向与归位（' + cmll.algs.join(' / ') + '）',
        moves: E.normalizeSeq(cmll.moves.join(' ')), state: cur.slice()
      });
      cur = E.applySeq(cur, cmll.moves);
    }
    if (!cmllDone(cur)) throw new Error('Roux CMLL 校验失败');
    if (!bridgeHome(cur)) throw new Error('Roux CMLL 破坏了双桥');
    onStage('CMLL', cur.slice());

    // ④ LSE
    var lse = lseSolve(cur);
    if (lse.moves.length) {
      steps.push({
        group: 'roux-lse', title: '最后六棱（LSE）',
        desc: '只剩中层与顶层六条棱，仅用 M / U 两个转动即可完成（查预查表取最短解）',
        moves: E.normalizeSeq(lse.moves.join(' ')), state: cur.slice()
      });
      cur = E.applySeq(cur, lse.moves);
    }
    onStage('LSE', cur.slice());

    if (!E.isSolved(cur)) throw new Error('Roux 求解失败：最终状态未复原');

    return {
      steps: steps,
      totalMoves: steps.reduce(function (n, s) { return n + s.moves.length; }, 0),
      ms: Date.now() - t0
    };
  }

  var Roux = {
    solve: solve,
    prewarm: function () { pools(); lseBuildTable(); cmllPool(); },
    stats: function () {
      pools();
      return {
        poolAll3: POOL_ALL3.length, poolRum3: POOL_RUM3 ? POOL_RUM3.length : 0,
        cmllAlgs: cmllPool().length, lseBuildMs: LSE_BUILD_MS
      };
    },
    CMLL_ALGS: CMLL_ALGS,
    // 供测试做自洽性核查（不参与解题逻辑）
    _internals: function () {
      buildLseTrans();
      return {
        edgeEncode: edgeEncode, lseEncode: lseEncode, centerRotN: centerRotN, cornerRotN: cornerRotN,
        CDELTA: CDELTA, UDELTA: UDELTA, ETRANS: ETRANS, NEDGE: NEDGE,
        LSE_GENS: LSE_GENS, LSE_GEN_PERMS: LSE_GEN_PERMS,
        buildTable: lseBuildTable, bridgeHome: bridgeHome, pieceHome: pieceHome
      };
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Roux;
  else global.CubeRoux = Roux;
})(typeof window !== 'undefined' ? window : globalThis);
