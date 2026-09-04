#!/usr/bin/env node
/*!
 * export-parent-data.js — 生成家长查询页用的静态数据 data/students.json
 *
 * 用法： node tools/export-parent-data.js
 *
 * 说明：
 *  - 数据来源：assets/sample-data.js（学习数据）+ assets/roster-data.js（学情档案），
 *    与工作台首次启动时的合并流程一致（mergeInto → mergeRosterInto → applyRoster → refresh）。
 *  - 隐私：Pages 站点是公开的，因此**不输出家长手机号明文**，只输出 phoneHash
 *    （FNV-1a 64 位确定性哈希，与 query.html 中的实现完全一致），查询时比对哈希。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* ---------- 与 query.html 保持一致的哈希实现 ---------- */
function normalizePhone(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}
/** FNV-1a 64 位（用两个 32 位半字模拟），返回 16 进制串 */
function phoneHash(phone) {
  const s = normalizePhone(phone);
  if (!s) return '';
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 ^ c) >>> 0; h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    h2 ^= h2 >>> 13; h2 >>>= 0;
  }
  const hex = (n) => ('00000000' + (n >>> 0).toString(16)).slice(-8);
  return hex(h1) + hex(h2);
}

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

const sampleWin = loadBrowserScript('sample-data.js');
const rosterWin = loadBrowserScript('roster-data.js');

/* ---------- 合并数据（与工作台启动流程一致） ---------- */
const db = SWB.emptyDB();

if (!sampleWin.SWB_SAMPLE || !sampleWin.SWB_SAMPLE.students) {
  console.error('缺少示例学习数据 SWB_SAMPLE');
  process.exit(1);
}
const merged = SWB.mergeInto(db, JSON.parse(JSON.stringify(sampleWin.SWB_SAMPLE)));

let rosterCount = 0;
if (rosterWin.SWB_ROSTER && rosterWin.SWB_ROSTER.students) {
  const r = SWB.mergeRosterInto(db, JSON.parse(JSON.stringify(rosterWin.SWB_ROSTER)));
  rosterCount = r.total;
  SWB.applyRoster(db);
}

// 第一次 refresh：算出 activeCourses / statCourses，以便挑选口径
SWB.refresh(db, null);

/* ---------- 手机号解析 ---------- */
/**
 * 平台导出的学习数据里手机号常被脱敏成「159****7600」，
 * 而 applyRoster 只在学员字段为空时才回填档案，所以完整号码仍留在学情表里。
 * 这里以学情表为准补全：优先用学员自带完整号，否则用其匹配到的档案号。
 */
const rosterByKey = {};
(db.roster.students || []).forEach((r) => { if (r && r.key) rosterByKey[r.key] = r; });

function isFullPhone(v) { return normalizePhone(v).length >= 11; }

function resolvePhone(s) {
  if (isFullPhone(s.phone)) return { phone: normalizePhone(s.phone), from: 'student' };
  const r = s.rosterKey ? rosterByKey[s.rosterKey] : null;
  if (r && isFullPhone(r.phone)) return { phone: normalizePhone(r.phone), from: 'roster' };
  return { phone: normalizePhone(s.phone), from: 'incomplete' };
}

/* ---------- 组装输出 ---------- */
// 口径与工作台一致：优先用「正课」(statCourses，已剔除习题课)。
// 但若正课尚无数据（例如课程只开了家长会、正式讲次还没开始），
// 则回退到「有学员实际参与的讲次」(activeCourses)，避免家长看到空白页。
let courses = (db.statCourses && db.statCourses.length) ? db.statCourses : [];
let courseSource = 'statCourses(正课)';
if (!courses.length) {
  courses = (db.activeCourses && db.activeCourses.length) ? db.activeCourses : [];
  courseSource = 'activeCourses(回退·含习题课)';
}

// 第二次 refresh：按最终确定的讲次口径重算统计，保证 stats 与导出的 courses 一致
SWB.refresh(db, courses);

let phoneFull = 0, phoneMissing = 0;
const students = db.students.map((s) => {
  // 仅导出查询与绘图所需的字段，去掉内部状态
  const lessons = {};
  courses.forEach((cn) => {
    const l = s.lessons && s.lessons[cn];
    if (!l) return;
    lessons[cn] = {
      effective: !!l.effective,
      attend: !!l.attend,
      accuracy: (l.accuracy == null ? null : l.accuracy),
      hwStatus: l.hwStatus || '',
      progress: l.progress || 0,
      minutes: l.durationMin || 0,
      quizRight: l.quizRight || 0,
      quizAnswer: l.quizAnswer || 0
    };
  });

  const rp = resolvePhone(s);
  if (rp.from !== 'incomplete') phoneFull++;
  else phoneMissing++;

  return {
    name: s.name || '',
    id: s.id || '',
    grade: s.grade || '',
    gender: s.gender || '',
    school: s.school || '',
    phoneHash: rp.from === 'incomplete' ? '' : phoneHash(rp.phone),
    stats: {
      score: s.stats ? s.stats.score : null,
      listen: s.stats ? s.stats.listen : null,
      accuracy: s.stats ? s.stats.accuracy : null,
      homework: s.stats ? s.stats.homework : null,
      progress: s.stats ? s.stats.progress : null,
      minutes: s.stats ? s.stats.minutes : null
    },
    lessons: lessons
  };
}).filter((s) => Object.keys(s.lessons).length > 0);

const out = {
  updatedAt: new Date().toISOString(),
  hashAlgo: 'fnv1a64',
  courseSource: courseSource,
  courseCount: courses.length,
  courses: courses,
  students: students
};

const outDir = path.join(ROOT, 'data');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'students.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 1), 'utf8');

console.log('已生成 ' + outFile);
console.log('  学习数据合并：新增 ' + merged.added + ' / 更新 ' + merged.updated + '，讲次 ' + merged.newCourses);
console.log('  学情档案：' + rosterCount + ' 份，匹配 ' + (db.rosterMatched || 0) + ' 人');
console.log('  参与统计的讲次：' + courses.length + ' 讲（来源 ' + courseSource + '）');
console.log('  导出学员：' + students.length + ' 人（仅含 phoneHash，不含手机号明文）');
console.log('  可用手机查询：' + phoneFull + ' 人；号码不完整无法查询：' + phoneMissing + ' 人');
