/* 求解器测试：node test/test-solver.js */
'use strict';
const E = require('../js/cube-engine.js');
const S = require('../js/solver.js');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

console.log('== 生成元验证 ==');
const genNames = Object.keys(S.GENS);
console.log('  可用生成元:', genNames.join(', '));
t('核心生成元可用', ['U', 'ollEdge', 'sune', 'tperm', 'uaperm'].every(g => S.GENS[g]));

console.log('== LBL 随机状态求解（100 例）==');
const t0 = Date.now();
let fails = [], totalMoves = 0, minM = 1e9, maxM = 0;
const N = 100;
for (let i = 0; i < N; i++) {
  const sc = E.randomScramble(25);
  try {
    const r = S.solve(sc.state, { mode: 'lbl' });
    const all = [];
    r.steps.forEach(s => all.push(...s.moves));
    const final = E.applySeq(sc.state, all);
    if (!E.isSolved(final)) fails.push('#' + i + ' 未复原');
    totalMoves += r.totalMoves;
    minM = Math.min(minM, r.totalMoves);
    maxM = Math.max(maxM, r.totalMoves);
  } catch (e) {
    fails.push('#' + i + ' ' + e.message);
  }
}
const dt = Date.now() - t0;
console.log('  失败数:', fails.length, fails.slice(0, 3));
console.log('  平均步数:', (totalMoves / N).toFixed(1), '范围:', minM, '-', maxM, '耗时:', dt + 'ms');
t('LBL 100 例全部复原', fails.length === 0);

console.log('== CFOP 分组求解（50 例）==');
let cfFails = [], cfTotal = 0;
for (let i = 0; i < 50; i++) {
  const sc = E.randomScramble(25);
  try {
    const r = S.solve(sc.state, { mode: 'cfop' });
    const all = [];
    r.steps.forEach(s => all.push(...s.moves));
    if (!E.isSolved(E.applySeq(sc.state, all))) cfFails.push('#' + i);
    cfTotal += r.totalMoves;
  } catch (e) { cfFails.push('#' + i + ' ' + e.message); }
}
console.log('  失败数:', cfFails.length, cfFails.slice(0, 3));
console.log('  平均步数:', (cfTotal / 50).toFixed(1));
t('CFOP 50 例全部复原', cfFails.length === 0);

console.log('== 步骤分组检查 ==');
const sc2 = E.randomScramble(20);
const r2 = S.solve(sc2.state, { mode: 'lbl' });
const groups = [...new Set(r2.steps.map(s => s.group))];
console.log('  LBL 分组:', groups.join(' → '));
t('LBL 含全部 7 组', ['cross', 'corner', 'middle', 'oll', 'pll'].every(g => groups.includes(g)));
const r3 = S.solve(sc2.state, { mode: 'cfop' });
const groups3 = [...new Set(r3.steps.map(s => s.group))];
console.log('  CFOP 分组:', groups3.join(' → '));
t('CFOP 含全部 4 组', ['cross', 'f2l', 'oll', 'pll'].every(g => groups3.includes(g)));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
