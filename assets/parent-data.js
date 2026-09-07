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

  /** 依据学习数据自动生成教师评语（叙事口吻，与工作台 share-canvas.js 完全一致） */
  function buildTeacherComment(s, courses, accFloorFor) {
    var st = s.stats || {};
    var pct = function (v) { return v == null ? null : Math.round(v * 100); };
    var listen = pct(st.listen);
    var rawAcc = pct(st.accuracy);
    var hw = pct(st.homework);
    var score = pct(st.score) || 0;
    // 真实答题/作业样本数：避免「0题全对显示100%」被尬吹
    var quizAnswer = +(st.quizAnswer || 0);
    var hwAssigned = +(st.hwAssigned || 0);
    var name = s.name || '宝贝';
    var parts = [name + '同学，这一阶段的学习情况老师已经帮你整理好啦。'];

    // 总体基调：按综合分给出真实、可落地的总评
    if (score >= 85) parts.push('整体表现非常优秀，继续保持这份热情和专注🌟');
    else if (score >= 70) parts.push('整体状态不错，再加把劲会更稳，老师看好你💪');
    else if (score >= 50) parts.push('整体还有提升空间，老师陪你一起把薄弱点逐个补上💪');
    else parts.push('目前基础环节还需要加强，老师已经注意到你，会重点关注并陪你赶上来🤝');

    if (listen != null) {
      if (listen >= 90) parts.push('课上有效听课率' + listen + '%，专注度很高，这个好习惯继续保持👍');
      else if (listen >= 70) parts.push('课上有效听课率' + listen + '%，大部分内容都跟上了，继续保持👍');
      else if (listen >= 40) parts.push('课上有效听课率' + listen + '%，听课状态有起伏，上课多互动、紧跟老师节奏会更快进步💪');
      else if (listen >= 10) parts.push('课上有效听课率' + listen + '%，听课参与度还偏低，老师会多提醒你，也请你上课更专注一些💪');
      else parts.push('课上有效听课率' + listen + '%，目前还未有效参与课堂，老师会在课前课后重点关注你，我们一起先把出勤和听课抓起来🤝');
    }
    if (rawAcc != null) {
      if (quizAnswer === 0) {
        parts.push('这一阶段的直播答题暂时还没有参与记录，下次课上记得积极答题，老师也想看到你的真实水平📝');
      } else if (rawAcc >= 85) {
        parts.push('直播答题正确率' + rawAcc + '%，知识点掌握得比较扎实，继续保持👏');
      } else if (rawAcc >= 60) {
        parts.push('直播答题正确率' + rawAcc + '%，基础还在，再多注意审题和错题整理会更好👏');
      } else {
        parts.push('直播答题正确率' + rawAcc + '%，部分知识点还需要再巩固，课后可以多回顾笔记和回放📚');
      }
    }
    if (hw != null) {
      if (hwAssigned === 0) {
        parts.push('这一阶段还没有布置练习，老师会关注后续作业情况📋');
      } else if (hw >= 90) {
        parts.push('练习完成率' + hw + '%，作业完成得很认真，把练习落到实处了👍');
      } else if (hw >= 60) {
        parts.push('练习完成率' + hw + '%，大部分作业都完成了，记得尽量别拖欠👍');
      } else if (hw >= 10) {
        parts.push('练习完成率' + hw + '%，作业完成度偏低，课后及时完成练习才能更好地消化课堂内容💪');
      } else {
        parts.push('练习完成率' + hw + '%，目前练习几乎没有提交，作业是巩固知识的重要环节，请尽快补起来💪');
      }
    }
    return parts.join('');
  }

  /** 导出展示时答题正确率的最低下限（按学员稳定浮动 76~80） */
  function accFloorFor(s) {
    var key = (s.id || '') + '|' + (s.name || '');
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return 76 + (h % 5);
  }

  /** 解析老师自定义评语：学员专属 override 优先，否则按综合分从评语库匹配区间模板 */
  function resolveCustomComment(s, lib, override) {
    var name = (s && s.name) || '宝贝';
    var ov = (override == null ? '' : String(override)).trim();
    if (ov) return ov.replace(/\{name\}/g, name);
    if (!lib || !lib.length) return '';
    var score = Math.round(((s && s.stats && s.stats.score) || 0) * 100);
    for (var i = 0; i < lib.length; i++) {
      var t = lib[i];
      if (!t || !t.text) continue;
      var min = t.min == null ? 0 : +t.min;
      var max = t.max == null ? 100 : +t.max;
      if (score >= min && score <= max) return String(t.text).replace(/\{name\}/g, name);
    }
    return '';
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

    // 阶段知识点映射：course -> points[]（仅保留参与统计的讲次）
    var knowMap = {};
    (work.knowledge || []).forEach(function (k) {
      if (k && k.course && k.points && k.points.length) knowMap[k.course] = k.points;
    });
    var stageKnowledge = [];
    courses.forEach(function (cn) {
      if (knowMap[cn] && knowMap[cn].length) stageKnowledge.push({ course: cn, points: knowMap[cn] });
    });
    var commentLib = work.commentLib || [];

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

      // 阶段知识点与评语：家长端展示用（仅在有真实学习记录时计算评语，知识点对所有学员展示）
      var autoComment = '', customComment = '';
      if (hasReal) {
        var tmpS = { name: r.name || (learn && learn.name) || '', id: r.key || r.id || '', stats: st, lessons: lessons };
        autoComment = buildTeacherComment(tmpS, courses, accFloorFor);
        customComment = resolveCustomComment(tmpS, commentLib, (learn && learn.customComment) || '');
      }

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
        lessons: lessons,
        knowledge: stageKnowledge,
        comment: { auto: autoComment, custom: customComment }
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
    resolveCustomComment: resolveCustomComment,
    build: build
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SWBParent;
  global.SWBParent = SWBParent;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
