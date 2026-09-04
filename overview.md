# 家长外部查询页 · 完成概述

## 已完成

1. 新增 `query.html`：家长端查询页，输入手机号即可查看学员学习报告，并支持「保存图片」。
2. 新增 `assets/share-canvas.js`：将工作台分享图绘制逻辑抽离为共用模块，工作台与家长页共用。
3. 重构 `assets/app.js`：移除重复绘图代码，复用 `share-canvas.js`。
4. 新增 `tools/export-parent-data.js`：按最终讲次口径导出 `data/students.json`，仅含 `phoneHash`，不暴露手机号明文。
5. 生成 `data/students.json`：当前含 **170 名学员**（学情表全量），其中 139 人手机号完整可查询，16 人有学习报告，123 人查到但暂无学习记录。
6. 部署到 GitHub Pages 并验证线上可用。

## 关键决策

- **隐私优先**：公开 JSON 中不放手机号明文，查询时比对 FNV-1a 64 哈希。
- **讲次口径**：优先用剔除习题课后的正课；若正课未开课则回退到实际参与讲次，避免家长看到空白页。
- **学员口径**：家长查询页以学情表 `roster-data.js` 全量为准，而非仅学习数据中的 35 人。
- **有报告判定**：仅综合分 `score > 0` 才渲染完整学习报告，其余查到学员显示「暂无学习记录」卡片。
- **手机号补全**：平台数据常脱敏为 `159****7600`，导出时优先使用学情表（飞书）中的完整号码。

## 验证结果

- 本地 HTTP + agent-browser 实测：
  - 吴晓乐 `15631149139`：成功渲染学习报告。
  - 靳安心 `15081698480`：正确显示「暂无学习记录」卡片，保存按钮隐藏。
- 线上 GitHub Pages 实测两种场景均正确。
- 提交已推送至 `ai-myclass/student-workbench` main（commit `47312bd`）。

## 访问地址

- 家长查询页：https://ai-myclass.github.io/student-workbench/query.html
- 直链示例：https://ai-myclass.github.io/student-workbench/query.html?phone=15631149139
- 教师工作台：https://ai-myclass.github.io/student-workbench/

## 后续维护

更新学习数据后，在仓库内运行：

```bash
node tools/export-parent-data.js
git add data/students.json
git commit -m "update parent query data"
git push origin main
```

约 30~60 秒后 GitHub Pages 自动刷新。
