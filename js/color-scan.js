/* =========================================================================
 * color-scan.js — 照片识别核心：3×3 网格颜色采样与六色分类（纯函数，零依赖）
 *
 * 管线：ImageData → 每格中心 30% 区域通道中位数 → 白平衡增益校正（线性域）
 *       → sRGB→Lab → 中心块标定（6 中心最优匹配标准色）→ 48 格
 *         ΔE 最近邻 + 「每色恰 9」平衡分配 → 54 色字母
 * 依赖：window.CubeEngine（COLOR_HEX / STD_COLORS）；Node 下 require。
 * ========================================================================= */
(function (global) {
  'use strict';

  var E = (typeof module !== 'undefined' && module.exports) ? require('./cube-engine.js') : global.CubeEngine;

  var FACE_KEYS = ['U', 'R', 'F', 'D', 'L', 'B'];
  var STD_LETTERS = ['W', 'Y', 'R', 'O', 'G', 'B']; // 标准六色字母（与 COLOR_HEX 键一致）

  /* ---------- sRGB → Lab（D65） ---------- */
  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToLab(lr, lg, lb) {
    // sRGB(D65) → XYZ
    var X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
    var Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
    var Z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
    // D65 白点归一
    X /= 0.95047; Z /= 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116); };
    var fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; // [L, a, b]
  }
  function rgbToLab(r, g, b) {
    return linearToLab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  }
  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  // 标准六色 Lab（letter → [L,a,b]）
  var STD_LAB = {};
  STD_LETTERS.forEach(function (L) {
    var c = hexToRgb(E.COLOR_HEX[L]);
    STD_LAB[L] = rgbToLab(c[0], c[1], c[2]);
  });

  /* ---------- 采样：通道中位数 ---------- */
  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // 从 ImageData 取 (x0,y0,w,h) 格子中心 30% 区域的 RGB 中位数
  function sampleCell(img, x0, y0, w, h) {
    var mx0 = Math.round(x0 + w * 0.35), my0 = Math.round(y0 + h * 0.35);
    var mx1 = Math.round(x0 + w * 0.65), my1 = Math.round(y0 + h * 0.65);
    var rs = [], gs = [], bs = [], data = img.data, W = img.width;
    for (var y = my0; y < my1; y++) {
      for (var x = mx0; x < mx1; x++) {
        var i = (y * W + x) * 4;
        rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
      }
    }
    return { r: Math.round(median(rs)), g: Math.round(median(gs)), b: Math.round(median(bs)) };
  }
  // 3×3 网格：从 (gx,gy) 起、每格 cellW×cellH
  function sampleGrid(img, gx, gy, cellW, cellH) {
    var out = [];
    for (var r = 0; r < 3; r++)
      for (var c = 0; c < 3; c++)
        out.push(sampleCell(img, gx + c * cellW, gy + r * cellH, cellW, cellH));
    return out;
  }

  /* ---------- 白平衡：6 中心色线性域增益 → 校正到标准六色均值 ---------- */
  function whiteBalanceGains(centers) {
    var stdMean = [0, 0, 0], imgMean = [0, 0, 0], n = centers.length;
    STD_LETTERS.forEach(function (L) {
      var c = hexToRgb(E.COLOR_HEX[L]);
      stdMean[0] += srgbToLinear(c[0]); stdMean[1] += srgbToLinear(c[1]); stdMean[2] += srgbToLinear(c[2]);
    });
    stdMean = stdMean.map(function (v) { return v / n; });
    centers.forEach(function (c) {
      imgMean[0] += srgbToLinear(c.r); imgMean[1] += srgbToLinear(c.g); imgMean[2] += srgbToLinear(c.b);
    });
    imgMean = imgMean.map(function (v) { return v / n; });
    return [0, 1, 2].map(function (i) {
      var g = imgMean[i] > 1e-6 ? stdMean[i] / imgMean[i] : 1;
      return Math.max(0.5, Math.min(2, g)); // 防异常
    });
  }
  function labWithGain(c, gains) {
    return linearToLab(srgbToLinear(c.r) * gains[0], srgbToLinear(c.g) * gains[1], srgbToLinear(c.b) * gains[2]);
  }
  function dE2(a, b) { // Lab 欧氏距离平方
    var da = a[0] - b[0], db = a[1] - b[1], dc = a[2] - b[2];
    return da * da + db * db + dc * dc;
  }

  /* ---------- 分类主入口 ----------
   * faces: { U:[9×{r,g,b}], R:…, F:…, D:…, L:…, B:… }（每面 3×3 行优先采样结果）
   * 返回:  { U:[9×字母], R:…, … } 字母 ∈ W/Y/R/O/G/B
   */
  function classifyCube(faces) {
    // 1. 中心色与白平衡
    var centers = FACE_KEYS.map(function (f) { return faces[f][4]; });
    var gains = whiteBalanceGains(centers);
    var centerLab = FACE_KEYS.map(function (f) { return labWithGain(faces[f][4], gains); });

    // 2. 中心 → 标准色字母：6! 全排列取总 ΔE 最小的匹配
    var bestPerm = null, bestCost = Infinity;
    var perm = STD_LETTERS.slice();
    function permutations(arr, start) {
      if (start === arr.length) {
        var cost = 0;
        for (var i = 0; i < 6; i++) cost += dE2(centerLab[i], STD_LAB[arr[i]]);
        if (cost < bestCost) { bestCost = cost; bestPerm = arr.slice(); }
        return;
      }
      for (var j = start; j < arr.length; j++) {
        var t = arr[start]; arr[start] = arr[j]; arr[j] = t;
        permutations(arr, start + 1);
        t = arr[start]; arr[start] = arr[j]; arr[j] = t;
      }
    }
    permutations(perm, 0);
    // 每类（字母）的参考 Lab = 该类中心实测 Lab（中心块标定）
    var classLab = {};
    FACE_KEYS.forEach(function (f, i) { classLab[bestPerm[i]] = centerLab[i]; });

    // 3. 其余 48 格：对 6 类 ΔE → 「每色恰 9」平衡贪心
    var result = {};
    var counts = {}, assigned = {};
    FACE_KEYS.forEach(function (f, fi) {
      result[f] = new Array(9);
      result[f][4] = bestPerm[fi]; // 中心格直接定类
      counts[bestPerm[fi]] = (counts[bestPerm[fi]] || 0) + 1;
    });
    var cands = [];
    FACE_KEYS.forEach(function (f) {
      for (var i = 0; i < 9; i++) {
        if (i === 4) continue;
        var lab = labWithGain(faces[f][i], gains);
        for (var j = 0; j < 6; j++) {
          cands.push({ f: f, i: i, letter: STD_LETTERS[j], d: dE2(lab, classLab[STD_LETTERS[j]]) });
        }
      }
    });
    cands.sort(function (a, b) { return a.d - b.d; });
    for (var k = 0; k < cands.length; k++) {
      var cd = cands[k];
      if (assigned[cd.f + cd.i]) continue;
      if (counts[cd.letter] >= 9) continue;
      assigned[cd.f + cd.i] = true;
      result[cd.f][cd.i] = cd.letter;
      counts[cd.letter]++;
    }
    return result;
  }

  /* ---------- 单点参考分类（实时预览用，非最终结果） ---------- */
  function nearestStdLetter(r, g, b) {
    var lab = rgbToLab(r, g, b), best = null, bestD = Infinity;
    STD_LETTERS.forEach(function (L) {
      var d = dE2(lab, STD_LAB[L]);
      if (d < bestD) { bestD = d; best = L; }
    });
    return best;
  }

  /* ---------- 导出 ---------- */
  var ColorScan = {
    rgbToLab: rgbToLab,
    sampleCell: sampleCell,
    sampleGrid: sampleGrid,
    whiteBalanceGains: whiteBalanceGains,
    classifyCube: classifyCube,
    nearestStdLetter: nearestStdLetter,
    STD_LETTERS: STD_LETTERS,
    FACE_KEYS: FACE_KEYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ColorScan;
  else global.CubeColorScan = ColorScan;
})(typeof window !== 'undefined' ? window : globalThis);
