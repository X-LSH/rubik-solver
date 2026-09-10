/* =========================================================================
 * e2e-kociemba.js — Kociemba 两阶段求解器浏览器端到端测试
 * 校验：方法选项存在 → 选中后求解 → 阶段卡片渲染 → 逐步播放 → 最终复原
 * 运行：node test/e2e-kociemba.js
 * ========================================================================= */
'use strict';
const path = require('path');
const { chromium } = require('../.pwtest/node_modules/playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  let pass = 0, fail = 0;
  const ok = (c, n, extra) => {
    if (c) { pass++; console.log('  PASS ' + n); }
    else { fail++; console.log('  FAIL ' + n + (extra ? '  [' + extra + ']' : '')); }
  };

  const url = 'file:///' + path.resolve(__dirname, '..').replace(/\\/g, '/') + '/index.html';
  await page.goto(url);
  await page.waitForTimeout(600);

  console.log('== 方法选项 ==');
  const opts = await page.$$eval('input[name=alg]', els => els.map(e => e.value));
  ok(opts.length === 4, '方法选择器有 4 个选项', opts.join(','));
  ok(opts.indexOf('kociemba') >= 0, '包含 kociemba 选项', opts.join(','));
  ok(opts.indexOf('lbl') >= 0 && opts.indexOf('cfop') >= 0 && opts.indexOf('4lll') >= 0,
    '原有 lbl / cfop / 4lll 均未被移除', opts.join(','));

  console.log('== kubik 模块可用性 ==');
  const kcReady = await page.evaluate(() => !!(window.CubeKociemba && window.CubeKociemba.build));
  ok(kcReady, '页面已加载 CubeKociemba');

  console.log('== 选中 Kociemba 并求解 ==');
  await page.click('label.alg-opt:has(input[value="kociemba"]) span');
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'),
    null, { timeout: 30000 });

  const tSolve = Date.now();
  await page.click('#btnSolve');
  await page.waitForFunction(() => {
    const s = document.getElementById('status').textContent;
    return s.includes('步 /') || s.includes('求解失败');
  }, null, { timeout: 120000 });
  const solveMs = Date.now() - tSolve;

  const status = (await page.textContent('#status')).trim();
  console.log('  状态栏: ' + status);
  console.log('  首解含建表耗时: ' + solveMs + 'ms');
  ok(status.indexOf('Kociemba') === 0, '状态栏显示「Kociemba 两阶段」', status);
  ok(status.indexOf('求解失败') < 0, '求解未失败', status);

  const moves = parseInt((status.match(/共 (\d+) 步/) || [])[1] || '0', 10);
  // Kociemba 是近最优解，应显著短于 LBL(约 113 步) / CFOP(约 116 步) / 4LLL(约 104 步)
  ok(moves > 15 && moves <= 35, '总步数在近最优区间（15-35）', 'moves=' + moves);
  ok(moves < 60, '步数显著短于 LBL/CFOP/4LLL', 'moves=' + moves);

  console.log('== 阶段卡片 ==');
  const groups = await page.$$eval('.step-group', els => els.map(e => e.textContent.trim()));
  console.log('  阶段: ' + groups.join(' → '));
  ok(groups.length === 2, '恰好 2 个阶段', groups.length + '');
  ok(groups.some(g => g.indexOf('阶段 1') >= 0 && g.indexOf('G1') >= 0), '含「阶段 1 · 归入 G1 子群」');
  ok(groups.some(g => g.indexOf('阶段 2') >= 0), '含「阶段 2」');
  ok(!groups.some(g => g.indexOf('F2L') >= 0 || g.indexOf('PLL') >= 0), '不含 LBL/CFOP 的阶段名');

  const cards = await page.$$('.step-card');
  ok(cards.length === 2, '步骤卡片已渲染', cards.length + '');

  console.log('== 播放演示到复原 ==');
  await page.click('#btnPlay');
  let done = false, t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const st = await page.textContent('#status');
    const btn = await page.textContent('#btnPlay');
    if (st.includes('演示完成') && btn.includes('重放')) { done = true; break; }
    const playing = await page.evaluate(() =>
      document.getElementById('btnPlay').textContent.includes('暂停'));
    await page.waitForTimeout(playing ? 250 : 120);
  }
  const played = (await page.textContent('#btnPlay')).trim();
  const finalStatus = (await page.textContent('#status')).trim();
  console.log('  完成: ' + done + ' | 状态栏: ' + finalStatus + ' | 按钮: ' + played);
  ok(done, 'Kociemba 解法可完整播放到「演示完成」', played);
  ok(finalStatus.includes('演示完成'), '状态栏显示演示完成', finalStatus);

  // 独立校验：页面内把 steps 全量施加后必须真复原（不依赖 UI 文案）
  const replayOk = await page.evaluate(() => {
    const E = window.CubeEngine;
    if (!E || !window.__solutionForTest) return null;
    let st = window.__solutionForTest.startState.slice();
    window.__solutionForTest.steps.forEach(s => { st = E.applySeq(st, s.moves); });
    return E.isSolved(st);
  });
  if (replayOk === null) {
    console.log('  （页面未暴露 __solutionForTest，跳过引擎级重放校验）');
  } else {
    ok(replayOk === true, '页面内独立重放：steps 全量施加后状态已复原');
  }

  await page.screenshot({ path: 'test/shot-kociemba-done.png' });

  console.log('== 二次求解（建表已缓存，应明显更快）==');
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'),
    null, { timeout: 30000 });
  const tSolve2 = Date.now();
  await page.click('#btnSolve');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('步 /'),
    null, { timeout: 120000 });
  const solveMs2 = Date.now() - tSolve2;
  const moves2 = parseInt(((await page.textContent('#status')).match(/共 (\d+) 步/) || [])[1] || '0', 10);
  console.log('  二次求解: ' + solveMs2 + 'ms / ' + moves2 + ' 步');
  ok(solveMs2 < solveMs, '二次求解快于首次（建表已缓存）', '首 ' + solveMs + 'ms → 次 ' + solveMs2 + 'ms');
  ok(moves2 > 15 && moves2 <= 35, '二次求解步数同样在近最优区间', 'moves=' + moves2);

  console.log('== 切换到其它解法仍可用（不影响既有逻辑）==');
  for (const m of ['lbl', 'cfop', '4lll']) {
    await page.click('label.alg-opt:has(input[value="' + m + '"]) span');
    await page.click('#btnScramble');
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'),
      null, { timeout: 30000 });
    await page.click('#btnSolve');
    await page.waitForFunction(() => {
      const s = document.getElementById('status').textContent;
      return s.includes('步 /') || s.includes('求解失败');
    }, null, { timeout: 90000 });
    const s2 = (await page.textContent('#status')).trim();
    ok(s2.indexOf('求解失败') < 0, m + ' 模式仍可正常求解', s2.slice(0, 60));
  }

  console.log('== 控制台无报错 ==');
  const realErrors = errors.filter(e => e.indexOf('favicon') < 0);
  ok(realErrors.length === 0, '无页面报错', realErrors.slice(0, 3).join(' | '));

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  await browser.close();
  if (fail) process.exit(1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
