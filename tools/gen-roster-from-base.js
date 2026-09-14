/**
 * gen-roster-from-base.js
 * 把「飞书在线学情表 Base」导出的 NDJSON（/tmp/xueqing.ndjson）转换为：
 *   1) assets/roster-data.js   —— 工作台启动时载入的学情表档案源（window.SWB_ROSTER）
 *   2) 就地刷新 data/teacher-db.json 的 db.roster（含完整手机号/年级/性别/信息登记等），
 *      并补全 db.students 的 phone/grade/gender/regStatus（仅填充，不动学习统计与黑名单）。
 *
 * 关键约定：
 *   - 学情表主键 = useid（10 位，与花名册 homeroom / 学习数据 id 完全一致）
 *   - 手机号优先取 Base 完整 11 位；不足 11 位记为空（沿用原有脱敏号）
 *   - 综合分(综合分)作为档案参考存 rosterScore，不覆盖学习数据测算的 stats.score
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.BASE_NDJSON || '/tmp/xueqing.ndjson';
const ROSTER_JS = path.join(ROOT, 'assets', 'roster-data.js');
const DB_JSON = path.join(ROOT, 'data', 'teacher-db.json');

const norm = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const normPhone = (v) => norm(v);
const clean = (v) => (v == null ? '' : String(v).trim());

function parseBase(src) {
  const raw = fs.readFileSync(src, 'utf8').trim().split('\n').filter(Boolean);
  const rows = raw.map((l) => JSON.parse(l));
  // 仅保留有学号或姓名的数据行（跳过空白行）
  const data = rows.filter((r) => clean(r['学生姓名']) || clean(r['useid']));
  const students = data.map((r) => {
    const phone = normPhone(r['手机号']);
    const gradeArr = Array.isArray(r['年级']) ? r['年级'] : (r['年级'] ? [r['年级']] : []);
    return {
      id: clean(r['useid']),
      name: clean(r['学生姓名']),
      phone: phone.length === 11 ? phone : '',
      nickname: clean(r['AICE报名姓名']),
      gender: clean(r['性别']),
      grade: gradeArr.length ? clean(gradeArr[0]) : '',
      klass: '',
      school: '',
      region: '',
      guardian: '',
      address: '',
      level: '',
      joinAt: '',
      remark: clean(r['最近跟进内容']),
      todayNote: '',
      renewStatus: clean(r['特殊情况']),
      regStatus: clean(r['信息登记']),
      rosterScore: (r['综合分'] == null ? null : Number(r['综合分'])),
      extra: {
        综合分: r['综合分'] == null ? null : Number(r['综合分']),
        特殊情况: clean(r['特殊情况']),
        最近跟进内容: clean(r['最近跟进内容']),
        AICE报名姓名: clean(r['AICE报名姓名']),
      },
      lessons: {},
      key: clean(r['useid']),
    };
  });
  // 去重（按 id）
  const seen = {};
  const uniq = [];
  students.forEach((s) => {
    const k = norm(s.id);
    if (!k || seen[k]) return;
    seen[k] = 1;
    uniq.push(s);
  });
  return uniq;
}

function writeRosterJS(students) {
  const meta = {
    source: '飞书在线学情表（Base · 高途教育）',
    sheet: '学情表',
    updatedAt: new Date().toISOString(),
    count: students.length,
  };
  const body = JSON.stringify({ ...meta, students }, null, 0);
  const js = 'window.SWB_ROSTER = ' + body + ';\n';
  fs.writeFileSync(ROSTER_JS, js, 'utf8');
  return meta;
}

function patchDB(students) {
  if (!fs.existsSync(DB_JSON)) return null;
  const db = JSON.parse(fs.readFileSync(DB_JSON, 'utf8'));
  const byId = {};
  students.forEach((s) => { const k = norm(s.id); if (k) byId[k] = s; });

  // 1) 刷新 db.roster（学情表档案源）
  db.roster = db.roster || { students: [], sources: [], updatedAt: null, fields: [] };
  db.roster.students = students.map((s) => JSON.parse(JSON.stringify(s)));
  db.roster.updatedAt = new Date().toISOString();
  db.roster.sources = db.roster.sources || [];
  db.roster.sources.unshift({ name: '飞书在线学情表(Base)', rows: students.length, time: db.roster.updatedAt });
  db.roster.sources = db.roster.sources.slice(0, 10);

  // 2) 补全 db.students 档案字段（仅填充，不动 stats/lessons/blacklist）
  let filledPhone = 0, filledGrade = 0, filledGender = 0, matched = 0;
  (db.students || []).forEach((st) => {
    const r = byId[norm(st.id)];
    if (!r) return;
    matched++;
    if (r.phone && norm(st.phone).length !== 11) { st.phone = r.phone; filledPhone++; }
    if (r.grade && !st.grade) { st.grade = r.grade; filledGrade++; }
    if (r.gender && !st.gender) { st.gender = r.gender; filledGender++; }
    if (r.regStatus && !st.regStatus) st.regStatus = r.regStatus;
    if (r.renewStatus && !st.renewStatus) st.renewStatus = r.renewStatus;
  });

  fs.writeFileSync(DB_JSON, JSON.stringify(db, null, 2), 'utf8');
  return { matched, filledPhone, filledGrade, filledGender, roster: students.length };
}

// ---------- main ----------
const students = parseBase(SRC);
if (!students.length) { console.error('No data rows found in', SRC); process.exit(1); }
const meta = writeRosterJS(students);
console.log('roster-data.js 写入:', students.length, '人');
const patch = patchDB(students);
if (patch) {
  console.log('teacher-db.json 刷新: 学情表', patch.roster, '人 | 匹配学员', patch.matched,
    '| 补全手机号', patch.filledPhone, '| 年级', patch.filledGrade, '| 性别', patch.filledGender);
}
