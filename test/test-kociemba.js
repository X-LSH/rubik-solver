/* test-kociemba.js — Kociemba 两阶段求解器单元测试 */
var K = require('../js/kociemba.js');
var S = require('../js/solver.js');
var E = require('../js/cube-engine.js');

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log('  x ' + name); }
}
function replay(state, steps) {
  var cur = state.slice();
  steps.forEach(function (s) { cur = E.applySeq(cur, s.moves); });
  return cur;
}

console.log('=== 1. 建表 ===');
var t0 = Date.now();
K.build();
ok(K.ready(), '建表完成');
ok(K.stats().buildMs < 5000, '建表耗时 < 5s（实测 ' + K.stats().buildMs + 'ms）');
console.log('  建表 ' + K.stats().buildMs + 'ms');

console.log('=== 2. 块级解码一致性 ===');
(function () {
  var d = K.decode(E.solvedState());
  // 复原态：每个位置都是本块、朝向全 0
  var idOk = true;
  for (var i = 0; i < 12; i++) if (d.ep[i] !== i) idOk = false;
  for (var j = 0; j < 8; j++) if (d.cp[j] !== j) idOk = false;
  ok(idOk, '复原态块 id 全为自身');
  ok(d.eo.every(function (x) { return x === 0; }), '复原态棱朝向全 0');
  ok(d.co.every(function (x) { return x === 0; }), '复原态角朝向全 0');

  // 朝向守恒量
  var bad = 0;
  for (var t = 0; t < 200; t++) {
    var s = E.applySeq(E.solvedState(), E.randomScramble(12).moves);
    var dd = K.decode(s);
    if (dd.eo.reduce(function (a, b) { return a + b; }, 0) % 2 !== 0) bad++;
    if (dd.co.reduce(function (a, b) { return a + b; }, 0) % 3 !== 0) bad++;
  }
  ok(bad === 0, '朝向守恒量（eo 偶 / co 3 的倍数）200 例');
})();

console.log('=== 3. 单例求解 ===');
(function () {
  var st = E.applySeq(E.solvedState(), E.randomScramble(20).moves);
  var r = K.solve(st);
  ok(E.isSolved(replay(st, r.steps)), '单例回放后复原');
  ok(r.steps.length === 2, '阶段数为 2');
  ok(r.steps[0].group === 'kc-ph1' && r.steps[1].group === 'kc-ph2', '阶段 group 正确');
  console.log('  ' + r.totalMoves + ' 步（阶段1 ' + r.phase1.length + ' + 阶段2 ' + r.phase2.length + '） ' + r.ms + 'ms');
})();

console.log('=== 4. 已复原态 ===');
(function () {
  var r = K.solve(E.solvedState());
  ok(r.totalMoves === 0, '复原态返回 0 步（实测 ' + r.totalMoves + '）');
})();

console.log('=== 5. 各难度批量（10 重 / 20 重 / 25 重） ===');
var DIFFS = [10, 20, 25];
DIFFS.forEach(function (n) {
  var good = 0, lens = [];
  for (var i = 0; i < 20; i++) {
    var st = E.applySeq(E.solvedState(), E.randomScramble(n).moves);
    try {
      var r = K.solve(st);
      if (E.isSolved(replay(st, r.steps))) { good++; lens.push(r.totalMoves); }
    } catch (e) { /* 计入失败 */ }
  }
  var avg = lens.length ? (lens.reduce(function (a, b) { return a + b; }, 0) / lens.length).toFixed(1) : '-';
  ok(good === 20, n + ' 重打乱 20/20 复原（实测 ' + good + '/20，平均 ' + avg + ' 步）');
  console.log('  ' + n + ' 重: ' + good + '/20 平均 ' + avg + ' 步');
});

console.log('=== 6. 非法/退化输入 ===');
(function () {
  // 完全非法的颜色状态应被引擎 validate 拦下或求解前被发现
  var bogus = E.solvedState().slice();
  bogus[0] = 'R'; bogus[1] = 'W'; // 打乱一个角，制造非法状态
  var threw = false;
  try { var r = K.solve(bogus); if (!E.isSolved(replay(bogus, r.steps))) threw = true; }
  catch (e) { threw = true; }
  ok(threw, '非法状态被拒绝（抛错或无法复原）');
})();

console.log('=== 7. 不与既有解法冲突（回归） ===');
(function () {
  var st = E.applySeq(E.solvedState(), E.randomScramble(20).moves);
  ['lbl', 'cfop', '4lll'].forEach(function (m) {
    var r = S.solve(st, { mode: m });
    ok(E.isSolved(replay(st, r.steps)), m + ' 模式仍可正常求解');
    ok(!r.kociemba, m + ' 模式未误带 kociemba 字段');
  });
  var rk = S.solve(st, { mode: 'kociemba' });
  ok(E.isSolved(replay(st, rk.steps)), 'solver.js 的 kociemba 分发可求解');
  ok(!!rk.kociemba, 'kociemba 模式带 kociemba 字段');
})();

console.log('');
console.log('Kociemba 单元测试: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
