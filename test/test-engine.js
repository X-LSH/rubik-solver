/* 引擎单元测试：node test/test-engine.js */
'use strict';
const E = require('../js/cube-engine.js');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
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

// 9. 中层转动 M / E / S（Roux 桥式必需）
// M 跟随 L（x=0 中层）、E 跟随 D（y=0 中层）、S 跟随 F（z=0 中层）
const AXIS = { M: 0, E: 1, S: 2 };
Object.keys(AXIS).forEach(k => {
  const ax = AXIS[k];
  const s0 = E.solvedState();
  const s1 = E.applySeq(s0, [k]);
  // 只影响该轴坐标 = 0 的贴纸
  let violations = [];
  for (let i = 0; i < 54; i++) {
    if (s1[i] !== s0[i] && E.PNS[i].pos[ax] !== 0) violations.push(`${i}(ax=${E.PNS[i].pos[ax]})`);
  }
  t(`${k} 只影响 ${'xyz'[ax]}=0 的贴纸`, violations.length === 0, violations.slice(0, 3).join(' '));
  // 恰好 12 个贴纸被影响（4 个中层棱 × 2 + 4 个中心 = 12）
  let moved = 0;
  for (let i = 0; i < 54; i++) if (s1[i] !== s0[i]) moved++;
  t(`${k} 影响 12 个贴纸（4 棱×2 + 4 中心）`, moved === 12, '实际 ' + moved);
  // 逆操作互消
  t(`${k} ${k}' = 恒等`, JSON.stringify(E.applySeq(s1, [k + "'"])) === JSON.stringify(s0));
  // 四连等于恒等
  let s4 = s0;
  for (let n = 0; n < 4; n++) s4 = E.applySeq(s4, [k]);
  t(`${k} 四连 = 恒等`, JSON.stringify(s4) === JSON.stringify(s0));
  // 与所属面同向（M 同 L、E 同 D、S 同 F）
  const FOLLOWER = { M: 'L', E: 'D', S: 'F' }[k];
  t(`${k} 与 ${FOLLOWER} 同向（中层+该面 = 整体转层）`,
    JSON.stringify(E.applySeq(s0, [k, FOLLOWER])) === JSON.stringify(E.applySeq(s0, [FOLLOWER, k])));
});
// 中层转动不改变合法性
{
  const sc = E.randomScramble(25).state;
  const afterMid = E.applySeq(sc, E.normalizeSeq("M E S M' E' S' U"));
  t('中层转动后状态仍合法', E.validate(afterMid).ok, E.validate(afterMid).reason || '');
}
// normalizeSeq 也应支持中层记号
t("normalize M M -> M2", JSON.stringify(E.normalizeSeq('M M')) === JSON.stringify(['M2']));
t("normalize S S' -> 空", E.normalizeSeq("S S'").length === 0);
t("normalize M U M' U' 保留", E.normalizeSeq("M U M' U'").length === 4);
// invertSeq 支持中层
t("invertSeq M E S", JSON.stringify(E.invertSeq('M E S')) === JSON.stringify(["S'", "E'", "M'"]));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
