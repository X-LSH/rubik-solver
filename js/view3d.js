/* =========================================================================
 * view3d.js — CSS 3D 魔方渲染与转动动画
 * 坐标约定：魔方数学坐标 x 右 / y 上 / z 前；CSS y 轴向下，故
 * cubie translate3d(x*S, -y*S, z*S)。
 * 转动 → CSS rotate3d 对照（已按右手系推导）：
 *   U:(0,1,0,-90°) D:(0,1,0,+90°) R:(1,0,0,+90°)
 *   L:(1,0,0,-90°) F:(0,0,1,+90°) B:(0,0,1,-90°)
 * ========================================================================= */
(function (global) {
  'use strict';

  var E = (typeof module !== 'undefined' && module.exports) ? require('./cube-engine.js') : global.CubeEngine;

  // (pos, normal) -> facelet 索引 反查表
  var LOOKUP = {};
  (function () {
    for (var i = 0; i < 54; i++) {
      var pn = E.PNS[i];
      LOOKUP[pn.pos.join(',') + '|' + pn.nrm.join(',')] = i;
    }
  })();

  var FACE_TRANSFORM = {
    U: 'rotateX(90deg)',
    D: 'rotateX(-90deg)',
    F: '',
    B: 'rotateY(180deg)',
    R: 'rotateY(90deg)',
    L: 'rotateY(-90deg)'
  };
  var NORMALS = {
    U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1],
    B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0]
  };
  // 转动 → CSS 旋转（轴 + 顺时针基准角）
  var ROT_CSS = {
    U: { ax: [0, 1, 0], deg: -90 },
    D: { ax: [0, 1, 0], deg: 90 },
    R: { ax: [1, 0, 0], deg: 90 },
    L: { ax: [1, 0, 0], deg: -90 },
    F: { ax: [0, 0, 1], deg: 90 },
    B: { ax: [0, 0, 1], deg: -90 }
  };

  function CubeView(container, opts) {
    opts = opts || {};
    this.size = opts.size || 66;         // cubie 尺寸 px
    this.gap = opts.gap || 3;            // cubie 间隙
    this.duration = opts.duration || 280;
    this.root = container;
    this.onMoveDone = null;

    container.classList.add('cv-root');
    var vp = document.createElement('div');
    vp.className = 'cv-viewport';
    this.scene = document.createElement('div');
    this.scene.className = 'cv-scene';
    vp.appendChild(this.scene);
    container.appendChild(vp);

    this.rotX = opts.rotX != null ? opts.rotX : -28;
    this.rotY = opts.rotY != null ? opts.rotY : -34;
    this._applyOrbit();

    this.cubies = [];
    this._build();
    this.state = null;
    this._animating = false;
    this._queue = [];

    // 拖拽视角
    var self = this, dragging = false, lx = 0, ly = 0;
    function down(x, y) { dragging = true; lx = x; ly = y; }
    function move(x, y) {
      if (!dragging) return;
      self.rotY += (x - lx) * 0.4;
      self.rotX -= (y - ly) * 0.4;
      self.rotX = Math.max(-90, Math.min(90, self.rotX));
      lx = x; ly = y;
      self._applyOrbit();
    }
    function up() { dragging = false; }
    vp.addEventListener('mousedown', function (e) { down(e.clientX, e.clientY); e.preventDefault(); });
    window.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', up);
    vp.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) { down(e.touches[0].clientX, e.touches[0].clientY); }
    }, { passive: true });
    vp.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1) { move(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
    }, { passive: false });
    vp.addEventListener('touchend', up);
  }

  CubeView.prototype._applyOrbit = function () {
    this.scene.style.transform = 'rotateX(' + this.rotX + 'deg) rotateY(' + this.rotY + 'deg)';
  };

  CubeView.prototype._build = function () {
    var S = this.size, G = this.gap, step = S + G;
    for (var x = -1; x <= 1; x++) {
      for (var y = -1; y <= 1; y++) {
        for (var z = -1; z <= 1; z++) {
          var el = document.createElement('div');
          el.className = 'cv-cubie';
          el.style.width = S + 'px';
          el.style.height = S + 'px';
          el.style.margin = (-S / 2) + 'px 0 0 ' + (-S / 2) + 'px';
          el.style.transform = 'translate3d(' + (x * step) + 'px,' + (-y * step) + 'px,' + (z * step) + 'px)';
          el._pos = [x, y, z];
          var faces = {};
          for (var f in NORMALS) {
            var n = NORMALS[f];
            if (x * n[0] + y * n[1] + z * n[2] !== 1) continue; // 仅外表面
            var fd = document.createElement('div');
            fd.className = 'cv-face cv-' + f;
            fd.style.width = S + 'px';
            fd.style.height = S + 'px';
            fd.style.transform = FACE_TRANSFORM[f] + ' translateZ(' + (S / 2) + 'px)';
            el.appendChild(fd);
            faces[f] = fd;
          }
          el._faces = faces;
          this.scene.appendChild(el);
          this.cubies.push(el);
        }
      }
    }
    this.pivot = document.createElement('div');
    this.pivot.className = 'cv-pivot';
    this.scene.appendChild(this.pivot);
  };

  CubeView.prototype.setState = function (state) {
    this.state = state.slice();
    this.refresh();
  };

  CubeView.prototype.refresh = function () {
    var st = this.state;
    if (!st) return;
    var self = this;
    this.cubies.forEach(function (el) {
      var p = el._pos;
      for (var f in el._faces) {
        var n = NORMALS[f];
        var idx = LOOKUP[p.join(',') + '|' + n.join(',')];
        el._faces[f].style.background = E.COLOR_HEX[st[idx]];
      }
    });
  };

  function layerOf(move) {
    var p = E.parseMove(move);
    var axis = { U: 'y', D: 'y', R: 'x', L: 'x', F: 'z', B: 'z' }[p.face];
    var val = { U: 1, D: -1, R: 1, L: -1, F: 1, B: -1 }[p.face];
    return { face: p.face, times: p.times, axis: axis, val: val };
  }

  // 动画执行单次 1/4 转动（times 拆分为多次 90°）
  CubeView.prototype._animateQuarter = function (face, dur) {
    var self = this;
    return new Promise(function (resolve) {
      var L = layerOf(face);
      var rc = ROT_CSS[face];
      var members = self.cubies.filter(function (el) {
        return el._pos[L.axis === 'x' ? 0 : (L.axis === 'y' ? 1 : 2)] === L.val;
      });
      members.forEach(function (el) { self.pivot.appendChild(el); });
      // 强制 reflow
      void self.pivot.offsetWidth;
      var deg = rc.deg;
      self.pivot.style.transition = 'none';
      self.pivot.style.transform = 'rotate3d(' + rc.ax.join(',') + ',0deg)';
      void self.pivot.offsetWidth;
      self.pivot.style.transition = 'transform ' + dur + 'ms cubic-bezier(.4,.1,.3,1)';
      self.pivot.style.transform = 'rotate3d(' + rc.ax.join(',') + ',' + deg + 'deg)';
      setTimeout(function () {
        // 归位：把 cubie 放回 scene，更新状态，刷新贴纸
        members.forEach(function (el) { self.scene.appendChild(el); });
        self.pivot.style.transition = 'none';
        self.pivot.style.transform = 'rotate3d(' + rc.ax.join(',') + ',0deg)';
        self.state = E.applyMove(self.state, face);
        self.refresh();
        resolve();
      }, dur + 30);
    });
  };

  // 播放一个转动（含 2 拆分），返回 Promise
  CubeView.prototype.animateMove = function (move, dur) {
    dur = dur || this.duration;
    var self = this;
    var p = E.parseMove(move);
    var seq = [];
    for (var i = 0; i < p.times; i++) seq.push(p.face);
    return seq.reduce(function (pr, f) {
      return pr.then(function () { return self._animateQuarter(f, dur); });
    }, Promise.resolve());
  };

  // 同步应用（无动画）
  CubeView.prototype.applyImmediate = function (move) {
    this.state = E.applyMove(this.state, move);
    this.refresh();
  };

  global.CubeView = CubeView;
  if (typeof module !== 'undefined' && module.exports) module.exports = CubeView;
})(typeof window !== 'undefined' ? window : globalThis);
