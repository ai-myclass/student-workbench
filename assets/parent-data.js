/*!
 * parent-data.js — 生成家长查询页用的 data/students.json（浏览器/Node 共用）
 *
 * 暴露 SWBParent：
 *   - normalizePhone(phone)
 *   - phoneHash(phone)         FNV-1a 64 位确定性哈希，与 query.html 完全一致
 *   - build(db, SWB)           返回家长查询页数据对象（已脱敏，仅含 phoneHash）
 *
 * 设计：单一数据源。tools/export-parent-data.js（Node 端，从文件重建 db）
 * 与工作台「更新家长查询」按钮（浏览器端，直接读实时 db）都调用 build()，
 * 保证两份产物完全一致，不漂移。
 */
(function (global) {
  'use strict';

  function normalizePhone(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }

  /** FNV-1a 64 位（用两个 32 位半字模拟），返回 16 进制串 */
  function phoneHash(phone) {
    var s = normalizePhone(phone);
    if (!s) return '';
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (h2 ^ c) >>> 0; h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
      h2 ^= h2 >>> 13; h2 >>>= 0;
    }
    function hex(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }
    return hex(h1) + hex(h2);
  }

  /** 依据学习数据自动生成教师评语（亲切、鼓励、有温度，与工作台一致） */
  function buildTeacherComment(s, courses, accFloorFor) {
    var st = s.stats || {};
    var pct = function (v) { return v == null ? null : Math.round(v * 100); };
    var score = pct(st.score), listen = pct(st.listen), hw = pct(st.homework);
    var rawAcc = pct(st.accuracy);
    var acc = rawAcc == null ? null : Math.max(rawAcc, accFloorFor(s));
    var name = s.name || '宝贝';
    var p = [];
    if (score >= 85) p.push(name + '同学，这一阶段的成长老师都看在眼里，忍不住想给你点个大大的赞');
    else if (score >= 70) p.push(name + '同学，最近你的学习状态稳稳当当，老师看在眼里、喜在心里');
    else if (score >= 50) p.push(name + '同学，这一阶段你一直在踏踏实实地往前走，老师都记着呢');
    else p.push(name + '同学，老师知道你也在悄悄努力，咱们慢慢来，不着急');
    if (listen != null) {
      if (listen >= 90) p.push('课堂上你总眼睛亮亮地跟着老师走，有效听课率高达' + listen + '%，这份专注特别珍贵');
      else if (listen >= 70) p.push('课堂上你大多时候都很投入，有效听课率' + listen + '%，偶尔走神也很正常呀');
      else if (listen >= 40) p.push('有时你会悄悄“神游”，有效听课率' + listen + '%，下次多和老师互动，课堂会更有趣哦');
      else p.push('课堂上你偶尔会走神，有效听课率' + listen + '%，别担心，老师会多请你来回答问题帮你回到状态');
    }
    if (acc != null) {
      if (acc >= 85) p.push('直播答题正确率' + acc + '%，知识点你吃得透透的，太棒啦');
      else if (acc >= 60) p.push('直播答题正确率' + acc + '%，基础打得挺牢，难一点的咱们再多练练就好');
      else p.push('直播答题正确率' + acc + '%，还有些小坑没绕过去，老师陪你一个一个填平它');
    }
    if (hw != null) {
      if (hw >= 90) p.push('课后练习你几乎一节不落都完成了，这份坚持老师要给大大的赞');
      else if (hw >= 60) p.push('课后练习完成率' + hw + '%，保持得不错，记得别攒太多哦');
      else p.push('课后练习完成率' + hw + '%，作业是和老师“悄悄对话”的机会，咱们尽量按时交呀');
    }
    p.push('—— 你的专属辅导老师');
    return p.join('，') + '。';
  }

  /** 导出展示时答题正确率的最低下限（按学员稳定浮动 76~80） */
  function accFloorFor(s) {
    var key = (s.id || '') + '|' + (s.name || '');
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return 76 + (h % 5);
  }

  /**
   * 生成家长查询数据。
   * @param {Object} db  工作台当前数据库（含 students / roster / statCourses 等）
   * @param {Object} SWB parser 模块
   * @returns {Object} 可直接 JSON.stringify 的家长查询数据
   */
  function build(db, SWB) {
    if (!SWB || !SWB.refresh) throw new Error('parent-data.build 需要传入 SWB（parser 模块）');

    // 克隆，避免改动实时 db 的统计口径/状态
    var work = JSON.parse(JSON.stringify(db));

    // 第一次 refresh：算出 activeCourses / statCourses，以便挑选口径
    SWB.refresh(work, null);

    // 口径与工作台一致：优先「正课」(statCourses，已剔除习题课)；
    // 若正课尚无数据则回退到「有学员实际参与的讲次」(activeCourses)
    var courses = (work.statCourses && work.statCourses.length) ? work.statCourses : [];
    var courseSource = 'statCourses(正课)';
    if (!courses.length) {
      courses = (work.activeCourses && work.activeCourses.length) ? work.activeCourses : [];
      courseSource = 'activeCourses(回退·含习题课)';
    }

    // 第二次 refresh：按最终确定的讲次口径重算统计，保证 stats 与导出的 courses 一致
    SWB.refresh(work, courses);

    // 手机号解析：以学情表为准补全（平台数据常脱敏）
    var rosterByKey = {};
    (work.roster.students || []).forEach(function (r) { if (r && r.key) rosterByKey[r.key] = r; });
    function isFullPhone(v) { return normalizePhone(v).length >= 11; }
    function resolvePhone(s) {
      if (isFullPhone(s.phone)) return { phone: normalizePhone(s.phone), from: 'student' };
      var r = s.rosterKey ? rosterByKey[s.rosterKey] : null;
      if (r && isFullPhone(r.phone)) return { phone: normalizePhone(r.phone), from: 'roster' };
      return { phone: normalizePhone(s.phone), from: 'incomplete' };
    }

    // 学习数据索引：按 rosterKey 与姓名，便于把学习记录挂到学情表学员上
    var learnByKey = {};
    var learnByName = {};
    work.students.forEach(function (s) {
      if (s.rosterKey) learnByKey[s.rosterKey] = s;
      if (s.name) learnByName[s.name] = s;
    });

    // 以学情表（roster）全量为查询对象：在册学员家长都能凭手机号查到自己的孩子。
    var rosterSource = (work.roster && work.roster.students && work.roster.students.length)
      ? work.roster.students
      : (work.students || []);

    var phoneFull = 0, phoneMissing = 0, withData = 0;
    var students = rosterSource.map(function (r) {
      var ph = normalizePhone(r.phone);
      // 跨设备云端备份会把明文手机号脱敏为 phoneHash，这里优先用明文、否则回退到已存的哈希
      var hash = ph.length >= 11 ? phoneHash(ph) : (r.phoneHash || '');
      var hasPhone = ph.length >= 11 || !!r.phoneHash;
      if (hasPhone) phoneFull++; else phoneMissing++;

      var learn = (r.key && learnByKey[r.key]) || (r.name && learnByName[r.name]) || null;
      var hasReal = !!(learn && learn.stats && learn.stats.score > 0);

      var lessons = {};
      if (hasReal) {
        courses.forEach(function (cn) {
          var l = learn.lessons && learn.lessons[cn];
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
      }
      var st = hasReal ? learn.stats : null;
      if (hasReal) withData++;

      return {
        name: r.name || '',
        id: r.key || r.id || '',
        grade: r.grade || (st ? (learn.grade || '') : ''),
        gender: r.gender || '',
        school: r.school || '',
        phoneHash: hash,
        stats: st ? {
          score: st.score, listen: st.listen, accuracy: st.accuracy,
          homework: st.homework, progress: st.progress, minutes: st.minutes
        } : {
          score: null, listen: null, accuracy: null,
          homework: null, progress: null, minutes: null
        },
        lessons: lessons
      };
    });

    return {
      updatedAt: new Date().toISOString(),
      hashAlgo: 'fnv1a64',
      courseSource: courseSource,
      courseCount: courses.length,
      courses: courses,
      students: students,
      _meta: {
        phoneFull: phoneFull,
        phoneMissing: phoneMissing,
        withData: withData
      }
    };
  }

  var SWBParent = {
    normalizePhone: normalizePhone,
    phoneHash: phoneHash,
    accFloorFor: accFloorFor,
    buildTeacherComment: buildTeacherComment,
    build: build
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SWBParent;
  global.SWBParent = SWBParent;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
