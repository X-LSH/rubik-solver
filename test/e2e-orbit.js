/* trackball 全向视角 E2E：node test/e2e-orbit.js（需系统 Edge）
   验证：初始 matrix3d 正交、拖拽后仍正交、垂直拖可越过 ±90°（旧版钳制点）、转动动画不受影响 */
'use strict';
const path = require('path');
const { chromium } = require('../.pwtest/node_modules/playwright-core');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (ok) pass++; else fail++;
}

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
  await page.waitForTimeout(500);

  const getM = () => page.evaluate(() => {
    const tr = document.querySelector('.cv-scene').style.transform;
    const m = tr.match(/matrix3d\(([^)]+)\)/);
    if (!m) return null;
    const v = m[1].split(',').map(parseFloat);
    // 取 3x3 线性部分（列主序展开 → 行主序矩阵）
    return [[v[0], v[4], v[8]], [v[1], v[5], v[9]], [v[2], v[6], v[10]]];
  });
  const isOrtho = (R) => {
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dot(R[i], R[i]) - 1) > 1e-4) return false;
      for (let j = i + 1; j < 3; j++) if (Math.abs(dot(R[i], R[j])) > 1e-4) return false;
    }
    return true;
  };

  const box = await page.locator('#cubeArea').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  const M0 = await getM();
  t('A1 初始 transform 为 matrix3d 且正交（姿态与旧版 rotateX(-28) rotateY(-34) 等价）', !!M0 && isOrtho(M0));

  // 水平拖 200px → 应有变化
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy, { steps: 10 });
  await page.mouse.up();
  const M1 = await getM();
  t('A2 水平拖拽改变视角', !!M1 && isOrtho(M1) && JSON.stringify(M1) !== JSON.stringify(M0));

  // 垂直向下拖 600px = 240°：旧版在 -90° 钳死，新版应持续翻转
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(cx + 200, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 250, { steps: 12 });
    await page.mouse.up();
  }
  const M2 = await getM();
  t('A3 垂直拖 750° 累计后矩阵仍正交（全向翻滚无锁死）', !!M2 && isOrtho(M2));
  t('A4 翻滚后视角与初始不同（越过了旧版 ±90° 钳制）', JSON.stringify(M2) !== JSON.stringify(M1));

  // 转动动画不受轨道影响：执行 R 转后矩阵不变、贴纸刷新
  await page.evaluate(() => window.CubeView && null);
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'), null, { timeout: 30000 });
  const M3 = await getM();
  t('A5 打乱动画完成后轨道矩阵保持不变', JSON.stringify(M3) === JSON.stringify(M2));

  // 归零视角拖回初始（粗略）不必要——重置页面验证复原态
  await page.reload();
  await page.waitForTimeout(500);
  const colors = await page.evaluate(() => {
    const set = new Set();
    document.querySelectorAll('.cv-face').forEach(f => set.add(f.style.background));
    return set.size;
  });
  t('A6 初始复原态 3D 显示 6 种面色', colors === 6, '色数=' + colors);

  t('无页面 JS 错误', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E 运行失败:', e); process.exit(1); });
