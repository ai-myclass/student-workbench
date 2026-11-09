/**
 * sync-roster-phones.js — 用飞书学情表最新数据增量补全工作台的学员手机号与档案字段
 *
 * 策略（增量合并，不覆盖式重建）：
 *   - 基底 = 本地 assets/roster-data.js（现有 188 人）
 *   - 增补 = 飞书学情表数据（多源合并）：
 *       ① 飞书电子表格版（最新，含 综合正确率/得分/评定结果 等新列）
 *       ② 飞书 Base 版（补充表格里缺失的号，如 张名博）
 *       两源按 useid 合并，手机号取「任一源有 11 位完整号」；
 *       本地已有的人 → 补全/更新 phone、grade、gender、regStatus 等
 *       本地没有的人 → 新增进学情表
 *   - 本地独有、两个飞书源都没有的人 → 保留不动
 *
 * 用法：node tools/sync-roster-phones.js <表格版.ndjson> [Base版.ndjson]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC_SHEET = process.argv[2] || '/tmp/xueqing_sheet.ndjson';
const SRC_BASE = process.argv[3] || '/tmp/xueqing_full.ndjson';
const ROSTER_JS = path.join(ROOT, 'assets', 'roster-data.js');
const DB_JSON = path.join(ROOT, 'data', 'teacher-db.json');

const norm = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const clean = (v) => (v == null ? '' : String(v).trim());
/** 完整 11 位手机号才算可用 */
const fullPhone = (v) => { const p = norm(v); return p.length === 11 ? p : ''; };

/** 读取一个 ndjson 源，返回 useid -> record */
function readSource(file) {
  if (!file || !fs.existsSync(file)) return {};
  const map = {};
  fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).forEach(l => {
    const r = JSON.parse(l);
    const id = norm(r['useid']);
    if (id) map[id] = r;
  });
  return map;
}

/** 从飞书记录生成学情表档案条目（结构对齐 assets/roster-data.js 现有格式） */
function recordToRoster(r, prev) {
  const phone = fullPhone(r['手机号']);
  const gradeArr = Array.isArray(r['年级']) ? r['年级'] : (r['年级'] ? [r['年级']] : []);
  const base = prev || {};
  const score = r['综合分'] == null ? null : Number(r['综合分']);
  const acc = r['综合正确率'] == null ? null : Number(r['综合正确率']);
  return {
    id: clean(r['useid']),
    name: clean(r['学生姓名']),
    // 手机号：飞书为 11 位才采用；否则沿用本地已有值（不因一次空值覆盖掉旧号）
    phone: phone || clean(base.phone) || '',
    nickname: clean(r['AICE报名姓名']) || clean(base.nickname) || '',
    gender: clean(r['性别']) || clean(base.gender) || '',
    grade: gradeArr.length ? clean(gradeArr[0]) : (clean(base.grade) || ''),
    klass: clean(r['班级']) || clean(base.klass) || '',
    school: clean(base.school) || '',
    region: clean(base.region) || '',
    guardian: clean(base.guardian) || '',
    address: clean(base.address) || '',
    level: clean(base.level) || '',
    joinAt: clean(base.joinAt) || '',
    remark: clean(r['最近跟进内容']) || clean(base.remark) || '',
    todayNote: clean(base.todayNote) || '',
    renewStatus: clean(r['特殊情况']) || clean(base.renewStatus) || '',
    regStatus: clean(r['信息登记']) || clean(base.regStatus) || '',
    rosterScore: score == null ? (base.rosterScore == null ? null : base.rosterScore) : score,
    extra: Object.assign({}, base.extra || {}, {
      综合分: score == null ? (base.extra && base.extra.综合分 != null ? base.extra.综合分 : null) : score,
      综合正确率: acc == null ? (base.extra && base.extra.综合正确率 != null ? base.extra.综合正确率 : null) : acc,
      特殊情况: clean(r['特殊情况']),
      最近跟进内容: clean(r['最近跟进内容']),
      AICE报名姓名: clean(r['AICE报名姓名']),
    }),
    lessons: base.lessons || {},
    key: clean(r['useid']),
  };
}

function loadLocalRoster() {
  const code = fs.readFileSync(ROSTER_JS, 'utf8');
  const sb = { window: {}, console }; sb.window.window = sb.window;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'roster-data.js' });
  return sb.window.SWB_ROSTER;
}

/* ---------------- 主流程 ---------------- */
const local = loadLocalRoster();
const localStudents = local.students || [];
const byId = {};
localStudents.forEach(s => { byId[norm(s.id)] = s; });

const sheetMap = readSource(SRC_SHEET);
const baseMap = readSource(SRC_BASE);
// 合并两源：表格优先，Base 补缺。
// 注意不能整条记录直接覆盖——某源里某人手机号为空时会把另一源的完整号冲掉，
// 故手机号按「任一源有 11 位完整号」取，其余字段以表格版为准、Base 兜底。
const merged_src = {};
const allIds = new Set([...Object.keys(baseMap), ...Object.keys(sheetMap)]);
allIds.forEach(function (id) {
  const s = sheetMap[id], b = baseMap[id];
  if (!s && !b) return;
  const merged = Object.assign({}, b || {}, s || {});
  const sPhone = fullPhone(s && s['手机号']);
  const bPhone = fullPhone(b && b['手机号']);
  if (sPhone) merged['手机号'] = sPhone;
  else if (bPhone) merged['手机号'] = bPhone;
  else merged['手机号'] = (s && s['手机号']) != null ? s['手机号'] : (b ? b['手机号'] : null);
  merged_src[id] = merged;
});

let filledPhone = 0, updatedPhone = 0, added = 0, skippedNoId = 0;
const noId = [], stillMissing = [], report = [];

Object.keys(merged_src).forEach(id => {
  const r = merged_src[id];
  const prev = byId[id];
  const rec = recordToRoster(r, prev);
  if (!prev) {
    added++;
    byId[id] = rec;
    report.push({ t: '新增', name: rec.name, id, phone: rec.phone });
    return;
  }
  const oldPhone = norm(prev.phone);
  if (rec.phone && oldPhone !== rec.phone) {
    if (!oldPhone) { filledPhone++; report.push({ t: '补全', name: rec.name, id, phone: rec.phone }); }
    else { updatedPhone++; report.push({ t: '更新', name: rec.name, id, from: prev.phone, phone: rec.phone }); }
  } else if (!rec.phone && !oldPhone) {
    stillMissing.push({ name: rec.name, id, raw: r['手机号'] == null ? '(空)' : r['手机号'] });
  }
  byId[id] = rec;
});

// 输出顺序：本地原有顺序保持不变，新增追加在末尾
const merged = [];
const usedIds = {};
localStudents.forEach(s => {
  const k = norm(s.id);
  if (usedIds[k]) return;
  usedIds[k] = 1;
  merged.push(byId[k] || s);
});
Object.keys(byId).forEach(k => {
  if (usedIds[k]) return;
  usedIds[k] = 1;
  merged.push(byId[k]);
});

/* ---- 写回 assets/roster-data.js ---- */
const meta = {
  source: '飞书在线学情表（Base · 高途教育）',
  sheet: '学情表',
  updatedAt: new Date().toISOString(),
  count: merged.length,
};
fs.writeFileSync(ROSTER_JS, 'window.SWB_ROSTER = ' + JSON.stringify(Object.assign({}, meta, { students: merged }), null, 0) + ';\n', 'utf8');

/* ---- 补全 data/teacher-db.json ---- */
let db = null;
if (fs.existsSync(DB_JSON)) {
  db = JSON.parse(fs.readFileSync(DB_JSON, 'utf8'));
  const map = {}; merged.forEach(s => { map[norm(s.id)] = s; });
  db.roster = db.roster || { students: [], sources: [], updatedAt: null, fields: [] };
  db.roster.students = merged.map(s => JSON.parse(JSON.stringify(s)));
  db.roster.updatedAt = new Date().toISOString();
  db.roster.sources = db.roster.sources || [];
  db.roster.sources.unshift({ name: '飞书在线学情表(Base)', rows: merged.length, time: db.roster.updatedAt });
  db.roster.sources = db.roster.sources.slice(0, 10);
  let fPhone = 0;
  (db.students || []).forEach(st => {
    const r = map[norm(st.id)];
    if (!r) return;
    if (r.phone && norm(st.phone).length !== 11) { st.phone = r.phone; fPhone++; }
    if (r.grade && !st.grade) st.grade = r.grade;
    if (r.gender && !st.gender) st.gender = r.gender;
    if (r.regStatus && !st.regStatus) st.regStatus = r.regStatus;
    if (r.renewStatus && !st.renewStatus) st.renewStatus = r.renewStatus;
  });
  // 保持与仓库一致的 indent:1 格式（避免 diff 膨胀）
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(DB_JSON, JSON.stringify(db, null, 1), 'utf8');
  console.log('teacher-db.json: 学员手机号补全', fPhone, '人');
}

console.log('数据源: 表格版', Object.keys(sheetMap).length, '| Base版', Object.keys(baseMap).length, '| 合并后', Object.keys(merged_src).length);
console.log('学情表 roster-data.js: 共', merged.length, '人');
console.log('  补全手机号', filledPhone, '| 更新手机号', updatedPhone, '| 新增学员', added);
if (report.length) {
  console.log('变更明细:');
  report.forEach(x => console.log('  [' + x.t + '] ' + x.name + ' | ' + x.id + ' | ' + (x.from ? x.from + ' → ' : '') + (x.phone || '(空)')));
}
if (stillMissing.length) {
  console.log('仍缺完整手机号（需人工在飞书表补录）:');
  stillMissing.forEach(x => console.log('  ' + x.name + ' | ' + x.id + ' | 飞书原始="' + x.raw + '"'));
}
