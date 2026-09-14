#!/usr/bin/env node
/*!
 * export-parent-data.js — 生成家长查询页用的静态数据 data/students.json
 *
 * 用法： node tools/export-parent-data.js
 *
 * 说明：
 *  - 数据来源：assets/sample-data.js（学习数据）+ assets/roster-data.js（学情档案），
 *    与工作台首次启动时的合并流程一致（mergeInto → mergeRosterInto → applyRoster → refresh）。
 *  - 生成逻辑全部委托给 assets/parent-data.js（SWBParent.build），
 *    与工作台「更新家长查询」按钮复用同一套代码，保证产物一致、不漂移。
 *  - 隐私：Pages 站点是公开的，因此**不输出家长手机号明文**，只输出 phoneHash。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* ---------- 在沙箱里加载浏览器端脚本 ---------- */
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

// parent-data.js 在 Node 下通过 module.exports 暴露
const SWBParent = require(path.join(ROOT, 'assets', 'parent-data.js'));

const rosterWin = loadBrowserScript('roster-data.js');

/* ---------- 以真实数据（teacher-db.json）为基准重建 db ---------- */
const dbPath = path.join(ROOT, 'data', 'teacher-db.json');
if (!fs.existsSync(dbPath)) {
  console.error('缺少 data/teacher-db.json（请先在工作台同步或导入数据）');
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// 学情表（含完整手机号）覆盖进 db.roster：家长端凭手机号查询需要完整号
if (rosterWin.SWB_ROSTER && rosterWin.SWB_ROSTER.students) {
  db.roster = db.roster || {};
  db.roster.students = JSON.parse(JSON.stringify(rosterWin.SWB_ROSTER.students));
}

SWB.refresh(db, null);

/* ---------- 生成家长查询数据（共用模块） ---------- */
const out = SWBParent.build(db, SWB);

const outDir = path.join(ROOT, 'data');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'students.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 1), 'utf8');

console.log('已生成 ' + outFile);
console.log('  数据源：data/teacher-db.json（在读 ' + (db.students || []).length + ' 人 / 花名册 ' + (db.homeroom || []).length + ' 人）');
console.log('  学情档案：' + ((db.roster && db.roster.students) || []).length + ' 份，匹配 ' + (db.rosterMatched || 0) + ' 人');
console.log('  参与统计的讲次：' + out.courses.length + ' 讲（来源 ' + out.courseSource + '）');
console.log('  导出学员：' + out.students.length + ' 人（以花名册全量为准，仅含 phoneHash，不含手机号明文）');
console.log('  可用手机查询：' + out._meta.phoneFull + ' 人；号码不完整无法查询：' + out._meta.phoneMissing + ' 人');
console.log('  其中有学习报告：' + out._meta.withData + ' 人；暂无学习记录：' + (out.students.length - out._meta.withData) + ' 人');
