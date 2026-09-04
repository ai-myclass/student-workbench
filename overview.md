# 家长外部查询页 · 完成概述

## 已完成

1. 新增 `query.html`：家长端查询页，输入手机号即可查看学员学习报告，并支持「保存图片」。
2. 新增 `assets/share-canvas.js`：将工作台分享图绘制逻辑抽离为共用模块，工作台与家长页共用。
3. 重构 `assets/app.js`：移除重复绘图代码，复用 `share-canvas.js`。
4. 新增 `tools/export-parent-data.js`：按最终讲次口径导出 `data/students.json`，仅含 `phoneHash`，不暴露手机号明文。
5. 生成 `data/students.json`：当前含 35 名学员，其中 23 人手机号完整可查询。
6. 部署到 GitHub Pages 并验证线上可用。

## 关键决策

- **隐私优先**：公开 JSON 中不放手机号明文，查询时比对 FNV-1a 64 哈希。
- **讲次口径**：优先用剔除习题课后的正课；若正课未开课则回退到实际参与讲次，避免家长看到空白页。
- **手机号补全**：平台数据常脱敏为 `159****7600`，导出时优先使用学情表（飞书）中的完整号码。

## 验证结果

- 本地 HTTP + agent-browser 实测：输入 `15631149139` 命中「吴晓乐」，成功渲染报告。
- 线上 GitHub Pages 实测：`query.html?phone=15631149139` 自动查询并渲染。
- 提交已推送至 `ai-myclass/student-workbench` main（commit `e230c76`）。

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
