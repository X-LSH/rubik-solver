/* 浏览器端到端测试：node test/browser-test.js（需系统 Edge） */
'use strict';
const path = require('path');
const { chromium } = require('../.pwtest/node_modules/playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const url = 'file:///' + path.resolve(__dirname, '..').replace(/\\/g, '/') + '/index.html';
  await page.goto(url);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test/shot-1-initial.png' });
  console.log('[1] 初始页加载 OK');

  // 随机打乱（等待完成）
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'), null, { timeout: 30000 });
  const scrambleStatus = await page.textContent('#status');
  console.log('[2] 打乱完成:', scrambleStatus.trim());
  await page.screenshot({ path: 'test/shot-2-scrambled.png' });

  // 求解
  await page.click('#btnSolve');
  await page.waitForTimeout(2500);
  const solveStatus = await page.textContent('#status');
  console.log('[3] 求解:', solveStatus.trim());
  const badge = await page.textContent('#validBadge');
  console.log('    状态徽章:', badge.trim());

  // 切到步骤 tab
  await page.click('.tab[data-tab="steps"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shot-3-steps.png' });
  const stepCount = await page.locator('.step-card').count();
  const groupCount = await page.locator('.step-group').count();
  console.log('[4] 步骤卡片:', stepCount, '个 / 分组:', groupCount, '个');

  // 播放演示（快速）
  await page.evaluate(() => { document.getElementById('speed').value = 90; document.getElementById('speed').dispatchEvent(new Event('input')); });
  await page.click('#btnPlay');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test/shot-4-playing.png' });
  // 轮询直到播放完成（最多 90s）
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 60000) {
    await page.waitForTimeout(1000);
    const st = await page.textContent('#status');
    if (st.includes('演示完成')) { done = true; break; }
    const playing = await page.evaluate(() => document.getElementById('btnPlay').textContent.includes('暂停'));
    if (!playing) break;
  }
  console.log('[5] 播放完成:', done, '耗时', Math.round((Date.now() - t0) / 1000) + 's');
  await page.waitForTimeout(400);
  const solvedCheck = await page.evaluate(() => {
    // 通过贴纸颜色验证复原：每个面的 9 格颜色一致（读取 3D 面背景色）
    const faces = {};
    document.querySelectorAll('.cv-face').forEach(f => {
      const cls = [...f.classList].find(c => /^cv-[URFDLB]$/.test(c));
      (faces[cls] = faces[cls] || new Set()).add(f.style.background);
    });
    let solved = true;
    Object.values(faces).forEach(set => { if (set.size !== 1) solved = false; });
    return { solved, faceCount: Object.keys(faces).length };
  });
  console.log('    3D 复原校验:', JSON.stringify(solvedCheck), '(solved 应为 true)');
  const finalBadge = await page.textContent('#validBadge');
  console.log('    最终徽章:', finalBadge.trim());
  await page.screenshot({ path: 'test/shot-5-done.png' });

  // 展开图编辑：切到编辑 tab，点击一格
  await page.click('.tab[data-tab="edit"]');
  await page.waitForTimeout(200);
  const cells = await page.locator('.net-cell').count();
  await page.locator('.net-cell').nth(1).click();
  console.log('[6] 展开图格子:', cells, '个，点击涂色 OK');
  await page.screenshot({ path: 'test/shot-6-edit.png' });

  console.log('\n页面错误:', errors.length ? errors : '无');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
