/* 引擎单元测试：node test/test-engine.js */
'use strict';
const E = require('../js/cube-engine.js');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

console.log('== 置换表基本性质 ==');
// 1. 每个 move 置换是双射（52 项无 -1 且无重复）
E.FACES.forEach(f => {
  [1, 2, 3].forEach(q => {
    const P = E.PERMS[f][q - 1];
    const set = new Set(P);
    t(`${f}${q}: 双射`, set.size === 54 && !P.includes(-1));
  });
});

// 2. R 后 R' 恒等；R2 后 R2 恒等
const S = E.solvedState();
t('R R\' = 恒等', E.isSolved(E.applySeq(S, "R R'")));
t('R2 R2 = 恒等', E.isSolved(E.applySeq(S, 'R2 R2')));
t("R' R = 恒等", E.isSolved(E.applySeq(S, "R' R")));

// 3. 逆序列：随机打乱后应用逆序列复原
for (let i = 0; i < 30; i++) {
  const sc = E.randomScramble(25);
  const restored = E.applySeq(sc.state, E.invertSeq(sc.moves));
  if (!E.isSolved(restored)) { t(`随机打乱 ${i} 逆序复原`, false); break; }
  if (i === 29) t('随机打乱逆序复原 x30', true);
}

// 4. 归一化合并
t("normalize U U -> U2", JSON.stringify(E.normalizeSeq('U U')) === JSON.stringify(['U2']));
t("normalize U U' -> 空", E.normalizeSeq("U U'").length === 0);
t("normalize R U U R' U 保留", E.normalizeSeq("R U U R' U").length === 4);

// 5. validate：合法状态必通过
for (let i = 0; i < 50; i++) {
  const sc = E.randomScramble(25);
  const v = E.validate(sc.state);
  if (!v.ok) { t(`validate 合法状态 #${i} (${v.reason})`, false); break; }
  if (i === 49) t('validate 合法状态 x50', true);
}

// 6. validate：非法状态应被拒绝
// 6a. 单独扭转一个角（对合法状态应用不合法组合无法直接构造，用交换两贴纸近似）
const sc1 = E.randomScramble(20);
// 交换两个同色不同位置的贴纸造成非法：把两个不同颜色的贴纸互换
const st1 = sc1.state.slice();
let iA = -1, iB = -1;
for (let i = 0; i < 54 && iB < 0; i++) {
  for (let j = i + 1; j < 54; j++) {
    if (st1[i] !== st1[j]) { iA = i; iB = j; break; }
  }
}
const tmp = st1[iA]; st1[iA] = st1[iB]; st1[iB] = tmp;
// 交换后颜色计数不变，但大概率破坏角/棱完整性
t('validate 交换两贴纸后被拒（大概率）', !E.validate(st1).ok);

// 6b. 中心不互异
const st2 = E.solvedState(); st2[0] = st2[9]; // U 中心改成 R 色（仅 1 格，计数也会错）
t('validate 计数错误被拒', !E.validate(st2).ok);

// 7. 已复原状态 validate 通过
t('validate 已复原状态', E.validate(E.solvedState()).ok);

// 8. findPiece：复原状态找白绿棱（W+G）在 UF 位置
const found = E.findPiece(E.solvedState(), ['W', 'G']);
t('findPiece 白绿棱位于 UF', found && E.isSolved ? found.pos.join(',') === '0,1,1' : false);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
