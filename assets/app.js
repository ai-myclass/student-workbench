/* ===========================================================
 * app.js —— 界面渲染与交互
 * 支持：学情表档案、自动匹配、习题课剔除、按讲次筛选
 * =========================================================== */
(function () {
  'use strict';

  var U = SWB.util;
  var LS_KEY = 'swb_student_workbench_v2';
  // 家长查询页一键同步相关配置（GitHub 仓库与文件）
  var GH_TOKEN_KEY = 'swb_gh_token';                 // 仅存本机浏览器
  var GH_API_BASE = 'https://api.github.com';
  var GH_REPO = 'ai-myclass/student-workbench';       // owner/repo
  var GH_FILE = 'data/students.json';                 // 家长查询数据源
  var GH_DB_FILE = 'data/teacher-db.json';            // 跨设备同步的云端备份（脱敏：仅含 phoneHash，剔除家庭隐私）
  var GH_VAULT_FILE = 'data/token-vault.json';        // 加密云保险箱：令牌经主口令加密后存放（公开但不可读）
  var VAULT_PASS_KEY = 'swb_vault_pass';              // 本机记住的主口令（仅本机，用于自动解锁）
  var GH_PAGES_URL = 'https://ai-myclass.github.io/student-workbench/query.html';
  var GH_TOKEN_URL = 'https://github.com/settings/tokens/new'; // classic PAT，需 repo 权限
  var ghTokenRaw = '';   // 真实令牌的内存镜像，避免界面遮罩后回存到错误值
  var PALETTE = ['#FF7A59', '#4DA3FF', '#3EC46D', '#FFC53D', '#B57BFF', '#FF8FB1', '#41C7C7', '#FF9F45'];

  /** 分享图可勾选的指标（key 对应lesson对象字段，color 为折线颜色，def 为默认勾选） */
  var SHARE_METRICS = [
    { key: 'listen', label: '有效听课率', color: '#2E8BD6', def: true },
    { key: 'accuracy', label: '答题正确率', color: '#2FB45F', def: true },
    { key: 'homework', label: '练习完成率', color: '#F5793B', def: true },
    { key: 'progress', label: '听课进度', color: '#9B5DE5', def: false },
    { key: 'score', label: '综合得分', color: '#E0A62E', def: false }
  ];

  var db = load();
  var view = 'dashboard';
  var keyword = '';
  var sortBy = 'score';
  var filterGrade = '';
  var filterMatch = '';
  var lessonScope = '';          // '' = 全部正课；否则为某一讲的课程名
  var archiveKw = '';
  var archiveFilter = '';
  var archiveSort = 'name';
  var currentDrawer = null;      // 记录当前打开的学员，供改名 / 改学习数据回填
  var currentLesson = null;      // 记录正在编辑的讲次
  var shareState = null;         // 记录分享图上下文（学员 + 讲次列表）

  /* ---------------- 存储 ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY) || localStorage.getItem('swb_student_workbench_v1');
      if (!raw) return SWB.refresh(SWB.emptyDB());
      var d = JSON.parse(raw);
      if (!d || !d.students) return SWB.refresh(SWB.emptyDB());
      d.courses = d.courses || [];
      d.activeCourses = d.activeCourses || [];
      d.sources = d.sources || [];
      d.roster = d.roster || { students: [], sources: [], updatedAt: null, fields: [] };
      return SWB.refresh(d);
    } catch (e) { return SWB.refresh(SWB.emptyDB()); }
  }
  function save() {
    try {
      var a = db.archive; db.archive = [];
      localStorage.setItem(LS_KEY, JSON.stringify(db));
      db.archive = a;
    } catch (e) { toast('本地存储空间不足，数据未能保存'); }
  }
  /** 重新计算（保持当前统计口径） */
  function recompute() {
    SWB.refresh(db, lessonScope ? [lessonScope] : null);
  }

  /* ---------------- 小工具 ---------------- */
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pct(v, digits) {
    if (v === null || v === undefined) return '—';
    return (v * 100).toFixed(digits === undefined ? 0 : digits) + '%';
  }
  function colorOf(name) {
    var h = 0, s = String(name || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function scoreColor(v) {
    if (v >= 0.85) return '#3EC46D';
    if (v >= 0.70) return '#4DA3FF';
    if (v >= 0.50) return '#FFC53D';
    return '#FF7A59';
  }
  function shortName(name) {
    var s = String(name || '');
    var m = /^(第\d+讲|习题课|第\d+次)/.exec(s);
    return m ? m[1] : s.slice(0, 6);
  }
  function lessonTitle(name) {
    var s = String(name || '');
    return s.replace(/^(第\d+讲|习题课)\s*/, '').slice(0, 22);
  }
  var timer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function hasRoster() { return !!(db.roster && db.roster.students && db.roster.students.length); }
  function rosterByKey(key) {
    var list = (db.roster && db.roster.students) || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function val(v) { return (v && v !== '-') ? v : ''; }
  /** 学员 ID 过长时中间省略，节省档案展示空间 */
  function shortId(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '—';
    if (s.length <= 12) return s;
    return s.slice(0, 8) + '…' + s.slice(-4);
  }
  /** 手机号脱敏显示（保留前 3 后 4），完整号仍可用于搜索匹配 */
  function maskPhone(v) {
    var d = String(v == null ? '' : v).replace(/\D/g, '');
    if (!d) return '—';
    if (d.length === 11) return d.slice(0, 3) + '****' + d.slice(7);
    if (d.length > 4) return d.slice(0, 3) + '****' + d.slice(-4);
    return d;
  }
  /** 学情表「信息登记」状态 */
  function regTag(s) {
    var t = val(s);
    if (!t) return '<span class="tag tag-warn">未登记</span>';
    return t.indexOf('已') === 0
      ? '<span class="tag tag-yes">' + esc(t) + '</span>'
      : '<span class="tag tag-blue">' + esc(t) + '</span>';
  }

  /* =========================================================
   * 渲染总入口
   * ======================================================= */
  function renderAll() {
    renderHeader();
    renderScopeBar();
    renderDashboard();
    renderStudents();
    renderArchive();
    renderData();
  }

  function renderHeader() {
    var has = db.students.length > 0;
    var bits = [];
    if (has) bits.push(db.students.length + ' 名学员');
    if ((db.statCourses || []).length) bits.push(db.statCourses.length + ' 讲正课');
    if (hasRoster()) bits.push(db.roster.students.length + ' 份档案');
    $('#classChip').hidden = !bits.length;
    $('#classChipText').textContent = bits.join(' · ');
    $('#brandSub').textContent = has
      ? '最近更新：' + new Date(db.updatedAt).toLocaleString('zh-CN')
      : '导入班级表格，自动汇总每一讲的学习表现';
  }

  /* =========================================================
   * 讲次筛选
   * ======================================================= */
  function renderScopeBar() {
    var courses = db.statCourses || [];
    var bar = $('#scopeBar');
    if (!db.students.length) { bar.hidden = true; return; }
    bar.hidden = false;

    var sel = $('#filterLesson');
    if (!courses.length) {
      sel.hidden = true;
      $('#scopeHint').innerHTML = '当前没有可统计的正课（' + (db.excludedCourses || []).length +
        ' 讲被剔除规则挡住）' + drillToggleBtn();
      return;
    }
    sel.hidden = false;

    if (lessonScope && courses.indexOf(lessonScope) === -1) lessonScope = '';

    var sel = $('#filterLesson');
    sel.innerHTML = '<option value="">全部讲次（' + courses.length + ' 讲累计）</option>' +
      courses.map(function (cn) {
        return '<option value="' + esc(cn) + '"' + (cn === lessonScope ? ' selected' : '') + '>' +
          esc(shortName(cn)) + ' · ' + esc(lessonTitle(cn)) + '</option>';
      }).join('');
    sel.value = lessonScope;

    var excluded = db.excludedCourses || [];
    var hint = '已剔除 ' + excluded.length + ' 门习题课（不计入统计）';
    if (lessonScope) {
      var i = courses.indexOf(lessonScope) + 1;
      hint = '正在单独查看第 ' + i + ' / ' + courses.length + ' 讲 · ' + hint;
    }
    $('#scopeHint').textContent = hint;
  }

  function drillToggleBtn() {
    return ' <button class="btn btn-ghost btn-sm" data-show-drill="1" style="margin-left:6px">临时显示习题课数据</button>';
  }

  function setScope(cn) {
    lessonScope = cn || '';
    recompute();
    renderAll();
  }

  /* =========================================================
   * 数据看板
   * ======================================================= */
  function renderDashboard() {
    if (!db.students.length) {
      $('#statRow').innerHTML = '';
      $('#trendChart').innerHTML = emptyBlock('还没有数据', '导入学习数据表，或先看看示例数据长什么样', true);
      $('#rankTop').innerHTML = '';
      $('#rankLow').innerHTML = '';
      $('#gradeDist').innerHTML = '<div class="empty-tip">暂无数据</div>';
      $('#attendDist').innerHTML = '<div class="empty-tip">暂无数据</div>';
      $('#trendTitle').textContent = '每一讲的学习趋势';
      $('#attendTitle').textContent = '最近一讲到课情况';
      return;
    }
    if (!(db.statCourses || []).length) {
      $('#statRow').innerHTML = '';
      $('#trendTitle').textContent = '每一讲的学习趋势';
      $('#attendTitle').textContent = '到课情况';
      $('#trendChart').innerHTML = noStatBlock();
      $('#rankTop').innerHTML = '';
      $('#rankLow').innerHTML = '';
      renderGradeDist();
      $('#attendDist').innerHTML = '<div class="empty-tip">暂无可统计的正课</div>';
      return;
    }

    if (lessonScope) renderLessonCards(lessonScope);
    else renderAllCards();

    drawTrend(SWB.courseTrend(db));
    renderRank();
    renderGradeDist();
    renderAttendDist(lessonScope || lastStatCourse());
  }

  function lastStatCourse() {
    var c = db.statCourses || [];
    return c.length ? c[c.length - 1] : null;
  }

  function avg(key) {
    var sum = 0, cnt = 0;
    db.students.forEach(function (s) {
      var v = s.stats[key];
      if (v !== null && v !== undefined) { sum += v; cnt++; }
    });
    return cnt ? sum / cnt : null;
  }

  function renderAllCards() {
    var n = db.students.length;
    var aListen = avg('listen'), aAcc = avg('accuracy'), aHw = avg('homework');
    var aScore = db.students.reduce(function (a, s) { return a + s.stats.score; }, 0) / n;
    var cards = [
      { cls: 's-blue', lbl: '在读学员', num: n, unit: '人', bar: 100, icon: 'people' },
      { cls: 's-green', lbl: '平均有效听课率', num: pct(aListen, 1), bar: (aListen || 0) * 100, icon: 'eye' },
      { cls: 's-orange', lbl: '平均答题正确率', num: pct(aAcc, 1), bar: (aAcc || 0) * 100, icon: 'check' },
      { cls: 's-purple', lbl: '练习完成率', num: pct(aHw, 1), bar: (aHw || 0) * 100, icon: 'book' },
      { cls: 's-yellow', lbl: '班级综合得分', num: pct(aScore, 1), bar: aScore * 100, icon: 'star' }
    ];
    $('#statRow').innerHTML = statCards(cards);
    $('#trendTitle').textContent = '每一讲的学习趋势';
    $('#attendTitle').textContent = '最近一讲到课情况';
  }

  function renderLessonCards(cn) {
    var bd = SWB.courseBreakdown(db, cn);
    var n = db.students.length || 1;
    var cards = [
      { cls: 's-blue', lbl: '应到学员', num: n, unit: '人', bar: 100, icon: 'people' },
      { cls: 's-green', lbl: '有效听课', num: bd.effective, unit: '人', bar: bd.effective / n * 100, icon: 'eye' },
      { cls: 's-orange', lbl: '答题正确率', num: bd.quizAnswer ? pct(bd.quizRight / bd.quizAnswer, 1) : '—', bar: bd.quizAnswer ? bd.quizRight / bd.quizAnswer * 100 : 0, icon: 'check' },
      { cls: 's-purple', lbl: '练习完成', num: bd.hwAssigned ? bd.hwDone + '/' + bd.hwAssigned : '—', bar: bd.hwAssigned ? bd.hwDone / bd.hwAssigned * 100 : 0, icon: 'book' },
      { cls: 's-yellow', lbl: '人均听课时长', num: Math.round(bd.avgMinutes), unit: '分钟', bar: Math.min(100, bd.avgMinutes / 90 * 100), icon: 'star' }
    ];
    $('#statRow').innerHTML = statCards(cards);
    $('#trendTitle').textContent = '全部讲次趋势（高亮：' + shortName(cn) + '）';
    $('#attendTitle').textContent = shortName(cn) + ' 到课情况';
  }

  function statCards(cards) {
    return cards.map(function (c) {
      return '<div class="stat ' + c.cls + '">' +
        '<div class="ico">' + icon(c.icon) + '</div>' +
        '<div class="num">' + esc(c.num) + (c.unit ? '<small>' + c.unit + '</small>' : '') + '</div>' +
        '<div class="lbl">' + esc(c.lbl) + '</div>' +
        '<div class="bar"><i style="width:' + Math.max(2, Math.min(100, c.bar)) + '%"></i></div>' +
        '</div>';
    }).join('');
  }

  function icon(name) {
    var s = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    var p = {
      people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 14.4c2 .7 3.5 2.5 3.5 4.6"/>',
      eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
      check: '<path d="M4 12.5 9 17.5 20 6.5"/>',
      book: '<path d="M4 5.5A2 2 0 0 1 6 4h13v14H6a2 2 0 0 0-2 2z"/><path d="M4 18.5A2 2 0 0 1 6 17h13"/>',
      star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'
    };
    return s + (p[name] || p.star) + '</svg>';
  }

  function emptyBlock(title, sub, withDemo) {
    return '<div style="text-align:center;padding:40px 0;color:#A49CB8">' +
      '<svg viewBox="0 0 120 90" width="130" style="opacity:.8">' +
      '<ellipse cx="60" cy="78" rx="26" ry="5" fill="#F0E7F5"/>' +
      '<path d="M60 8c9 7 13 17 13 29 0 8-2 14-5 20H52c-3-6-5-12-5-20C47 25 51 15 60 8z" fill="#FFD9CB"/>' +
      '<circle cx="60" cy="30" r="7" fill="#fff"/><circle cx="60" cy="30" r="4.5" fill="#B9C7D6"/>' +
      '<path d="M47 38c-6 2-10 8-11 15l9-4z" fill="#CFE3F5"/>' +
      '<path d="M73 38c6 2 10 8 11 15l-9-4z" fill="#CFE3F5"/>' +
      '</svg>' +
      '<div style="font-weight:800;color:#6B6285;margin-top:6px">' + esc(title) + '</div>' +
      '<div style="font-size:12.5px;margin-top:4px">' + esc(sub) + '</div>' +
      (withDemo ? '<div style="margin-top:14px;display:flex;gap:10px;justify-content:center">' +
        '<button class="btn btn-primary" data-demo="1">载入示例数据</button>' +
        '<button class="btn btn-ghost" data-goto-import="1">去导入表格</button></div>' : '') +
      '</div>';
  }

  function noStatBlock() {
    var ex = db.excludedCourses || [];
    var activeEx = (db.activeCourses || []).filter(function (c) { return ex.indexOf(c) !== -1; });
    var kws = (SWB.settings(db).excludeKeywords || []).join('、') || '（空）';
    return '<div style="text-align:center;padding:36px 0;color:#A49CB8">' +
      '<svg viewBox="0 0 120 90" width="130" style="opacity:.8">' +
      '<ellipse cx="60" cy="78" rx="26" ry="5" fill="#F0E7F5"/>' +
      '<path d="M60 8c9 7 13 17 13 29 0 8-2 14-5 20H52c-3-6-5-12-5-20C47 25 51 15 60 8z" fill="#FFD9CB"/>' +
      '<circle cx="60" cy="30" r="7" fill="#fff"/><circle cx="60" cy="30" r="4.5" fill="#B9C7D6"/>' +
      '<path d="M47 38c-6 2-10 8-11 15l9-4z" fill="#CFE3F5"/>' +
      '<path d="M73 38c6 2 10 8 11 15l-9-4z" fill="#CFE3F5"/>' +
      '</svg>' +
      '<div style="font-weight:800;color:#6B6285;margin-top:6px">当前没有可统计的正课</div>' +
      '<div style="font-size:12.5px;margin-top:4px;line-height:1.7">' +
      (activeEx.length
        ? '已开课的 ' + activeEx.length + ' 讲全部命中了剔除规则（' + esc(kws) + '），所以不计入统计。'
        : '导入的表格里还没有已开课的讲次。') +
      '</div>' +
      (activeEx.length
        ? '<div style="margin-top:14px"><button class="btn btn-primary" data-show-drill="1">临时把习题课纳入统计</button></div>'
        : '') +
      '</div>';
  }

  /* ---------- 趋势折线图（单讲时高亮） ---------- */
  function drawTrend(trend) {
    var box = $('#trendChart');
    if (!trend.length) { box.innerHTML = emptyBlock('还没有已开课的正课', '导入表格后会自动统计每一讲'); return; }

    var n = trend.length;
    var W = Math.max(760, 90 + n * 64), H = 290;
    var padL = 46, padR = 20, padT = 18, padB = 56;
    var iw = W - padL - padR, ih = H - padT - padB;
    var x = function (i) { return n === 1 ? padL + iw / 2 : padL + iw * i / (n - 1); };
    var y = function (v) { return padT + ih * (1 - v); };

    var hi = lessonScope ? trend.findIndex(function (t) { return t.name === lessonScope; }) : -1;
    var g = '';

    // 高亮列
    if (hi >= 0) {
      g += '<rect x="' + (x(hi) - 26).toFixed(1) + '" y="' + padT + '" width="52" height="' + ih +
        '" rx="14" fill="#FFF0E4"/>';
    }

    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      g += '<line x1="' + padL + '" y1="' + y(t).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(t).toFixed(1) +
        '" stroke="#F0E7F5" stroke-width="1.5"/>';
      g += '<text x="' + (padL - 10) + '" y="' + (y(t) + 4).toFixed(1) + '" font-size="11" fill="#A49CB8" text-anchor="end">' + (t * 100) + '%</text>';
    });

    function series(key, color) {
      var pts = [], dots = '', d = '', started = false;
      trend.forEach(function (t, i) {
        var v = t[key];
        if (v === null || v === undefined) { started = false; return; }
        var px = x(i).toFixed(1), py = y(v).toFixed(1);
        d += (started ? ' L' : (started = true, 'M')) + px + ' ' + py;
        var isHi = (i === hi);
        dots += '<circle cx="' + px + '" cy="' + py + '" r="' + (isHi ? 6.5 : 4.5) + '" fill="' +
          (isHi ? color : '#fff') + '" stroke="' + color + '" stroke-width="' + (isHi ? 3 : 2.6) + '">' +
          '<title>' + esc(t.name) + '\n' + pct(v, 1) + '</title></circle>';
      });
      return { path: d, dots: dots };
    }
    var s1 = series('listen', '#4DA3FF'), s2 = series('accuracy', '#3EC46D'), s3 = series('homework', '#FF7A59');

    var labels = trend.map(function (t, i) {
      if (n > 16 && i % 2 === 1 && i !== hi) return '';
      var c1 = i === hi ? '#FF7A59' : '#6B6285';
      return '<text x="' + x(i).toFixed(1) + '" y="' + (H - padB + 22) + '" font-size="11" fill="' + c1 +
        '" font-weight="' + (i === hi ? 800 : 400) + '" text-anchor="middle">' + esc(shortName(t.name)) + '</text>' +
        '<text x="' + x(i).toFixed(1) + '" y="' + (H - padB + 38) + '" font-size="10" fill="#C3BBDA" text-anchor="middle">' +
        esc(t.name.replace(/^第\d+讲\s*/, '').slice(0, 8)) + '</text>';
    }).join('');

    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" style="max-width:none">' +
      g +
      '<path d="' + s1.path + '" fill="none" stroke="#4DA3FF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="' + s2.path + '" fill="none" stroke="#3EC46D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="' + s3.path + '" fill="none" stroke="#FF7A59" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      s1.dots + s2.dots + s3.dots +
      labels + '</svg>';
  }

  /* ---------- 排行榜 ---------- */
  function renderRank() {
    var pool = rankPool();
    var list = pool.slice().sort(function (a, b) { return b.stats.score - a.stats.score; });
    var top = list.slice(0, 5);
    var low = list.slice(-5).reverse().filter(function (s) { return top.indexOf(s) === -1; });

    var scopeTxt = lessonScope ? shortName(lessonScope) + '单讲' : '综合';
    $('#rankTopTitle').textContent = lessonScope ? '本讲小明星' : '学习小明星';
    $('#rankLowTitle').textContent = lessonScope ? '本讲要多关注' : '需要多关注';

    $('#rankTop').innerHTML = top.length ? top.map(function (s, i) { return rankRow(s, i + 1); }).join('')
      : '<div class="empty-tip">暂无数据</div>';
    $('#rankLow').innerHTML = low.length ? low.map(function (s, i) { return rankRow(s, i + 1); }).join('')
      : '<div class="empty-tip">班级规模较小，暂无榜单</div>';
    void scopeTxt;
  }
  function rankPool() {
    if (!db.settings.onlyRoster || !hasRoster()) return db.students;
    return db.students.filter(function (s) { return s.rosterMatched; });
  }
  function rankRow(s, no) {
    var st = s.stats;
    var meta = lessonScope
      ? esc(val(s.grade) || '未填年级') + ' · 听课 ' + Math.round(st.minutes) + ' 分钟 · 答题 ' + st.quizRight + '/' + st.quizAnswer
      : esc(val(s.grade) || '未填年级') + ' · 听课 ' + pct(st.listen) + ' · 练习 ' + pct(st.homework);
    return '<li class="rank-item" data-id="' + esc(s.id) + '">' +
      '<span class="rank-no">' + no + '</span>' +
      '<span class="avatar" style="background:' + colorOf(s.name) + '">' + esc(s.name.slice(0, 1)) + '</span>' +
      '<span class="rank-main"><span class="rank-name">' + esc(s.name) + '</span>' +
      '<span class="rank-meta">' + meta + '</span></span>' +
      '<span class="rank-score" style="color:' + scoreColor(st.score) + '">' + (st.score * 100).toFixed(0) + '<small> 分</small></span>' +
      '</li>';
  }

  /* ---------- 年级分布 ---------- */
  function renderGradeDist() {
    var map = {}, order = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三'];
    db.students.forEach(function (s) {
      var g = val(s.grade) || '未填写';
      map[g] = (map[g] || 0) + 1;
    });
    var keys = Object.keys(map).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return map[b] - map[a];
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    var max = Math.max.apply(null, keys.map(function (k) { return map[k]; })) || 1;
    var colors = ['#4DA3FF', '#3EC46D', '#FFC53D', '#B57BFF', '#FF7A59', '#FF8FB1', '#41C7C7'];
    $('#gradeDist').innerHTML = keys.map(function (k, i) {
      return '<div class="dist-row"><span class="dist-label">' + esc(k) + '</span>' +
        '<span class="dist-track"><i style="width:' + (map[k] / max * 100) + '%;background:' + colors[i % colors.length] + '"></i></span>' +
        '<span class="dist-val">' + map[k] + ' 人</span></div>';
    }).join('');
  }

  /* ---------- 到课情况分布 ---------- */
  function renderAttendDist(cn) {
    if (!cn) { $('#attendDist').innerHTML = '<div class="empty-tip">暂无已开课正课</div>'; return; }
    var bd = SWB.courseBreakdown(db, cn);
    var n = db.students.length || 1;
    var rows = [
      { k: '有效听课', v: bd.effective, c: '#3EC46D' },
      { k: '到课未达标', v: bd.attendedOnly, c: '#FFC53D' },
      { k: '未到课', v: bd.absent, c: '#C9C2DA' },
      { k: '练习已交', v: bd.hwDone, c: '#4DA3FF' }
    ];
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; })) || 1;
    $('#attendDist').innerHTML =
      '<div style="font-size:12.5px;color:#6B6285;font-weight:700;margin-bottom:6px">' + esc(cn) + '</div>' +
      rows.map(function (r) {
        return '<div class="dist-row"><span class="dist-label">' + r.k + '</span>' +
          '<span class="dist-track"><i style="width:' + (r.v / max * 100) + '%;background:' + r.c + '"></i></span>' +
          '<span class="dist-val">' + r.v + '/' + n + '</span></div>';
      }).join('') +
      '<div style="margin-top:6px;font-size:12px;color:#A49CB8">人均听课 ' + Math.round(bd.avgMinutes) +
      ' 分钟 · 平均进度 ' + Math.round(bd.progress) + '% · 答题 ' + bd.quizRight + '/' + bd.quizAnswer + '</div>';
  }

  /* =========================================================
   * 学员名单
   * ======================================================= */
  function nullVal(v) { return v === null || v === undefined ? -1 : v; }

  function matchKeyword(kw, name, id, phone, nick) {
    if (!kw) return true;
    var k = kw.toLowerCase();
    var digits = kw.replace(/\D/g, '');
    if (String(name || '').toLowerCase().indexOf(k) !== -1) return true;
    if (String(nick || '').toLowerCase().indexOf(k) !== -1) return true;
    if (String(id || '').toLowerCase().indexOf(k) !== -1) return true;
    if (digits && String(phone || '').replace(/\D/g, '').indexOf(digits) !== -1) return true;
    if (String(phone || '').toLowerCase().indexOf(k) !== -1) return true;
    return false;
  }

  function filtered() {
    var list = db.students.filter(function (s) {
      if (filterGrade && (val(s.grade) || '未填写') !== filterGrade) return false;
      if (filterMatch === 'yes' && !s.rosterMatched) return false;
      if (filterMatch === 'no' && s.rosterMatched) return false;
      return matchKeyword(keyword.trim(), s.name, s.id, s.phone, s.nickname);
    });
    var cmp = {
      score: function (a, b) { return b.stats.score - a.stats.score; },
      score_asc: function (a, b) { return a.stats.score - b.stats.score; },
      listen: function (a, b) { return b.stats.listen - a.stats.listen; },
      accuracy: function (a, b) { return nullVal(b.stats.accuracy) - nullVal(a.stats.accuracy); },
      homework: function (a, b) { return nullVal(b.stats.homework) - nullVal(a.stats.homework); },
      minutes: function (a, b) { return b.stats.minutes - a.stats.minutes; },
      name: function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh-CN'); }
    };
    return list.sort(cmp[sortBy] || cmp.score);
  }

  function renderStudents() {
    // 年级选项
    var grades = {};
    db.students.forEach(function (s) { grades[val(s.grade) || '未填写'] = 1; });
    var sel = $('#filterGrade');
    sel.innerHTML = '<option value="">全部年级</option>' + Object.keys(grades).map(function (g) {
      return '<option value="' + esc(g) + '"' + (g === filterGrade ? ' selected' : '') + '>' + esc(g) + '</option>';
    }).join('');

    // 匹配筛选（有学情表才显示）
    var fm = $('#filterMatch');
    fm.hidden = !hasRoster();
    fm.value = filterMatch;
    $('#sortBy').value = sortBy;

    var head = lessonScope
      ? ['学员', '学员 ID', '手机号', '年级', '匹配', '到课', '有效听课', '答题', '正确率', '练习', '听课时长', '综合']
      : ['学员', '学员 ID', '手机号', '性别', '年级', '匹配', '有效听课率', '答题正确率', '练习完成率', '综合'];
    $('#stuHead').innerHTML = head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('');

    var list = filtered();
    var body = $('#stuBody');
    var colspan = head.length;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="' + colspan + '"><div class="empty-tip">' +
        (db.students.length ? '没有匹配的学员，换个关键词试试'
          : '还没有学员数据 ——<br><button class="btn btn-primary" data-demo="1" style="margin-top:12px">载入示例数据</button>') +
        '</div></td></tr>';
    } else {
      body.innerHTML = list.map(function (s) {
        var st = s.stats;
        var gCls = s.gender === '男' ? 'pill-boy' : (s.gender === '女' ? 'pill-girl' : 'pill-none');
        var base = '<tr data-id="' + esc(s.id) + '">' +
          '<td><div class="cell-stu"><span class="avatar" style="background:' + colorOf(s.name) + '">' + esc(s.name.slice(0, 1)) + '</span>' +
          '<span><div class="cell-name">' + esc(s.name) + '</div>' +
          '<div class="cell-sub">' + esc(s.nickname ? '昵称 ' + s.nickname : (val(s.region) || '')) + '</div></span></div></td>' +
          '<td class="mono" title="' + esc(s.id || '') + '">' + shortId(s.id) + '</td>' +
          '<td class="mono" title="' + esc(s.phone || '') + '">' + maskPhone(s.phone) + '</td>';

        if (lessonScope) {
          var l = s.lessons[lessonScope] || {};
          base += '<td class="grade-tag">' + esc(val(s.grade) || '—') + '</td>' +
            matchBadge(s) +
            '<td>' + (l.attended ? '<span class="tag tag-yes">到课</span>' : '<span class="tag tag-no">未到</span>') + '</td>' +
            '<td>' + (l.effective ? '<span class="tag tag-yes">有效</span>' : '<span class="tag tag-no">—</span>') + '</td>' +
            '<td class="mono">' + (l.quizRight || 0) + '/' + (l.quizAnswer || 0) + '</td>' +
            '<td>' + mini(l.quizAnswer ? (l.accuracy || 0) / 100 : null, '#3EC46D') + '</td>' +
            '<td>' + hwTag(l.hwStatus) + '</td>' +
            '<td class="mono">' + (l.durationMin || 0) + ' 分</td>' +
            '<td><span class="score-badge" style="background:' + scoreColor(st.score) + '">' + (st.score * 100).toFixed(0) + '</span></td>';
        } else {
          base += '<td><span class="pill ' + gCls + '">' + esc(val(s.gender) || '未填') + '</span></td>' +
            '<td class="grade-tag">' + esc(val(s.grade) || '—') + '</td>' +
            matchBadge(s) +
            '<td>' + mini(st.listen, '#4DA3FF') + '</td>' +
            '<td>' + mini(st.accuracy, '#3EC46D') + '</td>' +
            '<td>' + mini(st.homework, '#FF7A59') + '</td>' +
            '<td><span class="score-badge" style="background:' + scoreColor(st.score) + '">' + (st.score * 100).toFixed(0) + '</span></td>';
        }
        return base + '</tr>';
      }).join('');
    }
    $('#tableCount').textContent = db.students.length
      ? '显示 ' + list.length + ' / ' + db.students.length + ' 名学员' +
        (lessonScope ? '（统计范围：' + shortName(lessonScope) + '）' : '')
      : '';
  }

  function matchBadge(s) {
    if (!hasRoster()) return '';
    return '<td>' + (s.rosterMatched
      ? '<span class="tag tag-yes">已建档</span>'
      : '<span class="tag tag-warn">未匹配</span>') + '</td>';
  }
  function hwTag(status) {
    if (U.isUnassigned(status)) return '<span class="tag tag-no">未布置</span>';
    return U.isHwDone(status)
      ? '<span class="tag tag-yes">' + esc(status) + '</span>'
      : '<span class="tag tag-warn">' + esc(status || '未提交') + '</span>';
  }
  function mini(v, color) {
    if (v === null || v === undefined) return '<span class="mini-num" style="color:#C3BBDA">—</span>';
    return '<span class="mini"><span class="mini-track"><i style="width:' + (v * 100).toFixed(0) + '%;background:' + color + '"></i></span>' +
      '<span class="mini-num">' + (v * 100).toFixed(0) + '%</span></span>';
  }

  /* =========================================================
   * 学员档案
   * ======================================================= */
  function archiveFiltered() {
    var list = (db.archive || []).filter(function (a) {
      if (archiveFilter === 'linked' && a.noData) return false;
      if (archiveFilter === 'nodata' && !a.noData) return false;
      var r = a.roster || a.student || {};
      return matchKeyword(archiveKw.trim(), r.name, r.id, r.phone, r.nickname);
    });
    var cmp = {
      name: function (a, b) { return String((a.roster || a.student).name).localeCompare(String((b.roster || b.student).name), 'zh-CN'); },
      score: function (a, b) { return b.stats.score - a.stats.score; },
      score_asc: function (a, b) { return a.stats.score - b.stats.score; },
      listen: function (a, b) { return b.stats.listen - a.stats.listen; },
      grade: function (a, b) {
        return String((a.roster || a.student).grade || '').localeCompare(String((b.roster || b.student).grade || ''), 'zh-CN');
      }
    };
    return list.sort(cmp[archiveSort] || cmp.name);
  }

  function renderArchive() {
    $('#archiveFilter').value = archiveFilter;
    $('#archiveSort').value = archiveSort;

    var sub = hasRoster()
      ? '共 ' + db.roster.students.length + ' 份档案 · 已匹配学习数据 ' + (db.rosterMatched || 0) + ' 人' +
        (db.roster.updatedAt ? ' · 更新于 ' + new Date(db.roster.updatedAt).toLocaleString('zh-CN') : '')
      : '导入学情表后自动生成（未导入时显示学习数据里的学员）';
    $('#archiveSub').textContent = sub;

    var list = archiveFiltered();
    var body = $('#archiveBody');
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="11"><div class="empty-tip">' +
        (hasRoster() ? '没有匹配的档案，换个关键词试试'
          : '还没有学情表 ——<br><button class="btn btn-primary" data-goto-import="1" style="margin-top:12px">去导入学情表</button>') +
        '</div></td></tr>';
    } else {
      body.innerHTML = list.map(function (a) {
        var r = a.roster || a.student || {};
        var st = a.stats;
        var gCls = r.gender === '男' ? 'pill-boy' : (r.gender === '女' ? 'pill-girl' : 'pill-none');
        return '<tr data-key="' + esc(a.key) + '">' +
          '<td><div class="cell-stu"><span class="avatar" style="background:' + colorOf(r.name) + '">' + esc((r.name || '?').slice(0, 1)) + '</span>' +
          '<span><div class="cell-name">' + esc(r.name || '—') + '</div>' +
          '<div class="cell-sub">' + esc([val(r.school), val(r.klass)].filter(Boolean).join(' · ') || val(r.level) || '') + '</div></span></div></td>' +
          '<td class="mono" title="' + esc(r.id || '') + '">' + shortId(r.id) + '</td>' +
          '<td class="mono" title="' + esc(r.phone || '') + '">' + maskPhone(r.phone) + '</td>' +
          '<td><span class="pill ' + gCls + '">' + esc(val(r.gender) || '未填') + '</span></td>' +
          '<td class="grade-tag">' + esc(val(r.grade) || '—') + '</td>' +
          '<td>' + regTag(r.regStatus) + '</td>' +
          '<td>' + (a.noData
            ? '<span class="tag tag-no">暂无学习数据</span>'
            : '<span class="tag tag-yes">已匹配</span>') + '</td>' +
          (a.noData
            ? '<td colspan="3" class="mono" style="color:#C3BBDA">—</td><td><span class="score-badge" style="background:#C9C2DA">—</span></td>'
            : '<td>' + mini(st.listen, '#4DA3FF') + '</td>' +
              '<td>' + mini(st.accuracy, '#3EC46D') + '</td>' +
              '<td>' + mini(st.homework, '#FF7A59') + '</td>' +
              '<td><span class="score-badge" style="background:' + scoreColor(st.score) + '">' + (st.score * 100).toFixed(0) + '</span></td>') +
          '</tr>';
      }).join('');
    }
    $('#archiveCount').textContent = (db.archive || []).length
      ? '显示 ' + list.length + ' / ' + db.archive.length + ' 份档案'
      : '';
  }

  /* =========================================================
   * 学员详情抽屉
   * ======================================================= */
  function openStudent(id) {
    var s = null;
    for (var i = 0; i < db.students.length; i++) if (db.students[i].id === id) s = db.students[i];
    if (!s) return;
    var r = s.rosterKey ? rosterByKey(s.rosterKey) : null;
    currentDrawer = { key: 's:' + id, student: s, roster: r, noData: false };
    renderDrawer({ student: s, roster: r, stats: s.stats });
  }
  function openArchiveItem(key) {
    var a = null;
    for (var i = 0; i < (db.archive || []).length; i++) if (db.archive[i].key === key) a = db.archive[i];
    if (!a) return;
    currentDrawer = { key: key, student: a.student, roster: a.roster, noData: a.noData };
    renderDrawer({ student: a.student, roster: a.roster, stats: a.stats, noData: a.noData });
  }
  function closeDrawer() {
    $('#drawer').hidden = true;
    $('#drawerMask').hidden = true;
    document.body.style.overflow = '';
  }

  /** 用当前上下文重绘抽屉（改名 / 改学习数据后保留打开状态） */
  function redrawDrawer() {
    if (!currentDrawer) return;
    var c = currentDrawer;
    renderDrawer({
      student: c.student,
      roster: c.roster,
      stats: c.student ? c.student.stats : SWB.emptyStats(),
      noData: !c.student
    });
  }

  /* ---------------- 改名 ---------------- */
  function startRename() {
    var box = $('#drawerContent .profile-name');
    if (!box) return;
    var cur = (currentDrawer && currentDrawer.roster && currentDrawer.roster.name) ||
      (currentDrawer && currentDrawer.student && currentDrawer.student.name) || '';
    box.innerHTML = '<input id="renameInput" class="rename-input" value="' + esc(cur) + '" maxlength="20">' +
      '<button class="mini-btn ok" id="renameSave">保存</button><button class="mini-btn" id="renameCancel">取消</button>';
    var inp = $('#renameInput'); inp.focus(); inp.select();
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doRename();
      if (e.key === 'Escape') redrawDrawer();
    });
    $('#renameSave').addEventListener('click', doRename);
    $('#renameCancel').addEventListener('click', redrawDrawer);
  }
  function doRename() {
    var inp = $('#renameInput'); if (!inp || !currentDrawer) return;
    var v = (inp.value || '').trim();
    if (!v) { toast('姓名不能为空'); return; }
    if (currentDrawer.student) currentDrawer.student.name = v;
    if (currentDrawer.roster) currentDrawer.roster.name = v;
    recompute(); save(); renderAll(); redrawDrawer();
    toast('姓名已更新');
  }

  /* ---------------- 修改某一讲学习数据 ---------------- */
  function opt(items, sel) {
    return items.map(function (it) {
      return '<option value="' + esc(it[0]) + '"' + (it[0] === sel ? ' selected' : '') + '>' + esc(it[1]) + '</option>';
    }).join('');
  }
  function field(label, control) {
    return '<label class="edit-field"><span class="ef-label">' + esc(label) + '</span><span class="ef-ctrl">' + control + '</span></label>';
  }
  function openLessonEditor(cn, s) {
    if (!s) { toast('该学员暂无学习数据，无法编辑'); return; }
    var l = s.lessons[cn] || (s.lessons[cn] = {});
    currentLesson = { cn: cn, student: s };
    $('#editTitle').textContent = '修改学习数据 · ' + shortName(cn);
    $('#editBody').innerHTML =
      field('到课', '<select name="att">' + opt([['1', '是'], ['0', '否']], l.attended ? '1' : '0') + '</select>') +
      field('有效听课', '<select name="eff">' + opt([['1', '是'], ['0', '否']], l.effective ? '1' : '0') + '</select>') +
      field('答题正确数', '<input type="number" name="qr" min="0" value="' + (l.quizRight || 0) + '">') +
      field('答题总数', '<input type="number" name="qa" min="0" value="' + (l.quizAnswer || 0) + '">') +
      field('练习完成', '<select name="hw">' + opt([['已提交', '已完成'], ['未提交', '未完成'], ['未布置', '未布置']], l.hwStatus || '未布置') + '</select>') +
      '<div class="edit-actions"><button class="btn btn-primary btn-sm" id="editSave">保存</button>' +
      '<button class="btn btn-ghost btn-sm" id="editCancel">取消</button></div>';
    $('#editMask').hidden = false; $('#editModal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function saveLesson() {
    var c = currentLesson; if (!c) return;
    var body = $('#editBody');
    var l = c.student.lessons[c.cn] || (c.student.lessons[c.cn] = {});
    l.attended = body.querySelector('[name=att]').value === '1';
    l.effective = body.querySelector('[name=eff]').value === '1';
    var qa = Math.max(0, parseInt(body.querySelector('[name=qa]').value || '0', 10) || 0);
    var qr = Math.max(0, parseInt(body.querySelector('[name=qr]').value || '0', 10) || 0);
    if (qr > qa) qr = qa;
    l.quizAnswer = qa; l.quizRight = qr;
    l.accuracy = qa > 0 ? qr / qa * 100 : 0;
    l.hwStatus = body.querySelector('[name=hw]').value;
    closeEditModal();
    recompute(); save(); renderAll(); redrawDrawer();
    toast('学习数据已更新');
  }
  function closeEditModal() {
    $('#editMask').hidden = true; $('#editModal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------------- 生成学习情况分享图 ---------------- */
  /** 单个讲次的综合得分（与全班综合分同权：有效听课 0.35 / 答题 0.30 / 练习 0.35） */
  function lessonScore(l) { return SWBShare.lessonScore(l); }
  /** 取某个指标在单讲上的取值（0~1，缺失返回 null） */
  function lessonVal(key, l) { return SWBShare.lessonVal(key, l); }

  function openShare() {
    if (!currentDrawer) return;
    var s = currentDrawer.student;
    if (!s || !Object.keys(s.lessons || {}).length) { toast('该学员暂无学习数据，无法生成分享图'); return; }
    var courses = (db.statCourses && db.statCourses.length) ? db.statCourses : db.courses;
    if (!courses.length) { toast('还没有可统计的讲次'); return; }
    shareState = { student: s, courses: courses };
    $('#shareOpts').innerHTML = SHARE_METRICS.map(function (m) {
      return '<label class="share-opt"><input type="checkbox" data-metric="' + m.key + '"' + (m.def ? ' checked' : '') + '>' +
        '<span class="sw-dot" style="background:' + m.color + '"></span>' + m.label + '</label>';
    }).join('');
    $('#shareMask').hidden = false;
    $('#shareModal').hidden = false;
    document.body.style.overflow = 'hidden';
    drawShareImage();
  }
  function closeShare() {
    $('#shareMask').hidden = true;
    $('#shareModal').hidden = true;
    document.body.style.overflow = '';
    shareState = null;
  }
  /** 圆角矩形路径 */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  /** 导出展示时答题正确率的最低下限（76%~80% 之间，按学员稳定浮动） */
  function accFloorFor(s) { return SWBShare.accFloorFor(s); }

  /** 依据学习数据自动生成教师评语（亲切、鼓励、有温度） */
  function buildTeacherComment(s, courses) { return SWBShare.buildTeacherComment(s, courses); }
  function avg(arr) { var t = 0; arr.forEach(function (v) { t += v; }); return t / arr.length; }
  function wrapText(ctx, text, maxW) {
    var out = [], line = '';
    for (var i = 0; i < text.length; i++) {
      var t = line + text[i];
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = text[i]; }
      else line = t;
    }
    if (line) out.push(line);
    return out;
  }

  function drawShareImage() {
    if (!shareState) return;
    var cv = $('#shareCanvas');
    var s = shareState.student, courses = shareState.courses;
    var showChips = $('#shareChips').checked;
    var chosen = {};
    SHARE_METRICS.forEach(function (m) {
      var cb = $('#shareOpts').querySelector('[data-metric="' + m.key + '"]');
      chosen[m.key] = !!(cb && cb.checked);
    });
    SWBShare.draw(cv, s, courses, { metrics: chosen, showChips: showChips });
  }
  function shareDownload() {
    if (!shareState) return;
    var cv = $('#shareCanvas');
    try {
      var url = cv.toDataURL('image/png');
      var a = document.createElement('a');
      a.href = url;
      a.download = '学习分享_' + (shareState.student.name || '学员') + '_' +
        new Date().toISOString().slice(0, 10) + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast('分享图已导出');
    } catch (e) { toast('导出失败：' + (e.message || e)); }
  }

  function renderDrawer(ctx) {
    var s = ctx.student;
    var r = ctx.roster;
    var st = ctx.stats || SWB.emptyStats();
    var noData = !!ctx.noData || !s;

    // 档案优先、学习数据兜底
    var info = {
      name: (r && r.name) || (s && s.name) || '未命名',
      id: (s && s.id) || (r && r.id) || '',
      phone: (r && r.phone) || (s && s.phone) || '',
      gender: (r && r.gender) || (s && s.gender) || '',
      grade: (r && r.grade) || (s && s.grade) || '',
      school: (r && r.school) || (s && s.school) || '',
      klass: (r && r.klass) || (s && s.klass) || '',
      region: (r && r.region) || (s && s.region) || '',
      level: (r && r.level) || (s && s.level) || '',
      joinAt: (r && r.joinAt) || (s && s.joinAt) || '',
      guardian: (r && r.guardian) || (s && s.guardian) || '',
      address: (r && r.address) || (s && s.address) || '',
      renewStatus: (s && s.renewStatus) || (r && r.renewStatus) || '',
      lastLesson: (s && s.lastLesson) || ''
    };

    var badge = noData
      ? '<span class="tag tag-warn">暂无学习数据</span>'
      : (r ? '<span class="tag tag-yes">档案已匹配</span>' : '<span class="tag tag-no">未在学情表中</span>');

    var rings = [
      { l: '有效听课率', v: st.listen, c: '#4DA3FF' },
      { l: '答题正确率', v: st.accuracy, c: '#3EC46D' },
      { l: '练习完成率', v: st.homework, c: '#FF7A59' },
      { l: '综合得分', v: st.score, c: '#B57BFF' }
    ];

    var infoRows = [
      ['学员 ID', shortId(info.id), info.id], ['手机号', maskPhone(info.phone), info.phone],
      ['性别', info.gender], ['年级', info.grade],
      ['学校', info.school], ['班级', info.klass], ['地区', info.region], ['分层', info.level],
      ['进班时间', info.joinAt], ['家长', info.guardian], ['收货地址', info.address],
      ['续班状态', info.renewStatus], ['最近课节', info.lastLesson]
    ].filter(function (p) { return val(p[1]); });

    // 学情表里额外的字段
    var extraHtml = '';
    if (r && r.extra) {
      var keys = Object.keys(r.extra);
      if (keys.length) {
        extraHtml = '<div class="info-item" style="grid-column:1/-1"><div class="k">学情表其它字段</div>' +
          '<div class="v" style="font-size:12.5px;line-height:1.8;font-weight:600">' +
          keys.map(function (k) { return esc(k) + '：' + esc(r.extra[k]); }).join('<br>') +
          '</div></div>';
      }
    }

    var html =
      '<div class="profile">' +
        '<span class="avatar" style="background:' + colorOf(info.name) + '">' + esc(info.name.slice(0, 1)) + '</span>' +
        '<span class="profile-main"><div class="profile-name">' + esc(info.name) + ' ' + badge + '</div>' +
        '<div class="profile-sub">' + esc([info.grade, info.gender, info.school, info.klass].filter(function (x) { return val(x); }).join(' · ') || '信息待完善') + '</div></span>' +
        '<button class="mini-btn" id="btnShare">📊 分享图</button>' +
        '<button class="mini-btn rename-btn" id="btnRename">✎ 改名</button>' +
      '</div>';

    if (!noData) {
      html += '<div class="ring-row">' + rings.map(function (x) { return ring(x.v, x.c, x.l); }).join('') + '</div>' +
        '<div class="spark-wrap"><div class="lesson-head"><h3>每一讲的听课进度</h3>' +
        '<span class="sub" style="font-size:11.5px;color:#A49CB8">绿色=有效 · 黄色=到课 · 灰色=未到</span></div>' +
        spark(s) + '</div>';
    }

    html += '<div class="card" style="margin-bottom:18px"><div class="lesson-head"><h3>个人档案</h3>' +
      '<span class="sub" style="font-size:11.5px;color:#A49CB8">' + (r ? '来源：学情表' : '来源：学习数据表') + '</span></div>' +
      '<div class="info-grid">' +
      (infoRows.length
        ? infoRows.map(function (p) {
            return '<div class="info-item"><div class="k">' + esc(p[0]) + '</div><div class="v" title="' + esc(p[2] || '') + '">' + esc(p[1]) + '</div></div>';
          }).join('')
        : '<div class="info-item" style="grid-column:1/-1"><div class="k">—</div><div class="v">暂无档案信息</div></div>') +
      extraHtml +
      '</div>' +
      (((s && (s.followUp || s.remark)) || (r && r.remark))
        ? '<div class="info-item"><div class="k">跟进 / 备注</div><div class="v" style="font-weight:600;font-size:13px;line-height:1.6">' +
          esc((s && (s.followUp || s.remark)) || (r && r.remark) || '') + '</div></div>' : '') +
      '</div>';

    // 每讲明细
    if (s && Object.keys(s.lessons || {}).length) {
      html += '<div class="card"><div class="lesson-head"><h3>每讲明细</h3>' +
        '<span class="sub" style="font-size:11.5px;color:#A49CB8">灰色行=不计入统计</span></div>' +
        '<div style="overflow-x:auto"><table class="lesson-table">' +
        '<thead><tr><th>讲次</th><th>到课</th><th>有效</th><th>完课</th><th>时长</th><th>进度</th>' +
        '<th>答对/作答</th><th>正确率</th><th>练习</th><th>得分</th><th style="width:46px"></th></tr></thead><tbody>' +
        lessonRows(s) + '</tbody></table></div></div>';
    } else if (noData) {
      html += '<div class="card"><div class="empty-tip">这位学员还没有匹配到学习数据</div></div>';
    }

    $('#drawerContent').innerHTML = html;
    $('#drawer').hidden = false;
    $('#drawerMask').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function lessonRows(s) {
    var statSet = {}, activeSet = {};
    (db.statCourses || []).forEach(function (c) { statSet[c] = 1; });
    (db.activeCourses || []).forEach(function (c) { activeSet[c] = 1; });
    return db.courses.map(function (cn) {
      var l = s.lessons[cn] || {};
      var inActive = !!activeSet[cn];
      var inStat = !!statSet[cn];
      var isCurrent = cn === lessonScope;
      var tag = !inActive ? ' <span class="tag tag-no">未开课</span>'
        : (inStat ? '' : ' <span class="tag tag-no">不统计</span>');
      var accTxt = (l.quizAnswer > 0)
        ? '<span class="tag ' + ((l.accuracy || 0) >= 80 ? 'tag-yes' : 'tag-warn') + '">' + pct((l.accuracy || 0) / 100, 0) + '</span>'
        : '<span class="tag tag-no">无</span>';
      return '<tr style="opacity:' + (inStat ? 1 : .45) + (isCurrent ? ';outline:2.5px solid #FF7A59;border-radius:12px' : '') + '">' +
        '<td><span class="lesson-name" title="' + esc(cn) + '">' + esc(shortName(cn)) + tag + '</span></td>' +
        '<td>' + (l.attended ? '<span class="tag tag-yes">到课</span>' : '<span class="tag tag-no">未到</span>') + '</td>' +
        '<td>' + (l.effective ? '<span class="tag tag-yes">有效</span>' : '<span class="tag tag-no">—</span>') + '</td>' +
        '<td>' + (l.finished ? '<span class="tag tag-blue">完课</span>' : '<span class="tag tag-no">—</span>') + '</td>' +
        '<td class="mono">' + (l.durationMin || 0) + ' 分</td>' +
        '<td>' + miniBar(l.progress / 100, '#4DA3FF') + '</td>' +
        '<td class="mono">' + (l.quizRight || 0) + '/' + (l.quizAnswer || 0) + '</td>' +
        '<td>' + accTxt + '</td>' +
        '<td>' + hwTag(l.hwStatus) + '</td>' +
        '<td class="mono">' + (l.hwScore === null || l.hwScore === undefined ? '—' : l.hwScore + ' 分') + '</td>' +
        '<td style="text-align:center"><button class="row-edit" data-lesson="' + esc(cn) + '" title="修改本讲学习数据">✎</button></td>' +
        '</tr>';
    }).join('');
  }

  function miniBar(v, c) {
    if (!v) return '<span style="color:#C3BBDA">—</span>';
    return '<span class="mini"><span class="mini-track"><i style="width:' + (v * 100).toFixed(0) + '%;background:' + c + '"></i></span>' +
      '<span class="mini-num">' + (v * 100).toFixed(0) + '%</span></span>';
  }
  function ring(v, color, label) {
    var r = 26, c = 2 * Math.PI * r;
    var val2 = v === null || v === undefined ? 0 : Math.max(0, Math.min(1, v));
    return '<div class="ring-card">' +
      '<svg width="66" height="66" viewBox="0 0 66 66">' +
      '<circle cx="33" cy="33" r="' + r + '" fill="none" stroke="#F1EBF8" stroke-width="8"/>' +
      '<circle cx="33" cy="33" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round" ' +
      'stroke-dasharray="' + (c * val2).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 33 33)"/>' +
      '<text x="33" y="37" text-anchor="middle" font-size="14" font-weight="800" fill="#2E2545">' +
      (v === null || v === undefined ? '—' : Math.round(v * 100)) + '</text>' +
      '</svg><div class="rl">' + esc(label) + '</div></div>';
  }
  function spark(s) {
    var courses = db.statCourses && db.statCourses.length ? db.statCourses : db.courses;
    if (!courses.length) return '<div class="empty-tip">暂无课程</div>';
    var n = courses.length;
    var W = Math.max(300, n * 26), H = 110, bw = Math.min(18, (W - 20) / n - 6);
    var anyProgress = false;
    var bars = courses.map(function (cn, i) {
      var l = s.lessons[cn] || {};
      var h = Math.max(3, (l.progress || 0) / 100 * (H - 34));
      if (l.progress > 0) anyProgress = true;
      var x = 10 + i * ((W - 20) / n) + (((W - 20) / n) - bw) / 2;
      var col = l.effective ? '#3EC46D' : (l.attended ? '#FFC53D' : '#E6DFF2');
      return '<rect x="' + x.toFixed(1) + '" y="' + (H - 24 - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) +
        '" rx="4" fill="' + col + '"><title>' + esc(cn) + '\n进度 ' + (l.progress || 0) + '% · 听课 ' + (l.durationMin || 0) + ' 分钟</title></rect>' +
        '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" font-size="9.5" fill="' + (cn === lessonScope ? '#FF7A59' : '#A49CB8') +
        '" text-anchor="middle">' + esc(shortName(cn).replace('第', '').replace('讲', '')) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="xMinYMid meet">' +
      '<line x1="10" y1="' + (H - 24) + '" x2="' + (W - 10) + '" y2="' + (H - 24) + '" stroke="#F0E7F5" stroke-width="2"/>' + bars + '</svg>' +
      (anyProgress ? '' : '<div style="text-align:center;font-size:11.5px;color:#A49CB8;margin-top:4px">该学员在所选讲次中暂无学习进度</div>');
  }

  /* =========================================================
   * 数据管理
   * ======================================================= */
  function renderData() {
    var sg = SWB.settings(db);

    // 学情表状态
    $('#rosterSub').textContent = hasRoster()
      ? db.roster.students.length + ' 份档案 · ' + new Date(db.roster.updatedAt).toLocaleString('zh-CN')
      : '尚未导入';
    $('#dataSub').textContent = db.students.length
      ? db.students.length + ' 名学员 · ' + (db.statCourses || []).length + ' 讲正课'
      : '尚未导入';

    // 开关
    setSwitch('#swExclude', sg.excludeDrill);
    setSwitch('#swAutoProfile', sg.autoProfile);
    setSwitch('#swOnlyRoster', sg.onlyRoster);
    $('#rowOnlyRoster').style.opacity = hasRoster() ? 1 : .45;

    // 关键词 chips
    $('#excludeChips').innerHTML = (sg.excludeKeywords || []).map(function (k) {
      return '<span class="chip">' + esc(k) + '<button class="chip-x" data-kw="' + esc(k) + '" aria-label="移除">&times;</button></span>';
    }).join('') || '<span style="font-size:12.5px;color:#A49CB8">暂无关键词，所有讲次都会计入统计</span>';

    // 课程分类概览
    var stat = db.statCourses || [], ex = db.excludedCourses || [];
    $('#courseSplit').innerHTML =
      '<div class="cs-box cs-ok"><div class="cs-n">' + stat.length + '</div><div class="cs-t">计入统计</div>' +
      '<div class="cs-l">' + (stat.length ? stat.slice(0, 4).map(function (c) { return esc(lessonTitle(c) || c); }).join('、') + (stat.length > 4 ? ' 等' : '') : '—') + '</div></div>' +
      '<div class="cs-box cs-no"><div class="cs-n">' + ex.length + '</div><div class="cs-t">已剔除</div>' +
      '<div class="cs-l">' + (ex.length ? ex.map(function (c) { return esc(lessonTitle(c) || c); }).slice(0, 4).join('、') : '—') + '</div></div>';

    // 数据源
    renderSourceList('#rosterSourceList', (db.roster && db.roster.sources) || [], '还没有导入学情表');
    renderSourceList('#sourceList', db.sources || [], '还没有导入学习数据');

    // 回填已保存的 GitHub 令牌（仅显示是否已设置，不回显明文全部，避免误读）
    var tk = getToken();
    ghTokenRaw = tk;
    if (tk) $('#ghToken').value = tk.length > 11 ? (tk.slice(0, 6) + '••••••••' + tk.slice(-4)) : tk;
    renderCloudStatus();
  }

  function renderSourceList(sel, list, emptyTxt) {
    var ul = $(sel);
    if (!list.length) { ul.innerHTML = '<li><div class="empty-tip">' + esc(emptyTxt) + '</div></li>'; return; }
    ul.innerHTML = list.map(function (src) {
      var extra = (src.matched !== undefined)
        ? ' · 匹配 ' + src.matched + ' / 未匹配 ' + src.unmatched
        : '';
      return '<li class="source-item">' +
        '<span class="source-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg></span>' +
        '<span class="source-main"><div class="source-name">' + esc(src.name) + '</div>' +
        '<div class="source-meta">' + src.rows + ' 条记录' + extra + ' · ' + new Date(src.time).toLocaleString('zh-CN') + '</div></span>' +
        '</li>';
    }).join('');
  }

  function setSwitch(sel, on) {
    var el = $(sel);
    el.classList.toggle('on', !!on);
    el.dataset.on = on ? '1' : '0';
  }

  /* ---------------- 导入：学情表 ---------------- */
  /** 学情表入库 + 结果展示（文件导入与内置学情表共用） */
  function finishRosterImport(parsed) {
    var r = SWB.mergeRosterInto(db, parsed);
    recompute();
    save();
    renderAll();
    var m = db.rosterMatched || 0;
    var box = $('#rosterResult');
    box.hidden = false;
    box.className = 'import-result';
    box.innerHTML = '已建立 <b>' + r.total + '</b> 份学员档案（来源：' + esc(r.source) + '）。<br>' +
      '与已有学习数据自动匹配上 <b>' + m + '</b> 人' +
      (db.students.length ? '，未匹配 <b>' + (db.students.length - m) + '</b> 人（可在「学员名单」里用「未匹配」筛选查看）。' : '。') +
      (parsed.meta.extra && parsed.meta.extra.length
        ? '<br>额外收录字段：' + esc(parsed.meta.extra.slice(0, 8).join('、')) : '');
    return r;
  }

  /** 载入内置的飞书学情表（170 人档案） */
  function loadRosterSample(silent) {
    if (!window.SWB_ROSTER || !window.SWB_ROSTER.students) { toast('飞书学情表数据不可用'); return; }
    if (!silent && hasRoster() &&
      !confirm('载入飞书学情表会覆盖当前 ' + db.roster.students.length + ' 份学员档案，继续吗？')) return;
    var snapshot = JSON.parse(JSON.stringify(window.SWB_ROSTER));
    finishRosterImport(snapshot);
    if (!silent) toast('飞书学情表已载入');
  }

  function handleRosterFiles(files) {
    var arr = Array.prototype.slice.call(files);
    if (!arr.length) return;
    var f = arr[0];
    if (hasRoster() && !confirm('导入《' + f.name + '》会覆盖当前 ' + db.roster.students.length + ' 份学员档案，继续吗？')) return;

    var fr = new FileReader();
    fr.onload = function (e) {
      var box = $('#rosterResult');
      box.hidden = false;
      try {
        var parsed = SWB.parseRosterWorkbook(new Uint8Array(e.target.result), f.name);
        finishRosterImport(parsed);
        toast('学情表导入成功');
      } catch (err) {
        box.className = 'import-result err';
        box.innerHTML = '学情表导入失败：' + esc(err.message || err) + '<br>请确认表里包含「姓名 / 学员ID / 手机号」中的任意一列。';
      }
    };
    fr.onerror = function () { toast('文件读取失败'); };
    fr.readAsArrayBuffer(f);
  }

  /* ---------------- 导入：学习数据 ---------------- */
  function handleFiles(files) {
    var arr = Array.prototype.slice.call(files);
    if (!arr.length) return;
    var ok = 0, errs = [], total = { added: 0, updated: 0, newCourses: 0, matched: 0, unmatched: 0 };
    var pending = arr.length;

    arr.forEach(function (f) {
      var fr = new FileReader();
      fr.onload = function (e) {
        try {
          var parsed = SWB.parseWorkbook(new Uint8Array(e.target.result), f.name);
          var r = SWB.mergeInto(db, parsed);
          total.added += r.added; total.updated += r.updated; total.newCourses += r.newCourses;
          total.matched += r.matched; total.unmatched += r.unmatched;
          ok++;
        } catch (err) {
          errs.push(f.name + '：' + (err.message || err));
        }
        if (--pending === 0) finish();
      };
      fr.onerror = function () { errs.push(f.name + '：读取失败'); if (--pending === 0) finish(); };
      fr.readAsArrayBuffer(f);
    });

    function finish() {
      if (ok) {
        recompute();
        save();
        renderAll();
      }
      var box = $('#importResult');
      box.hidden = false;
      var matchTxt = hasRoster()
        ? '<br>学情表匹配：<b>' + total.matched + '</b> 人已建档' + (total.unmatched ? '，<b>' + total.unmatched + '</b> 人未匹配' : '')
        : '';
      if (ok && !errs.length) {
        box.className = 'import-result';
        box.innerHTML = '导入成功 <b>' + ok + '</b> 个文件：新增学员 <b>' + total.added + '</b> 人，更新 <b>' +
          total.updated + '</b> 人，新增讲次 <b>' + total.newCourses + '</b> 个。' + matchTxt +
          '<br>当前共 <b>' + db.students.length + '</b> 名学员、<b>' + (db.statCourses || []).length +
          '</b> 讲正课' + ((db.excludedCourses || []).length ? '（另有 ' + db.excludedCourses.length + ' 讲已剔除）' : '') + '。';
        toast('导入完成');
      } else if (ok) {
        box.className = 'import-result';
        box.innerHTML = '成功 ' + ok + ' 个文件（新增 ' + total.added + ' / 更新 ' + total.updated +
          '），失败 ' + errs.length + ' 个：<br>' + errs.map(esc).join('<br>') + matchTxt;
      } else {
        box.className = 'import-result err';
        box.innerHTML = '导入失败：<br>' + errs.map(esc).join('<br>');
      }
    }
  }

  /** 载入内置示例数据 */
  function loadSample() {
    if (!window.SWB_SAMPLE || !window.SWB_SAMPLE.students) { toast('示例数据不可用'); return; }
    if (db.students.length && !confirm('载入示例数据会与当前数据合并（相同学员 ID 将覆盖更新），继续吗？')) return;
    var sample = JSON.parse(JSON.stringify(window.SWB_SAMPLE));
    var r = SWB.mergeInto(db, sample);
    recompute();
    save(); renderAll();
    var box = $('#importResult');
    box.hidden = false;
    box.className = 'import-result';
    box.innerHTML = '已载入示例数据：新增学员 <b>' + r.added + '</b> 人，更新 <b>' + r.updated +
      '</b> 人，新增讲次 <b>' + r.newCourses + '</b> 个。<br>当前共 <b>' + db.students.length +
      '</b> 名学员、<b>' + (db.statCourses || []).length + '</b> 讲正课' +
      ((db.excludedCourses || []).length ? '，已自动剔除 <b>' + db.excludedCourses.length + '</b> 讲习题课' : '') + '。';
    toast('示例数据已载入');
  }

  function download(name, content) {
    var blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportCSV() {
    if (!db.students.length) { toast('还没有数据可以导出'); return; }
    download('学员学习数据_' + new Date().toISOString().slice(0, 10) + '.csv', SWB.toCSV(db));
    toast('已导出学习数据');
  }
  function exportRosterCSV() {
    if (!(db.archive || []).length) { toast('还没有档案可以导出'); return; }
    download('学员档案_' + new Date().toISOString().slice(0, 10) + '.csv', SWB.toRosterCSV(db));
    toast('已导出学员档案');
  }
  // 导出完整数据库（含手机号明文），用于固化到家长查询页。
  // 注意：此文件仅本地使用，发给管理员后会脱敏为哈希再发布，不会泄露明文。
  function exportDBJSON() {
    if (!db.students.length) { toast('还没有数据可以导出'); return; }
    var payload = JSON.parse(JSON.stringify(db));
    download('学员完整数据_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(payload, null, 1));
    toast('已导出完整数据（含手机号，请发管理员固化到家长查询页）');
  }

  /* ---------------- 一键同步家长查询页 ---------------- */
  function getToken() { return (localStorage.getItem(GH_TOKEN_KEY) || '').trim(); }

  function saveToken() {
    var v = ($('#ghToken').value || '').trim();
    // 若界面显示的是遮罩串且用户未改动，使用内存镜像中的真实令牌
    var real = (ghTokenRaw && /[•]/.test(v)) ? ghTokenRaw : v;
    if (!real) { localStorage.removeItem(GH_TOKEN_KEY); ghTokenRaw = ''; toast('已清除 GitHub 令牌'); return; }
    localStorage.setItem(GH_TOKEN_KEY, real);
    ghTokenRaw = real;
    toast('GitHub 令牌已保存（仅存本机）');
    // 保存令牌后，若本机还没有数据，自动从云端拉取一次，方便在新设备上直接开用
    if (!db.students.length && !hasRoster()) loadFromCloud(true);
  }

  /* 跨设备更新链接：把令牌做轻混淆后编入 URL，其他设备打开即自动绑定，无需手填令牌 */
  function b64urlEncode(s){ return btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  function b64urlDecode(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; return decodeURIComponent(escape(atob(s))); }
  function xorCrypt(s, salt){ var o=''; for(var i=0;i<s.length;i++) o+=String.fromCharCode(s.charCodeAt(i)^salt.charCodeAt(i%s.length)); return o; }
  function copyText(t){
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return new Promise(function(res, rej){ try{ var ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); res(); }catch(e){ rej(e);} });
  }
  /** 常用设备：生成一条「更新链接」，自带访问凭证，发到其他设备打开即自动绑定令牌 */
  function genSyncLink() {
    var token = getToken();
    if (!token) { toast('本设备尚未绑定令牌，无法生成更新链接'); return; }
    var salt = Math.random().toString(36).slice(2, 10);
    var enc = b64urlEncode(xorCrypt(token, salt));
    var link = location.origin + location.pathname + '?sync=' + encodeURIComponent(salt + '.' + enc);
    var out = $('#syncLinkOut');
    if (out) out.value = link;
    copyText(link).then(function () {
      toast('更新链接已复制，发到其他设备打开即可（含访问凭证，请勿转发他人）');
    }).catch(function () { toast('链接已生成，请手动复制下方文本框内容'); });
  }
  /** 其他设备：打开带 ?sync= 的链接时自动恢复令牌并拉取最新数据 */
  function applySyncFromUrl() {
    var m = location.search.match(/[?&]sync=([^&]+)/);
    if (!m) return false;
    try {
      var raw = decodeURIComponent(m[1]);
      var dot = raw.indexOf('.');
      if (dot < 0) return false;
      var salt = raw.slice(0, dot), enc = raw.slice(dot + 1);
      var token = xorCrypt(b64urlDecode(enc), salt);
      if (!/^(ghp_|github_pat_)/i.test(token)) return false;
      localStorage.setItem(GH_TOKEN_KEY, token);
      ghTokenRaw = token;
      var inp = $('#ghToken');
      if (inp) inp.value = token.length > 11 ? (token.slice(0, 6) + '••••••••' + token.slice(-4)) : token;
      toast('已从更新链接自动绑定令牌，正在拉取最新数据…');
      loadFromCloud(true);
      return true;
    } catch (e) { return false; }
  }

  /* 加密云保险箱：令牌经主口令加密后存进公开仓库，其他设备输同一主口令即自动绑定（口令不落云端） */
  function saveTokenVault() {
    var token = getToken();
    if (!token) { toast('请先在本设备绑定令牌，再保存到保险箱'); return; }
    var p1 = ($('#vaultPass').value || '').trim();
    var p2 = ($('#vaultPass2').value || '').trim();
    if (p1.length < 4) { toast('主口令至少 4 位'); return; }
    if (p1 !== p2) { toast('两次输入的口令不一致'); return; }
    var salt = Math.random().toString(36).slice(2, 12);
    var enc = b64urlEncode(xorCrypt(token, p1 + '|' + salt));
    var payload = { v: 1, algo: 'xor+pass', salt: salt, enc: enc, updatedAt: new Date().toISOString() };
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    toast('正在保存到云端保险箱…');
    pushFile(GH_VAULT_FILE, content, 'vault: 更新加密令牌保险箱', token).then(function () {
      if ($('#vaultRemember') && $('#vaultRemember').checked) localStorage.setItem(VAULT_PASS_KEY, p1);
      toast('已保存到云端保险箱，其他设备输入该口令即可绑定');
      renderVaultStatus();
    }).catch(function (e) { toast('保存失败：' + errMsg({ reason: e })); });
  }
  function unlockTokenVault(silent) {
    var p = ($('#vaultPass').value || '').trim() || localStorage.getItem(VAULT_PASS_KEY) || '';
    if (!p) { if (!silent) toast('请输入主口令'); return; }
    if (!silent) toast('正在从云端解锁…');
    ghGetFile(GH_VAULT_FILE, '').then(function (meta) {
      if (!meta || !meta.content) { if (!silent) toast('云端还没有保险箱，请先在常用设备保存'); return; }
      var v;
      try { v = JSON.parse(decodeURIComponent(escape(atob(meta.content)))); }
      catch (e) { if (!silent) toast('保险箱解析失败'); return; }
      if (!v.salt || !v.enc) { if (!silent) toast('保险箱格式异常'); return; }
      var token = xorCrypt(b64urlDecode(v.enc), p + '|' + v.salt);
      if (!/^(ghp_|github_pat_)/i.test(token)) { if (!silent) toast('主口令错误，无法解锁'); return; }
      localStorage.setItem(GH_TOKEN_KEY, token);
      ghTokenRaw = token;
      var inp = $('#ghToken');
      if (inp) inp.value = token.length > 11 ? (token.slice(0, 6) + '••••••••' + token.slice(-4)) : token;
      if ($('#vaultRemember') && $('#vaultRemember').checked) localStorage.setItem(VAULT_PASS_KEY, p);
      toast('已从云端保险箱解锁并绑定令牌' + (silent ? '' : '，可直接更新家长查询'));
      loadFromCloud(true);
      renderVaultStatus();
    }).catch(function (e) { if (!silent) toast('解锁失败：' + errMsg({ reason: e })); });
  }
  function renderVaultStatus() {
    var el = $('#vaultStatus');
    if (!el) return;
    ghGetFile(GH_VAULT_FILE, '').then(function (meta) {
      if (!meta || !meta.content) { el.textContent = '云端保险箱：未创建'; el.className = 'sync-status'; return; }
      var v;
      try { v = JSON.parse(decodeURIComponent(escape(atob(meta.content)))); }
      catch (e) { el.textContent = '保险箱（解析失败）'; return; }
      var when = v.updatedAt ? new Date(v.updatedAt).toLocaleString('zh-CN') : '';
      el.textContent = '云端保险箱：' + when; el.className = 'sync-status ok';
    }).catch(function () { el.textContent = '保险箱状态获取失败'; el.className = 'sync-status'; });
  }
  /** 启动时：本机已记住主口令且未绑令牌，自动从云端解锁 */
  function applyVaultFromStart() {
    var p = localStorage.getItem(VAULT_PASS_KEY);
    if (p && !getToken()) { unlockTokenVault(true); return true; }
    return false;
  }

  function ghHeaders(token) {
    var h = { Accept: 'application/vnd.github+json' };
    // 公开仓库文件可免令牌读取；仅写入（PUT）需要令牌
    if (token) h.Authorization = 'token ' + token;
    return h;
  }
  /** 读取仓库文件（GitHub Contents API），不存在返回 null。token 为空时以匿名身份读取公开文件 */
  function ghGetFile(path, token) {
    var url = GH_API_BASE + '/repos/' + GH_REPO + '/contents/' + path;
    return fetch(url, { headers: ghHeaders(token) }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ('HTTP ' + r.status)); });
      return r.json();
    });
  }
  /** 写入/更新仓库文件，自动带上 sha（更新需要） */
  function ghPutFile(path, contentBase64, message, token, sha) {
    var url = GH_API_BASE + '/repos/' + GH_REPO + '/contents/' + path;
    var body = { message: message, content: contentBase64 };
    if (sha) body.sha = sha;
    return fetch(url, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)),
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ('HTTP ' + r.status)); });
      return r.json();
    });
  }
  /** 把文件推送到仓库（先取 sha 再 PUT） */
  function pushFile(path, contentBase64, message, token) {
    return ghGetFile(path, token).then(function (meta) {
      return ghPutFile(path, contentBase64, message, token, meta && meta.sha);
    });
  }

  /**
   * 云端备份脱敏：手机号转为 FNV-1a 哈希（不保留明文），剔除家庭隐私字段。
   * 云端备份的敏感等级与已公开的 students.json 一致（姓名 + 成绩 + phoneHash），
   * 任何设备拉取后仍能正确重建家长查询数据，但无法反推家长手机号或家庭住址。
   */
  function sanitizeDBForCloud(src) {
    var d = JSON.parse(JSON.stringify(src));
    function stripPhone(o) {
      if (!o) return;
      if (o.phone) {
        var h = SWBParent.phoneHash(o.phone);
        o.phoneHash = h || o.phoneHash || '';
        o.phone = '';
      }
    }
    function stripSensitive(o) {
      if (!o) return;
      delete o.guardian; delete o.address; delete o.remark; delete o.followUp;
    }
    (d.students || []).forEach(function (s) { stripPhone(s); stripSensitive(s); });
    (d.roster && d.roster.students || []).forEach(function (s) { stripPhone(s); stripSensitive(s); });
    d.updatedAt = new Date().toISOString();
    return d;
  }

  /** 把当前数据推送到 GitHub：家长查询页 + 云端备份，触发 Pages 重建，家长立即可查 */
  function syncParentData() {
    var token = getToken();
    if (!token) {
      toast('请先在「数据管理」填写 GitHub 访问令牌');
      $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === 'import'); });
      $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-import'); });
      $('#ghToken').focus();
      return;
    }
    if (!db.students.length && !hasRoster()) { toast('当前没有数据，无法同步'); return; }

    var btn = $('#btnSync');
    btn.disabled = true;
    toast('正在同步到家长查询页与云端备份…');

    var payload, content, cloudPayload, cloudContent;
    try {
      payload = SWBParent.build(db, SWB);
      content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 1))));
      cloudPayload = sanitizeDBForCloud(db);
      cloudContent = btoa(unescape(encodeURIComponent(JSON.stringify(cloudPayload, null, 1))));
    } catch (e) {
      btn.disabled = false;
      toast('生成失败：' + e.message);
      return;
    }

    var ts = new Date().toISOString();
    var pStudents = pushFile(GH_FILE, content, 'sync: 更新家长查询数据 ' + ts, token);
    var pCloud = ghGetFile(GH_DB_FILE, token).then(function (meta) {
      return ghPutFile(GH_DB_FILE, cloudContent, 'sync: 云端备份 ' + ts, token, meta && meta.sha);
    });

    Promise.allSettled([pStudents, pCloud]).then(function (res) {
      btn.disabled = false;
      var okS = res[0].status === 'fulfilled';
      var okC = res[1].status === 'fulfilled';
      var n = payload.students.length, q = payload._meta.phoneFull, rep = payload._meta.withData;
      if (okS && okC) {
        toast('已同步！' + n + ' 名学员（' + q + ' 人可查，' + rep + ' 人有报告）· 云端已备份');
      } else if (okS) {
        toast('家长查询已更新，但云端备份失败：' + errMsg(res[1]));
      } else if (okC) {
        toast('云端已备份，但家长查询更新失败：' + errMsg(res[0]));
      } else {
        toast('同步失败：' + errMsg(res[0]));
      }
    });
  }

  function errMsg(r) {
    var m = r && r.reason && r.reason.message ? r.reason.message : String((r && r.reason) || '');
    if (/401|403/.test(m)) return '令牌无权限，请确认具有该仓库 repo 权限';
    if (/network|Failed to fetch|CORS/i.test(m)) return '网络或跨域被拦截，请检查网络后重试';
    return m;
  }

  /** 从云端拉取数据到本机（跨设备更新）。公开文件免令牌即可读取 */
  function loadFromCloud(silent) {
    var token = getToken();
    if (!silent) toast('正在从云端加载数据…');
    ghGetFile(GH_DB_FILE, token).then(function (meta) {
      if (!meta || !meta.content) {
        if (!silent) toast('云端还没有备份，请先在常用设备点「更新家长查询」');
        return;
      }
      var json;
      try {
        json = JSON.parse(decodeURIComponent(escape(atob(meta.content))));
      } catch (e) { toast('云端数据解析失败'); return; }

      if (!silent && (db.students.length || hasRoster())) {
        if (!confirm('从云端加载会用最新备份覆盖当前本机数据，继续吗？')) return;
      }
      db = SWB.refresh(json);
      lessonScope = ''; keyword = ''; filterGrade = ''; filterMatch = ''; archiveKw = ''; archiveFilter = '';
      $('#searchInput').value = ''; $('#archiveSearch').value = '';
      save(); renderAll();
      var when = json.updatedAt ? new Date(json.updatedAt).toLocaleString('zh-CN') : '未知时间';
      toast('已从云端加载（备份更新于 ' + when + '）');
      renderCloudStatus();
    }).catch(function (e) {
      // 匿名读取被拒（极少见，公开仓库不会）且本机无令牌时，提示绑定
      if (/401|403/.test((e && e.message) || '') && !token) {
        if (!silent) toast('云端读取被拒，请先绑定令牌或打开更新链接');
        return;
      }
      if (!silent) toast('云端加载失败：' + errMsg({ reason: e }));
    });
  }

  function renderCloudStatus() {
    var el = $('#cloudStatus');
    if (!el) return;
    ghGetFile(GH_DB_FILE, getToken()).then(function (meta) {
      if (!meta || !meta.content) { el.textContent = '云端暂无备份'; el.className = 'sync-status'; return; }
      var json;
      try { json = JSON.parse(decodeURIComponent(escape(atob(meta.content)))); }
      catch (e) { el.textContent = '云端备份（解析失败）'; return; }
      var when = json.updatedAt ? new Date(json.updatedAt).toLocaleString('zh-CN') : '';
      var cnt = (json.students ? json.students.length : 0) + (json.roster && json.roster.students ? json.roster.students.length : 0);
      el.textContent = '云端备份：' + when + ' · ' + cnt + ' 条记录' + (getToken() ? '' : '（未绑定令牌，仅读取）');
      el.className = 'sync-status ok';
    }).catch(function () { el.textContent = '云端状态获取失败'; el.className = 'sync-status'; });
  }

  /* =========================================================
   * 事件绑定
   * ======================================================= */
  function bind() {
    $('#tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab');
      if (!btn) return;
      $$('.tab').forEach(function (t) { t.classList.toggle('active', t === btn); });
      view = btn.dataset.view;
      $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    });

    // 讲次筛选
    $('#filterLesson').addEventListener('change', function () { setScope(this.value); });

    // 名单搜索
    var si = $('#searchInput');
    si.addEventListener('input', function () {
      keyword = si.value;
      $('#clearSearch').hidden = !keyword;
      renderStudents();
    });
    $('#clearSearch').addEventListener('click', function () {
      si.value = ''; keyword = ''; $('#clearSearch').hidden = true; renderStudents(); si.focus();
    });
    $('#sortBy').addEventListener('change', function () { sortBy = this.value; renderStudents(); });
    $('#filterGrade').addEventListener('change', function () { filterGrade = this.value; renderStudents(); });
    $('#filterMatch').addEventListener('change', function () { filterMatch = this.value; renderStudents(); });

    // 档案搜索
    var ai = $('#archiveSearch');
    ai.addEventListener('input', function () {
      archiveKw = ai.value;
      $('#clearArchiveSearch').hidden = !archiveKw;
      renderArchive();
    });
    $('#clearArchiveSearch').addEventListener('click', function () {
      ai.value = ''; archiveKw = ''; $('#clearArchiveSearch').hidden = true; renderArchive(); ai.focus();
    });
    $('#archiveFilter').addEventListener('change', function () { archiveFilter = this.value; renderArchive(); });
    $('#archiveSort').addEventListener('change', function () { archiveSort = this.value; renderArchive(); });

    // 打开详情
    $('#stuBody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]');
      if (tr) openStudent(tr.dataset.id);
    });
    $('#archiveBody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-key]');
      if (tr) openArchiveItem(tr.dataset.key);
    });
    $('#rankTop').addEventListener('click', function (e) {
      var li = e.target.closest('.rank-item'); if (li) openStudent(li.dataset.id);
    });
    $('#rankLow').addEventListener('click', function (e) {
      var li = e.target.closest('.rank-item'); if (li) openStudent(li.dataset.id);
    });

    // 抽屉
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerMask').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
    });

    // 抽屉内：改名 / 修改学习数据
    $('#drawerContent').addEventListener('click', function (e) {
      if (e.target.closest('#btnShare')) { openShare(); return; }
      if (e.target.closest('#btnRename')) { startRename(); return; }
      var ed = e.target.closest('.row-edit');
      if (ed) openLessonEditor(ed.dataset.lesson, currentDrawer && currentDrawer.student);
    });

    // 示例数据
    $('#btnDemo').addEventListener('click', loadSample);
    document.querySelector('main').addEventListener('click', function (e) {
      if (e.target.closest('[data-demo]')) loadSample();
      if (e.target.closest('[data-goto-import]')) $('.tab[data-view="import"]').click();
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-show-drill]')) {
        SWB.settings(db).excludeDrill = false;
        recompute(); save(); renderAll();
        toast('已把习题课纳入统计，可在「数据管理」里改回来');
      }
    });

    // 导入：学习数据
    $('#btnPickFile').addEventListener('click', function () { $('#fileInput').click(); });
    $('#btnImport').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', function () { handleFiles(this.files); this.value = ''; });
    bindDropzone('#dropzone', handleFiles);

    // 导入：学情表
    $('#btnPickRoster').addEventListener('click', function () { $('#rosterInput').click(); });
    $('#rosterInput').addEventListener('change', function () { handleRosterFiles(this.files); this.value = ''; });
    bindDropzone('#rosterDrop', handleRosterFiles);
    $('#btnLoadRoster').addEventListener('click', function () { loadRosterSample(false); });

    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    // 统计设置
    $('#swExclude').addEventListener('click', function () {
      SWB.settings(db).excludeDrill = !SWB.settings(db).excludeDrill;
      recompute(); save(); renderAll();
      toast(SWB.settings(db).excludeDrill ? '已剔除习题课' : '已恢复统计习题课');
    });
    $('#swAutoProfile').addEventListener('click', function () {
      SWB.settings(db).autoProfile = !SWB.settings(db).autoProfile;
      recompute(); save(); renderAll();
    });
    $('#swOnlyRoster').addEventListener('click', function () {
      var sg = SWB.settings(db);
      sg.onlyRoster = !sg.onlyRoster;
      filterMatch = (sg.onlyRoster && hasRoster()) ? 'yes' : '';
      recompute(); save(); renderAll();
    });
    $('#btnAddExclude').addEventListener('click', addExclude);
    $('#excludeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') addExclude(); });
    $('#excludeChips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip-x');
      if (!b) return;
      var sg = SWB.settings(db);
      sg.excludeKeywords = sg.excludeKeywords.filter(function (k) { return k !== b.dataset.kw; });
      if (!sg.excludeKeywords.length) sg.excludeKeywords = [];
      recompute(); save(); renderAll();
    });

    // 导出 / 同步 / 清空
    $('#btnExport').addEventListener('click', exportCSV);
    $('#btnExportDB').addEventListener('click', exportDBJSON);
    $('#btnSync').addEventListener('click', syncParentData);
    $('#btnLoadCloud').addEventListener('click', function () { loadFromCloud(false); });
    $('#btnGenLink').addEventListener('click', genSyncLink);
    $('#btnSaveVault').addEventListener('click', saveTokenVault);
    $('#btnUnlockVault').addEventListener('click', function () { unlockTokenVault(false); });
    $('#btnSaveToken').addEventListener('click', saveToken);
    $('#ghToken').addEventListener('input', function () { ghTokenRaw = this.value; });
    $('#btnClear').addEventListener('click', function () {
      if (!db.students.length && !hasRoster()) { toast('当前没有数据'); return; }
      if (!confirm('确定清空全部数据吗？包含 ' + db.students.length + ' 名学员与 ' +
        (hasRoster() ? db.roster.students.length + ' 份档案' : '0 份档案') + '，此操作不可撤销。')) return;
      db = SWB.refresh(SWB.emptyDB());
      lessonScope = ''; keyword = ''; filterGrade = ''; filterMatch = ''; archiveKw = ''; archiveFilter = '';
      $('#searchInput').value = ''; $('#archiveSearch').value = '';
      save(); renderAll();
      toast('已清空数据');
    });

    // 学习数据编辑浮层
    $('#editClose').addEventListener('click', closeEditModal);
    $('#editMask').addEventListener('click', closeEditModal);
    $('#editBody').addEventListener('click', function (e) {
      if (e.target.closest('#editSave')) saveLesson();
      else if (e.target.closest('#editCancel')) closeEditModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#editModal').hidden) closeEditModal();
    });

    // 学习情况分享图
    $('#shareOpts').addEventListener('change', function () { drawShareImage(); });
    $('#shareChips').addEventListener('change', function () { drawShareImage(); });
    $('#shareDownload').addEventListener('click', shareDownload);
    $('#shareClose').addEventListener('click', closeShare);
    $('#shareMask').addEventListener('click', closeShare);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#shareModal').hidden) closeShare();
    });
  }

  function addExclude() {
    var input = $('#excludeInput');
    var v = (input.value || '').trim();
    if (!v) return;
    var sg = SWB.settings(db);
    if (sg.excludeKeywords.indexOf(v) === -1) sg.excludeKeywords.push(v);
    input.value = '';
    recompute(); save(); renderAll();
    toast('已加入剔除关键词：' + v);
  }

  function bindDropzone(sel, handler) {
    var dz = $(sel);
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) handler(e.dataTransfer.files);
    });
  }

  /* ---------------- 启动 ---------------- */
  bind();
  renderAll();

  // 若通过「更新链接」打开，先自动绑定令牌并从云端拉取最新数据（其他设备免手填令牌）
  var fromSyncLink = applySyncFromUrl();
  // 若本机已记住主口令且未绑令牌，自动从云端保险箱解锁（其他设备免手填令牌）
  var vaultAuto = applyVaultFromStart();

  // 首次打开且无任何数据：若已绑定令牌（非链接/保险箱场景），优先从云端拉取（跨设备开用）；否则载入示例与飞书学情表
  if (!fromSyncLink && !vaultAuto && !db.roster.students.length && !db.students.length) {
    if (getToken()) {
      loadFromCloud(true);
    } else {
      if (window.SWB_SAMPLE && window.SWB_SAMPLE.students) {
        var s = JSON.parse(JSON.stringify(window.SWB_SAMPLE));
        SWB.mergeInto(db, s);
        recompute();
      }
      loadRosterSample(true);
      toast('已自动载入飞书学情表（170 人）与示例学习数据');
    }
  }
})();
