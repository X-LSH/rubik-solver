/* =========================================================================
 * kociemba.js — Kociemba 两阶段（Two-Phase）近最优解求解器
 *
 * 思路：把还原过程拆成两个阶段，各自在自己的坐标空间里搜索。
 *   阶段 1：只关心「棱朝向 EO + 角朝向 CO + 中层棱是否回到中层（slice）」，
 *          用全部 18 个面转动，把魔方推进到 G1 = <U,D,R2,L2,F2,B2> 子群里。
 *   阶段 2：此时朝向已全部正确、中层棱已在位，改用 10 个「半转为主」的转动
 *          （U/U2/U'/D/D2/D'/R2/L2/F2/B2）把角与棱的排列彻底归位。
 *
 * 坐标系（都是小块层面上的整数坐标，不存 54 贴纸）：
 *   eo    棱朝向            2^11            = 2048
 *   co    角朝向            3^7             = 2187
 *   slice 中层 4 棱的位置组合 (12 选 4)      = 495
 *   cp    角排列            8!              = 40320
 *   ep8   U/D 层 8 棱的排列  8!              = 40320
 *   sperm 中层 4 棱的排列    4!              = 24
 *
 * 剪枝表（BFS 反向展开得到每态到目标的最少步数下界）：
 *   PT_SE  slice×eo   1,013,760   （阶段 1 启发式）
 *   PT_SC  slice×co   1,082,565   （阶段 1 启发式）
 *   PT_CP  cp            40,320   （阶段 2 启发式）
 *   PT_EP  ep8           40,320   （阶段 2 启发式）
 *   PT_SP  sperm             24   （阶段 2 启发式）
 *
 * 注意：这里的坐标 ≠ engine 的 54-facelet 表示。两者之间的桥梁是
 * 「读出每个位置上的块是哪个块」——颜色必须经 色字母→面名 转换后再比较，
 * 因为 engine 的 state 存的是绝对色（W/R/G/Y/O/B），而块名是面名（UR/URF…）。
 * ========================================================================= */
(function (global) {
  'use strict';

  var E = (typeof module !== 'undefined' && module.exports) ? require('./cube-engine.js') : global.CubeEngine;
  var FACES = E.FACES, SC = E.STD_COLORS;

  function faceOfIdx(i) { return FACES[(i / 9) | 0]; }
  function sortFaces(s) { return s.split('').sort().join(''); }

  // 色字母 → 面名（'W'→'U', 'R'→'R', …）
  var C2F = {}; FACES.forEach(function (f) { C2F[SC[f]] = f; });

  var SOLVED = E.solvedState();

  /* ---------------- Kociemba 标准块序 ---------------- */

  var KEDGES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
  var KSIG_E = KEDGES.map(sortFaces);
  var KEO = KEDGES.map(function (nm) {
    for (var i = 0; i < 12; i++)
      if (sortFaces(E.faceletsAt(E.EDGE_POS[i]).map(faceOfIdx).join('')) === sortFaces(nm)) return i;
    return -1;
  });
  var KCORNERS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
  var KSIG_C = KCORNERS.map(sortFaces);
  var KCO = KCORNERS.map(function (nm) {
    for (var i = 0; i < 8; i++)
      if (sortFaces(E.faceletsAt(E.CORNER_POS[i]).map(faceOfIdx).join('')) === sortFaces(nm)) return i;
    return -1;
  });

  /* ---------------- 54 贴纸 → 块级紧凑状态 ---------------- */

  var CHIR = [1, 1, 0, 0, 0, 1, 1, 0];

  // 位置上的贴纸色（绝对色字母）→ 面名字符串
  function facesOfColors(state, idxs) { return idxs.map(function (i) { return C2F[state[i]]; }).join(''); }

  function decode(state) {
    var ep = new Array(12), eo = new Array(12), cp = new Array(8), co = new Array(8);
    var udc = [SC.U, SC.D], fbc = [SC.F, SC.B];

    for (var k = 0; k < 12; k++) {
      var epos = E.EDGE_POS[KEO[k]], efs = E.faceletsAt(epos);
      ep[k] = KSIG_E.indexOf(sortFaces(facesOfColors(state, efs)));

      // 朝向：块的「主色」（含 U/D 色者优先，否则取含 F/B 色者）所在贴纸的法向
      // 是否等于该位置的 slot0 法向
      var slot0 = epos[1] !== 0 ? [0, epos[1], 0] : [0, 0, epos[2]];
      var cols = efs.map(function (x) { return state[x]; });
      var c0 = cols.filter(function (c) { return udc.indexOf(c) >= 0; })
                   .concat(cols.filter(function (c) { return fbc.indexOf(c) >= 0; }))[0];
      var ci = -1;
      for (var t = 0; t < efs.length; t++) if (state[efs[t]] === c0) { ci = efs[t]; break; }
      var n = E.PNS[ci].nrm;
      eo[k] = (n[0] === slot0[0] && n[1] === slot0[1] && n[2] === slot0[2]) ? 0 : 1;
    }

    for (var j = 0; j < 8; j++) {
      var cpos = E.CORNER_POS[KCO[j]], cfs = E.faceletsAt(cpos);
      cp[j] = KSIG_C.indexOf(sortFaces(facesOfColors(state, cfs)));

      // 角朝向：与 engine.validate() 完全同一口径（含手性表）
      var uf = -1;
      for (var k1 = 0; k1 < 3; k1++) { var f = faceOfIdx(cfs[k1]); if (f === 'U' || f === 'D') { uf = k1; break; } }
      var us = -1;
      for (var k2 = 0; k2 < 3; k2++) if ([SC.U, SC.D].indexOf(state[cfs[k2]]) >= 0) { us = k2; break; }
      var o;
      if (us === uf) o = 0;
      else { var other = 3 - uf - us; o = CHIR[KCO[j]] ? (us < other ? 1 : 2) : (us < other ? 2 : 1); }
      co[j] = o;
    }
    return { ep: ep, eo: eo, cp: cp, co: co };
  }

  /* ---------------- 块级转动表 ---------------- */

  var MOVE_NAMES = [];
  ['U', 'R', 'F', 'D', 'L', 'B'].forEach(function (f) {
    [1, 2, 3].forEach(function (t) { MOVE_NAMES.push(f + (t === 1 ? '' : t === 2 ? '2' : "'")); });
  });

  function buildPieceMove(name) {
    var d = decode(E.applyMove(SOLVED, name));
    return { name: name, src: d.ep, flip: d.eo, csrc: d.cp, ctwist: d.co };
  }
  var MOVES = MOVE_NAMES.map(buildPieceMove);

  function applyPermToEp(ep, pm) { var n = new Array(12); for (var i = 0; i < 12; i++) n[i] = ep[pm.src[i]]; return n; }
  function applyPermToCp(cp, pm) { var n = new Array(8); for (var i = 0; i < 8; i++) n[i] = cp[pm.csrc[i]]; return n; }

  /* ---------------- 坐标编码 ---------------- */

  function eoCoord(eo) { var c = 0; for (var i = 0; i < 11; i++) c |= eo[i] << i; return c; }
  function coCoord(co) { var c = 0; for (var i = 0; i < 7; i++) c += co[i] * Math.pow(3, i); return c; }
  function eoFromCoord(c) { var e = new Array(12), s = 0; for (var i = 0; i < 11; i++) { e[i] = (c >> i) & 1; s += e[i]; } e[11] = s & 1; return e; }
  function coFromCoord(c) { var o = new Array(8), s = 0; for (var i = 0; i < 7; i++) { o[i] = c % 3; c = (c / 3) | 0; s += o[i]; } o[7] = (3 - (s % 3)) % 3; return o; }

  // slice：中层 4 棱（block id 8..11）占据的位置 → 12 位掩码 → 稠密索引 0..494
  var MASK_TO_IDX = new Int16Array(4096).fill(-1);
  var IDX_TO_MASK = [];
  (function () {
    var idx = 0;
    for (var m = 0; m < 4096; m++) {
      var cnt = 0, mm = m;
      while (mm) { cnt += mm & 1; mm >>= 1; }
      if (cnt === 4) { MASK_TO_IDX[m] = idx; IDX_TO_MASK.push(m); idx++; }
    }
  })();
  var SLICE_MASK_SOLVED = (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11);

  function sliceCoord(ep) { var m = 0; for (var i = 0; i < 12; i++) if (ep[i] >= 8) m |= (1 << i); return MASK_TO_IDX[m]; }
  function sliceIdxToEp(idx) {
    var m = IDX_TO_MASK[idx], ep = new Array(12).fill(-1);
    var k = 0;
    for (var i = 0; i < 12; i++) if (m & (1 << i)) ep[i] = 8 + (k++);
    var pi = 0; for (var j = 0; j < 12; j++) if (ep[j] === -1) ep[j] = pi++;
    return ep;
  }

  // 置换 <-> Lehmer 索引
  var FACT = [1];
  for (var fi = 1; fi <= 12; fi++) FACT[fi] = FACT[fi - 1] * fi;
  function permToIdx(perm) {
    var n = perm.length, idx = 0;
    for (var i = 0; i < n; i++) {
      var c = 0;
      for (var j = i + 1; j < n; j++) if (perm[j] < perm[i]) c++;
      idx += c * FACT[n - 1 - i];
    }
    return idx;
  }
  function idxToPerm(idx, n) {
    var avail = [];
    for (var i = 0; i < n; i++) avail.push(i);
    var perm = new Array(n);
    for (var k = 0; k < n; k++) {
      var f = FACT[n - 1 - k];
      var j = Math.floor(idx / f); idx = idx % f;
      perm[k] = avail.splice(j, 1)[0];
    }
    return perm;
  }

  function cpCoord(cp) { return permToIdx(cp); }
  function ep8Coord(ep) {
    var a = [];
    for (var i = 0; i < 12; i++) if (ep[i] < 8) a.push(ep[i]);
    return a.length === 8 ? permToIdx(a) : -1;
  }
  function ep8ToEp(idx) {
    var perm = idxToPerm(idx, 8), ep = new Array(12);
    for (var i = 0; i < 12; i++) ep[i] = (i >= 8) ? (8 + (i - 8)) : perm[i];
    return ep;
  }
  function slicePermCoord(ep) {
    var a = [];
    for (var i = 8; i < 12; i++) a.push(ep[i] - 8);
    return permToIdx(a);
  }
  function slicePermIdxToArr(idx) { return idxToPerm(idx, 4).map(function (v) { return v + 8; }); }

  /* ---------------- 转移表与剪枝表 ---------------- */

  var NEO = 2048, NCO = 2187, NSLICE = 495, NCP = 40320, NEP8 = 40320, NSP = 24;
  var N18 = 18;
  var PH2_NAMES = ['U', 'U2', "U'", 'D', 'D2', "D'", 'R2', 'L2', 'F2', 'B2'];
  var NM2 = PH2_NAMES.length;
  var PH2_PM = PH2_NAMES.map(function (nm) {
    for (var i = 0; i < MOVES.length; i++) if (MOVES[i].name === nm) return MOVES[i];
    throw new Error('缺少阶段2 生成元: ' + nm);
  });

  var ready = false, buildMs = 0;

  // 阶段1 / 阶段2 转移表与剪枝表（惰性构建）
  var EOT, COT, SLT18, CPT, EPT, SPT;
  var PT_SE, PT_SC, PT_CP, PT_EP, PT_SP;

  function bfsJoint(transA, nA, transB, nB, goalA, goalB, maxD) {
    var N = nA * nB;
    var dist = new Int8Array(N); dist.fill(-1);
    var q = new Int32Array(N), h = 0, t = 0;
    var gi = goalA * nB + goalB;
    dist[gi] = 0; q[t++] = gi;
    while (h < t) {
      var cur = q[h++], a = (cur / nB) | 0, b = cur % nB, d = dist[cur];
      if (d >= maxD) continue;
      for (var m = 0; m < N18; m++) {
        var na = transA[a * N18 + m], nb = transB[b * N18 + m];
        var ni = na * nB + nb;
        if (dist[ni] === -1) { dist[ni] = d + 1; q[t++] = ni; }
      }
    }
    return dist;
  }
  function bfsSimple(trans, nStates, nMoves, goal, maxD) {
    var dist = new Int8Array(nStates); dist.fill(-1);
    var q = new Int32Array(nStates), h = 0, t = 0;
    dist[goal] = 0; q[t++] = goal;
    while (h < t) {
      var cur = q[h++], d = dist[cur];
      if (d >= maxD) continue;
      for (var m = 0; m < nMoves; m++) {
        var nx = trans[cur * nMoves + m];
        if (nx >= 0 && dist[nx] === -1) { dist[nx] = d + 1; q[t++] = nx; }
      }
    }
    return dist;
  }

  function build() {
    if (ready) return;
    var t0 = Date.now();

    // ---- 阶段1 转移表（18 转动） ----
    EOT = new Int16Array(NEO * N18);
    for (var e = 0; e < NEO; e++) {
      var eo = eoFromCoord(e);
      for (var m = 0; m < N18; m++) {
        var pm = MOVES[m], ne = new Array(12);
        for (var i = 0; i < 12; i++) ne[i] = eo[pm.src[i]] ^ pm.flip[i];
        EOT[e * N18 + m] = eoCoord(ne);
      }
    }
    COT = new Int16Array(NCO * N18);
    for (var c = 0; c < NCO; c++) {
      var co = coFromCoord(c);
      for (var m2 = 0; m2 < N18; m2++) {
        var pm2 = MOVES[m2], nc = new Array(8);
        for (var j = 0; j < 8; j++) nc[j] = (co[pm2.csrc[j]] + pm2.ctwist[j]) % 3;
        COT[c * N18 + m2] = coCoord(nc);
      }
    }
    SLT18 = new Int16Array(NSLICE * N18);
    for (var s = 0; s < NSLICE; s++) {
      var epS = sliceIdxToEp(s);
      for (var m3 = 0; m3 < N18; m3++) SLT18[s * N18 + m3] = sliceCoord(applyPermToEp(epS, MOVES[m3]));
    }

    // ---- 阶段2 转移表（10 转动） ----
    CPT = new Int32Array(NCP * NM2);
    for (var cc = 0; cc < NCP; cc++) {
      var cp = idxToPerm(cc, 8);
      for (var m4 = 0; m4 < NM2; m4++) CPT[cc * NM2 + m4] = cpCoord(applyPermToCp(cp, PH2_PM[m4]));
    }
    EPT = new Int32Array(NEP8 * NM2);
    for (var ee = 0; ee < NEP8; ee++) {
      var ep = ep8ToEp(ee);
      for (var m5 = 0; m5 < NM2; m5++) EPT[ee * NM2 + m5] = ep8Coord(applyPermToEp(ep, PH2_PM[m5]));
    }
    SPT = new Int32Array(NSP * NM2);
    for (var sp = 0; sp < NSP; sp++) {
      var epP = ep8ToEp(0).slice();
      var arr = slicePermIdxToArr(sp);
      for (var i4 = 8; i4 < 12; i4++) epP[i4] = arr[i4 - 8];
      for (var m6 = 0; m6 < NM2; m6++) SPT[sp * NM2 + m6] = slicePermCoord(applyPermToEp(epP, PH2_PM[m6]));
    }

    // ---- 剪枝表 ----
    var GOAL_SL = MASK_TO_IDX[SLICE_MASK_SOLVED];
    PT_SE = bfsJoint(SLT18, NSLICE, EOT, NEO, GOAL_SL, 0, 11);
    PT_SC = bfsJoint(SLT18, NSLICE, COT, NCO, GOAL_SL, 0, 11);
    PT_CP = bfsSimple(CPT, NCP, NM2, 0, 16);
    PT_EP = bfsSimple(EPT, NEP8, NM2, 0, 12);
    PT_SP = bfsSimple(SPT, NSP, NM2, 0, 8);

    buildMs = Date.now() - t0;
    ready = true;
  }

  /* ---------------- 两阶段 IDA* ---------------- */

  var GOAL_SL = null;

  function phase1(state, maxDepth) {
    var pc = decode(state);
    var s0 = sliceCoord(pc.ep), e0 = eoCoord(pc.eo), c0 = coCoord(pc.co);
    if (GOAL_SL === null) GOAL_SL = MASK_TO_IDX[SLICE_MASK_SOLVED];

    var path = [], found = null;
    function h(s, e, c) {
      var a = PT_SE[s * NEO + e], b = PT_SC[s * NCO + c];
      return a > b ? a : b;
    }
    // 子节点排序：优先走「启发式下降最多」的分支，IDA* 能更早撞到目标。
    // 每层独立分配缓冲，避免递归时子层覆盖父层的遍历数组。
    var bufs = [];   // bufs[depth] = 该层的候选数组（复用以减少 GC）
    function dfs(s, e, c, ep, g, limit, lastAxis) {
      if (found) return true;
      if (g + h(s, e, c) > limit) return false;
      if (s === GOAL_SL && e === 0 && c === 0) { found = { moves: path.slice() }; return true; }
      if (g === limit) return false;

      var buf = bufs[g] || (bufs[g] = new Array(N18));
      var ordN = 0;
      for (var m = 0; m < N18; m++) {
        var axis = (m / 3) | 0;
        if (axis === lastAxis) continue;
        var ns = SLT18[s * N18 + m], ne2 = EOT[e * N18 + m], nc2 = COT[c * N18 + m];
        buf[ordN++] = { m: m, ns: ns, ne: ne2, nc: nc2, score: h(ns, ne2, nc2) };
      }
      var list = buf.slice(0, ordN);
      list.sort(function (A, B) { return A.score - B.score; });

      for (var idx = 0; idx < ordN; idx++) {
        var o = list[idx];
        var nep = applyPermToEp(ep, MOVES[o.m]);
        path.push(MOVES[o.m].name);
        if (dfs(o.ns, o.ne, o.nc, nep, g + 1, limit, (o.m / 3) | 0)) return true;
        path.pop();
      }
      return false;
    }
    for (var lim = 0; lim <= maxDepth; lim++) {
      path.length = 0;
      if (dfs(s0, e0, c0, pc.ep.slice(), 0, lim, -1)) return found;
    }
    return null;
  }

  function phase2(state, maxDepth) {
    var pc = decode(state);
    var a0 = cpCoord(pc.cp), b0 = ep8Coord(pc.ep), p0 = slicePermCoord(pc.ep);
    var path = [], found = null;
    function h(a, b, p) {
      var x = PT_CP[a], y = PT_EP[b], z = PT_SP[p];
      return Math.max(x, y, z);
    }
    function dfs(a, b, p, g, limit, lastAxis) {
      if (found) return true;
      if (g + h(a, b, p) > limit) return false;
      if (a === 0 && b === 0 && p === 0) { found = { moves: path.slice() }; return true; }
      if (g === limit) return false;
      for (var m = 0; m < NM2; m++) {
        var nm = PH2_NAMES[m], axis = 'URFDLB'.indexOf(nm[0]);
        if (axis === lastAxis) continue;
        path.push(nm);
        if (dfs(CPT[a * NM2 + m], EPT[b * NM2 + m], SPT[p * NM2 + m], g + 1, limit, axis)) return true;
        path.pop();
      }
      return false;
    }
    for (var lim = 0; lim <= maxDepth; lim++) {
      path.length = 0;
      if (dfs(a0, b0, p0, 0, lim, -1)) return found;
    }
    return null;
  }

  /* ---------------- 对外接口 ---------------- */

  // 求解，返回 { steps, totalMoves }（与 solver.js 其他解法同构）
  function solve(state, options) {
    options = options || {};
    build();
    var t0 = Date.now();

    var p1 = null, d1 = options.maxPhase1 || 12;
    while (!p1 && d1 <= 14) { p1 = phase1(state, d1); if (!p1) d1 += 2; }
    if (!p1) throw new Error('Kociemba 阶段 1 求解失败');

    var mid = E.applySeq(state, p1.moves);
    var p2 = null, d2 = options.maxPhase2 || 18;
    while (!p2 && d2 <= 22) { p2 = phase2(mid, d2); if (!p2) d2 += 2; }
    if (!p2) throw new Error('Kociemba 阶段 2 求解失败');

    var steps = [];
    if (p1.moves.length) steps.push({
      group: 'kc-ph1', title: '阶段 1 · 归入 G1 子群',
      desc: '把棱朝向、角朝向全部摆正，并让中层 4 个棱回到中层（此时进入 <U,D,R2,L2,F2,B2> 子群）',
      moves: E.normalizeSeq(p1.moves.join(' ')),
      state: state.slice()
    });
    if (p2.moves.length) steps.push({
      group: 'kc-ph2', title: '阶段 2 · 半转归位',
      desc: '朝向已正确、中层棱已在位，只用 U/D 与 R2/L2/F2/B2 把角、棱排列彻底归位',
      moves: E.normalizeSeq(p2.moves.join(' ')),
      state: mid.slice()
    });

    return {
      steps: steps,
      totalMoves: p1.moves.length + p2.moves.length,
      phase1: p1.moves, phase2: p2.moves,
      buildMs: buildMs, ms: Date.now() - t0
    };
  }

  var Kociemba = {
    solve: solve, build: build, decode: decode,
    MOVES: MOVES, PH2_NAMES: PH2_NAMES,
    ready: function () { return ready; },
    stats: function () { return { buildMs: buildMs }; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Kociemba;
  else global.CubeKociemba = Kociemba;
})(typeof window !== 'undefined' ? window : globalThis);
