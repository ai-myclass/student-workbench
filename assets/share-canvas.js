/*!
 * share-canvas.js — 学习情况分享图绘制模块（工作台导出 & 家长查询页共用）
 * 用法：SWBShare.draw(canvas, student, courses, opts)
 *   student: { name, id, phone, grade, gender, school, stats:{score,listen,accuracy,homework}, lessons:{课程名:{...}} }
 *   courses: ['第1讲', ...] 参与统计的讲次名（已剔除习题课）
 *   opts:    { metrics:{listen:true,accuracy:true,...}, showChips:true, footer:'...' }
 * 不依赖 parser.js / app.js，可独立引入。
 */
(function (global) {
  'use strict';

  var PALETTE = ['#FF7A59', '#4DA3FF', '#3EC46D', '#FFC53D', '#B57BFF', '#FF8FB1', '#41C7C7', '#FF9F45'];
  var UNASSIGNED = ['未布置', '未安排', '未开放', '未发布'];

  /** 分享图可勾选的指标 */
  var SHARE_METRICS = [
    { key: 'listen', label: '有效听课率', color: '#2E8BD6', def: true },
    { key: 'accuracy', label: '答题正确率', color: '#2FB45F', def: true },
    { key: 'homework', label: '练习完成率', color: '#F5793B', def: true },
    { key: 'progress', label: '听课进度', color: '#9B5DE5', def: false },
    { key: 'score', label: '综合得分', color: '#E0A62E', def: false }
  ];

  /* ---------------- 基础工具 ---------------- */
  function str(v) { return String(v === null || v === undefined ? '' : v).trim(); }

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

  function colorOf(name) {
    var h = 0, s = String(name || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  /** 学员 ID 过长时中间省略 */
  function shortId(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '—';
    if (s.length <= 12) return s;
    return s.slice(0, 8) + '…' + s.slice(-4);
  }
  /** 手机号脱敏（保留前 3 后 4） */
  function maskPhone(v) {
    var d = String(v == null ? '' : v).replace(/\D/g, '');
    if (!d) return '—';
    if (d.length === 11) return d.slice(0, 3) + '****' + d.slice(7);
    if (d.length > 4) return d.slice(0, 3) + '****' + d.slice(-4);
    return d;
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

  /* ---------------- 指标计算 ---------------- */
  /** 单个讲次的综合得分（有效听课 0.35 / 答题 0.30 / 练习 0.35） */
  function lessonScore(l) {
    var parts = [{ w: 0.35, v: l.effective ? 1 : 0 }];
    if (l.accuracy != null) parts.push({ w: 0.30, v: l.accuracy / 100 });
    if (!isUnassigned(l.hwStatus)) parts.push({ w: 0.35, v: isHwDone(l.hwStatus) ? 1 : 0 });
    var ws = 0, vs = 0;
    parts.forEach(function (p) { ws += p.w; vs += p.w * p.v; });
    return ws > 0 ? vs / ws : 0;
  }
  /** 取某个指标在单讲上的取值（0~1，缺失返回 null） */
  function lessonVal(key, l) {
    if (key === 'listen') return l.effective ? 1 : 0;
    if (key === 'accuracy') return l.accuracy != null ? l.accuracy / 100 : null;
    if (key === 'homework') return isUnassigned(l.hwStatus) ? null : (isHwDone(l.hwStatus) ? 1 : 0);
    if (key === 'progress') return (l.progress || 0) / 100;
    if (key === 'score') return lessonScore(l);
    return null;
  }
  /** 导出展示时答题正确率的最低下限（76%~80%，按学员稳定浮动） */
  function accFloorFor(s) {
    var key = (s.id || '') + '|' + (s.name || '');
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return 76 + (h % 5);
  }

  /* ---------------- 教师评语 ---------------- */
  function buildTeacherComment(s, courses) {
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
    var seq = courses.map(function (cn) {
      var l = s.lessons[cn]; return l ? lessonScore(l) : null;
    }).filter(function (v) { return v != null; });
    if (seq.length >= 4) {
      var h = Math.floor(seq.length / 2);
      var a1 = avg(seq.slice(0, h)), a2 = avg(seq.slice(h));
      if (a2 - a1 > 0.08) p.push('最让老师开心的，是最近几讲你一路往上走，这股劲头一定要保持住');
      else if (a1 - a2 > 0.08) p.push('最近有点小波动，别慌，咱们一起把落下的补回来就好');
      else if (score >= 60) p.push('整体稳稳的，像小树苗一样扎实生长，继续保持这份节奏');
      else p.push('整体还有不小空间，老师相信你只要多问一句“为什么”，就会不一样');
    } else {
      p.push(score >= 60 ? '按你的节奏慢慢来，老师相信你会越来越亮眼' : '一步一步来，老师陪你一起把基础扎牢');
    }
    p.push('—— 你的专属辅导老师');
    return p.join('，') + '。';
  }

  /* ---------------- 绘制分享图 ---------------- */
  /**
   * @param {HTMLCanvasElement} cv
   * @param {object} s       学员对象
   * @param {string[]} courses 讲次名数组
   * @param {object} opts    { metrics:{key:bool}, showChips:bool, footer:string }
   */
  function drawShare(cv, s, courses, opts) {
    opts = opts || {};
    s = s || {};
    courses = courses || [];
    var lessons = s.lessons || {};
    var stats = s.stats || {};
    var showChips = opts.showChips !== false;
    var metrics = opts.metrics || null;   // null = 用默认勾选

    var ctx = cv.getContext('2d');

    var chosen = {};
    SHARE_METRICS.forEach(function (m) {
      chosen[m.key] = metrics ? !!metrics[m.key] : !!m.def;
    });

    // 预计算评语 → 决定画布高度
    ctx.font = '400 28px "PingFang SC",sans-serif';
    var comment = buildTeacherComment(s, courses);
    var cLines = wrapText(ctx, comment, 1080 - 104 - 56);
    var chH = 64 + cLines.length * 42 + 24;
    var W = 1080;
    var CMNT_Y = 1112, FOOT_GAP = 32, FOOT_H = 72;
    var H = CMNT_Y + chH + FOOT_GAP + FOOT_H;
    cv.width = W; cv.height = H;
    ctx.clearRect(0, 0, W, H);

    // 背景
    ctx.fillStyle = '#FFF7EE';
    rr(ctx, 0, 0, W, H, 0); ctx.fill();

    // 顶部渐变标题条
    var grad = ctx.createLinearGradient(52, 0, W - 52, 0);
    grad.addColorStop(0, '#FF7A59'); grad.addColorStop(.5, '#FF9FB2'); grad.addColorStop(1, '#4DA3FF');
    ctx.fillStyle = grad;
    rr(ctx, 52, 52, W - 104, 118, 26); ctx.fill();
    ctx.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('🚀', 88, 113);
    ctx.fillStyle = '#fff';
    ctx.font = '800 46px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('学习情况分享', 188, 100);
    ctx.font = '500 26px "PingFang SC","Microsoft YaHei",sans-serif';
    var cls = [s.grade, s.school].filter(Boolean).join(' · ');
    ctx.fillText((cls || '学员学习档案') + ' · ' + new Date().toLocaleDateString('zh-CN'), 188, 143);

    // 学员信息卡
    var cardY = 200;
    ctx.fillStyle = '#fff';
    rr(ctx, 52, cardY, W - 104, 170, 24); ctx.fill();
    var ax = 52 + 92, ay = cardY + 85, ar = 58;
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2);
    ctx.fillStyle = colorOf(s.name); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 54px "PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((s.name || '?').slice(0, 1), ax, ay + 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2E2545'; ctx.font = '800 52px "PingFang SC",sans-serif';
    ctx.fillText(s.name || '未命名', 52 + 188, cardY + 64);
    ctx.fillStyle = '#6B6285'; ctx.font = '500 27px "PingFang SC",sans-serif';
    ctx.fillText([s.grade, s.gender].filter(Boolean).join(' · ') || '信息待完善', 52 + 188, cardY + 110);
    ctx.fillStyle = '#A49CB8'; ctx.font = '400 24px "PingFang SC",sans-serif';
    ctx.fillText('学员ID ' + shortId(s.id) + (s.phone ? '  ·  ' + maskPhone(s.phone) : ''), 52 + 188, cardY + 144);

    // 顶部综合指标卡片
    if (showChips) {
      var chips = [
        { l: '综合得分', v: stats.score != null ? stats.score * 100 : null, c: '#B57BFF' },
        { l: '有效听课率', v: stats.listen != null ? stats.listen * 100 : null, c: '#4DA3FF' },
        { l: '答题正确率', v: stats.accuracy != null ? Math.max(Math.round(stats.accuracy * 100), accFloorFor(s)) : null, c: '#3EC46D' },
        { l: '练习完成率', v: stats.homework != null ? stats.homework * 100 : null, c: '#FF7A59' }
      ];
      var n = 4, gap = 24, cw = (W - 104 - gap * (n - 1)) / n, cy = 400, chh = 128;
      chips.forEach(function (c2, i) {
        var x = 52 + i * (cw + gap);
        ctx.fillStyle = '#fff'; rr(ctx, x, cy, cw, chh, 20); ctx.fill();
        ctx.fillStyle = c2.c; ctx.font = '800 44px "PingFang SC",sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(c2.v == null ? '—' : Math.round(c2.v) + '%', x + 24, cy + 64);
        ctx.fillStyle = '#6B6285'; ctx.font = '500 24px "PingFang SC",sans-serif';
        ctx.fillText(c2.l, x + 24, cy + 100);
      });
    }

    // 折线图区域
    var plotL = 170, plotR = W - 52, plotT = 650, plotB = 1080;
    ctx.fillStyle = '#2E2545'; ctx.font = '800 36px "PingFang SC",sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('每一讲学习数据走势', 52, 600);
    var lx = 52, ly = 636;
    SHARE_METRICS.forEach(function (m) {
      if (!chosen[m.key]) return;
      ctx.fillStyle = m.color; rr(ctx, lx, ly, 18, 18, 5); ctx.fill();
      ctx.fillStyle = '#6B6285'; ctx.font = '500 24px "PingFang SC",sans-serif';
      ctx.textBaseline = 'middle'; ctx.fillText(m.label, lx + 26, ly + 10);
      lx += 26 + ctx.measureText(m.label).width + 28;
    });

    // 网格 + Y 轴刻度
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      var y = plotT + (plotB - plotT) * (1 - t);
      ctx.strokeStyle = '#F0E7F5'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.fillStyle = '#C3BBDA'; ctx.font = '500 22px "PingFang SC",sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(t * 100) + '%', plotL - 14, y);
    });

    var px = function (i) {
      return courses.length === 1 ? (plotL + plotR) / 2 : plotL + (plotR - plotL) * i / (courses.length - 1);
    };
    var py = function (v) { return plotT + (plotB - plotT) * (1 - v); };

    // X 轴标签
    var step = courses.length > 14 ? 2 : 1;
    courses.forEach(function (cn, i) {
      if (i % step !== 0 && i !== courses.length - 1) return;
      ctx.fillStyle = '#A49CB8'; ctx.font = '500 22px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(String(i + 1), px(i), plotB + 16);
    });
    ctx.strokeStyle = '#E6DFF2'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(plotL, plotB); ctx.lineTo(plotR, plotB); ctx.stroke();

    // 各指标折线
    var any = false;
    SHARE_METRICS.forEach(function (m) {
      if (!chosen[m.key]) return;
      var pts = [];
      courses.forEach(function (cn, i) {
        var v = lessonVal(m.key, lessons[cn] || {});
        if (v == null) return;
        if (m.key === 'accuracy') v = Math.max(v, accFloorFor(s) / 100);
        pts.push({ x: px(i), y: py(v) });
      });
      if (!pts.length) return;
      any = true;
      ctx.strokeStyle = m.color; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      pts.forEach(function (p) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = m.color; ctx.stroke();
      });
    });
    if (!any) {
      ctx.fillStyle = '#A49CB8'; ctx.font = '500 26px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('暂无可展示的学习数据', (plotL + plotR) / 2, (plotT + plotB) / 2);
    }

    // 教师评语卡
    var cY = CMNT_Y;
    ctx.fillStyle = '#fff'; rr(ctx, 52, cY, W - 104, chH, 24); ctx.fill();
    ctx.fillStyle = '#FFC53D'; rr(ctx, 52, cY, 12, chH, 6); ctx.fill();
    ctx.fillStyle = '#2E2545'; ctx.font = '800 32px "PingFang SC",sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('📝 教师评语', 52 + 40, cY + 50);
    ctx.fillStyle = '#4A4360'; ctx.font = '400 28px "PingFang SC",sans-serif';
    cLines.forEach(function (ln, i) { ctx.fillText(ln, 52 + 40, cY + 92 + i * 42); });

    // 页脚
    var fY = cY + chH + FOOT_GAP;
    ctx.strokeStyle = '#F0E7F5'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(52, fY); ctx.lineTo(W - 52, fY); ctx.stroke();
    ctx.fillStyle = '#A49CB8'; ctx.font = '500 24px "PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(opts.footer || ('学员学习数据统计工作台 · 生成于 ' + new Date().toLocaleString('zh-CN')), W / 2, fY + 52);

    return cv;
  }

  global.SWBShare = {
    SHARE_METRICS: SHARE_METRICS,
    draw: drawShare,
    buildTeacherComment: buildTeacherComment,
    accFloorFor: accFloorFor,
    lessonScore: lessonScore,
    lessonVal: lessonVal,
    colorOf: colorOf,
    shortId: shortId,
    maskPhone: maskPhone,
    isUnassigned: isUnassigned,
    isHwDone: isHwDone
  };
})(window);
