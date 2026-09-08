# 魔方复原教练 · Rubik Solver

纯前端三阶魔方求解与教学网页应用。零依赖、零构建，打开即用。

![技术栈](https://img.shields.io/badge/tech-vanilla%20JS%20%2B%20CSS%203D-blue)

## 功能

- **3D 可视化魔方**：纯 CSS 3D 渲染，拖拽旋转视角，转动动画与状态实时联动
- **一键随机打乱**：22 步标准打乱，动画逐步呈现
- **手动编辑状态**：展开图点击涂色（画笔模式 / 循环换色），自动校验状态合法性
  （颜色计数 / 角块扭转和 / 棱块翻转和 / 排列奇偶性，非法状态给出具体原因）
- **两种求解算法**：
  - **层先法 LBL**：十字 → 底角 → 中层棱 → 顶面 OLL → 顶层 PLL，平均 ~116 步
  - **CFOP**：Cross → F2L（逐槽位）→ OLL → PLL，平均 ~109 步
- **分步演示**：阶段分组卡片、当前步高亮、播放/暂停/单步/回退/跳转、速度调节
- **响应式**：桌面双栏 / 移动端单列，支持触屏拖拽

## 求解引擎原理

`js/cube-engine.js`
- 54 贴纸（facelet）状态模型；18 种转动的置换表由 3D 坐标系自动生成（x 右 / y 上 / z 前，WCA 顺时针约定），杜绝手写置换错误
- 状态合法性校验：中心互异 + 每色 9 张 + 角/棱块双射 + 角朝向和 ≡ 0 (mod 3) + 棱朝向和 ≡ 0 (mod 2) + 角棱排列奇偶一致

`js/solver.js`
- **前三层**：每个目标块在「位置×朝向」24 态子状态图上 BFS；生成元 = 单步转动 + 净保持先验的宏观序列（共轭提取宏 `X U^k X'`、翻棱宏、sexy move 插入、中层插入公式），每个生成元经置换合成动态验证"不破坏已完成块"
- **顶层**：2-look OLL/PLL 经典公式（翻棱、Sune/反 Sune、T-perm、U-perm）先验证置换性质，再在顶层面/排列状态空间上 BFS 出最短生成元序列；角棱排列因 U 转动耦合，采用联合 PLL 状态空间（24×24）一次求解
- 随机 100 例测试全部复原（`node test/test-solver.js`）

## 运行

直接双击 `index.html`，或：

```bash
cd rubik-solver
python -m http.server 8000
# 打开 http://localhost:8000
```

## 测试

```bash
node test/test-engine.js   # 引擎：置换双射/逆序复原/合法性校验
node test/test-solver.js   # 求解器：100 例随机状态 LBL + 50 例 CFOP
```

## 文件结构

```
rubik-solver/
├── index.html          # 页面入口
├── css/style.css       # 深色现代风格样式
├── js/
│   ├── cube-engine.js  # 魔方核心引擎（状态/置换/校验）
│   ├── solver.js       # LBL + CFOP 求解器
│   ├── view3d.js       # CSS 3D 渲染与转动动画
│   └── app.js          # 界面逻辑（编辑器/播放器）
└── test/               # Node 自动化测试
```
