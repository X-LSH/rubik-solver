/* test-roux.js — Roux 桥式求解器单元测试 */
var R = require('../js/roux.js');
var S = require('../js/solver.js');
var E = require('../js/cube-engine.js');

var pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  x ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function replay(state, steps) {
  var cur = state.slice();
  steps.forEach(function (s) { cur = E.applySeq(cur, s.moves); });
  return cur;
}

console.log('=== 1. 模块与池 ===');
(function () {
  var s = R.stats();
  ok(s.poolAll3 > 1000, '21 步宏池已建立（' + s.poolAll3 + ' 条）');
  ok(s.cmllAlgs >= 10, 'CMLL 保桥公式数 ' + s.cmllAlgs + ' >= 10');
  console.log('  池: ' + JSON.stringify(s));
})();

console.log('=== 2. LSE 复合模型自洽性 ===');
(function () {
  var I = R._internals();
  // 生成元对「中心旋转 / 顶角旋转」的增量应是 M:{1,3,2} U:{0,0,0} 之类
  ok(I.CDELTA[0] === 1 && I.CDELTA[3] === 0, 'M 转中心 +1、U 不动中心');
  ok(I.UDELTA[3] === 1 && I.UDELTA[0] === 0, 'U 转顶角 +1、M 不动顶角');
  // 转移表无越界
  var bad = 0;
  for (var i = 0; i < I.ETRANS.length; i++) if (I.ETRANS[i] < 0 || I.ETRANS[i] >= I.NEDGE) bad++;
  ok(bad === 0, '六棱转移表无越界项（' + bad + ' 项异常）');

  // 真实转移 vs 预测（200 步）
  var SOLVED = E.solvedState();
  var mism = 0, checked = 0;
  for (var t = 0; t < 20; t++) {
    var st = E.applySeq(SOLVED, ['M', 'M', 'U', 'M2']);
    for (var step = 0; step < 10; step++) {
      var g = (Math.random() * 6) | 0;
      var c0 = I.lseEncode(st);
      var ec = (c0 / 16) | 0, cr = ((c0 / 4) | 0) & 3, ur = c0 & 3;
      st = E.applyMove(st, I.LSE_GENS[g]);
      var c1 = I.lseEncode(st);
      var pred = I.ETRANS[ec * 6 + g] * 16 + ((cr + I.CDELTA[g]) & 3) * 4 + ((ur + I.UDELTA[g]) & 3);
      checked++;
      if (c1 !== pred) mism++;
    }
  }
  ok(mism === 0, '复合模型 ' + checked + ' 步转移全部一致（不一致 ' + mism + '）');
})();

console.log('=== 3. CMLL 公式确实保桥 ===');
(function () {
  var SOLVED = E.solvedState();
  var I = R._internals();
  var BRIDGE = [
    { kind: 'edge', idx: 0 }, { kind: 'edge', idx: 1 }, { kind: 'edge', idx: 2 },
    { kind: 'corner', idx: 0 }, { kind: 'corner', idx: 1 },
    { kind: 'edge', idx: 8 }, { kind: 'edge', idx: 9 }, { kind: 'edge', idx: 10 },
    { kind: 'corner', idx: 4 }, { kind: 'corner', idx: 5 }
  ];
  var bad = 0;
  R.CMLL_ALGS.forEach(function (a) {
    var st = E.applySeq(SOLVED, a.seq);
    if (!I.bridgeHome(st)) bad++;
  });
  ok(bad === 0, '14 条 CMLL 公式全部保持双桥（破坏 ' + bad + ' 条）');
})();

console.log('=== 4. 单例求解 ===');
(function () {
  var st = E.applySeq(E.solvedState(), E.randomScramble(20).moves);
  var r = R.solve(st);
  var groups = r.steps.map(function (s) { return s.group; });
  ok(E.isSolved(replay(st, r.steps)), '单例回放后复原');
  ok(groups.indexOf('roux-fb') >= 0, '含左桥阶段');
  ok(groups.indexOf('roux-sb') >= 0, '含右桥阶段');
  ok(groups.indexOf('roux-lse') >= 0, '含 LSE 阶段');
  ok(r.totalMoves > 30 && r.totalMoves < 100, '总步数在合理区间（' + r.totalMoves + '）');
  console.log('  ' + r.totalMoves + ' 步 / ' + r.steps.length + ' 阶段 / ' + r.ms + 'ms');
})();

console.log('=== 5. 已复原态 ===');
(function () {
  var r = R.solve(E.solvedState());
  ok(r.totalMoves === 0, '复原态返回 0 步（实测 ' + r.totalMoves + '）');
})();

console.log('=== 6. 批量与稳定性（20 重 / 25 重） ===');
[20, 25].forEach(function (n) {
  var good = 0, lens = [];
  for (var i = 0; i < 25; i++) {
    var st = E.applySeq(E.solvedState(), E.randomScramble(n).moves);
    try {
      var r = R.solve(st);
      if (E.isSolved(replay(st, r.steps))) { good++; lens.push(r.totalMoves); }
    } catch (e) { /* 计入失败 */ }
  }
  var avg = lens.length ? (lens.reduce(function (a, b) { return a + b; }, 0) / lens.length).toFixed(1) : '-';
  ok(good === 25, n + ' 重打乱 25/25 复原（实测 ' + good + '/25，平均 ' + avg + ' 步）');
  console.log('  ' + n + ' 重: ' + good + '/25 平均 ' + avg + ' 步');
});

console.log('=== 7. 阶段契约（每步都必须真复原，且不得破坏已完成的桥） ===');
(function () {
  var st = E.applySeq(E.solvedState(), E.randomScramble(20).moves);
  var r = R.solve(st);
  var cur = st.slice(), badBridge = 0, badCornerLate = 0;
  var seenFE = false;
  r.steps.forEach(function (s) {
    cur = E.applySeq(cur, s.moves);
    if (s.group === 'roux-sb' || s.group === 'roux-cmll' || s.group === 'roux-lse') {
      // 左桥三棱两角必须始终在原位
      var broke = [0, 1, 2].some(function (e) {
        return E.faceletsAt(E.EDGE_POS[e]).some(function (f) { return cur[f] !== E.solvedState()[f]; });
      }) || [0, 1].some(function (c) {
        return E.faceletsAt(E.CORNER_POS[c]).some(function (f) { return cur[f] !== E.solvedState()[f]; });
      });
      if (broke) badBridge++;
    }
  });
  ok(badBridge === 0, '进入右桥后左桥始终未被破坏');
  ok(E.isSolved(cur), '全部阶段施加后复原');
})();

console.log('=== 8. 不影响既有解法（回归） ===');
(function () {
  var st = E.applySeq(E.solvedState(), E.randomScramble(20).moves);
  ['lbl', 'cfop', '4lll', 'kociemba'].forEach(function (m) {
    var r = S.solve(st, { mode: m });
    ok(E.isSolved(replay(st, r.steps)), m + ' 模式仍可正常求解');
    ok(!r.roux, m + ' 模式未误带 roux 字段');
  });
  var rr = S.solve(st, { mode: 'roux' });
  ok(E.isSolved(replay(st, rr.steps)), 'solver.js 的 roux 分发可求解');
  ok(!!rr.roux, 'roux 模式带 roux 字段');
})();

console.log('');
console.log('Roux 单元测试: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
