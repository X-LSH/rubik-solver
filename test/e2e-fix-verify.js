/* 针对两项修复的 E2E 验证：node test/e2e-fix-verify.js（需系统 Edge）
   [A] 展开图画笔涂色实时刷新
   [B] 颜色数量正常但不可复原的分类提示（角扭转走 UI 链路，棱翻转/奇偶走引擎层） */
'use strict';
const path = require('path');
const { chromium } = require('../.pwtest/node_modules/playwright-core');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (ok) pass++; else fail++;
}
const squash = (s) => String(s).replace(/\s/g, '');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const url = 'file:///' + path.resolve(__dirname, '..').replace(/\\/g, '/') + '/index.html';
  await page.goto(url);
  await page.waitForTimeout(500);

  const HEX = await page.evaluate(() => window.CubeEngine.COLOR_HEX);
  const netCell = (i) => '#net .net-cell[data-idx="' + i + '"]';
  const bgOf = (sel) => page.$eval(sel, el => el.style.background);
  const hex2rgb = (h) => {
    const n = parseInt(h.slice(1), 16);
    return 'rgb(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ')';
  };

  /* ===== [A] 展开图画笔涂色实时刷新 ===== */
  const before = await bgOf(netCell(0));
  t('A1 初始 facelet0 展开图为白色', squash(before) === squash(hex2rgb(HEX.W)), before);
  await page.click('#palette .swatch[data-color="G"]');
  await page.click(netCell(0));
  await page.waitForTimeout(120);
  const after = await bgOf(netCell(0));
  t('A2 画笔涂色后展开图立即变绿', squash(after) === squash(hex2rgb(HEX.G)), after);
  const badge1 = await page.textContent('#validBadge');
  t('A3 badge 显示数量错误（8 次/应为 9 次）', badge1.includes('8') && badge1.includes('9'), badge1.trim());
  t('A4 数量错误时求解按钮禁用', (await page.$eval('#btnSolve', el => el.disabled)) === true);

  /* ===== [B] 颜色数量正常但不可复原 ===== */
  await page.click('#btnReset');
  await page.waitForTimeout(150);
  // 交换单个角块（URF）的两个贴纸 → 单独扭转，颜色计数不变
  const slots = await page.evaluate(() => window.CubeEngine.faceletsAt([1, 1, 1]));
  const colA = await bgOf(netCell(slots[0]));
  const colB = await bgOf(netCell(slots[1]));
  t('B1 URF 角两贴纸颜色不同（复原态）', squash(colA) !== squash(colB));
  const colorByRGB = {};
  Object.keys(HEX).forEach(k => { colorByRGB[squash(hex2rgb(HEX[k]))] = k; });
  const keyA = colorByRGB[squash(colA)];
  const keyB = colorByRGB[squash(colB)];
  await page.click('#palette .swatch[data-color="' + keyB + '"]');
  await page.click(netCell(slots[0]));
  await page.click('#palette .swatch[data-color="' + keyA + '"]');
  await page.click(netCell(slots[1]));
  await page.waitForTimeout(120);
  t('B2 交换后展开图 slot0 = 原 slot1 颜色（再次验证实时刷新）', squash(await bgOf(netCell(slots[0]))) === squash(colB));
  t('B3 交换后展开图 slot1 = 原 slot0 颜色', squash(await bgOf(netCell(slots[1]))) === squash(colA));
  const badge2 = await page.textContent('#validBadge');
  t('B4 badge 提示「颜色数量正常，但不可复原」', badge2.includes('颜色数量正常') && badge2.includes('不可复原'), badge2.trim());
  t('B5 badge 指出角块被单独扭转', badge2.includes('扭转'), badge2.trim());
  t('B6 不可解状态时求解按钮禁用', (await page.$eval('#btnSolve', el => el.disabled)) === true);

  // 引擎层文案：棱翻转 / 两棱互换（均不改变颜色计数）
  const rFlip = await page.evaluate(() => {
    const E = window.CubeEngine;
    const s = E.solvedState();
    const f = E.faceletsAt([0, 1, 1]); // UF 棱
    const tmp = s[f[0]]; s[f[0]] = s[f[1]]; s[f[1]] = tmp;
    return E.validate(s).reason;
  });
  t('B7 棱翻转 → 分类提示含「翻转」', rFlip.includes('颜色数量正常') && rFlip.includes('翻转'), rFlip);
  const rPar = await page.evaluate(() => {
    const E = window.CubeEngine;
    const s = E.solvedState();
    const a = E.faceletsAt([0, 1, 1]); // UF
    const b = E.faceletsAt([1, 1, 0]); // UR
    let tmp = s[a[0]]; s[a[0]] = s[b[0]]; s[b[0]] = tmp;
    tmp = s[a[1]]; s[a[1]] = s[b[1]]; s[b[1]] = tmp;
    return E.validate(s).reason;
  });
  t('B8 两棱互换 → 分类提示含「互换」', rPar.includes('颜色数量正常') && rPar.includes('互换'), rPar);

  t('无页面 JS 错误', errors.length === 0, errors.join(' | '));

  await page.screenshot({ path: 'test/shot-fix-verify.png' });
  await browser.close();
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E 运行失败:', e); process.exit(1); });
