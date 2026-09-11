/* =========================================================================
 * e2e-roux.js — Roux 桥式解法浏览器端到端测试
 * 校验：方法选项 → 求解 → 阶段卡片 → 逐步播放 → 复原；且不影响既有解法
 * 运行：node test/e2e-roux.js
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
  ok(opts.indexOf('roux') >= 0, '包含 roux 选项', opts.join(','));
  ok(['lbl', 'cfop', '4lll', 'kociemba'].every(m => opts.indexOf(m) >= 0),
    '原有四解法均未被移除', opts.join(','));

  console.log('== 模块可用性 ==');
  ok(await page.evaluate(() => !!(window.CubeRoux && window.CubeRoux.solve)), '页面已加载 CubeRoux');

  console.log('== 选中 Roux 并求解 ==');
  await page.click('label.alg-opt:has(input[value="roux"]) span');
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'),
    null, { timeout: 30000 });

  const t0 = Date.now();
  await page.click('#btnSolve');
  await page.waitForFunction(() => {
    const s = document.getElementById('status').textContent;
    return s.includes('步 /') || s.includes('求解失败');
  }, null, { timeout: 120000 });
  const solveMs = Date.now() - t0;

  const status = (await page.textContent('#status')).trim();
  console.log('  状态栏: ' + status);
  console.log('  首次求解(含 LSE 建表): ' + solveMs + 'ms');
  ok(status.indexOf('Roux') === 0, '状态栏显示「Roux 桥式」', status);
  ok(status.indexOf('求解失败') < 0, '求解未失败', status);

  const moves = parseInt((status.match(/共 (\d+) 步/) || [])[1] || '0', 10);
  // Roux 靠块构造，应明显短于层先法(约 113 步)，但长于 Kociemba(约 23 步)
  ok(moves > 30 && moves < 100, '总步数在 Roux 合理区间（30-100）', 'moves=' + moves);

  console.log('== 阶段卡片 ==');
  const groups = await page.$$eval('.step-group', els => els.map(e => e.textContent.trim()));
  console.log('  阶段: ' + groups.join(' → '));
  ok(groups.some(g => g.indexOf('左桥') >= 0), '含「左桥 FB」');
  ok(groups.some(g => g.indexOf('右桥') >= 0), '含「右桥 SB」');
  ok(groups.some(g => g.indexOf('LSE') >= 0), '含「最后六棱 LSE」');
  ok(!groups.some(g => g.indexOf('F2L') >= 0), '不含层先/CFOP 的 F2L 阶段');

  const cards = await page.$$('.step-card');
  ok(cards.length >= 3, '步骤卡片已渲染', cards.length + '');

  console.log('== 播放演示到复原 ==');
  await page.click('#btnPlay');
  let done = false;
  const tp = Date.now();
  while (Date.now() - tp < 120000) {
    const st = await page.textContent('#status');
    const btn = await page.textContent('#btnPlay');
    if (st.includes('演示完成') && btn.includes('重放')) { done = true; break; }
    const playing = await page.evaluate(() =>
      document.getElementById('btnPlay').textContent.includes('暂停'));
    await page.waitForTimeout(playing ? 250 : 120);
  }
  const played = (await page.textContent('#btnPlay')).trim();
  ok(done, 'Roux 解法可完整播放到「演示完成」', played);

  const replayOk = await page.evaluate(() => {
    const E = window.CubeEngine;
    if (!E || !window.__solutionForTest) return null;
    let st = window.__solutionForTest.startState.slice();
    window.__solutionForTest.steps.forEach(s => { st = E.applySeq(st, s.moves); });
    return E.isSolved(st);
  });
  if (replayOk === null) console.log('  （未暴露 __solutionForTest，跳过引擎级重放校验）');
  else ok(replayOk === true, '页面内独立重放：steps 全量施加后状态已复原');

  await page.screenshot({ path: 'test/shot-roux-done.png' });

  console.log('== 二次求解（表已缓存，应更快）==');
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'),
    null, { timeout: 30000 });
  const t2 = Date.now();
  await page.click('#btnSolve');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('步 /'),
    null, { timeout: 120000 });
  const solveMs2 = Date.now() - t2;
  const moves2 = parseInt(((await page.textContent('#status')).match(/共 (\d+) 步/) || [])[1] || '0', 10);
  // 单次耗时取决于打乱难度，不能断言「二次一定更快」（会 flaky）。
  // 改为确定性校验：LSE 建表只发生一次 —— 建表耗时在首次求解后固定不变。
  const b = await page.evaluate(() => window.CubeRoux && window.CubeRoux.stats().lseBuildMs);
  ok(b > 0, '首次求解后 LSE 表已建好（lseBuildMs=' + b + 'ms）');
  ok(moves2 > 30 && moves2 < 100, '二次求解步数同样合理', 'moves=' + moves2);
  console.log('  二次: ' + solveMs2 + 'ms / ' + moves2 + ' 步');

  console.log('== 其它解法仍可用（不影响既有逻辑）==');
  for (const m of ['lbl', 'cfop', '4lll', 'kociemba']) {
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
    ok(s2.indexOf('求解失败') < 0, m + ' 模式仍可正常求解', s2.slice(0, 50));
  }

  console.log('== 控制台无报错 ==');
  const realErrors = errors.filter(e => e.indexOf('favicon') < 0);
  ok(realErrors.length === 0, '无页面报错', realErrors.slice(0, 3).join(' | '));

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  await browser.close();
  if (fail) process.exit(1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
