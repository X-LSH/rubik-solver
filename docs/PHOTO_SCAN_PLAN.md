# 照片输入识别魔方状态 —— 开发计划（V1）

> 目标：通过摄像头/照片输入，自动识别真实魔方六面状态，一键生成可求解的 54-facelet 状态。
> 定位：纯前端零依赖（与项目一致），GitHub Pages 环境可直接使用（`getUserMedia` 需 HTTPS；本地 `file://` 不可用，需 `localhost` 服务）。

## 已有基建（直接复用）

| 模块 | 复用点 |
|---|---|
| `cube-engine.js` | 54 facelet 模型、`validate()` 三不变量校验（识别错误的兜底闸门）、面序 U R F D L B |
| 展开图编辑器（app.js） | 识别错误的修正 UI——校验失败自动跳转改错格 |
| 3D 渲染 | 识别结果即时 3D 预览 |
| 求解器 | 校验通过后直接求解 |

## 参考开源（2026-09 调研）

- IzaquielCordeiro/rubix-cube-solver —— 纯前端 + MediaStream API + min2phase，技术栈最接近
- Austinhere7/Rubix.AI —— 摄像头扫描引导交互 + 手动兜底
- BenjaminBurnell/Cube-Solver —— KNN(HSV) 分类器，可重训练（V3 路线参考）
- Nourjennane/rubiks-cube-scanner、SamriddhoBiswas/Qbix —— Python/HSV 管线参照

共识管线：取像 → 颜色分类 → 54 状态重建 → 可解性校验 → 求解播放。

## Phase 1 —— 颜色采样核心（纯函数，无 UI）

- 目标：实现从画布图像 3×3 网格到六色分类的核心算法，独立于 UI 可单测。
- 交付：`js/color-scan.js`（每格取中心 30% 区域 RGB 中位数 → RGB→HSV → 中心块标定 + HSV 加权最近邻 6 色分类）+ `test/test-color-scan.js`（合成图像用例：标准六色、暖光白平衡偏移模拟、反光格中位数抗性；≥20 用例全绿）。

## Phase 2 —— 取像 UI（引导式六面拍摄）

- 目标：新增「拍照录入」tab，getUserMedia 取流，按 U→R→F→D→L→B 顺序引导拍摄，实时预览九宫格采样框与识别色，支持单面重拍。
- 交付：拍照 tab UI + 摄像头生命周期管理（权限拒绝/无摄像头降级为上传图片）+ 每面快照缓存；浏览器 E2E（Playwright `--use-fake-device-for-media-stream` 假摄像头视频验证取流与快照链路）。

## Phase 3 —— 状态组装与校验闭环

- 目标：六面识别结果按面序组装 54 facelet，接入 `validate()`，失败时自动跳转展开图并标出可疑格。
- 交付：组装与面映射逻辑 + 校验结果分类提示（复用现有文案）+ 展开图可疑格标记样式；E2E 覆盖合法态一键进求解、非法态引导修正两条链路。

## Phase 4 —— 部署与文档

- 目标：README 增补照片扫描使用说明与 HTTPS 要求，全量回归后部署上线。
- 交付：README 更新 + 全部测试绿 + push + GitHub Pages 线上人工验证。

## V2 / V3 展望（V1 验收后评估）

- V2 自动网格检测：颜色分割找色块簇 + 透视变换自动校正，摆脱对准框引导。
- V3 ML 分类器：KNN 小模型 + 用户自标定训练数据，提升极端光照精度（参考 BenjaminBurnell/Cube-Solver）。

## 关键风险与对策

| 风险 | 对策 |
|---|---|
| 白平衡偏移（白/黄混淆） | 中心块标定 + 相对聚类，不用绝对阈值 |
| 光照渐变 / 反光 | 每格中心 30% 区域中位数、多帧取中值、拍摄引导避开直射光 |
| 个别格识别错误 | validate 校验 + 可疑格标记 + 展开图人工修正（已有 UI） |
| 浏览器不支持摄像头 | 降级为上传照片识别，或纯手动展开图编辑（已有） |
