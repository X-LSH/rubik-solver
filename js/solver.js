/* =========================================================================
 * solver.js — 层先法（LBL）与 CFOP 分组求解器
 * 核心策略：
 *  1. 前三层：每个目标块在 24 态子状态图上做 BFS，生成元 = 单步转动 +
 *     "净保持先验"的宏观序列（共轭提取宏 / 翻棱宏 / sexy 插入 / 中层插入公式）。
 *     每个生成元先通过置换合成验证"不破坏任何已完成块"，动态过滤。
 *  2. 顶层：2-look OLL / PLL 经典公式作为生成元（验证不破坏下层），
 *     在顶层面/排列状态空间上 BFS。
 * ========================================================================= */
(function (global) {
  'use strict';

  var E = (typeof module !== 'undefined' && module.exports) ? require('./cube-engine.js') : global.CubeEngine;
  var FACES = E.FACES;

  /* ---------------- 基础工具 ---------------- */

  function permInverse(P) {
    var inv = new Array(54);
    for (var j = 0; j < 54; j++) inv[P[j]] = j;
    return inv;
  }
  function composePerm(P, Q) { // out[j] = state[P[Q[j]]]（先 P 后 Q）
    var out = new Array(54);
    for (var j = 0; j < 54; j++) out[j] = P[Q[j]];
    return out;
  }
  function permOfSeq(seq) {
    var moves = E.normalizeSeq(seq);
    var R = new Array(54);
    for (var j = 0; j < 54; j++) R[j] = j;
    moves.forEach(function (m) {
      var p = E.parseMove(m);
      R = composePerm(R, E.PERMS[p.face][p.times - 1]);
    });
    return R;
  }
  function key(p) { return p.join(','); }
  function faceOfIdx(i) { return FACES[(i / 9) | 0]; }

  function normColors(state) {
    var centers = [4, 13, 22, 31, 40, 49].map(function (i) { return state[i]; });
    var map = {};
    FACES.forEach(function (f, idx) { map[centers[idx]] = f; });
    return state.map(function (c) { return map[c]; });
  }
  function centerColor(state, face) {
    return state[{ U: 4, R: 13, F: 22, D: 31, L: 40, B: 49 }[face]];
  }
  function faceOfCenter(state, color) {
    for (var i = 0; i < 6; i++) {
      if (state[[4, 13, 22, 31, 40, 49][i]] === color) return FACES[i];
    }
    return null;
  }
  function pieceSolvedAt(state, pos) {
    var nc = normColors(state);
    return E.faceletsAt(pos).every(function (i) { return nc[i] === faceOfIdx(i); });
  }

  /* ---------------- 块子状态定义 ---------------- */

  function primaryFace(pos) {
    if (pos[1] !== 0) return pos[1] > 0 ? 'U' : 'D';
    return pos[2] > 0 ? 'F' : 'B';
  }
  var EDGE_SUBS = E.EDGE_POS.map(function (p) {
    var fs = E.faceletsAt(p);
    var prim = primaryFace(p);
    return {
      pos: p, k: key(p), primary: prim,
      fPrim: fs.filter(function (i) { return faceOfIdx(i) === prim; })[0],
      fSec: fs.filter(function (i) { return faceOfIdx(i) !== prim; })[0]
    };
  });
  var CORNER_SUBS = E.CORNER_POS.map(function (p) {
    var fs = E.faceletsAt(p);
    var udSlot = -1;
    fs.forEach(function (i, j) { var f = faceOfIdx(i); if (f === 'U' || f === 'D') udSlot = j; });
    return { pos: p, k: key(p), facelets: fs, udSlot: udSlot };
  });
  function edgeSubIdx(pos) { for (var i = 0; i < 12; i++) if (EDGE_SUBS[i].k === key(pos)) return i; return -1; }
  function cornerSubIdx(pos) { for (var i = 0; i < 8; i++) if (CORNER_SUBS[i].k === key(pos)) return i; return -1; }

  var MOVE_LIST = [];
  FACES.forEach(function (f) { ['', "'", '2'].forEach(function (s) { MOVE_LIST.push(f + s); }); });

  var PINV = {};
  MOVE_LIST.forEach(function (m) {
    var p = E.parseMove(m);
    PINV[m] = permInverse(E.PERMS[p.face][p.times - 1]);
  });

  // 单步子状态映射：棱 s*2+ori（ori=0 ⟺ 块主色贴纸在主面）；角 s*3+ori（ori = U/D 贴纸自然槽位）
  var EDGE_MAPS = {}, CORNER_MAPS = {};
  (function buildMaps() {
    MOVE_LIST.forEach(function (m) {
      var pinv = PINV[m];
      var em = new Array(24), cm = new Array(24);
      for (var s = 0; s < 12; s++) {
        var sub = EDGE_SUBS[s];
        for (var ori = 0; ori < 2; ori++) {
          var src = ori === 0 ? sub.fPrim : sub.fSec;
          var dst = pinv[src], t = -1, dOri = -1;
          for (var u = 0; u < 12; u++) {
            if (EDGE_SUBS[u].fPrim === dst) { t = u; dOri = 0; break; }
            if (EDGE_SUBS[u].fSec === dst) { t = u; dOri = 1; break; }
          }
          em[s * 2 + ori] = t * 2 + dOri;
        }
      }
      EDGE_MAPS[m] = em;
      for (var c = 0; c < 8; c++) {
        var csub = CORNER_SUBS[c];
        for (var o = 0; o < 3; o++) {
          var cdst = pinv[csub.facelets[o]], ct = -1, cOri = -1;
          for (var v = 0; v < 8; v++) {
            var kk = CORNER_SUBS[v].facelets.indexOf(cdst);
            if (kk >= 0) { ct = v; cOri = kk; break; }
          }
          cm[c * 3 + o] = ct * 3 + cOri;
        }
      }
      CORNER_MAPS[m] = cm;
    });
  })();

  // 宏（序列）的合成子状态映射：next = MAP[cur] 型函数复合（先应用先出现的转动）
  function macroMap(seq, kind) {
    var maps = kind === 'edge' ? EDGE_MAPS : CORNER_MAPS;
    var N = 24, R = new Array(N);
    for (var i = 0; i < N; i++) R[i] = i;
    E.normalizeSeq(seq).forEach(function (m) {
      var M = maps[m], out = new Array(N);
      for (var j = 0; j < N; j++) out[j] = M[R[j]];
      R = out;
    });
    return R;
  }

  // 块当前子状态
  function edgeSubOf(state, piecePos, colors) {
    var s = edgeSubIdx(piecePos);
    var nc = normColors(state);
    var colorSet = colors.slice().map(function (c) { return faceOfCenter(state, c); }).sort().join('');
    var home = -1;
    for (var i = 0; i < 12; i++) {
      if (E.faceletsAt(EDGE_SUBS[i].pos).map(faceOfIdx).sort().join('') === colorSet) { home = i; break; }
    }
    var c1 = primaryFace(EDGE_SUBS[home].pos);
    return s * 2 + ((nc[EDGE_SUBS[s].fPrim] === c1) ? 0 : 1);
  }
  function cornerSubOf(state, piecePos) {
    var s = cornerSubIdx(piecePos);
    var nc = normColors(state);
    var ori = -1;
    for (var j = 0; j < 3; j++) {
      var v = nc[CORNER_SUBS[s].facelets[j]];
      if (v === 'U' || v === 'D') { ori = j; break; }
    }
    return s * 3 + ori;
  }

  /* ---------------- 宏生成元池 ---------------- */

  // 面代换（绕 y 轴旋转族）：把以 F/R 为主写的公式转到其他槽位
  var Y_ROTS = [
    { F: 'F', R: 'R', B: 'B', L: 'L' },               // 0
    { F: 'R', R: 'B', B: 'L', L: 'F' },               // y
    { F: 'B', R: 'L', B: 'F', L: 'R' },               // y2
    { F: 'L', R: 'F', B: 'R', L: 'B' }                // y'
  ];
  function subst(seq, rot) {
    return E.normalizeSeq(seq).map(function (m) {
      var f = m[0], rest = m.slice(1);
      return (rot[f] || f) + rest; // U/D 不受 y 旋转影响
    }).join(' ');
  }

  function buildGeneratorPool() {
    var pool = [];
    MOVE_LIST.forEach(function (m) { pool.push({ seq: m }); });
    // 共轭提取宏：X U^k X' / X' U^k X（净保持整个 D 层）
    ['F', 'R', 'B', 'L'].forEach(function (X) {
      ['U', 'U2', "U'"].forEach(function (U) {
        pool.push({ seq: X + ' ' + U + " " + X + "'" });
        pool.push({ seq: X + "' " + U + ' ' + X });
      });
    });
    // 翻棱宏：X' Z' U^k Z X（X' 后块落到 (X,Z) 中层槽，Z' 把它翻上顶层）
    var FLIP = { F: 'L', R: 'F', B: 'R', L: 'B' };
    ['F', 'R', 'B', 'L'].forEach(function (X) {
      var Z = FLIP[X];
      ['U', 'U2', "U'"].forEach(function (U) {
        pool.push({ seq: X + "' " + Z + "' " + U + ' ' + Z + ' ' + X });
      });
    });
    // sexy 插入宏（底层角）：槽 (D,f,r) 的 r 面版本 "r U r' U'" 及其逆 "U r U r'"? 
    // 逆 = U R U' R'（标准）。按 y 旋转代换生成 4 槽版本。
    var SLOT_RIGHT = { DFR: 'R', DRB: 'B', DBL: 'L', DLF: 'F' };
    var SLOT_ROT = { DFR: Y_ROTS[0], DRB: Y_ROTS[1], DBL: Y_ROTS[2], DLF: Y_ROTS[3] };
    Object.keys(SLOT_RIGHT).forEach(function (slot) {
      var r = SLOT_RIGHT[slot], rot = SLOT_ROT[slot];
      pool.push({ seq: subst("R U R' U'", rot), tag: 'sexy:' + slot });
      pool.push({ seq: subst("U R U' R'", rot), tag: 'sexyinv:' + slot });
    });
    // 中层棱插入宏：右插 "U R U' R' U' F' U F"、左插 "U' L' U L U F U' F'"
    // 槽 FR 用原式；其余槽按 y 代换。
    var MID_SLOT_ROT = { FR: Y_ROTS[0], RB: Y_ROTS[1], BL: Y_ROTS[2], LF: Y_ROTS[3] };
    Object.keys(MID_SLOT_ROT).forEach(function (slot) {
      var rot = MID_SLOT_ROT[slot];
      pool.push({ seq: subst("U R U' R' U' F' U F", rot), tag: 'insR:' + slot });
      pool.push({ seq: subst("U' L' U L U F U' F'", rot), tag: 'insL:' + slot });
    });
    return pool;
  }
  var GEN_POOL = buildGeneratorPool();

  /* ---------------- 子状态 BFS（宏生成元 + 先验过滤） ---------------- */

  function bfsPiece(startSub, goalSub, priors, kind) {
    // priors: [{kind, goal}] 已完成块
    if (startSub === goalSub) return [];
    // 预过滤生成元：宏的合成映射必须固定所有先验目标子状态
    var gens = [];
    for (var gi = 0; gi < GEN_POOL.length; gi++) {
      var g = GEN_POOL[gi];
      var map = macroMap(g.seq, kind);
      var ok = true;
      for (var pi = 0; pi < priors.length; pi++) {
        var pm = macroMap(g.seq, priors[pi].kind);
        if (pm[priors[pi].goal] !== priors[pi].goal) { ok = false; break; }
      }
      if (ok) gens.push({ seq: g.seq, map: map });
    }
    var prev = {}; prev[startSub] = { g: -1, from: -1 };
    var queue = [startSub];
    while (queue.length) {
      var cur = queue.shift();
      for (var t = 0; t < gens.length; t++) {
        var nxt = gens[t].map[cur];
        if (nxt in prev) continue;
        prev[nxt] = { g: t, from: cur };
        if (nxt === goalSub) {
          var path = [], node = nxt;
          while (node !== startSub) { path.unshift(gens[prev[node].g].seq); node = prev[node].from; }
          return path;
        }
        queue.push(nxt);
      }
    }
    return null;
  }

  /* ---------------- 任务定义 ---------------- */

  var SIDE_N = { F: [0, 0, 1], R: [1, 0, 0], B: [0, 0, -1], L: [-1, 0, 0] };
  var SIDE_POS = { F: [0, -1, 1], R: [1, -1, 0], B: [0, -1, -1], L: [-1, -1, 0] };

  function buildTasks(state) {
    var w = centerColor(state, 'D');
    var tasks = [];
    ['F', 'R', 'B', 'L'].forEach(function (side) {
      var c = centerColor(state, side);
      tasks.push({
        kind: 'edge', pos: SIDE_POS[side], colors: [w, c],
        title: '底棱·' + E.COLOR_NAME[c], group: 'cross',
        desc: '将「' + E.COLOR_NAME[w] + E.COLOR_NAME[c] + '」棱块放入底层十字'
      });
    });
    [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']].forEach(function (sides) {
      var c1 = centerColor(state, sides[0]), c2 = centerColor(state, sides[1]);
      var n1 = SIDE_N[sides[0]], n2 = SIDE_N[sides[1]];
      tasks.push({
        kind: 'corner', pos: [n1[0] + n2[0], -1, n1[2] + n2[2]], colors: [w, c1, c2],
        title: '底角·' + E.COLOR_NAME[c1] + E.COLOR_NAME[c2], group: 'corner',
        desc: '将「' + E.COLOR_NAME[w] + E.COLOR_NAME[c1] + E.COLOR_NAME[c2] + '」角块放入底角'
      });
    });
    [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']].forEach(function (sides) {
      var c1 = centerColor(state, sides[0]), c2 = centerColor(state, sides[1]);
      var n1 = SIDE_N[sides[0]], n2 = SIDE_N[sides[1]];
      tasks.push({
        kind: 'edge', pos: [n1[0] + n2[0], 0, n1[2] + n2[2]], colors: [c1, c2],
        title: '中层棱·' + E.COLOR_NAME[c1] + E.COLOR_NAME[c2], group: 'middle',
        desc: '将「' + E.COLOR_NAME[c1] + E.COLOR_NAME[c2] + '」棱块放入中层'
      });
    });
    return tasks;
  }

  /* ---------------- 顶层生成元（验证后使用） ---------------- */

  var F2L_FACELETS = [];
  for (var fi = 0; fi < 54; fi++) {
    var ff = (fi / 9) | 0, fr = ((fi % 9) / 3) | 0;
    if (ff !== 0 && fr !== 0) F2L_FACELETS.push(fi);
  }
  var TOP_EDGE_POS = [[0, 1, 1], [1, 1, 0], [0, 1, -1], [-1, 1, 0]]; // UF UR UB UL
  var TOP_CORNER_POS = [[1, 1, 1], [1, 1, -1], [-1, 1, -1], [-1, 1, 1]];

  function verifyAlg(seq, opts) {
    try {
      var P = permOfSeq(seq);
      for (var i = 0; i < F2L_FACELETS.length; i++) {
        if (P[F2L_FACELETS[i]] !== F2L_FACELETS[i]) return null;
      }
      var pinv = permInverse(P);
      var topFacelets = [];
      TOP_EDGE_POS.concat(TOP_CORNER_POS).forEach(function (p) {
        E.faceletsAt(p).forEach(function (i) { topFacelets.push(i); });
      });
      for (var j = 0; j < topFacelets.length; j++) {
        var d = pinv[topFacelets[j]];
        var df = (d / 9) | 0, dr = ((d % 9) / 3) | 0;
        if (!(df === 0 || dr === 0)) return null;
      }
      if (opts && opts.fixCorners) {
        for (var k = 0; k < TOP_CORNER_POS.length; k++) {
          var fs = E.faceletsAt(TOP_CORNER_POS[k]);
          for (var k2 = 0; k2 < fs.length; k2++) if (P[fs[k2]] !== fs[k2]) return null;
        }
      }
      if (opts && opts.keepCornerOri) {
        for (var k3 = 0; k3 < TOP_CORNER_POS.length; k3++) {
          var uf = E.faceletsAt(TOP_CORNER_POS[k3]).filter(function (i) { return faceOfIdx(i) === 'U'; })[0];
          if (faceOfIdx(pinv[uf]) !== 'U') return null;
        }
      }
      if (opts && opts.keepTopCross) {
        for (var k4 = 0; k4 < TOP_EDGE_POS.length; k4++) {
          var uf2 = E.faceletsAt(TOP_EDGE_POS[k4]).filter(function (i) { return faceOfIdx(i) === 'U'; })[0];
          if (faceOfIdx(pinv[uf2]) !== 'U') return null;
        }
      }
      return P;
    } catch (e) { return null; }
  }

  var GENS = (function () {
    var defs = {
      U: { seq: 'U', opts: {} },
      ollEdge: { seq: "F R U R' U' F'", opts: {} },
      ollEdge2: { seq: "F U R U' R' F'", opts: {} },
      sune: { seq: "R U R' U R U2 R'", opts: { keepTopCross: true } },
      antisune: { seq: "R U2 R' U' R U' R'", opts: { keepTopCross: true } },
      tperm: { seq: "R U R' U' R' F R2 U' R' U' R U R' F'", opts: { keepCornerOri: true } },
      uaperm: { seq: "R U' R U R U R U' R' U' R2", opts: { fixCorners: true } },
      ubperm: { seq: "R2 U R U R' U' R' U' R' U R'", opts: { fixCorners: true } }
    };
    var out = {};
    Object.keys(defs).forEach(function (k) {
      var P = verifyAlg(defs[k].seq, defs[k].opts);
      if (P) out[k] = { seq: defs[k].seq, perm: P, pinv: permInverse(P) };
    });
    return out;
  })();

  /* ---------------- 顶层状态空间 BFS ---------------- */

  function topEdgeBitsState(state, topColor) {
    var b = 0;
    TOP_EDGE_POS.forEach(function (p, i) {
      var uf = E.faceletsAt(p).filter(function (x) { return faceOfIdx(x) === 'U'; })[0];
      if (state[uf] === topColor) b |= (1 << i);
    });
    return b;
  }
  function edgeBitsGenMap(gen) {
    var map = new Array(16);
    for (var s = 0; s < 16; s++) {
      var nb = 0;
      for (var i = 0; i < 4; i++) {
        var fs = E.faceletsAt(TOP_EDGE_POS[i]);
        var fU = fs.filter(function (x) { return faceOfIdx(x) === 'U'; })[0];
        var fS = fs.filter(function (x) { return faceOfIdx(x) !== 'U'; })[0];
        var dst = gen.pinv[((s >> i) & 1) ? fU : fS];
        for (var j = 0; j < 4; j++) {
          var fUj = E.faceletsAt(TOP_EDGE_POS[j]).filter(function (x) { return faceOfIdx(x) === 'U'; })[0];
          if (dst === fUj) { nb |= (1 << j); break; }
        }
      }
      map[s] = nb;
    }
    return map;
  }
  function cornerOriState(state, topColor) {
    var v = 0;
    TOP_CORNER_POS.forEach(function (p) {
      var fs = E.faceletsAt(p), slot = 0;
      for (var j = 0; j < 3; j++) {
        if (state[fs[j]] === topColor) { slot = j; break; } // 顶色贴纸所在自然槽位
      }
      v = v * 3 + slot;
    });
    return v;
  }
  function cornerOriGenMap(gen) {
    var map = new Array(81);
    for (var s = 0; s < 81; s++) {
      var slots = [], x = s;
      for (var i = 3; i >= 0; i--) { slots[i] = x % 3; x = (x / 3) | 0; }
      var nb = [0, 0, 0, 0];
      for (var i2 = 0; i2 < 4; i2++) {
        var dst = gen.pinv[E.faceletsAt(TOP_CORNER_POS[i2])[slots[i2]]];
        for (var j = 0; j < 4; j++) {
          var kk = E.faceletsAt(TOP_CORNER_POS[j]).indexOf(dst);
          if (kk >= 0) { nb[j] = kk; break; }
        }
      }
      map[s] = ((nb[0] * 3 + nb[1]) * 3 + nb[2]) * 3 + nb[3];
    }
    return map;
  }
  function bfsNumPath(start, goal, transitions) {
    if (start === goal) return [];
    var prev = {}; prev[start] = { t: -1, from: -1 };
    var queue = [start];
    while (queue.length) {
      var cur = queue.shift();
      for (var t = 0; t < transitions.length; t++) {
        var nxt = transitions[t].map[cur];
        if (nxt in prev) continue;
        prev[nxt] = { t: t, from: cur };
        if (nxt === goal) {
          var path = [], node = nxt;
          while (node !== start) { path.unshift(transitions[prev[node].t].name); node = prev[node].from; }
          return path;
        }
        queue.push(nxt);
      }
    }
    return null;
  }
  function bfsPerm(startArr, gens) {
    var gk = '0,1,2,3', sk = startArr.join(',');
    if (sk === gk) return [];
    var prev = {}; prev[sk] = null;
    var queue = [startArr];
    while (queue.length) {
      var curArr = queue.shift();
      for (var t = 0; t < gens.length; t++) {
        var nxt = gens[t].applyTo(curArr);
        var nk = nxt.join(',');
        if (nk in prev) continue;
        prev[nk] = { gen: t, from: curArr };
        if (nk === gk) {
          var path = [], node = nxt;
          while (node.join(',') !== sk) {
            var info = prev[node.join(',')];
            path.unshift(gens[info.gen].seq);
            node = info.from;
          }
          return path;
        }
        queue.push(nxt);
      }
    }
    return null;
  }
  function makePermGens(TOP_POS) {
    var gens = [];
    if (GENS.U) gens.push(GENS.U);
    return gens;
  }
  function permApplyGen(arr, gen, TOP_POS) {
    var out = new Array(4);
    for (var i = 0; i < 4; i++) {
      var uf = E.faceletsAt(TOP_POS[i]).filter(function (x) { return faceOfIdx(x) === 'U'; })[0];
      var dst = gen.pinv[uf];
      for (var j = 0; j < 4; j++) {
        if (E.faceletsAt(TOP_POS[j]).indexOf(dst) >= 0) { out[j] = arr[i]; break; }
      }
    }
    return out;
  }

  /* ---------------- 主求解流程 ---------------- */

  function solve(state, options) {
    options = options || {};
    var mode = options.mode || 'lbl';
    var cur = state.slice();
    var steps = [];

    function record(group, title, desc, moves) {
      if (moves && moves.length) steps.push({ group: group, title: title, desc: desc, moves: moves, state: cur.slice() });
    }
    function apply(seqList) {
      var all = [];
      seqList.forEach(function (s) { all.push.apply(all, E.normalizeSeq(s)); });
      cur = E.applySeq(cur, all);
      return E.normalizeSeq(all.join(' '));
    }

    var topColor = centerColor(cur, 'U');
    var tasks = buildTasks(cur);
    var cross = tasks.filter(function (t) { return t.group === 'cross'; });
    var corners = tasks.filter(function (t) { return t.group === 'corner'; });
    var middles = tasks.filter(function (t) { return t.group === 'middle'; });

    var priors = []; // {kind, goal}

    function doTask(task, group, title) {
      var piece = E.findPiece(cur, task.colors);
      if (!piece) throw new Error('找不到块: ' + task.colors.join(','));
      var startSub, goalSub;
      if (task.kind === 'edge') {
        startSub = edgeSubOf(cur, piece.pos, task.colors);
        goalSub = edgeSubIdx(task.pos) * 2;
      } else {
        startSub = cornerSubOf(cur, piece.pos);
        goalSub = cornerSubIdx(task.pos) * 3 + CORNER_SUBS[cornerSubIdx(task.pos)].udSlot;
      }
      var path = bfsPiece(startSub, goalSub, priors, task.kind);
      if (path === null) throw new Error('BFS 失败: ' + task.title + ' start=' + startSub + ' goal=' + goalSub);
      var moves = apply(path);
      if (!pieceSolvedAt(cur, task.pos)) throw new Error('块未就位: ' + task.title);
      priors.push({ kind: task.kind, goal: goalSub });
      record(group, title, task.desc, moves);
    }

    cross.forEach(function (t) { doTask(t, 'cross', t.title); });
    if (mode === 'lbl') {
      corners.forEach(function (t) { doTask(t, 'corner', t.title); });
      middles.forEach(function (t) { doTask(t, 'middle', t.title); });
    } else {
      var names = ['前右', '右后', '后左', '左前'];
      for (var i = 0; i < 4; i++) {
        doTask(corners[i], 'f2l', 'F2L·' + names[i] + '（角）');
        doTask(middles[i], 'f2l', 'F2L·' + names[i] + '（棱）');
      }
    }

    // ---- 顶十字 ----
    (function topCross() {
      var gens = [];
      if (GENS.U) gens.push({ name: 'U', map: edgeBitsGenMap(GENS.U) });
      if (GENS.ollEdge) gens.push({ name: GENS.ollEdge.seq, map: edgeBitsGenMap(GENS.ollEdge) });
      if (GENS.ollEdge2) gens.push({ name: GENS.ollEdge2.seq, map: edgeBitsGenMap(GENS.ollEdge2) });
      var start = topEdgeBitsState(cur, topColor);
      var path = bfsNumPath(start, 15, gens);
      if (path === null) throw new Error('顶十字 BFS 失败');
      record('oll', '顶层十字', '翻棱公式将顶棱转为顶色朝上（2-look OLL 第 1 步）', apply(path));
    })();

    // ---- 顶角朝向 ----
    (function cornerOri() {
      var gens = [];
      if (GENS.U) gens.push({ name: 'U', map: cornerOriGenMap(GENS.U) });
      if (GENS.sune) gens.push({ name: GENS.sune.seq, map: cornerOriGenMap(GENS.sune) });
      if (GENS.antisune) gens.push({ name: GENS.antisune.seq, map: cornerOriGenMap(GENS.antisune) });
      var goal = 0;
      TOP_CORNER_POS.forEach(function (p) {
        var fs = E.faceletsAt(p), ud = 0;
        for (var j = 0; j < 3; j++) { var f = faceOfIdx(fs[j]); if (f === 'U' || f === 'D') ud = j; }
        goal = goal * 3 + ud;
      });
      var start = cornerOriState(cur, topColor);
      var path = bfsNumPath(start, goal, gens);
      if (path === null) throw new Error('顶角朝向 BFS 失败');
      record('oll', '顶面同色', 'Sune / 反 Sune 公式将顶角全部翻到顶色朝上（2-look OLL 第 2 步）', apply(path));
    })();

    // ---- 顶角排列 + 顶棱排列（联合 PLL：两者通过 U 转动耦合，必须联合求解） ----
    (function jointPLL() {
      var TE = TOP_EDGE_POS, TC = TOP_CORNER_POS;
      var nc = normColors(cur);
      var eHome = TE.map(function (p) { return E.faceletsAt(p).map(faceOfIdx).sort().join(''); });
      var cHome = TC.map(function (p) { return E.faceletsAt(p).map(faceOfIdx).sort().join(''); });
      var startE = TE.map(function (p) { return eHome.indexOf(E.faceletsAt(p).map(function (i) { return nc[i]; }).sort().join('')); });
      var startC = TC.map(function (p) { return cHome.indexOf(E.faceletsAt(p).map(function (i) { return nc[i]; }).sort().join('')); });
      var gE = '0,1,2,3', gC = '0,1,2,3';
      var sk = startE.join(',') + '|' + startC.join(',');
      var gk = gE + '|' + gC;
      if (sk === gk) return;

      var gens = [];
      if (GENS.U) gens.push({ seq: GENS.U.seq, pinv: GENS.U.pinv });
      if (GENS.tperm) gens.push({ seq: GENS.tperm.seq, pinv: GENS.tperm.pinv });
      if (GENS.uaperm) gens.push({ seq: GENS.uaperm.seq, pinv: GENS.uaperm.pinv });
      if (GENS.ubperm) gens.push({ seq: GENS.ubperm.seq, pinv: GENS.ubperm.pinv });

      function applyPerm(arr, pinv, TOP_POS) {
        var out = new Array(4);
        for (var i = 0; i < 4; i++) {
          var uf = E.faceletsAt(TOP_POS[i]).filter(function (x) { return faceOfIdx(x) === 'U'; })[0];
          var dst = pinv[uf];
          for (var j = 0; j < 4; j++) {
            if (E.faceletsAt(TOP_POS[j]).indexOf(dst) >= 0) { out[j] = arr[i]; break; }
          }
        }
        return out;
      }
      function genApply(g, eArr, cArr) {
        return [applyPerm(eArr, g.pinv, TE), applyPerm(cArr, g.pinv, TC)];
      }

      var prev = {}; prev[sk] = null;
      var queue = [[startE, startC]];
      var path = null;
      while (queue.length && !path) {
        var curPair = queue.shift();
        for (var t = 0; t < gens.length; t++) {
          var nxt = genApply(gens[t], curPair[0], curPair[1]);
          var nk = nxt[0].join(',') + '|' + nxt[1].join(',');
          if (nk in prev) continue;
          prev[nk] = { gen: t, from: curPair };
          if (nk === gk) {
            path = [];
            var node = nxt;
            while (node.join && node[0].join(',') + '|' + node[1].join(',') !== sk) {
              var info = prev[node[0].join(',') + '|' + node[1].join(',')];
              path.unshift(gens[info.gen].seq);
              node = info.from;
            }
            break;
          }
          queue.push(nxt);
        }
      }
      if (!path) throw new Error('联合 PLL BFS 失败');
      record('pll', '顶层归位', 'U / T-perm / U-perm 组合将顶层角棱全部归位（2-look PLL）', apply(path));
    })();

    if (!E.isSolved(cur)) {
      var err = new Error('求解失败：最终状态未复原');
      err.debugSteps = steps;
      throw err;
    }

    return { steps: steps, totalMoves: steps.reduce(function (n, s) { return n + s.moves.length; }, 0) };
  }

  var Solver = { solve: solve, GENS: GENS, normColors: normColors };
  if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
  else global.CubeSolver = Solver;
})(typeof window !== 'undefined' ? window : globalThis);
