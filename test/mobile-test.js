/* 移动端视口测试 */
'use strict';
const path = require('path');
const { chromium } = require('../.pwtest/node_modules/playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const url = 'file:///' + path.resolve(__dirname, '..').replace(/\\/g, '/') + '/index.html';
  await page.goto(url);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test/shot-mobile-1.png' });
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'), null, { timeout: 30000 });
  await page.click('#btnSolve');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('步'), null, { timeout: 30000 });
  await page.click('.tab[data-tab="steps"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => { const s = document.getElementById('speed'); s.value = 90; s.dispatchEvent(new Event('input')); });
  await page.click('#btnPlay');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test/shot-mobile-2.png' });
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 90000) {
    await page.waitForTimeout(1000);
    if ((await page.textContent('#status')).includes('演示完成')) { done = true; break; }
  }
  await page.screenshot({ path: 'test/shot-mobile-3.png' });
  const solved = await page.evaluate(() => {
    const faces = {};
    document.querySelectorAll('.cv-face').forEach(f => {
      const cls = [...f.classList].find(c => /^cv-[URFDLB]$/.test(c));
      (faces[cls] = faces[cls] || new Set()).add(f.style.background);
    });
    return Object.values(faces).every(set => set.size === 1);
  });
  console.log('移动端播放完成:', done, '复原:', solved, '错误:', errors.length ? errors : '无');
  await browser.close();
  process.exit(errors.length || !solved ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
