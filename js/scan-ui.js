/* =========================================================================
 * scan-ui.js — 拍照录入：getUserMedia 取流 → 中央九宫格采样预览 → 逐面拍摄
 *              → 六面齐后 classifyCube 组装 → 应用到魔方
 * 依赖：CubeEngine / CubeColorScan / CubeApp（app.js 导出）
 * 摄像头不可用时降级为上传图片；离开拍照 tab 自动停止摄像头。
 * ========================================================================= */
(function () {
  'use strict';

  var CS = window.CubeColorScan, E = window.CubeEngine;
  if (!CS || !E || !window.CubeApp) return;

  var FACE_KEYS = CS.FACE_KEYS;                 // 拍摄顺序标签 ['U','R','F','D','L','B']（≠ facelet 面序）
  var SEQ_NAME = ['第 1 面', '第 2 面', '第 3 面', '第 4 面', '第 5 面', '第 6 面'];

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('scanStage'), video = $('scanVideo'), canvas = $('scanCanvas');
  var cellsBox = $('scanCells'), guide = $('scanGuide'), facesBox = $('scanFaces');
  var btnStart = $('btnScanStart'), btnShot = $('btnShot'), btnApply = $('btnScanApply');
  var btnUpload = $('btnScanUpload'), fileInput = $('scanFile'), note = $('scanNote');

  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var stream = null, rafId = 0, lastSample = 0;
  var mode = 'idle';          // idle | camera | image
  var curIdx = 0;             // 当前待拍面索引
  var snaps = {};             // face → {grid:[9×{r,g,b}]}

  var SIDE = 0.62;            // 中央取景正方形（与 CSS .scan-cells 对齐）

  /* ---------- 初始化 DOM ---------- */
  var cells = [];
  (function buildCells() {
    for (var i = 0; i < 9; i++) {
      var d = document.createElement('div');
      d.className = 'scan-cell' + (i === 4 ? ' center-cell' : '');
      var tag = document.createElement('span');
      tag.className = 'tag';
      d.appendChild(tag);
      cellsBox.appendChild(d);
      cells.push({ el: d, tag: tag });
    }
  })();

  /* ---------- 摄像头 ---------- */
  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      note.textContent = '当前环境不支持摄像头（需 HTTPS 或 localhost），请使用「上传图片」';
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    }).then(function (s) {
      stream = s;
      video.srcObject = s;
      video.style.display = 'block';
      return video.play();
    }).then(function () {
      mode = 'camera';
      stage.classList.add('live');
      btnStart.disabled = true;
      btnShot.disabled = false;
      note.textContent = '摄像头已启动';
      cancelAnimationFrame(rafId);
      drawLoop();
    }).catch(function (err) {
      note.textContent = '摄像头不可用（' + (err && err.name ? err.name : '未知错误') + '），请使用「上传图片」';
    });
  }

  function stopCamera() {
    cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    video.srcObject = null;
    if (mode === 'camera') {
      stage.classList.remove('live');
      video.style.display = '';
      mode = 'idle';
      btnStart.disabled = false;
      btnShot.disabled = snaps[FACE_KEYS[curIdx]] ? false : true;
    }
  }

  // cover 模式绘制视频帧到 canvas（裁切铺满，canvas 内容 = 显示内容）
  function drawCover(src, sw, sh) {
    var W = canvas.width, H = canvas.height;
    var s = Math.max(W / sw, H / sh), dw = sw * s, dh = sh * s;
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  function drawLoop() {
    if (mode !== 'camera') return;
    if (video.videoWidth) {
      drawCover(video, video.videoWidth, video.videoHeight);
      var now = performance.now();
      if (now - lastSample > 120) { lastSample = now; liveSample(); }
    }
    rafId = requestAnimationFrame(drawLoop);
  }

  /* ---------- 采样与预览 ---------- */
  function sampleCenterGrid() {
    var side = canvas.width * SIDE;
    var x0 = (canvas.width - side) / 2, y0 = (canvas.height - side) / 2;
    var cw = side / 3;
    var img = ctx.getImageData(Math.round(x0), Math.round(y0), Math.round(side), Math.round(side));
    return CS.sampleGrid(img, 0, 0, Math.round(cw), Math.round(cw));
  }

  function liveSample() {
    var grid;
    try { grid = sampleCenterGrid(); } catch (e) { return; }
    for (var i = 0; i < 9; i++) {
      var c = grid[i], rgb = 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
      cells[i].el.style.background = rgb;
      cells[i].tag.textContent = CS.nearestStdLetter(c.r, c.g, c.b);
      cells[i].tag.style.color = '#fff';
    }
  }

  /* ---------- 拍摄 / 快照 ---------- */
  function shot() {
    var face = FACE_KEYS[curIdx];
    var grid;
    try { grid = sampleCenterGrid(); } catch (e) { return; }
    snaps[face] = { grid: grid };
    renderThumbs();
    if (curIdx < 5) curIdx++;
    updateGuide();
    var done = FACE_KEYS.filter(function (f) { return snaps[f]; }).length;
    btnApply.disabled = done < 6;
    note.textContent = '已拍摄 ' + face + ' 面（' + done + '/6）';
  }

  function renderThumbs() {
    facesBox.innerHTML = '';
    FACE_KEYS.forEach(function (f, i) {
      var snap = snaps[f];
      var d = document.createElement('div');
      d.className = 'scan-face-thumb' + (i === curIdx ? ' current' : '') + (snap ? ' done' : '');
      d.innerHTML = '<div class="f-name">' + SEQ_NAME[i] + '</div>';
      var mini = document.createElement('div');
      mini.className = 'f-mini';
      for (var k = 0; k < 9; k++) {
        var dot = document.createElement('i');
        if (snap) {
          var c = snap.grid[k];
          dot.style.background = 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
        }
        mini.appendChild(dot);
      }
      d.appendChild(mini);
      d.addEventListener('click', function () {
        curIdx = FACE_KEYS.indexOf(f);
        updateGuide();
        renderThumbs();
      });
      facesBox.appendChild(d);
    });
  }

  function updateGuide() {
    var done = FACE_KEYS.filter(function (k) { return snaps[k]; }).length;
    var f = FACE_KEYS[curIdx];
    guide.textContent = done >= 6
      ? '六面已拍齐！点击「应用 54 格状态到魔方」，或点击下方缩略图重拍'
      : '拍摄' + SEQ_NAME[curIdx] + '（' + done + '/6 已拍）：将魔方一个未拍摄的面正对取景框（面归属由中心块颜色自动判断）';
    renderThumbs();
  }

  /* ---------- 应用到魔方 ---------- */
  function apply() {
    var grids = {};
    for (var i = 0; i < 6; i++) {
      var f = FACE_KEYS[i];
      if (!snaps[f]) { note.textContent = '还有未拍摄的面'; return; }
      grids[f] = snaps[f].grid;
    }
    var cls = CS.classifyCube(grids);          // {faces, margins}
    var asm = CS.assembleCube(cls.faces, cls.margins); // 面归属 + 旋转搜索
    window.CubeApp.applyScannedState(asm.state);
    if (asm.ok) {
      note.textContent = '识别成功：已自动判断面归属与朝向，状态合法可直接求解';
    } else {
      window.CubeApp.markSuspects(asm.suspects || []);
      note.textContent = '已应用，但存在识别问题（' + asm.reason + '）——展开图中黄框闪烁的是最可疑的格子，请对照真实魔方修正后再求解';
    }
  }

  /* ---------- 上传图片降级 ---------- */
  function handleFile(file) {
    if (!file) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      stopCamera();
      mode = 'image';
      stage.classList.add('live');
      video.style.display = 'none';
      drawCover(img, img.naturalWidth, img.naturalHeight);
      liveSample();
      btnShot.disabled = false;
      note.textContent = '已载入图片，确认取景框覆盖六格后点「拍摄本面」';
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { note.textContent = '图片加载失败'; };
    img.src = url;
  }

  /* ---------- 事件绑定 ---------- */
  btnStart.addEventListener('click', startCamera);
  btnShot.addEventListener('click', shot);
  btnApply.addEventListener('click', apply);
  btnUpload.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () { handleFile(this.files[0]); this.value = ''; });
  // 离开拍照 tab 自动停摄像头
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tab !== 'scan') stopCamera();
    });
  });

  updateGuide();
})();
