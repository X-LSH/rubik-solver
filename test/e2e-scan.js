/* 拍照录入 E2E：node test/e2e-scan.js（需系统 Edge）
   覆盖：摄像头启动与取流 → 实时采样色卡 → 逐面拍摄 6 面 → 应用到魔方；
        权限拒绝降级提示；上传图片采样链路 */
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
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const url = 'file:///' + path.resolve(__dirname, '..').replace(/\\/g, '/') + '/index.html';
  await page.goto(url);
  await page.waitForTimeout(400);

  // 进入拍照 tab
  await page.click('.tab[data-tab="scan"]');
  t('S1 拍照 tab 存在且可切换', await page.$eval('#tab-scan', el => el.classList.contains('active')));
  await page.waitForTimeout(100);
  const layoutMode = await page.evaluate(() => ({
    cubeHidden: getComputedStyle(document.querySelector('.panel-cube')).display === 'none',
    scanMode: document.body.classList.contains('scan-mode')
  }));
  t('S16 拍照模式下 3D 面板隐藏（布局让位取景器）', layoutMode.cubeHidden && layoutMode.scanMode, JSON.stringify(layoutMode));
  await page.click('.tab[data-tab="edit"]');
  await page.waitForTimeout(100);
  t('S17 切回编辑 tab 后 3D 面板恢复', await page.$eval('.panel-cube', el => getComputedStyle(el).display !== 'none'));
  await page.click('.tab[data-tab="scan"]');

  // 启动摄像头（fake device）
  await page.click('#btnScanStart');
  await page.waitForFunction(() => {
    const v = document.getElementById('scanVideo');
    return v && v.videoWidth > 0;
  }, null, { timeout: 15000 });
  t('S2 摄像头取流成功（videoWidth>0）', true);
  t('S3 stage 进入 live 态', await page.$eval('#scanStage', el => el.classList.contains('live')));

  // 实时采样色卡
  await page.waitForTimeout(400);
  const cellInfo = await page.evaluate(() => {
    const c = document.querySelector('.scan-cell');
    return { bg: c.style.background, tag: c.querySelector('.tag').textContent };
  });
  t('S4 色卡有采样背景与参考分类', cellInfo.bg.includes('rgb') && /^[WYROGB]$/.test(cellInfo.tag), JSON.stringify(cellInfo));

  // 逐面拍摄 6 面
  for (let i = 0; i < 6; i++) await page.click('#btnShot');
  const thumbState = await page.evaluate(() => ({
    done: document.querySelectorAll('.scan-face-thumb.done').length,
    applyEnabled: !document.getElementById('btnScanApply').disabled,
    guide: document.getElementById('scanGuide').textContent
  }));
  t('S5 六面拍摄完成（6 缩略 done）', thumbState.done === 6, 'done=' + thumbState.done);
  t('S6 应用按钮解锁', thumbState.applyEnabled);
  t('S7 引导条提示拍齐', thumbState.guide.includes('拍齐'), thumbState.guide);

  // 应用到魔方
  await page.click('#btnScanApply');
  await page.waitForTimeout(300);
  const applied = await page.evaluate(() => {
    const bgs = [...document.querySelectorAll('#net .net-cell')].map(el => el.style.background);
    const white = bgs.filter(b => b.includes('242, 245, 247')).length;
    return {
      editActive: document.getElementById('tab-edit').classList.contains('active'),
      nonWhite: 54 - white,
      note: document.getElementById('scanNote').textContent
    };
  });
  t('S8 应用后切回状态编辑 tab', applied.editActive);
  t('S9 展开图状态已被替换（非白格 > 20，fake 视频非纯白画面）', applied.nonWhite > 20, 'nonWhite=' + applied.nonWhite);
  t('S10 应用有结果反馈', applied.note.length > 0, applied.note);

  // 权限拒绝降级（mock getUserMedia reject）
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page2.goto(url);
  await page2.waitForTimeout(300);
  await page2.click('.tab[data-tab="scan"]');
  await page2.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject({ name: 'NotAllowedError' });
  });
  await page2.click('#btnScanStart');
  await page2.waitForTimeout(300);
  const degrade = await page2.evaluate(() => document.getElementById('scanNote').textContent);
  t('S11 权限拒绝降级提示', degrade.includes('NotAllowedError') && degrade.includes('上传图片'), degrade);

  // 上传图片链路：页面内构造九宫格纯色图（U 面全白）塞给 file input
  await page2.evaluate(() => {
    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 360;
    const g = cv.getContext('2d');
    g.fillStyle = '#202a38'; g.fillRect(0, 0, 480, 360);
    const side = 480 * 0.62, x0 = (480 - side) / 2, y0 = (360 - side) / 2;
    g.fillStyle = '#f2f5f7';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      g.fillRect(x0 + c * side / 3 + 2, y0 + r * side / 3 + 2, side / 3 - 4, side / 3 - 4);
    return new Promise(res => cv.toBlob(b => {
      const dt = new DataTransfer();
      dt.items.add(new File([b], 'face.png', { type: 'image/png' }));
      const input = document.getElementById('scanFile');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
      res();
    }));
  });
  await page2.waitForTimeout(400);
  const upState = await page2.evaluate(() => {
    const c = document.querySelector('.scan-cell');
    return { tag: c.querySelector('.tag').textContent, note: document.getElementById('scanNote').textContent };
  });
  t('S12 上传图片采样链路（识别为白 W）', upState.tag === 'W', JSON.stringify(upState));
  await page2.click('#btnShot');
  t('S13 上传后可拍摄本面', await page2.$eval('.scan-face-thumb', el => el.classList.contains('done')));

  // 六面同一张图（中央全白）→ 中心匹配为双射必产生非法组合 → 旋转搜索失败 + 可疑格引导
  for (let i = 0; i < 5; i++) await page2.click('#btnShot');
  await page2.click('#btnScanApply');
  await page2.waitForTimeout(300);
  const asmFail = await page2.evaluate(() => ({
    note: document.getElementById('scanNote').textContent,
    guide: document.getElementById('scanGuide').textContent,
    suspects: document.querySelectorAll('#net .net-cell.suspect').length
  }));
  t('S14 无效输入 → 识别错误提示 + 回退应用', asmFail.note.includes('识别错误') || asmFail.note.includes('可尝试'), asmFail.note);
  t('S15 可疑格黄框标记渲染', asmFail.suspects > 0, 'suspects=' + asmFail.suspects);

  // 单面旋转校正：结果横幅为警示态 + ⟳ 按钮存在并可旋转
  const rotUi = await page2.evaluate(() => ({
    guideBad: document.getElementById('scanGuide').className.includes('bad'),
    rotCount: document.querySelectorAll('.scan-face-thumb .f-rot').length
  }));
  t('S18 应用失败时引导横幅为警示态', rotUi.guideBad);
  t('S19 已拍面显示旋转校正按钮', rotUi.rotCount === 6, 'count=' + rotUi.rotCount);
  await page2.click('.tab[data-tab="scan"]'); // 应用失败也会切到编辑 tab，先回到拍照页
  await page2.waitForTimeout(200);
  await page2.click('.scan-face-thumb .f-rot');
  const rotNote = await page2.evaluate(() => document.getElementById('scanNote').textContent);
  t('S20 点击 ⟳ 旋转单面并提示重新应用', rotNote.includes('旋转 90°'), rotNote);

  t('无页面 JS 错误', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E 运行失败:', e); process.exit(1); });
