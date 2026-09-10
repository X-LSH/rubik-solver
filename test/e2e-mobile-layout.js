/* 移动端布局防回归：步骤 tab 播放器控件必须在任何视口下完整可见、不错位不重叠
 * 背景：2026-09-10 真机反馈 —— 记号速查加入后暴露 player flex-wrap 任意折行，
 * 速度滑块掉到第二行右下角导致控件错位。此测试锁定布局契约，防止再次回归。 */
'use strict';
const path = require('path');
const { chromium } = require('../.pwtest/node_modules/playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///' + path.resolve(__dirname, '..').replace(/\\/g, '/') + '/index.html';
let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : ' —— ' + detail));
}

async function measurePlayer(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
    const side = rect(document.querySelector('.panel-side'));
    const player = rect(document.querySelector('#tab-steps .player'));
    const ids = ['btnToStart', 'btnPrev', 'btnPlay', 'btnNext'];
    const btns = ids.map(id => { const el = document.getElementById(id); const r = rect(el); return { id, display: getComputedStyle(el).display, ...r }; });
    const speedEl = document.querySelector('#tab-steps .speed-ctl');
    const speed = { display: getComputedStyle(speedEl).display, ...rect(speedEl) };
    const notation = rect(document.querySelector('.notation-help'));
    return { vw, vh, side, player, btns, speed, notation };
  });
}

async function testViewport(browser, w, h, label, expectOneRow) {
  console.log('\n[' + label + ' ' + w + '×' + h + ']');
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  await page.click('#btnScramble');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已打乱'), null, { timeout: 30000 });
  await page.click('#btnSolve');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('步'), null, { timeout: 30000 });
  await page.click('.tab[data-tab="steps"]');
  await page.waitForTimeout(300);
  const m = await measurePlayer(page);
  const shot = 'test/shot-layout-' + label + '.png';
  await page.screenshot({ path: shot });

  // 1) 五个控件全部渲染可见
  const all = m.btns.concat([m.speed]);
  check('5 个播放控件全部可见', all.every(c => c.display !== 'none' && c.h > 0 && c.w > 0),
    JSON.stringify(all.map(c => ({ id: c.id, display: c.display, w: Math.round(c.w), h: Math.round(c.h) }))));
  // 2) 无控件超出面板边界（左右 + 顶部；底部允许面板内滚动裁剪但 player 不应被裁）
  check('控件不超出面板边界', all.every(c => c.x >= m.side.x - 1 && c.right <= m.side.right + 1),
    JSON.stringify(all.filter(c => c.x < m.side.x - 1 || c.right > m.side.right + 1).map(c => c.id)));
  // 3) 控件不超出视口
  check('控件不超出视口', all.every(c => c.right <= m.vw + 1 && c.x >= -1),
    JSON.stringify(all.filter(c => c.right > m.vw + 1 || c.x < -1).map(c => c.id)));
  // 4) 记号速查与播放器不重叠
  check('记号速查不遮挡播放器', m.notation.bottom <= m.player.y + 1,
    'notation.bottom=' + Math.round(m.notation.bottom) + ' player.y=' + Math.round(m.player.y));
  // 5) 行布局契约
  const yOf = c => c.y;
  const centerY = c => c.y + c.h / 2;
  const btnYs = m.btns.map(yOf);
  const sameRow = cs => { const ys = cs.map(centerY); return Math.max.apply(null, ys) - Math.min.apply(null, ys) < 10; };
  if (expectOneRow) {
    check('桌面：按钮 + 速度滑块同一行（垂直中心对齐）', sameRow(m.btns.concat([m.speed])),
      'centerYs=' + m.btns.concat([m.speed]).map(centerY).map(Math.round).join(','));
  } else {
    check('移动端：四个按钮同一行', sameRow(m.btns), 'centerYs=' + m.btns.map(centerY).map(Math.round).join(','));
    check('移动端：速度滑块独占下方整行且与按钮不重叠',
      m.speed.y >= Math.max.apply(null, btnYs) + m.btns[0].h - 2 && m.speed.w > m.player.w * 0.8,
      'speed.y=' + Math.round(m.speed.y) + ' speed.w=' + Math.round(m.speed.w));
  }
  // 6) 无页面脚本错误
  check('无页面错误', errors.length === 0, errors.join('; '));
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  await testViewport(browser, 1280, 800, 'desktop', true);
  await testViewport(browser, 390, 844, 'mobile390', false);
  await testViewport(browser, 360, 740, 'mobile360', false);
  await browser.close();
  console.log('\n结果: ' + (failures === 0 ? '全部通过' : failures + ' 项失败'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
