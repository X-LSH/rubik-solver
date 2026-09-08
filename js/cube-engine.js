/* =========================================================================
 * cube-engine.js — 三阶魔方核心引擎（facelet 模型）
 * 面顺序：U R F D L B（每面 9 格按"从该面外侧看"的阅读顺序）。
 * 置换表由 3D 坐标自动生成（x 右 / y 上 / z 前；WCA 顺时针定义）：
 *   U:(x,z)->(-z,x) D:(x,z)->(z,-x) R:(y,z)->(z,-y)
 *   L:(y,z)->(-z,y) F:(x,y)->(y,-x) B:(x,y)->(-y,x)
 * ========================================================================= */
(function (global) {
  'use strict';

  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var AXES = { U: ['y', 1], D: ['y', -1], R: ['x', 1], L: ['x', -1], F: ['z', 1], B: ['z', -1] };
  var STD_COLORS = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
  var COLOR_NAME = { W: '白', R: '红', G: '绿', Y: '黄', O: '橙', B: '蓝' };
  var COLOR_HEX = { W: '#F2F5F7', R: '#E5333B', G: '#00B36B', Y: '#FFD500', O: '#FF8A00', B: '#1E6FE0' };

  /* ---------- facelet <-> (pos, normal) ---------- */
  function faceletToPN(i) {
    var f = (i / 9) | 0, r = ((i % 9) / 3) | 0, c = i % 3;
    switch (FACES[f]) {
      case 'U': return { pos: [c - 1, 1, r - 1], nrm: [0, 1, 0] };
      case 'R': return { pos: [1, 1 - r, 1 - c], nrm: [1, 0, 0] };
      case 'F': return { pos: [c - 1, 1 - r, 1], nrm: [0, 0, 1] };
      case 'D': return { pos: [c - 1, -1, 1 - r], nrm: [0, -1, 0] };
      case 'L': return { pos: [-1, 1 - r, c - 1], nrm: [-1, 0, 0] };
      default:  return { pos: [1 - c, 1 - r, -1], nrm: [0, 0, -1] };
    }
  }
  function pnToFacelet(p, n) {
    if (n[1] === 1)  return 0 * 9 + (p[2] + 1) * 3 + (p[0] + 1);
    if (n[0] === 1)  return 1 * 9 + (1 - p[1]) * 3 + (1 - p[2]);
    if (n[2] === 1)  return 2 * 9 + (1 - p[1]) * 3 + (p[0] + 1);
    if (n[1] === -1) return 3 * 9 + (1 - p[2]) * 3 + (p[0] + 1);
    if (n[0] === -1) return 4 * 9 + (1 - p[1]) * 3 + (p[2] + 1);
    return 5 * 9 + (1 - p[1]) * 3 + (1 - p[0]);
  }
  var ROT = {
    U: function (p) { return [-p[2], p[1], p[0]]; },
    D: function (p) { return [p[2], p[1], -p[0]]; },
    R: function (p) { return [p[0], p[2], -p[1]]; },
    L: function (p) { return [p[0], -p[2], p[1]]; },
    F: function (p) { return [p[1], -p[0], p[2]]; },
    B: function (p) { return [-p[1], p[0], p[2]]; }
  };
  function axisIdx(a) { return a === 'x' ? 0 : (a === 'y' ? 1 : 2); }
  function key(p) { return p[0] + ',' + p[1] + ',' + p[2]; }

  var PNS = [];
  for (var i0 = 0; i0 < 54; i0++) PNS.push(faceletToPN(i0));

  /* ---------- 置换表 ---------- */
  function compose(P, Q) { // 先 Q 后 P：out[j] = P[Q[j]]
    var out = new Array(54);
    for (var j = 0; j < 54; j++) out[j] = P[Q[j]];
    return out;
  }
  var PERMS = (function () {
    var map = {};
    FACES.forEach(function (f) {
      var rot = ROT[f], ax = AXES[f][0], layer = AXES[f][1];
      var src = new Array(54);
      for (var j = 0; j < 54; j++) src[j] = j; // 非转层贴纸原地不动
      for (var i = 0; i < 54; i++) {
        var pn = PNS[i];
        if (pn.pos[axisIdx(ax)] !== layer) continue;
        src[pnToFacelet(rot(pn.pos), rot(pn.nrm))] = i;
      }
      map[f] = [src, compose(src, src), compose(compose(src, src), src)];
    });
    return map;
  })();

  var MOVE_RE = /^([URFDLB])(')?(2)?$/;
  function parseMove(m) {
    var mt = MOVE_RE.exec(m);
    if (!mt) throw new Error('非法转动记号: ' + m);
    return { face: mt[1], times: mt[3] ? 2 : (mt[2] ? 3 : 1) };
  }
  function suffix(times) { return times === 1 ? '' : (times === 2 ? '2' : "'"); }

  function applyMove(state, move) {
    var p = parseMove(move);
    var perm = PERMS[p.face][p.times - 1], out = new Array(54);
    for (var j = 0; j < 54; j++) out[j] = state[perm[j]];
    return out;
  }
  // 归一：同面连续转动合并（U U -> U2，U U' -> 消失）
  function normalizeSeq(seq) {
    var raw = typeof seq === 'string' ? seq.trim().split(/\s+/).filter(Boolean) : seq.slice();
    var out = [];
    raw.forEach(function (m) {
      var p = parseMove(m);
      if (out.length) {
        var lastP = parseMove(out[out.length - 1]);
        if (lastP.face === p.face) {
          var t = (lastP.times + p.times) % 4;
          out.pop();
          if (t !== 0) out.push(p.face + suffix(t));
          return;
        }
      }
      out.push(p.face + suffix(p.times));
    });
    return out;
  }
  function applySeq(state, seq) {
    var s = state.slice();
    normalizeSeq(seq).forEach(function (m) { s = applyMove(s, m); });
    return s;
  }
  function invertSeq(seq) {
    var moves = normalizeSeq(seq), out = [];
    for (var i = moves.length - 1; i >= 0; i--) {
      var p = parseMove(moves[i]);
      var t = (4 - p.times) % 4;
      if (t !== 0) out.push(p.face + suffix(t));
    }
    return out;
  }

  /* ---------- 基础状态 ---------- */
  function solvedState() {
    var s = [];
    FACES.forEach(function (f) { for (var i = 0; i < 9; i++) s.push(STD_COLORS[f]); });
    return s;
  }
  function isSolved(state) {
    for (var i = 0; i < 54; i++) if (state[i] !== state[((i / 9) | 0) * 9 + 4]) return false;
    return true;
  }
  function randomScramble(len) {
    len = len || 22;
    var s = solvedState(), last = '', moves = [];
    for (var i = 0; i < len; i++) {
      var f;
      do { f = FACES[(Math.random() * 6) | 0]; } while (f === last);
      last = f;
      var m = f + suffix([1, 2, 3][(Math.random() * 3) | 0]);
      moves.push(m);
      s = applyMove(s, m);
    }
    return { state: s, moves: moves };
  }

  /* ---------- 块定义 ---------- */
  var CORNER_POS = [], EDGE_POS = [];
  (function () {
    for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) for (var z = -1; z <= 1; z++) {
      var nz = [x, y, z].filter(function (v) { return v !== 0; }).length;
      if (nz === 3) CORNER_POS.push([x, y, z]);
      else if (nz === 2) EDGE_POS.push([x, y, z]);
    }
  })();
  function faceletsAt(pos) {
    var out = [];
    for (var i = 0; i < 54; i++) if (key(PNS[i].pos) === key(pos)) out.push(i);
    return out;
  }
  function pieceId(state, pos) {
    return faceletsAt(pos).map(function (i) { return state[i]; }).sort().join('');
  }
  function findPiece(state, colors) {
    var target = colors.slice().sort().join('');
    var list = colors.length === 2 ? EDGE_POS : CORNER_POS;
    for (var i = 0; i < list.length; i++) {
      if (pieceId(state, list[i]) === target) {
        var fs = faceletsAt(list[i]), byColor = {};
        fs.forEach(function (fi) { byColor[state[fi]] = fi; });
        return { pos: list[i], facelets: fs, byColor: byColor };
      }
    }
    return null;
  }

  /* ---------- 合法性验证 ---------- */
  // 槽序（Kociemba 约定）：U/D 面优先，其次 R/L，最后 F/B
  function cornerSlotRank(n) { if (n[1] !== 0) return 2; if (n[0] !== 0) return 1; return 0; }
  function parity(perm) {
    var p = perm.slice(), cnt = 0;
    for (var i = 0; i < p.length; i++) {
      while (p[i] !== i) { var t = p[p[i]]; p[p[i]] = p[i]; p[i] = t; cnt++; }
    }
    return cnt % 2;
  }
  var CORNER_SET = {}, EDGE_SET = {};
  CORNER_POS.forEach(function (p, idx) {
    var cs = [p[0] > 0 ? 'R' : (p[0] < 0 ? 'L' : null),
              p[1] > 0 ? 'U' : (p[1] < 0 ? 'D' : null),
              p[2] > 0 ? 'F' : (p[2] < 0 ? 'B' : null)].filter(Boolean).sort().join('');
    CORNER_SET[cs] = idx;
  });
  EDGE_POS.forEach(function (p, idx) {
    var cs = [p[0] > 0 ? 'R' : (p[0] < 0 ? 'L' : null),
              p[1] > 0 ? 'U' : (p[1] < 0 ? 'D' : null),
              p[2] > 0 ? 'F' : (p[2] < 0 ? 'B' : null)].filter(Boolean).sort().join('');
    EDGE_SET[cs] = idx;
  });

  function validate(state) {
    var centers = [4, 13, 22, 31, 40, 49].map(function (i) { return state[i]; });
    if (new Set(centers).size !== 6) return { ok: false, reason: '六个中心块颜色必须互不相同' };
    for (var c = 0; c < 6; c++) {
      var n = 0;
      for (var i = 0; i < 54; i++) if (state[i] === centers[c]) n++;
      if (n !== 9) return { ok: false, reason: '颜色「' + COLOR_NAME[centers[c]] + '」出现 ' + n + ' 次，应为 9 次' };
    }
    var colorToFace = {};
    FACES.forEach(function (f, idx) { colorToFace[centers[idx]] = f; });
    var norm = state.map(function (col) { return colorToFace[col]; });

    var seen = {}, cPerm = [], cOriSum = 0;
    // 角朝向约定（经 300 个随机合法状态暴力校准 + 单步转动约束验证）：
    // 自然槽序 = facelet 索引升序；U/D 面槽位由物理位置确定（贴纸在该槽 → 朝向 0）；
    // 其余两槽的 1/2 指派由 CORNER_CHIRALITY 决定（CORNER_POS 顺序）。
    var CORNER_CHIRALITY = [1, 1, 0, 0, 0, 1, 1, 0];
    for (var ci = 0; ci < 8; ci++) {
      var pos = CORNER_POS[ci];
      var natSlots = faceletsAt(pos); // 自然槽序 = facelet 索引升序（与手性表一致）
      var ids = natSlots.map(function (i) { return norm[i]; }).sort().join('');
      if (!(ids in CORNER_SET)) return { ok: false, reason: '颜色数量正常，但不可复原：角块颜色组合非法（' + ids + '），真实魔方不存在此块，请检查贴纸' };
      if (seen['c' + ids]) return { ok: false, reason: '颜色数量正常，但不可复原：存在重复角块（' + ids + '），请检查贴纸是否贴错' };
      seen['c' + ids] = true;
      cPerm.push(CORNER_SET[ids]);
      // U/D 面的槽位（物理确定）
      var udFaceSlot = -1;
      for (var k1 = 0; k1 < 3; k1++) {
        var fch = FACES[(natSlots[k1] / 9) | 0];
        if (fch === 'U' || fch === 'D') { udFaceSlot = k1; break; }
      }
      // U/D 色贴纸所在槽位
      var udStickerSlot = -1;
      for (var k2 = 0; k2 < 3; k2++) {
        var v2 = norm[natSlots[k2]];
        if (v2 === 'U' || v2 === 'D') { udStickerSlot = k2; break; }
      }
      if (udStickerSlot < 0) return { ok: false, reason: '颜色数量正常，但不可复原：角块缺少 U/D 色贴纸，请检查贴纸' };
      var ori;
      if (udStickerSlot === udFaceSlot) {
        ori = 0;
      } else {
        var other = 3 - udFaceSlot - udStickerSlot;
        ori = CORNER_CHIRALITY[ci] ? (udStickerSlot < other ? 1 : 2) : (udStickerSlot < other ? 2 : 1);
      }
      cOriSum = (cOriSum + ori) % 3;
    }
    if (cOriSum !== 0) return { ok: false, reason: '颜色数量正常，但不可复原：存在被单独扭转的角块（真实魔方无法转出此状态，请检查贴纸是否贴错）' };

    var eSeen = {}, ePerm = [], eOriSum = 0;
    var isUD = function (v) { return v === 'U' || v === 'D'; };
    var isFB = function (v) { return v === 'F' || v === 'B'; };
    var sameVec = function (a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; };
    for (var ei = 0; ei < 12; ei++) {
      var epos = EDGE_POS[ei];
      var efs = faceletsAt(epos);
      var eids = efs.map(function (i) { return norm[i]; }).sort().join('');
      if (!(eids in EDGE_SET)) return { ok: false, reason: '颜色数量正常，但不可复原：棱块颜色组合非法（' + eids + '），真实魔方不存在此块，请检查贴纸' };
      if (eSeen['e' + eids]) return { ok: false, reason: '颜色数量正常，但不可复原：存在重复棱块（' + eids + '），请检查贴纸是否贴错' };
      eSeen['e' + eids] = true;
      ePerm.push(EDGE_SET[eids]);
      // 标准棱朝向：位置槽0 = U/D 层位置取 U/D 面、中层位置取 F/B 面；
      // 块 color0 = 有 U/D 色取之，否则取 F/B 色；color0 贴纸位于槽0 面 → 朝向 0
      var slot0 = epos[1] !== 0 ? [0, epos[1], 0] : [0, 0, epos[2]];
      var colors = efs.map(function (i) { return norm[i]; });
      var color0 = colors.filter(isUD).concat(colors.filter(isFB))[0];
      var c0Idx = efs.filter(function (i) { return norm[i] === color0; })[0];
      var o = sameVec(PNS[c0Idx].nrm, slot0) ? 0 : 1;
      eOriSum = (eOriSum + o) % 2;
    }
    if (eOriSum !== 0) return { ok: false, reason: '颜色数量正常，但不可复原：存在被单独翻转的棱块（真实魔方无法转出此状态，请检查贴纸是否贴错）' };
    if (parity(cPerm) !== parity(ePerm)) return { ok: false, reason: '颜色数量正常，但不可复原：恰有两块被互换（角/棱排列奇偶性不一致，请检查贴纸是否贴错）' };
    return { ok: true };
  }

  /* ---------- 导出 ---------- */
  var Engine = {
    FACES: FACES, STD_COLORS: STD_COLORS, COLOR_NAME: COLOR_NAME, COLOR_HEX: COLOR_HEX,
    PNS: PNS, CORNER_POS: CORNER_POS, EDGE_POS: EDGE_POS, PERMS: PERMS,
    parseMove: parseMove, suffix: suffix,
    applyMove: applyMove, applySeq: applySeq, normalizeSeq: normalizeSeq, invertSeq: invertSeq,
    solvedState: solvedState, isSolved: isSolved, randomScramble: randomScramble,
    faceletsAt: faceletsAt, pieceId: pieceId, findPiece: findPiece,
    validate: validate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else global.CubeEngine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
