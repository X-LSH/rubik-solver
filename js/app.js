/* =========================================================================
 * app.js — 界面逻辑：状态管理 / 展开图编辑器 / 求解 / 步骤播放器
 * ========================================================================= */
(function () {
  'use strict';

  var E = window.CubeEngine, S = window.CubeSolver;

  /* ---------------- 全局状态 ---------------- */
  var state = E.solvedState();
  var view = null;
  var solution = null;       // {steps:[{group,title,desc,moves,state}], totalMoves}
  var playIndex = 0;         // 当前播放到的步骤索引
  var flatMoves = [];        // [{stepIdx, move}]
  var flatIdx = 0;
  var playing = false;
  var busy = false;         // 打乱/求解进行中
  var speed = 300;          // 每步动画 ms
  var editColor = null;     // 画笔颜色（null = 点击循环切换）

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ---------------- 初始化 ---------------- */
  function init() {
    view = new CubeView($('#cubeArea'), { size: 64, gap: 3 });
    view.setState(state);

    buildNet();
    bindControls();
    syncState();
    renderSteps();
    updateStatus('点击「随机打乱」开始，或直接求解当前状态');
  }

  /* ---------------- 展开图编辑器 ---------------- */
  var NET_CELLS = []; // {faceletIdx, el}
  var NET_LAYOUT = [
    // [face, gridRow, gridCol]  12 列 × 9 行网格
    { face: 'U', row: 0, col: 3 },
    { face: 'L', row: 3, col: 0 }, { face: 'F', row: 3, col: 3 },
    { face: 'R', row: 3, col: 6 }, { face: 'B', row: 3, col: 9 },
    { face: 'D', row: 6, col: 3 }
  ];
  function buildNet() {
    var net = $('#net');
    net.innerHTML = '';
    NET_CELLS = [];
    NET_LAYOUT.forEach(function (blk) {
      var fi = E.FACES.indexOf(blk.face);
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) {
          var cell = document.createElement('div');
          cell.className = 'net-cell';
          cell.style.gridRow = (blk.row + r + 1);
          cell.style.gridColumn = (blk.col + c + 1);
          var idx = fi * 9 + r * 3 + c;
          cell.addEventListener('click', function () {
            if (busy || playing) return; // 动画/播放中禁止编辑，避免状态竞争
            var i = parseInt(this.dataset.idx, 10);
            if (editColor) {
              state[i] = editColor;
            } else {
              var order = ['W', 'Y', 'R', 'O', 'G', 'B'];
              state[i] = order[(order.indexOf(state[i]) + 1) % 6];
            }
            syncState();
          });
          cell.dataset.idx = idx;
          net.appendChild(cell);
          NET_CELLS.push({ idx: idx, el: cell });
        }
      }
    });
    // 中心块标记
    NET_CELLS.forEach(function (c) {
      if ([4, 13, 22, 31, 40, 49].indexOf(c.idx) >= 0) c.el.classList.add('center');
    });
  }
  function renderNet() {
    NET_CELLS.forEach(function (c) {
      c.el.style.background = E.COLOR_HEX[state[c.idx]];
    });
  }

  /* ---------------- 状态同步 ---------------- */
  function syncState() {
    renderNet();
    view.setState(state);
    var v = E.validate(state);
    var badge = $('#validBadge');
    if (v.ok) {
      badge.textContent = '状态合法';
      badge.className = 'badge ok';
    } else {
      badge.textContent = v.reason;
      badge.className = 'badge bad';
    }
    $('#btnSolve').disabled = !v.ok;
  }

  function updateStatus(msg) { $('#status').textContent = msg; }

  /* ---------------- 控制绑定 ---------------- */
  function bindControls() {
    $('#btnScramble').addEventListener('click', function () {
      if (busy) return;
      busy = true;
      stopPlay();
      $('#btnSolve').disabled = true;
      $('#btnScramble').disabled = true;
      var sc = E.randomScramble(22);
      state = E.solvedState();
      // 带动画依次应用
      var moves = sc.moves;
      var i = 0;
      var speedNow = Math.max(90, speed * 0.45);
      updateStatus('打乱中…');
      (function next() {
        if (i >= moves.length) {
          state = sc.state;
          view.setState(state);
          busy = false;
          $('#btnScramble').disabled = false;
          syncState();
          updateStatus('已打乱（' + moves.length + ' 步）');
          return;
        }
        view.setState(state);
        var m = moves[i++];
        view.animateMove(m, speedNow).then(function () {
          state = view.state;
          renderNet();
          next();
        });
      })();
    });
    $('#btnReset').addEventListener('click', function () {
      stopPlay();
      state = E.solvedState();
      solution = null; flatMoves = [];
      syncState();
      renderSteps();
      updateStatus('已复原为初始状态');
    });
    // 画笔
    $$('#palette .swatch').forEach(function (sw) {
      sw.style.background = E.COLOR_HEX[sw.dataset.color];
      sw.addEventListener('click', function () {
        $$('#palette .swatch').forEach(function (s2) { s2.classList.remove('active'); });
        if (editColor === sw.dataset.color) { editColor = null; }
        else { editColor = sw.dataset.color; sw.classList.add('active'); }
      });
    });
    // 算法选择
    $$('input[name=alg]').forEach(function (r) {
      r.addEventListener('change', function () { renderSteps(); });
    });
    $('#btnSolve').addEventListener('click', doSolve);
    $('#btnPlay').addEventListener('click', togglePlay);
    $('#btnPrev').addEventListener('click', function () { stepBy(-1); });
    $('#btnNext').addEventListener('click', function () { stepBy(1); });
    $('#btnToStart').addEventListener('click', function () {
      stopPlay();
      if (!solution) return;
      state = solution.steps[0] ? null : state;
      // 回到打乱态：重新求解前的状态不可知，直接用第一步之前的状态 = 求解时状态
      state = solution.startState.slice();
      syncState();
      flatIdx = 0; playIndex = 0;
      highlightStep();
    });
    $('#speed').addEventListener('input', function () {
      speed = parseInt(this.value, 10);
    });
    // Tab 切换
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.tab').forEach(function (x) { x.classList.remove('active'); });
        $$('.tab-pane').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        $('#tab-' + t.dataset.tab).classList.add('active');
      });
    });
  }

  /* ---------------- 求解 ---------------- */
  function doSolve() {
    if (busy) { updateStatus('请等待打乱完成'); return; }
    var v = E.validate(state);
    if (!v.ok) { updateStatus('状态非法：' + v.reason); return; }
    if (E.isSolved(state)) { updateStatus('魔方已处于复原状态'); return; }
    busy = true;
    $('#btnSolve').disabled = true;
    var mode = document.querySelector('input[name=alg]:checked').value;
    updateStatus('求解中…');
    setTimeout(function () {
      try {
        var t0 = performance.now();
        var r = S.solve(state, { mode: mode });
        var dt = Math.round(performance.now() - t0);
        r.startState = state.slice();
        solution = r;
        flatMoves = [];
        r.steps.forEach(function (s, si) {
          s.moves.forEach(function (m) { flatMoves.push({ stepIdx: si, move: m }); });
        });
        flatIdx = 0; playIndex = 0;
        renderSteps();
        // 自动切到步骤 tab
        $$('.tab').forEach(function (x) { x.classList.remove('active'); });
        $$('.tab-pane').forEach(function (x) { x.classList.remove('active'); });
        document.querySelector('.tab[data-tab="steps"]').classList.add('active');
        $('#tab-steps').classList.add('active');
        updateStatus((mode === 'lbl' ? '层先法' : 'CFOP') + '：共 ' + r.totalMoves + ' 步 / ' + r.steps.length + ' 个阶段（' + dt + 'ms）— 点击播放演示');
      } catch (e) {
        updateStatus('求解失败：' + e.message);
      }
      busy = false;
      $('#btnSolve').disabled = false;
    }, 30);
  }

  /* ---------------- 步骤渲染 ---------------- */
  var GROUP_META = {
    cross: { name: '① 底层十字', color: '#5b8def' },
    corner: { name: '② 底层角块', color: '#39c46f' },
    middle: { name: '③ 中层棱块', color: '#f0a24a' },
    f2l: { name: 'F2L（前两层）', color: '#39c46f' },
    oll: { name: '④ 顶面朝向 OLL', color: '#e05a7a' },
    pll: { name: '⑤ 顶层排列 PLL', color: '#9a6ff0' }
  };
  function renderSteps() {
    var box = $('#steps');
    box.innerHTML = '';
    if (!solution) {
      box.innerHTML = '<div class="empty-hint">打乱后点击「求解」，这里会显示分阶段复原步骤</div>';
      return;
    }
    var lastGroup = null;
    solution.steps.forEach(function (s, si) {
      if (s.group !== lastGroup) {
        var meta = GROUP_META[s.group] || { name: s.group, color: '#888' };
        var h = document.createElement('div');
        h.className = 'step-group';
        h.innerHTML = '<span class="dot" style="background:' + meta.color + '"></span>' + meta.name;
        box.appendChild(h);
        lastGroup = s.group;
      }
      var card = document.createElement('div');
      card.className = 'step-card';
      card.dataset.stepIdx = si;
      var formula = s.moves.join(' ');
      card.innerHTML = '<div class="step-title">' + s.title + '</div>' +
        '<div class="step-desc">' + s.desc + '</div>' +
        '<div class="step-formula">' + formula + '</div>';
      card.addEventListener('click', function () { jumpToStep(si); });
      box.appendChild(card);
    });
    highlightStep();
  }
  function highlightStep() {
    $$('.step-card').forEach(function (c) {
      c.classList.toggle('current', parseInt(c.dataset.stepIdx, 10) === playIndex);
      c.classList.toggle('done', parseInt(c.dataset.stepIdx, 10) < playIndex);
    });
    var cur = document.querySelector('.step-card.current');
    if (cur) {
      var cont = $('#steps');
      var top = cur.offsetTop - cont.offsetTop;
      if (top < cont.scrollTop + 20 || top > cont.scrollTop + cont.clientHeight - 80) {
        cont.scrollTop = top - cont.clientHeight / 3;
      }
    }
  }

  /* ---------------- 播放器 ---------------- */
  function togglePlay() {
    if (!solution) { updateStatus('请先求解'); return; }
    if (playing) { stopPlay(); return; }
    playing = true;
    $('#btnPlay').textContent = '⏸ 暂停';
    playLoop();
  }
  function stopPlay() {
    playing = false;
    var b = $('#btnPlay');
    if (b) b.textContent = '▶ 播放';
  }
  function playLoop() {
    if (!playing) return;
    if (flatIdx >= flatMoves.length) { stopPlay(); updateStatus('演示完成，魔方已复原 🎉'); return; }
    var fm = flatMoves[flatIdx];
    playIndex = fm.stepIdx;
    highlightStep();
    view.animateMove(fm.move, speed).then(function () {
      state = view.state;
      syncState();
      flatIdx++;
      playLoop();
    });
  }
  function stepBy(dir) {
    if (!solution || playing) return;
    if (dir > 0) {
      if (flatIdx >= flatMoves.length) return;
      var fm = flatMoves[flatIdx];
      playIndex = fm.stepIdx;
      view.animateMove(fm.move, Math.max(140, speed * 0.7)).then(function () {
        state = view.state; syncState();
        flatIdx++; highlightStep();
      });
    } else {
      if (flatIdx <= 0) return;
      flatIdx--;
      var fm2 = flatMoves[flatIdx];
      playIndex = fm2.stepIdx;
      // 逆向：应用逆转动
      var p = E.parseMove(fm2.move);
      var inv = p.face + (p.times === 1 ? "'" : (p.times === 3 ? '' : '2'));
      view.animateMove(inv, Math.max(140, speed * 0.7)).then(function () {
        state = view.state; syncState(); highlightStep();
      });
    }
  }
  function jumpToStep(si) {
    if (!solution || playing) return;
    // 目标：执行到第 si 步的开头（即前 si 步的所有 moves 应用完）
    var targetFlat = 0;
    for (var i = 0; i < si; i++) targetFlat += solution.steps[i].moves.length;
    // 回退到起点再快进（无动画）
    state = solution.startState.slice();
    for (var j = 0; j < targetFlat; j++) state = E.applyMove(state, flatMoves[j].move);
    flatIdx = targetFlat; playIndex = si;
    syncState(); highlightStep();
  }

  /* ---------------- 启动 ---------------- */
  document.addEventListener('DOMContentLoaded', init);
})();
