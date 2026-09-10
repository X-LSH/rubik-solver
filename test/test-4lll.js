/* =========================================================================
 * test-4lll.js — 四步法顶层（4-look last layer）专项测试
 *
 * 4LLL 的顶层拆解：EO（棱朝向）→ CO（角朝向）→ PLL（角+棱排列联合）。
 * 本测试覆盖：
 *   1. 生成元可用性（apermA / apermB 必须是"只动角不动棱"的 A-perm）
 *   2. 三个阶段的置换/朝向语义正确（独立于 solver 内部实现校验）
 *   3. 100 例随机打乱全部复原
 *   4. 阶段分组为 cross → f2l → ll-eo → ll-co → ll-pll
 *   5. 不影响 LBL / CFOP 既有路径
 * 运行：node test/test-4lll.js
 * ========================================================================= */
var path = require('path');
var E = require(path.join(__dirname, '..', 'js', 'cube-engine.js'));
var S = require(path.join(__dirname, '..', 'js', 'solver.js'));

var pass = 0, fail = 0, fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

var TE = [[0, 1, 1], [1, 1, 0], [0, 1, -1], [-1, 1, 0]];      // UF UR UB UL
var TC = [[1, 1, 1], [1, 1, -1], [-1, 1, -1], [-1, 1, 1]];      // URF UBR ULB ULF

/* ---------- 工具：与 solver 内部一致的排列语义 ---------- */
function homeOf(TOP_POS) {
  var solved = E.solvedState();
  return TOP_POS.map(function (p) {
    return E.faceletsAt(p).map(function (i) { return solved[i]; }).sort().join('');
  });
}
// real[j] = 施加 seq 后位置 j 装着哪一块（块 = 其原位置的索引）
function realPerm(seq, TOP_POS) {
  var home = homeOf(TOP_POS);
  var st = E.applySeq(E.solvedState(), E.normalizeSeq(seq));
  return TOP_POS.map(function (p) {
    var id = E.faceletsAt(p).map(function (i) { return st[i]; }).sort().join('');
    return home.indexOf(id);
  });
}
function isPerm(a) {
  return a.slice().sort().join(',') === '0,1,2,3';
}

function scramble(n, seed) {
  var st = seed;
  function rnd() { st = (st * 1103515245 + 12345) & 0x7fffffff; return st / 0x7fffffff; }
  var faces = ['U', 'R', 'F', 'D', 'L', 'B'], sufs = ['', "'", '2'];
  var seq = [], last = '';
  while (seq.length < n) {
    var f = faces[Math.floor(rnd() * 6)];
    if (f === last) continue;
    last = f;
    seq.push(f + sufs[Math.floor(rnd() * 3)]);
  }
  return seq;
}

console.log('== 生成元：A-perm 只动角、U-perm 只动棱 ==');
(function () {
  ok(!!S.GENS.apermA && !!S.GENS.apermB, 'apermA / apermB 已注册');
  ok(!!S.GENS.uaperm && !!S.GENS.ubperm, 'uaperm / ubperm 已注册');

  // A-perm：角置换必须是 3-循环（非常规），棱必须完全不动（恒等）
  [['apermA', S.GENS.apermA], ['apermB', S.GENS.apermB]].forEach(function (pair) {
    var name = pair[0], seq = pair[1].seq;
    var rc = realPerm(seq, TC), re = realPerm(seq, TE);
    ok(isPerm(rc) && rc.join(',') !== '0,1,2,3', name + ' 确实置换顶角（3-循环）', 'corner=' + rc.join(','));
    ok(re.join(',') === '0,1,2,3', name + ' 完全不动顶棱', 'edge=' + re.join(','));
  });

  // U-perm：棱置换必须是 3-循环，角必须完全不动
  [['uaperm', S.GENS.uaperm], ['ubperm', S.GENS.ubperm]].forEach(function (pair) {
    var name = pair[0], seq = pair[1].seq;
    var rc = realPerm(seq, TC), re = realPerm(seq, TE);
    ok(isPerm(re) && re.join(',') !== '0,1,2,3', name + ' 确实置换顶棱（3-循环）', 'edge=' + re.join(','));
    ok(rc.join(',') === '0,1,2,3', name + ' 完全不动顶角', 'corner=' + rc.join(','));
  });

  // 置换语义与已验证的数据一致（防止 permGenFor 方向再次写反）
  ok(realPerm(S.GENS.apermA.seq, TC).join(',') === '1,2,0,3', 'apermA 角置换 = [1,2,0,3]');
  ok(realPerm(S.GENS.apermB.seq, TC).join(',') === '3,0,2,1', 'apermB 角置换 = [3,0,2,1]');
  ok(realPerm(S.GENS.uaperm.seq, TE).join(',') === '3,0,2,1', 'uaperm 棱置换 = [3,0,2,1]');
  ok(realPerm(S.GENS.ubperm.seq, TE).join(',') === '1,3,2,0', 'ubperm 棱置换 = [1,3,2,0]');
})();

console.log('== U 转动对顶层的置换 ==');
(function () {
  ok(realPerm('U', TC).join(',') === '1,2,3,0', 'U 角置换 = [1,2,3,0]');
  ok(realPerm('U', TE).join(',') === '1,2,3,0', 'U 棱置换 = [1,2,3,0]');
  // 角/棱置换奇偶性必须一致（否则该状态不可能是真实魔方）
  function parity(a) {
    var p = a.slice(), c = 0;
    for (var i = 0; i < p.length; i++) while (p[i] !== i) { var t = p[p[i]]; p[p[i]] = p[i]; p[i] = t; c++; }
    return c % 2;
  }
  [['U', 'U'], ['apermA', S.GENS.apermA.seq], ['uaperm', S.GENS.uaperm.seq],
   ['apermB', S.GENS.apermB.seq], ['ubperm', S.GENS.ubperm.seq]].forEach(function (pair) {
    var pc = parity(realPerm(pair[1], TC)), pe = parity(realPerm(pair[1], TE));
    ok(pc === pe, pair[0] + ' 角棱排列奇偶性一致', 'cornerParity=' + pc + ' edgeParity=' + pe);
  });
})();

console.log('== 4LLL 随机状态求解（100 例）==');
var solvedCount = 0, movesArr = [], groups = {};
(function () {
  var N = 100, bad = [];
  for (var i = 1; i <= N; i++) {
    var st = E.applySeq(E.solvedState(), E.normalizeSeq(scramble(25, i * 7919 + 13).join(' ')));
    try {
      var r = S.solve(st, { mode: '4lll' });
      // 独立复算：用返回的 steps 重新施加，验证真的复原（不信任 solver 内部断言）
      var re = E.solvedState();
      r.steps.forEach(function (s) { re = E.applySeq(re, s.moves); });
      var reScrambled = E.applySeq(st, []);
      r.steps.forEach(function (s) { reScrambled = E.applySeq(reScrambled, s.moves); });
      if (!E.isSolved(reScrambled)) { bad.push(i + ':重放未复原'); continue; }
      solvedCount++;
      movesArr.push(r.totalMoves);
      r.steps.forEach(function (s) { groups[s.group] = (groups[s.group] || 0) + 1; });
    } catch (e) {
      bad.push(i + ':' + e.message.split('：')[0]);
    }
  }
  var avg = (movesArr.reduce(function (a, b) { return a + b; }, 0) / (movesArr.length || 1)).toFixed(1);
  console.log('  成功 ' + solvedCount + '/' + N + '  平均步数 ' + avg +
    '  范围 ' + (Math.min.apply(null, movesArr) || 0) + '-' + (Math.max.apply(null, movesArr) || 0));
  if (bad.length) console.log('  失败: ' + bad.slice(0, 8).join(', '));
  ok(solvedCount === N, '4LLL 100 例全部复原（含独立重放校验）', solvedCount + '/' + N);
  ok(parseFloat(avg) < 130, '4LLL 平均步数 < 130', 'avg=' + avg);

  var gk = Object.keys(groups).sort().join(',');
  ok(gk === 'cross,f2l,ll-co,ll-eo,ll-pll', '4LLL 阶段分组 = cross,f2l,ll-eo,ll-co,ll-pll', gk);
})();

console.log('== 不影响既有路径（LBL / CFOP）==');
(function () {
  var N = 25;
  ['lbl', 'cfop'].forEach(function (mode) {
    var c = 0;
    for (var i = 1; i <= N; i++) {
      var st = E.applySeq(E.solvedState(), E.normalizeSeq(scramble(25, i * 5231 + 7).join(' ')));
      var r = S.solve(st, { mode: mode });
      var chk = st.slice();
      r.steps.forEach(function (s) { chk = E.applySeq(chk, s.moves); });
      if (E.isSolved(chk)) c++;
    }
    ok(c === N, mode + ' ' + N + ' 例仍全部复原', c + '/' + N);
  });
  var r3 = S.solve(E.applySeq(E.solvedState(),
    E.normalizeSeq(scramble(25, 999).join(' '))), { mode: '4lll' });
  ok(r3.steps.some(function (s) { return s.group === 'f2l'; }), '4LLL 复用 F2L 阶段');
  ok(!r3.steps.some(function (s) { return s.group === 'oll' || s.group === 'pll'; }),
    '4LLL 不触发 CFOP 的 oll / pll 阶段');
})();

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
if (fail) { console.log('失败项: ' + fails.join(' | ')); process.exit(1); }
