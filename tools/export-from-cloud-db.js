#!/usr/bin/env node
/*!
 * export-from-cloud-db.js — 从 data/teacher-db.json 生成家长查询页 data/students.json
 *
 * 用法： node tools/export-from-cloud-db.js
 *
 * 说明：
 *  - 输入：data/teacher-db.json（工作台云端备份，含 roster phoneHash、学习数据）
 *  - 输出：data/students.json（供 GitHub Pages 家长查询页使用）
 *  - 复用 assets/parent-data.js 的 build()，保证与「更新家长查询」按钮产物一致
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadBrowserScript(file) {
  const code = fs.readFileSync(path.join(ROOT, 'assets', file), 'utf8');
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return sandbox.window;
}

const parserWin = loadBrowserScript('parser.js');
const SWB = parserWin.SWB;
if (!SWB) { console.error('parser.js 未导出 SWB'); process.exit(1); }

const SWBParent = require(path.join(ROOT, 'assets', 'parent-data.js'));

const dbFile = path.join(ROOT, 'data', 'teacher-db.json');
if (!fs.existsSync(dbFile)) {
  console.error('找不到云端备份：' + dbFile);
  process.exit(1);
}

const db = SWB.refresh(JSON.parse(fs.readFileSync(dbFile, 'utf8')));
const out = SWBParent.build(db, SWB);

const outFile = path.join(ROOT, 'data', 'students.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 1), 'utf8');

console.log('已生成 ' + outFile);
console.log('  数据来源：' + dbFile);
console.log('  导出学员：' + out.students.length + ' 人');
console.log('  参与统计讲次：' + out.courses.length + ' 讲（来源 ' + out.courseSource + '）');
console.log('  可用手机查询：' + out._meta.phoneFull + ' 人；号码不完整无法查询：' + out._meta.phoneMissing + ' 人');
console.log('  其中有学习报告：' + out._meta.withData + ' 人；查到但暂无学习记录：' + (out._meta.phoneFull - out._meta.withData) + ' 人');
