/* color-scan 单元与场景测试：node test/test-color-scan.js
   合成图像覆盖：标准六色 / 暖光·冷光·暗光白平衡 / 高斯噪声 / 中央反光斑 / 平衡分配约束 */
'use strict';
var E = require('../js/cube-engine.js');
var CS = require('../js/color-scan.js');

var pass = 0, fail = 0;
function t(name, ok, extra) {
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (ok ? '' : ' — ' + (extra == null ? '' : extra)));
  if (ok) pass++; else fail++;
}
function lcg(seed) {
  var s = seed >>> 0;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/* ---------- 合成图像工厂 ---------- */
// colors9: [9×{r,g,b}]；opts: {gain:[gr,gg,gb], noise:σ, glare:[格idx...], seed}
function makeGridImage(colors9, opts) {
  opts = opts || {};
  var cell = 30, W = cell * 3, H = cell * 3;
  var data = new Uint8ClampedArray(W * H * 4);
  var rnd = lcg(opts.seed || 42);
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 3; c++) {
      var idx = r * 3 + c, col = colors9[idx];
      for (var py = 0; py < cell; py++) {
        for (var px = 0; px < cell; px++) {
          var R = col.r, G = col.g, B = col.b;
          if (opts.gain) {
            R *= opts.gain[0]; G *= opts.gain[1]; B *= opts.gain[2];
          }
          if (opts.noise) {
            R += (rnd() + rnd() + rnd() - 1.5) * 2 * opts.noise;
            G += (rnd() + rnd() + rnd() - 1.5) * 2 * opts.noise;
            B += (rnd() + rnd() + rnd() - 1.5) * 2 * opts.noise;
          }
          // 中央反光斑：格子中央 6×6，占采样区（约 9×9）44% —— 中位数可消除
          if (opts.glare && opts.glare.indexOf(idx) >= 0) {
            var dx = Math.abs(px - 14.5), dy = Math.abs(py - 14.5);
            if (dx < 3 && dy < 3) { R = 250; G = 250; B = 250; }
          }
          var i = ((r * cell + py) * W + c * cell + px) * 4;
          data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = 255;
        }
      }
    }
  }
  return { data: data, width: W, height: H };
}
function rgbOf(letter) {
  var c = CS.rgbToLab ? null : null; // noop 保持简洁
  var hex = E.COLOR_HEX[letter];
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}
// 54 字母状态（面序 U R F D L B）→ 六面 9 色 RGB
function facesFromState(state) {
  var faces = {};
  CS.FACE_KEYS.forEach(function (f, fi) {
    faces[f] = [];
    for (var i = 0; i < 9; i++) faces[f].push(rgbOf(state[fi * 9 + i]));
  });
  return faces;
}
function classifyState(state, opts) {
  var faces = facesFromState(state);
  var images = {};
  CS.FACE_KEYS.forEach(function (f) { images[f] = makeGridImage(faces[f], opts); });
  var grids = {};
  CS.FACE_KEYS.forEach(function (f) { grids[f] = CS.sampleGrid(images[f], 0, 0, 30, 30); });
  return CS.classifyCube(grids);
}
function toFlat(result) {
  var out = [];
  CS.FACE_KEYS.forEach(function (f) { out = out.concat(result[f]); });
  return out;
}
function matchCount(a, b) {
  var n = 0;
  for (var i = 0; i < 54; i++) if (a[i] === b[i]) n++;
  return n;
}
// 固定种子随机合法态
function randomState(seed) {
  var rnd = lcg(seed), st = E.solvedState();
  var faces = ['U', 'D', 'R', 'L', 'F', 'B'];
  for (var i = 0; i < 25; i++) {
    var mv = faces[(rnd() * 6) | 0], t = 1 + ((rnd() * 3) | 0);
    st = E.applyMove(st, mv + (t === 2 ? '2' : (t === 3 ? "'" : '')));
  }
  return st;
}

/* ---------- 1. rgbToLab 已知值 ---------- */
(function () {
  var w = CS.rgbToLab(255, 255, 255);
  t('1.1 白 → L≈100, a/b≈0', Math.abs(w[0] - 100) < 0.5 && Math.abs(w[1]) < 1 && Math.abs(w[2]) < 1, JSON.stringify(w));
  var b = CS.rgbToLab(0, 0, 0);
  t('1.2 黑 → 全 0', Math.abs(b[0]) < 0.5 && Math.abs(b[1]) < 0.5 && Math.abs(b[2]) < 0.5, JSON.stringify(b));
  var r = CS.rgbToLab(255, 0, 0);
  t('1.3 红 → a>50, b>40, L∈[50,58]', r[1] > 50 && r[2] > 40 && r[0] > 50 && r[0] < 58, JSON.stringify(r));
})();

/* ---------- 2. 采样 ---------- */
(function () {
  var img = makeGridImage([rgbOf('W'), rgbOf('Y'), rgbOf('R'), rgbOf('O'), rgbOf('G'), rgbOf('B'), rgbOf('W'), rgbOf('Y'), rgbOf('R')]);
  var cell = CS.sampleCell(img, 0, 0, 30, 30);
  t('2.1 纯色格中位数 = 原色', Math.abs(cell.r - 242) <= 1 && Math.abs(cell.g - 245) <= 1 && Math.abs(cell.b - 247) <= 1, JSON.stringify(cell));
  var glareImg = makeGridImage([rgbOf('W'), rgbOf('W'), rgbOf('W'), rgbOf('W'), rgbOf('W'), rgbOf('W'), rgbOf('W'), rgbOf('W'), rgbOf('W')], { glare: [0] });
  var g = CS.sampleCell(glareImg, 0, 0, 30, 30);
  t('2.2 中央 44% 白斑下中位数仍为底色', Math.abs(g.r - 242) <= 6 && Math.abs(g.g - 245) <= 6, JSON.stringify(g));
  var grid = CS.sampleGrid(img, 0, 0, 30, 30);
  t('2.3 sampleGrid 位置正确（格4=绿）', grid[4].g > grid[4].r && grid[4].g > grid[4].b, JSON.stringify(grid[4]));
})();

/* ---------- 3. classifyCube 场景 ---------- */
(function () {
  // 标准复原态无偏移
  var solved = E.solvedState();
  var r1 = classifyState(solved, {});
  t('3.1 复原态标准色 54/54', matchCount(toFlat(r1), solved) === 54);
  var v = E.validate(toFlat(r1));
  t('3.2 组装结果 validate 通过且已复原', v.ok && E.isSolved(toFlat(r1)));

  // 暖光 / 冷光 / 暗光
  t('3.3 暖光 gain(1.08,1.00,0.82) 54/54', matchCount(toFlat(classifyState(solved, { gain: [1.08, 1.0, 0.82] })), solved) === 54);
  t('3.4 冷光 gain(0.88,0.96,1.12) 54/54', matchCount(toFlat(classifyState(solved, { gain: [0.88, 0.96, 1.12] })), solved) === 54);
  t('3.5 暗光 ×0.55 54/54', matchCount(toFlat(classifyState(solved, { gain: [0.55, 0.55, 0.55] })), solved) === 54);

  // 随机合法态
  [1, 2, 3].forEach(function (seed) {
    var st = randomState(seed);
    t('3.6 随机态 seed=' + seed + ' 无偏移 54/54', matchCount(toFlat(classifyState(st, {})), st) === 54);
  });
  [4, 5].forEach(function (seed) {
    var st = randomState(seed);
    t('3.7 随机态 seed=' + seed + ' 暖光 54/54', matchCount(toFlat(classifyState(st, { gain: [1.08, 1.0, 0.82] })), st) === 54);
  });
  [6, 7, 8].forEach(function (seed) {
    var st = randomState(seed);
    var n = matchCount(toFlat(classifyState(st, { gain: [1.06, 1.0, 0.86], noise: 6, seed: seed })), st);
    t('3.8 随机态 seed=' + seed + ' 暖光+噪声σ6 ≥52/54', n >= 52, '对 ' + n + '/54');
  });

  // 反光
  [9, 10].forEach(function (seed) {
    var st = randomState(seed);
    var n = matchCount(toFlat(classifyState(st, { glare: [2, 6], seed: seed })), st);
    t('3.9 随机态 seed=' + seed + ' 两格反光 54/54', n === 54, '对 ' + n + '/54');
  });

  // 平衡分配约束
  var rr = classifyState(randomState(11), { gain: [1.05, 1.0, 0.85], noise: 4, seed: 11 });
  var flat = toFlat(rr);
  var cnt = {};
  flat.forEach(function (L) { cnt[L] = (cnt[L] || 0) + 1; });
  var balanced = CS.STD_LETTERS.every(function (L) { return cnt[L] === 9; });
  t('3.10 平衡分配：每色恰 9 个', balanced, JSON.stringify(cnt));
  var vOk = E.validate(flat).ok;
  t('3.11 分类组装态 validate 通过', vOk, E.validate(flat).reason);

  // 输出结构
  t('3.12 输出结构：六面各 9 格', CS.FACE_KEYS.every(function (f) { return rr[f].length === 9; }));
})();

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
