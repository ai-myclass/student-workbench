/* ===========================================================
 * parser.js —— 表格解析 + 数据模型 + 指标计算
 * 适配「课程名 + 子字段名」表头（如「第1讲 xxx 是否有效听课」）
 * 额外支持：学情表（学员档案）解析与自动匹配、习题课剔除、单讲统计口径
 * =========================================================== */
(function (global) {
  'use strict';

  /** 每门课固定 13 个子字段 */
  var SUB_FIELDS = [
    '伴学关系', '是否有效听课', '是否到课', '是否到课完课', '听课时长',
    '听课进度', '看直播时长', '看回放时长', '看伴学时长',
    '直播答题', '直播答题正确率', '练习状态', '练习得分'
  ];

  /** 基础字段 → 内部键 */
  var BASE_FIELDS = {
    'userID': 'id', 'useid': 'id', 'userid': 'id', 'userId': 'id', 'user_id': 'id',
    '用户ID': 'id', '用户id': 'id', '学员ID': 'id', '学员id': 'id', 'ID': 'id', 'id': 'id',
    '学生ID': 'id', '学号': 'id', '编号': 'id', '学员编号': 'id',
    '电话': 'phone', '手机号': 'phone', '联系方式': 'phone', '手机': 'phone',
    '联系电话': 'phone', '家长手机号': 'phone', 'mobile': 'phone',
    '真实姓名': 'name', '姓名': 'name', '学员姓名': 'name', '学生姓名': 'name', '学生': 'name',
    '昵称': 'nickname',
    '性别': 'gender',
    '地区': 'region', '城市': 'region',
    '收货地址': 'address', '地址': 'address', '家长': 'guardian', '家长姓名': 'guardian',
    '年级': 'grade',
    '学校': 'school',
    '班级': 'klass', '班型': 'klass',
    '进班时间': 'joinAt', '入班时间': 'joinAt', '报名时间': 'joinAt',
    '今日动态': 'todayNote',
    '分层': 'level',
    '学员备注': 'remark', '备注': 'remark',
    '好友关系': 'friendship',
    '最近跟进内容': 'followUp',
    '电话沟通次数': 'callCount',
    '最近电话时间': 'lastCall',
    '沟通亲密度': 'closeness',
    '有效听课率': 'rawListenRate',
    '直播到课率': 'rawAttendRate',
    '最近课节情况': 'lastLesson',
    '信息登记': 'regStatus', '登记状态': 'regStatus', '登记情况': 'regStatus',
    '练习提交率': 'rawHwSubmitRate',
    '练习订正率': 'rawHwFixRate',
    '小灶课到课率': 'rawSmallClassRate',
    '直播连麦次数': 'micCount',
    '续班状态': 'renewStatus'
  };

  /** 档案字段（学情表覆盖这些字段） */
  var PROFILE_KEYS = ['id', 'phone', 'gender', 'grade', 'school', 'region', 'guardian',
    'address', 'level', 'klass', 'joinAt', 'remark', 'todayNote'];

  /** 未布置（不计入统计）的练习状态 */
  var UNASSIGNED = ['未布置', '未安排', '未开放', '未发布'];

  /** 默认剔除的课程关键词（习题课不参与统计） */
  var DEFAULT_EXCLUDE = ['习题课'];

  /* ---------------- 值解析工具 ---------------- */
  function str(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return fmtDate(v);
    return String(v).trim();
  }
  function fmtDate(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function num(v) {
    var s = str(v).replace(/[%\s,]/g, '');
    if (s === '' || s === '-') return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function toMinutes(v) {
    var s = str(v);
    if (!s || s === '-') return 0;
    var h = /(\d+(?:\.\d+)?)\s*(?:h|小时|时)/i.exec(s);
    var m = /(\d+(?:\.\d+)?)\s*(?:min|分钟|分)/i.exec(s);
    var sec = /(\d+(?:\.\d+)?)\s*(?:s|秒)/i.exec(s);
    var total = 0;
    if (h) total += parseFloat(h[1]) * 60;
    if (m) total += parseFloat(m[1]);
    if (!h && !m && sec) total += parseFloat(sec[1]) / 60;
    return Math.round(total * 10) / 10;
  }
  function parseQuiz(v) {
    var s = str(v);
    var m = /共推(\d+)题[，,、\s]*作答(\d+)题[，,、\s]*答对(\d+)题/.exec(s);
    if (m) return { push: +m[1], answer: +m[2], right: +m[3] };
    var m2 = /(\d+)\s*\/\s*(\d+)/.exec(s);
    if (m2) return { push: +m2[2], answer: +m2[2], right: +m2[1] };
    return { push: 0, answer: 0, right: 0 };
  }
  function isYes(v) { var s = str(v); return s === '是' || s === 'Y' || s === 'y' || s === 'true' || s === '1'; }
  function isUnassigned(v) {
    var s = str(v);
    if (s === '' || s === '-') return true;
    for (var i = 0; i < UNASSIGNED.length; i++) if (s.indexOf(UNASSIGNED[i]) === 0) return true;
    return false;
  }
  function isHwDone(v) {
    if (isUnassigned(v)) return false;
    return str(v).indexOf('未') === -1;
  }

  /* ---------------- 匹配用的归一化 ---------------- */
  function normId(v) { return String(v === null || v === undefined ? '' : v).trim().toLowerCase(); }
  function normPhone(v) {
    var d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
    return d.length > 11 ? d.slice(-11) : d;
  }
  function normName(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/[\s\u3000]/g, '').replace(/[（(].*?[)）]/g, '').trim().toLowerCase();
  }

  /* ---------------- 课程剔除 ---------------- */
  function settings(db) {
    if (!db.settings) db.settings = {};
    var s = db.settings;
    if (!s.excludeKeywords || !s.excludeKeywords.length) s.excludeKeywords = DEFAULT_EXCLUDE.slice();
    if (s.excludeDrill === undefined) s.excludeDrill = true;
    if (s.autoProfile === undefined) s.autoProfile = true;
    if (s.onlyRoster === undefined) s.onlyRoster = false;
    return s;
  }
  function isExcludedCourse(db, name) {
    var s = settings(db);
    if (!s.excludeDrill) return false;
    for (var i = 0; i < s.excludeKeywords.length; i++) {
      var k = s.excludeKeywords[i];
      if (k && String(name).indexOf(k) !== -1) return true;
    }
    return false;
  }

  /* ---------------- 表头分析 ---------------- */
  function analyzeHeader(header) {
    var baseCols = {};
    var courses = [];
    var courseIndex = {};

    for (var c = 0; c < header.length; c++) {
      var h = str(header[c]);
      if (!h) continue;

      if (BASE_FIELDS.hasOwnProperty(h)) {
        var key = BASE_FIELDS[h];
        if (baseCols[key] === undefined) baseCols[key] = c;
        continue;
      }
      var matched = null;
      for (var i = 0; i < SUB_FIELDS.length; i++) {
        var sub = SUB_FIELDS[i];
        if (h.length > sub.length && h.slice(h.length - sub.length) === sub) {
          if (!matched || sub.length > matched.length) matched = sub;
        }
      }
      if (matched) {
        var name = h.slice(0, h.length - matched.length).replace(/[\s·]+$/, '').trim();
        if (!name) continue;
        if (courseIndex[name] === undefined) {
          courseIndex[name] = courses.length;
          courses.push({ name: name, cols: {} });
        }
        courses[courseIndex[name]].cols[matched] = c;
      }
    }
    return { baseCols: baseCols, courses: courses, header: header };
  }

  /** 在表格中挑出「表头行」：基础字段命中最多的一行 */
  function findHeaderRow(rows, maxScan) {
    var bestRow = 0, bestScore = -1;
    for (var r = 0; r < Math.min(maxScan || 10, rows.length); r++) {
      var la = analyzeHeader(rows[r] || []);
      var score = Object.keys(la.baseCols).length * 3 + la.courses.length;
      if (score > bestScore) { bestScore = score; bestRow = r; }
    }
    return bestRow;
  }

  /* ---------------- 行 → 学员对象 ---------------- */
  function rowToStudent(row, layout) {
    var b = layout.baseCols;
    var get = function (idx) { return idx === undefined ? '' : str(row[idx]); };

    var student = {
      id: get(b.id),
      phone: get(b.phone),
      name: get(b.name),
      nickname: get(b.nickname),
      gender: get(b.gender),
      grade: get(b.grade),
      klass: get(b.klass),
      region: get(b.region),
      address: get(b.address),
      guardian: get(b.guardian),
      school: get(b.school),
      joinAt: get(b.joinAt),
      level: get(b.level),
      remark: get(b.remark),
      followUp: get(b.followUp),
      lastLesson: get(b.lastLesson),
      renewStatus: get(b.renewStatus),
      callCount: get(b.callCount),
      lastCall: get(b.lastCall),
      lessons: {}
    };
    if (!student.name) student.name = student.nickname || ('未命名 ' + (student.id || ''));
    if (!student.id) student.id = 'P_' + (student.name || Math.random().toString(36).slice(2, 8));

    layout.courses.forEach(function (course) {
      var cols = course.cols;
      var g = function (sub) { return cols[sub] === undefined ? '' : str(row[cols[sub]]); };

      var quiz = parseQuiz(g('直播答题'));
      var rec = {
        bind: g('伴学关系'),
        effective: isYes(g('是否有效听课')),
        attended: isYes(g('是否到课')),
        finished: isYes(g('是否到课完课')),
        durationMin: toMinutes(g('听课时长')),
        progress: num(g('听课进度')) || 0,
        liveMin: toMinutes(g('看直播时长')),
        replayMin: toMinutes(g('看回放时长')),
        companionMin: toMinutes(g('看伴学时长')),
        quizPush: quiz.push,
        quizAnswer: quiz.answer,
        quizRight: quiz.right,
        accuracy: num(g('直播答题正确率')),
        hwStatus: g('练习状态'),
        hwScore: num(g('练习得分'))
      };
      if (rec.accuracy === null && rec.quizAnswer > 0) {
        rec.accuracy = Math.round(rec.quizRight / rec.quizAnswer * 1000) / 10;
      }
      student.lessons[course.name] = rec;
    });
    return student;
  }

  /* ---------------- 工作簿 → 学习数据集 ---------------- */
  function parseWorkbook(data, fileName) {
    var wb = XLSX.read(data, { type: 'array', cellDates: true });
    var sheetName = wb.SheetNames[0];
    var ws = wb.Sheets[sheetName];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false });
    if (!rows.length) throw new Error('表格是空的');

    var bestRow = findHeaderRow(rows, 10);
    var layout = analyzeHeader(rows[bestRow] || []);
    if (layout.courses.length === 0 && !layout.baseCols.name && !layout.baseCols.id) {
      throw new Error('没能识别表头，请确认第一行包含「姓名」「是否有效听课」等列名');
    }

    var students = [];
    for (var i = bestRow + 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var hasContent = false;
      for (var k = 0; k < Math.min(row.length, 12); k++) {
        if (str(row[k])) { hasContent = true; break; }
      }
      if (!hasContent) continue;
      students.push(rowToStudent(row, layout));
    }
    if (!students.length) throw new Error('没有读到任何学员数据');

    return {
      source: fileName || sheetName,
      sheet: sheetName,
      students: students,
      courses: layout.courses.map(function (c) { return c.name; }),
      meta: { headerRow: bestRow + 1, fields: Object.keys(layout.baseCols).length }
    };
  }

  /* ---------------- 工作簿 → 学情表（学员档案） ---------------- */
  function parseRosterWorkbook(data, fileName) {
    var wb = XLSX.read(data, { type: 'array', cellDates: true });

    // 多工作表时，挑「基础字段识别最多」的那个
    var best = null;
    wb.SheetNames.forEach(function (sn) {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: true, blankrows: false });
      if (!rows.length) return;
      var hr = findHeaderRow(rows, 10);
      var la = analyzeHeader(rows[hr] || []);
      var score = Object.keys(la.baseCols).length * 3 + la.courses.length;
      if (!best || score > best.score) best = { sheet: sn, rows: rows, hr: hr, la: la, score: score };
    });
    if (!best) throw new Error('学情表是空的，没读到任何内容');

    var layout = best.la;
    var rows = best.rows;
    if (!layout.baseCols.name && !layout.baseCols.id && !layout.baseCols.phone) {
      throw new Error('没能在学情表里找到「姓名 / 学员ID / 手机号」中的任何一列');
    }

    // 哪些列属于「课程指标列」（学情表里一般没有，有则忽略）
    var courseCol = {};
    layout.courses.forEach(function (c) {
      Object.keys(c.cols).forEach(function (sub) { courseCol[c.cols[sub]] = 1; });
    });

    var b = layout.baseCols;
    var used = {};
    Object.keys(b).forEach(function (k) { used[b[k]] = 1; });

    // 其余列全部收进 extra，作为档案的补充信息
    var extraCols = [];
    for (var c = 0; c < (layout.header || []).length; c++) {
      if (used[c] || courseCol[c]) continue;
      var h = str(layout.header[c]);
      if (!h) continue;
      extraCols.push({ header: h, col: c });
    }

    var students = [];
    for (var r = best.hr + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var get = function (idx) { return idx === undefined ? '' : str(row[idx]); };
      var name = get(b.name), id = get(b.id), phone = get(b.phone);
      if (!name && !id && !phone) continue;

      var extra = {};
      extraCols.forEach(function (ec) {
        var v = str(row[ec.col]);
        if (v && v !== '-') extra[ec.header] = v;
      });

      var rec = {
        id: id, name: name, phone: phone,
        nickname: get(b.nickname), gender: get(b.gender), grade: get(b.grade),
        klass: get(b.klass), school: get(b.school), region: get(b.region),
        guardian: get(b.guardian), address: get(b.address), level: get(b.level),
        joinAt: get(b.joinAt), remark: get(b.remark), todayNote: get(b.todayNote),
        renewStatus: get(b.renewStatus), regStatus: get(b.regStatus),
        extra: extra,
        lessons: {}
      };
      if (!rec.name) rec.name = rec.nickname || ('未命名 ' + (rec.id || ''));
      if (!rec.id) rec.id = 'R_' + (rec.name || '') + '_' + (normPhone(rec.phone) || r);
      rec.key = normId(rec.id) || ('ph:' + normPhone(rec.phone)) || ('nm:' + normName(rec.name));
      students.push(rec);
    }
    if (!students.length) throw new Error('学情表里没有读到任何学员记录');

    return {
      source: fileName || best.sheet,
      sheet: best.sheet,
      students: students,
      meta: { headerRow: best.hr + 1, fields: Object.keys(b).length, extra: extraCols.map(function (e) { return e.header; }) }
    };
  }

  /** 学情表整体入库（档案以最后一次导入为准） */
  function mergeRosterInto(db, parsed) {
    db.roster = db.roster || { students: [], sources: [], updatedAt: null };
    db.roster.students = parsed.students;
    db.roster.sources = db.roster.sources || [];
    db.roster.sources.unshift({ name: parsed.source, rows: parsed.students.length, time: new Date().toISOString() });
    db.roster.sources = db.roster.sources.slice(0, 10);
    db.roster.updatedAt = new Date().toISOString();
    db.roster.fields = parsed.meta.extra || [];
    return { total: parsed.students.length, source: parsed.source };
  }

  /* ---------------- 学习数据合并入库 ---------------- */
  function mergeInto(db, parsed) {
    var added = 0, updated = 0, newCourses = 0;
    var courseSet = {};
    db.courses.forEach(function (n) { courseSet[n] = 1; });
    parsed.courses.forEach(function (n) {
      if (!courseSet[n]) { db.courses.push(n); courseSet[n] = 1; newCourses++; }
    });

    var index = {};
    db.students.forEach(function (s, i) { index[s.id] = i; });

    // 学情表索引（用于后续匹配）
    var ridx = rosterIndex(db);
    var matched = 0, unmatched = 0;

    parsed.students.forEach(function (ns) {
      // 先用学情表补全身份信息，再决定落到哪条记录
      var r = matchRecord(ridx, ns);
      ns.rosterMatched = false;
      ns.rosterKey = '';
      if (r) {
        ns.rosterMatched = true;
        ns.rosterKey = r.key;
        if (settings(db).autoProfile) {
          PROFILE_KEYS.forEach(function (k) {
            if (k === 'id') return;                       // 不动 id，避免打断已有记录
            if (r[k] && r[k] !== '-') ns[k] = r[k];
          });
        }
        matched++;
      } else {
        unmatched++;
      }

      var idx = index[ns.id];
      if (idx === undefined) {
        db.students.push(ns);
        index[ns.id] = db.students.length - 1;
        added++;
      } else {
        var old = db.students[idx];
        Object.keys(ns).forEach(function (k) {
          if (k === 'lessons') return;
          if (ns[k] !== '' && ns[k] !== null && ns[k] !== undefined) old[k] = ns[k];
        });
        Object.keys(ns.lessons).forEach(function (cn) { old.lessons[cn] = ns.lessons[cn]; });
        updated++;
      }
    });

    db.sources = db.sources || [];
    db.sources.unshift({
      name: parsed.source,
      rows: parsed.students.length,
      matched: matched,
      unmatched: unmatched,
      time: new Date().toISOString()
    });
    db.sources = db.sources.slice(0, 20);
    db.updatedAt = new Date().toISOString();

    return {
      added: added, updated: updated, newCourses: newCourses,
      total: parsed.students.length, matched: matched, unmatched: unmatched
    };
  }

  /* ---------------- 学情表匹配 ---------------- */
  function rosterIndex(db) {
    var idx = { byId: {}, byPhone: {}, byName: {}, list: [] };
    var list = (db.roster && db.roster.students) ? db.roster.students : [];
    list.forEach(function (r) {
      idx.list.push(r);
      var id = normId(r.id); if (id && !idx.byId[id]) idx.byId[id] = r;
      var ph = normPhone(r.phone); if (ph && !idx.byPhone[ph]) idx.byPhone[ph] = r;
      var nm = normName(r.name); if (nm && !idx.byName[nm]) idx.byName[nm] = r;
    });
    return idx;
  }
  /** 匹配顺序：学员 ID → 手机号 → 姓名 */
  function matchRecord(ridx, s) {
    if (!ridx || !ridx.list.length) return null;
    var byId = normId(s.id) ? ridx.byId[normId(s.id)] : null;
    if (byId) return byId;
    var byPhone = normPhone(s.phone) ? ridx.byPhone[normPhone(s.phone)] : null;
    if (byPhone) return byPhone;
    var byName = normName(s.name) ? ridx.byName[normName(s.name)] : null;
    if (byName) return byName;
    return null;
  }

  /** 全量重算匹配关系（切换学情表 / 清空后调用） */
  function applyRoster(db) {
    var ridx = rosterIndex(db);
    var link = {}, matched = 0, filled = 0;
    db.students.forEach(function (s) {
      var r = matchRecord(ridx, s);
      s.rosterMatched = !!r;
      s.rosterKey = r ? r.key : '';
      if (r) {
        matched++;
        link[r.key] = s.id;
        if (settings(db).autoProfile) {
          PROFILE_KEYS.forEach(function (k) {
            if (k === 'id') return;
            if (r[k] && r[k] !== '-' && (!s[k] || s[k] === '-')) { s[k] = r[k]; filled++; }
          });
        }
      }
    });
    db.rosterMatched = matched;
    db.rosterLink = link;
    // 学情表变化后，把历史学习数据源的匹配数也刷新成当前全局状态
    (db.sources || []).forEach(function (src) {
      src.matched = matched;
      src.unmatched = db.students.length - matched;
    });
    return { matched: matched, filled: filled, total: db.students.length };
  }

  /* ---------------- 指标计算 ---------------- */
  function isCourseActive(db, courseName) {
    for (var i = 0; i < db.students.length; i++) {
      var l = db.students[i].lessons[courseName];
      if (!l) continue;
      if (l.attended || l.effective || l.finished) return true;
      if (l.durationMin > 0 || l.liveMin > 0 || l.replayMin > 0) return true;
      if (!isUnassigned(l.hwStatus)) return true;
    }
    return false;
  }

  function emptyStats() {
    return {
      listen: 0, attend: 0, accuracy: null, homework: null, score: 0,
      effCount: 0, attCount: 0, finCount: 0, quizAnswer: 0, quizRight: 0, hasQuiz: false,
      hwAssigned: 0, hwDone: 0, minutes: 0, activeCount: 0, progress: 0
    };
  }

  /** 计算单个学员在给定课程范围内的核心指标 */
  function studentStats(db, s, courses) {
    var list = courses || db.statCourses || db.activeCourses || db.courses;
    var n = list.length || 1;
    var eff = 0, att = 0, fin = 0, hwAssigned = 0, hwDone = 0;
    var qa = 0, qr = 0, minutes = 0, prog = 0, progN = 0;

    list.forEach(function (cn) {
      var l = s.lessons[cn];
      if (!l) return;
      if (l.effective) eff++;
      if (l.attended) att++;
      if (l.finished) fin++;
      if (!isUnassigned(l.hwStatus)) {
        hwAssigned++;
        if (isHwDone(l.hwStatus)) hwDone++;
      }
      if (l.quizAnswer > 0) { qa += l.quizAnswer; qr += l.quizRight; }
      minutes += (l.durationMin || 0);
      if (l.progress > 0) { prog += l.progress; progN++; }
    });

    var listen = eff / n;
    var attend = att / n;
    var accuracy = qa > 0 ? qr / qa : null;
    var homework = hwAssigned > 0 ? hwDone / hwAssigned : null;

    var parts = [];
    parts.push({ w: 0.35, v: listen });
    if (accuracy !== null) parts.push({ w: 0.30, v: accuracy });
    if (homework !== null) parts.push({ w: 0.35, v: homework });
    var wSum = 0, vSum = 0;
    parts.forEach(function (p) { wSum += p.w; vSum += p.w * p.v; });
    var score = wSum > 0 ? vSum / wSum : 0;

    return {
      listen: listen, attend: attend, accuracy: accuracy, homework: homework,
      score: score, effCount: eff, attCount: att, finCount: fin,
      quizAnswer: qa, quizRight: qr, hasQuiz: qa > 0,
      hwAssigned: hwAssigned, hwDone: hwDone,
      minutes: minutes, activeCount: n,
      progress: progN ? prog / progN : 0
    };
  }

  /** 全班每讲汇总（仅统计未被剔除的课程） */
  function courseTrend(db) {
    var courses = db.statCourses || [];
    var n0 = db.students.length || 1;
    return courses.map(function (cn) {
      var eff = 0, att = 0, hwA = 0, hwD = 0, qa = 0, qr = 0, mins = 0;
      db.students.forEach(function (s) {
        var l = s.lessons[cn];
        if (!l) return;
        if (l.effective) eff++;
        if (l.attended) att++;
        if (!isUnassigned(l.hwStatus)) { hwA++; if (isHwDone(l.hwStatus)) hwD++; }
        if (l.quizAnswer > 0) { qa += l.quizAnswer; qr += l.quizRight; }
        mins += (l.durationMin || 0);
      });
      return {
        name: cn,
        listen: eff / n0,
        attend: att / n0,
        accuracy: qa > 0 ? qr / qa : null,
        homework: hwA > 0 ? hwD / hwA : null,
        minutes: mins / n0
      };
    });
  }

  /** 单讲班级构成 */
  function courseBreakdown(db, cn) {
    var eff = 0, att = 0, no = 0, fin = 0;
    var hwA = 0, hwD = 0, qa = 0, qr = 0, mins = 0, prog = 0, progN = 0;
    db.students.forEach(function (s) {
      var l = s.lessons[cn];
      if (!l) { no++; return; }
      if (l.effective) eff++; else if (l.attended) att++; else no++;
      if (l.finished) fin++;
      if (!isUnassigned(l.hwStatus)) { hwA++; if (isHwDone(l.hwStatus)) hwD++; }
      if (l.quizAnswer > 0) { qa += l.quizAnswer; qr += l.quizRight; }
      mins += (l.durationMin || 0);
      if (l.progress > 0) { prog += l.progress; progN++; }
    });
    return {
      name: cn, effective: eff, attendedOnly: att, absent: no, finished: fin,
      hwAssigned: hwA, hwDone: hwD, quizAnswer: qa, quizRight: qr,
      minutes: mins, avgMinutes: mins / (db.students.length || 1),
      progress: progN ? prog / progN : 0
    };
  }

  /** 刷新全库派生数据；scope 为 null 时统计全部正课 */
  function refresh(db, scope) {
    db.roster = db.roster || { students: [], sources: [], updatedAt: null };
    settings(db);

    db.activeCourses = db.courses.filter(function (cn) { return isCourseActive(db, cn); });
    db.statCourses = db.activeCourses.filter(function (cn) { return !isExcludedCourse(db, cn); });
    db.excludedCourses = db.courses.filter(function (cn) { return isExcludedCourse(db, cn); });

    db.scopeCourses = scope || null;
    var list = scope && scope.length ? scope : db.statCourses;
    db.students.forEach(function (s) { s.stats = studentStats(db, s, list); });

    applyRoster(db);
    buildArchive(db);
    return db;
  }

  /** 档案视图：学情表为准，挂接学习数据 */
  function buildArchive(db) {
    var byKey = db.rosterLink || {};
    var sById = {};
    db.students.forEach(function (s) { sById[s.id] = s; });

    if (!db.roster.students.length) {
      db.archive = db.students.map(function (s) {
        return { key: 's:' + s.id, roster: null, student: s, stats: s.stats, noData: false };
      });
      return db.archive;
    }

    db.archive = db.roster.students.map(function (r) {
      var sid = byKey[r.key];
      var s = sid ? sById[sid] : null;
      return {
        key: 'r:' + r.key,
        roster: r,
        student: s || null,
        stats: s ? s.stats : emptyStats(),
        noData: !s
      };
    });
    return db.archive;
  }

  /* ---------------- 导出 ---------------- */
  function pct(v) { return v === null || v === undefined ? '' : (v * 100).toFixed(1) + '%'; }
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** 学习数据导出（当前统计口径） */
  function toCSV(db) {
    var scope = (db.scopeCourses && db.scopeCourses.length) ? db.scopeCourses : db.statCourses;
    var scopeTxt = (db.scopeCourses && db.scopeCourses.length === 1) ? db.scopeCourses[0] : '全部正课 ' + scope.length + ' 讲';
    var head = ['学员ID', '姓名', '昵称', '手机号', '性别', '年级', '地区', '学校', '进班时间',
      '档案匹配', '统计口径', '有效听课率', '到课率', '答题正确率', '练习完成率', '综合得分', '累计听课(分钟)'];
    var lines = [head.join(',')];
    db.students.forEach(function (s) {
      var st = s.stats || studentStats(db, s, scope);
      lines.push([
        s.id, s.name, s.nickname || '', s.phone || '', s.gender || '', s.grade || '',
        s.region || '', s.school || '', s.joinAt || '',
        s.rosterMatched ? '已匹配' : (db.roster.students.length ? '未匹配' : '未导入学情表'),
        scopeTxt,
        pct(st.listen), pct(st.attend), pct(st.accuracy), pct(st.homework),
        (st.score * 100).toFixed(1) + '%', Math.round(st.minutes)
      ].map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\n');
  }

  /** 学情表档案导出（含学习表现） */
  function toRosterCSV(db) {
    var hasRoster = db.roster.students.length > 0;
    var head = ['姓名', '学员ID', '手机号', '性别', '年级', '学校', '班级', '地区', '家长', '分层', '进班时间',
      '匹配状态', '有效听课率', '答题正确率', '练习完成率', '综合得分', '听课(分钟)'];
    var lines = [head.join(',')];
    (db.archive || []).forEach(function (a) {
      var r = a.roster || a.student || {};
      var st = a.stats || emptyStats();
      lines.push([
        r.name || '', r.id || '', r.phone || '', r.gender || '', r.grade || '',
        r.school || '', r.klass || '', r.region || '', r.guardian || '', r.level || '', r.joinAt || '',
        hasRoster ? (a.noData ? '暂无学习数据' : '已匹配') : '—',
        a.noData ? '' : pct(st.listen),
        a.noData ? '' : pct(st.accuracy),
        a.noData ? '' : pct(st.homework),
        a.noData ? '' : (st.score * 100).toFixed(1) + '%',
        a.noData ? '' : Math.round(st.minutes)
      ].map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\n');
  }

  /* ---------------- 空库 ---------------- */
  function emptyDB() {
    return {
      version: 2, updatedAt: null,
      courses: [], students: [], sources: [],
      activeCourses: [], statCourses: [], excludedCourses: [],
      scopeCourses: null, archive: [], rosterLink: {}, rosterMatched: 0,
      roster: { students: [], sources: [], updatedAt: null, fields: [] },
      settings: {
        excludeKeywords: DEFAULT_EXCLUDE.slice(),
        excludeDrill: true,
        autoProfile: true,
        onlyRoster: false
      }
    };
  }

  global.SWB = {
    SUB_FIELDS: SUB_FIELDS,
    BASE_FIELDS: BASE_FIELDS,
    DEFAULT_EXCLUDE: DEFAULT_EXCLUDE,
    parseWorkbook: parseWorkbook,
    parseRosterWorkbook: parseRosterWorkbook,
    mergeInto: mergeInto,
    mergeRosterInto: mergeRosterInto,
    applyRoster: applyRoster,
    rosterIndex: rosterIndex,
    matchRecord: matchRecord,
    refresh: refresh,
    studentStats: studentStats,
    emptyStats: emptyStats,
    courseTrend: courseTrend,
    courseBreakdown: courseBreakdown,
    isExcludedCourse: isExcludedCourse,
    settings: settings,
    toCSV: toCSV,
    toRosterCSV: toRosterCSV,
    emptyDB: emptyDB,
    util: {
      str: str, num: num, toMinutes: toMinutes, parseQuiz: parseQuiz,
      isUnassigned: isUnassigned, isHwDone: isHwDone, pct: pct,
      normId: normId, normPhone: normPhone, normName: normName
    }
  };
})(window);
