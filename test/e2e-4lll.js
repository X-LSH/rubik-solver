/* =========================================================================
 * e2e-4lll.js — 四步法 4LLL 浏览器端到端测试
 * 校验：方法选项存在 → 选中后求解 → 阶段卡片渲染 → 逐步播放 → 最终复原
 * 运行：node test/e2e-4lll.js
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
  ok(opts.length === 3, '方法选择器有 3 个选项', opts.join(','));
  ok(opts.indexOf('4lll') >= 0, '包含 4lll 选项', opts.join(','));
  ok(opts.indexOf('lbl') >= 0 && opts.indexOf('cfop') >= 0, '原有 lbl / cfop 未被移除', opts.join(','));

  console.log('== 选中 4LLL 并求解 ==');
  await page.click('label.alg-opt:has(input[value="4lll"]) span');
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'),
    null, { timeout: 30000 });

  await page.click('#btnSolve');
  await page.waitForFunction(() => {
    const s = document.getElementById('status').textContent;
    return s.includes('步 /') || s.includes('求解失败');
  }, null, { timeout: 60000 });
  const status = (await page.textContent('#status')).trim();
  console.log('  状态栏: ' + status);
  ok(status.indexOf('四步法 4LLL') === 0, '状态栏显示「四步法 4LLL」', status);
  ok(status.indexOf('求解失败') < 0, '求解未失败', status);

  const moves = parseInt((status.match(/共 (\d+) 步/) || [])[1] || '0', 10);
  ok(moves > 30 && moves < 200, '总步数在合理区间', 'moves=' + moves);

  console.log('== 阶段卡片 ==');
  const groups = await page.$$eval('.step-group', els => els.map(e => e.textContent.trim()));
  console.log('  阶段: ' + groups.join(' → '));
  ok(groups.length >= 5, '至少 5 个阶段', groups.length + '');
  ok(groups.some(g => g.indexOf('顶棱朝向') >= 0), '含「顶棱朝向」阶段');
  ok(groups.some(g => g.indexOf('顶角朝向') >= 0), '含「顶角朝向」阶段');
  ok(groups.some(g => g.indexOf('顶层归位') >= 0), '含「顶层归位」阶段');
  ok(!groups.some(g => g.indexOf('OLL') >= 0 || g.indexOf('PLL') >= 0), '不含 CFOP 的 OLL/PLL 阶段');

  const cards = await page.$$('.step-card');
  ok(cards.length >= 5, '步骤卡片已渲染', cards.length + '');

  console.log('== 播放演示到复原 ==');
  // 用「播放」按钮走完全程（完成态以「演示完成」+ 按钮变「重放」双重条件判定，
  // 与 browser-test.js 一致——单看文案会因残留导致假阳性）。
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
  ok(done, '4LLL 解法可完整播放到「演示完成」', played);
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

  await page.screenshot({ path: 'test/shot-4lll-done.png' });

  console.log('== 切回 LBL 仍可用（不影响既有逻辑）==');
  await page.click('label.alg-opt:has(input[value="lbl"]) span');
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'),
    null, { timeout: 30000 });
  await page.click('#btnSolve');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('步 /'),
    null, { timeout: 60000 });
  const lblStatus = (await page.textContent('#status')).trim();
  ok(lblStatus.indexOf('层先法') === 0, 'LBL 仍正常工作', lblStatus);

  console.log('== 控制台无报错 ==');
  const realErrors = errors.filter(e => e.indexOf('favicon') < 0);
  ok(realErrors.length === 0, '无页面报错', realErrors.slice(0, 3).join(' | '));

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  await browser.close();
  if (fail) process.exit(1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
