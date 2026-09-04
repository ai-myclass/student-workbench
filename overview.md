# 家长外部查询页 · 完成概述

## 已完成

1. 新增 `query.html`：家长端查询页，输入手机号即可查看学员学习报告，并支持「保存图片」。
2. 新增 `assets/share-canvas.js`：将工作台分享图绘制逻辑抽离为共用模块，工作台与家长页共用。
3. 新增 `assets/parent-data.js`：生成 `data/students.json` 的共用逻辑，浏览器按钮与 Node 脚本复用，单一数据源、不漂移。
4. 重构 `assets/app.js`：复用 `share-canvas.js`，并新增「更新家长查询」一键同步能力。
5. 重构 `tools/export-parent-data.js`：复用 `parent-data.js` 生成家长查询数据，与按钮产物完全一致。
6. 新增「更新家长查询」按钮：在工作台点击即可把当前数据脱敏后通过 GitHub API 推送至仓库，家长页自动刷新，无需手动导出。
7. 部署到 GitHub Pages 并验证线上可用。

## 关键决策

- **隐私优先**：公开 JSON 中不放手机号明文，查询时比对 FNV-1a 64 哈希。
- **一键同步**：工作台的「更新家长查询」按钮直接调用 GitHub Contents API，把生成的 `data/students.json` 推送到仓库并触发 Pages 重建。
- **单一数据源**：`assets/parent-data.js` 同时被 Node 脚本和浏览器按钮使用，避免导出逻辑漂移。
- **讲次口径**：优先用剔除习题课后的正课；若正课未开课则回退到实际参与讲次，避免家长看到空白页。
- **学员口径**：家长查询页以学情表 `roster-data.js` 全量为准，而非仅学习数据中的 35 人。
- **有报告判定**：仅综合分 `score > 0` 才渲染完整学习报告，其余查到学员显示「暂无学习记录」卡片。
- **手机号补全**：平台数据常脱敏为 `159****7600`，导出时优先使用学情表（飞书）中的完整号码。

## 验证结果

- 本地 HTTP + agent-browser 实测：点击「更新家长查询」成功推送 `data/students.json` 到仓库，线上 `updatedAt` 立即更新。
- 吴晓乐 `15631149139`：成功渲染学习报告。
- 靳安心 `15081698480`：正确显示「暂无学习记录」卡片，保存按钮隐藏。
- 线上 GitHub Pages 实测两种场景均正确。
- 提交已推送至 `ai-myclass/student-workbench` main。

## 访问地址

- 家长查询页：https://ai-myclass.github.io/student-workbench/query.html
- 直链示例：https://ai-myclass.github.io/student-workbench/query.html?phone=15631149139
- 教师工作台：https://ai-myclass.github.io/student-workbench/

## 使用「更新家长查询」

1. 打开工作台 → 点击顶部「更新家长查询」。
2. 首次使用会提示去「数据管理」填写 GitHub 访问令牌：
   - 前往 GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token。
   - 勾选 `repo`（或 `public_repo` + 组织访问）权限。
   - 复制 `ghp_xxx` 字符串，粘贴到「数据管理」→「GitHub 访问令牌（一键同步）」并保存。
3. 之后每次点「更新家长查询」，当前数据即自动同步到公开站点。

> 令牌仅保存在本机浏览器 localStorage，不会随数据导出。

## 后续维护（手动方式保留）

如果更习惯命令行，仍可运行：

```bash
node tools/export-parent-data.js
git add data/students.json
git commit -m "update parent query data"
git push origin main
```

约 30~60 秒后 GitHub Pages 自动刷新。
