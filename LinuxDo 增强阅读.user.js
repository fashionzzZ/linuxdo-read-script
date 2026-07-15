// ==UserScript==
// @name         LinuxDo 增强阅读
// @namespace    https://linux.do/
// @version      1.2.0
// @license      MIT
// @description  在 LINUX DO 列表页点击标题即可弹窗预览整帖，楼中楼展示、点赞、回复、收藏、原图灯箱一应俱全，并按真实阅读节奏上报已读进度——无需离开列表页，也无需反复返回。
// @author       Fashion
// @match        https://linux.do/*
// @icon         https://cdn3.ldstatic.com/optimized/4X/6/a/6/6a6affc7b1ce8140279e959d32671304db06d5ab_2_180x180.png
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const BASE = location.origin;
  const PAGE_SIZE = 20;          // 每次请求帖子数（与 Discourse 默认一致），也是 loadUp/loadDown 每次追加的数量
  const SLICE_RADIUS = 20;       // 双向切片：目标楼层前后各保留的"窗口半径"，单位是"楼层数"
  const READ_THRESHOLD = 1500;
  const FLUSH_INTERVAL = 5000;
  let ME_USERNAME = null;

  // --- 楼中楼分批加载 相关配置 ---
  const SUB_REPLY_INITIAL_SIZE = 3;
  const SUB_REPLY_PAGE_SIZE = 10;
  const REPLIES_HOVER_DELAY = 400;

  // --- 全局请求队列 & 429 退避重试 相关配置 ---
  // 所有只读 GET 请求（fetchJSON）统一走这个队列：任意时刻只有 1 个请求在途，
  // 且相邻两次请求之间至少间隔 REQUEST_MIN_INTERVAL 毫秒；命中 429 时按
  // 响应头 Retry-After（若有）或指数退避等待后自动重试。
  const REQUEST_MIN_INTERVAL = 300;   // 相邻请求最小间隔（毫秒）
  const RETRY_MAX_ATTEMPTS = 3;       // 429 最多重试次数（不含首次请求）
  const RETRY_BASE_DELAY = 500;       // 指数退避基础延迟（毫秒），实际延迟 = BASE * 2^attempt
  let lastRequestTime = 0;
  let requestQueueTail = Promise.resolve();

  const MENU_PANEL_SEL = '.menu-panel, .user-menu, .quick-access-panel, .notifications';
  const SEARCH_SEL = '.search-results, .fps-result, .search-menu, .search-menu-container, .search-result-topic';

  /* ============ 1. 样式 ============ */
  const style = document.createElement('style');
  style.textContent = `
    .ldp-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;
      align-items:center;justify-content:center;background:rgba(0,0,0,.55);}
    .ldp-modal{display:flex;flex-direction:column;
      width:90%;max-width:1000px;height:90vh;
      border-radius:12px;overflow:hidden;font-size:16px;
      line-height:1.65;background:var(--secondary,#fff);color:var(--primary,#222);
      box-shadow:0 16px 50px rgba(0,0,0,.4);}
    .ldp-header{display:flex;align-items:flex-start;gap:10px;padding:16px 20px;
      border-bottom:1px solid var(--primary-low,#e5e5e5);}
    .ldp-title{margin:0;font-size:18px;font-weight:700;}
    .ldp-meta{font-size:12px;opacity:.7;margin-top:4px;}
    .ldp-head-btns{display:flex;gap:8px;align-items:center;}
    .ldp-close{cursor:pointer;border:none;background:transparent;font-size:22px;
      line-height:1;color:inherit;padding:0 4px;}
    .ldp-body{flex:1;min-height:0;position:relative;
      padding:8px 20px 20px;overflow-y:auto;overscroll-behavior:contain;}

    /* 底部悬浮操作栏 */
    .ldp-footer{flex:none;display:flex;align-items:center;justify-content:space-around;
      padding:12px 24px;border-top:1px solid var(--primary-low,#eee);
      background:var(--secondary,#fff);}
    .ldp-fbtn{background:transparent;border:none;cursor:pointer;display:flex;
      align-items:center;gap:8px;font-size:.95rem;color:var(--primary-medium,#666);
      padding:8px 16px;border-radius:6px;transition:all .2s ease;font-weight:600;
      white-space:nowrap;text-decoration:none;}
    .ldp-fbtn:hover{background:var(--primary-low,#f0f0f0);color:var(--tertiary,#3b82f6);}
    .ldp-fbtn svg{width:18px;height:18px;fill:currentColor;flex:none;}
    .ldp-fbtn:disabled{cursor:default;opacity:.5;pointer-events:none;}
    .ldp-fbtn.loading{opacity:.6;pointer-events:none;}
    .ldp-fbtn.liked{color:#e74c3c;}
    .ldp-fbtn.liked svg{fill:#e74c3c;}
    .ldp-fbtn.bookmarked{color:var(--tertiary,#3b82f6);}
    .ldp-fbtn.bookmarked svg{fill:var(--tertiary,#3b82f6);}

    /* 楼主帖自身的点赞/回复按钮已挪到底部操作栏，这里隐藏原位置 */
    .ldp-topic > .ldp-post > .ldp-actions{display:none;}

    /* 骨架屏 */
    .ldp-loadmask{position:absolute;inset:0;z-index:5;
      padding:8px 20px 20px;overflow:hidden;
      background:var(--secondary,#fff);color:inherit;}
    .ldp-loadmask.hide{opacity:0;pointer-events:none;transition:opacity .25s ease;}
    .ldp-sk{position:relative;overflow:hidden;border-radius:6px;
      background:var(--primary-low,#e9e9e9);}
    .ldp-sk::after{content:"";position:absolute;inset:0;
      transform:translateX(-100%);
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);
      animation:ldp-shimmer 1.2s infinite;}
    @keyframes ldp-shimmer{100%{transform:translateX(100%);}}
    .ldp-sk-title{height:18px;width:55%;border-radius:6px;
      display:inline-block;vertical-align:middle;}
    .ldp-sk-meta{height:11px;width:35%;border-radius:5px;
      display:inline-block;}
    .ldp-sk-head{display:flex;align-items:center;gap:10px;margin:12px 0 10px;}
    .ldp-sk-avatar{width:32px;height:32px;border-radius:50%;flex:none;}
    .ldp-sk-line{height:12px;}
    .ldp-sk-w30{width:30%;}.ldp-sk-w40{width:40%;}.ldp-sk-w60{width:60%;}
    .ldp-sk-w80{width:80%;}.ldp-sk-w90{width:90%;}.ldp-sk-w100{width:100%;}
    .ldp-sk-para .ldp-sk-line{margin-bottom:8px;}
    .ldp-sk-divider{height:1px;background:var(--primary-low,#e0e0e0);margin:16px 0 12px;}
    .ldp-sk-comment{display:flex;gap:10px;margin-bottom:18px;}
    .ldp-sk-comment .ldp-sk-avatar{width:28px;height:28px;}
    .ldp-sk-cbody{flex:1;}

    /* 楼主帖区块 */
    .ldp-topic{padding:4px 0 14px;}
    .ldp-topic .ldp-post{border-bottom:none;}

    /* 评论区分隔 + 左上角"评论"标题 */
    .ldp-comments-header{display:flex;align-items:center;gap:8px;
      margin:6px 0 2px;padding-top:14px;border-top:2px solid var(--primary-low,#e0e0e0);
      font-size:16px;font-weight:700;letter-spacing:.5px;}
    .ldp-comments-header::before{content:"💬";font-size:14px;}
    .ldp-comments-count{font-size:12px;font-weight:500;opacity:.6;}
    .ldp-comments{padding-top:4px;}
    .ldp-comments-empty{padding:18px 0;text-align:center;opacity:.5;font-size:13px;}

    .ldp-post{padding:12px 0 12px 12px;border-bottom:1px solid var(--primary-low,#eee);}
    .ldp-post.ldp-flash{animation:ldp-flash-bg 1.6s ease;}
    @keyframes ldp-flash-bg{
      0%{background:rgba(8,132,255,.16);}
      100%{background:transparent;}
    }
    .ldp-post-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
    .ldp-avatar{width:28px;height:28px;border-radius:50%;}
    .ldp-author{font-weight:600;}
    .ldp-op{font-size:11px;font-weight:700;color:#fff;background:var(--tertiary,#08c);
      border-radius:4px;padding:1px 6px;letter-spacing:.5px;}
    .ldp-me{font-size:11px;font-weight:700;color:#fff;background:#3ea66b;
      border-radius:4px;padding:1px 6px;letter-spacing:.5px;}
    .ldp-user{font-size:12px;opacity:.6;}
    .ldp-time{font-size:12px;opacity:.55;}
    .ldp-floor{font-size:12px;opacity:.5;margin-left:auto;
      padding-left:8px;white-space:nowrap;}
    .ldp-content img{max-width:100%;height:auto;cursor:zoom-in;border-radius:4px;}
    .ldp-content pre{overflow:auto;background:var(--primary-very-low,#f6f6f6);
      padding:10px;border-radius:6px;}
    .ldp-children{margin-left:22px;
      border-left:1px solid var(--tertiary,#08c);}
    .ldp-actions{display:flex;gap:14px;margin-top:8px;font-size:12px;align-items:center;}
    .ldp-btn{cursor:pointer;border:none;background:transparent;color:inherit;
      opacity:.7;display:inline-flex;align-items:center;gap:4px;padding:2px 4px;}
    .ldp-btn:hover{opacity:1;}
    .ldp-btn:disabled{cursor:default;opacity:.4;}
    .ldp-like.liked{color:var(--love,#e25822);opacity:1;font-weight:600;}

    .ldp-replybox{margin-top:8px;display:none;position:relative;}
    .ldp-replybox.open{display:block;}
    .ldp-replybox textarea{width:100%;min-height:90px;box-sizing:border-box;
      border:1px solid var(--primary-low,#ccc);border-radius:6px;padding:8px;
      font:inherit;background:var(--secondary,#fff);color:inherit;resize:vertical;}
    .ldp-replybox textarea.uploading{opacity:0.6;pointer-events:none;}
    .ldp-send{margin-top:6px;background:var(--tertiary,#08c);color:#fff;border:none;
      border-radius:6px;padding:6px 14px;cursor:pointer;}
    .ldp-reply-tip{margin-left:10px;font-size:12px;color:#3ea66b;opacity:0;
      transition:opacity .25s ease;}
    .ldp-reply-tip.show{opacity:1;}

    .ldp-loading-tip{padding:14px 0;text-align:center;font-size:13px;
      color:var(--primary-medium,#888);display:none;user-select:none;}
    .ldp-loading-tip.show{display:block;}
    .ldp-loading-tip .ldp-tip-icon{display:inline-block;margin-right:6px;
      animation:ldp-spin .9s linear infinite;}
    @keyframes ldp-spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}

    /* 上方/下方懒加载触发提示 */
    .ldp-load-up-tip,.ldp-load-down-tip{
      padding:10px 0;text-align:center;font-size:12px;
      color:var(--primary-medium,#999);user-select:none;display:none;}
    .ldp-load-up-tip.show,.ldp-load-down-tip.show{display:block;}
    .ldp-load-up-tip .ldp-tip-icon,.ldp-load-down-tip .ldp-tip-icon{
      display:inline-block;margin-right:4px;animation:ldp-spin .9s linear infinite;}

    .ldp-bottom-tip{padding:16px 0;text-align:center;font-size:13px;
      color:var(--primary-medium,#888);user-select:none;}
    .ldp-top-tip{padding:10px 0;text-align:center;font-size:13px;
      color:var(--primary-medium,#888);user-select:none;}

    /* 灯箱 */
    .ldp-lightbox{position:fixed;inset:0;z-index:2147483600;display:flex;
      flex-direction:column;background:rgba(0,0,0,.9);}
    .ldp-lb-stage{flex:1;overflow:auto;display:flex;align-items:center;
      justify-content:center;padding:20px;}
    .ldp-lb-stage img{display:block;max-width:94vw;max-height:88vh;
      width:auto;height:auto;border-radius:4px;cursor:zoom-out;
      box-shadow:0 10px 40px rgba(0,0,0,.6);}
    .ldp-lb-x{position:fixed;top:14px;right:18px;z-index:1;cursor:pointer;border:none;
      background:transparent;color:#fff;font-size:30px;line-height:1;}

    /* 楼中楼"展示更多回复"按钮 */
    .ldp-sub-actions{margin-left:22px;padding-left:14px;margin-top:2px;display:none;}
    .ldp-load-more-replies{font-size:12px;color:var(--tertiary,#08c);font-weight:600;
      opacity:.9;padding:4px 0;}
    .ldp-load-more-replies:hover{opacity:1;text-decoration:underline;}
    .ldp-sub-loading{font-size:12px;opacity:.5;margin-left:22px;padding-left:14px;
      margin-top:2px;display:none;}

    /* ============ Boost 样式 ============ */
    .ldp-boosts-list{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:6px;min-height:0;}
    .ldp-boost-bubble{display:inline-flex;align-items:center;gap:4px;
      padding:3px 8px 3px 4px;border:none;
      background:rgba(128,128,128,.1);border-radius:50px;
      font-size:14px;line-height:1.4;cursor:default;position:relative;
      transition:background .15s;}
    .ldp-boost-bubble:hover{background:rgba(128,128,128,.18);}
    .ldp-b-avatar{width:18px;height:18px;border-radius:50%;flex:none;display:block;}
    .ldp-boost-bubble p{margin:0;display:inline-flex;gap:2px;align-items:center;flex-wrap:wrap;}
    .ldp-boost-bubble p img.emoji{width:14px;height:14px;margin:0;vertical-align:middle;}
    .ldp-boost-del{cursor:pointer;margin-left:2px;opacity:0;font-size:13px;
      color:var(--danger,#cc4b4b);line-height:1;border:none;background:transparent;
      padding:0 2px;transition:opacity .15s;flex:none;}
    .ldp-boost-bubble:hover .ldp-boost-del{opacity:.65;}
    .ldp-boost-del:hover{opacity:1!important;}
    .ldp-boost-input-wrap{display:none;align-items:center;gap:5px;margin-top:6px;
      padding:4px 6px;border-radius:8px;
      border:1px solid var(--primary-low,#ddd);
      background:var(--secondary,#fff);}
    .ldp-boost-input-wrap.open{display:flex;}
    .ldp-boost-input{flex:1;border:none;background:transparent;outline:none;
      font-size:13px;padding:2px 4px;color:inherit;min-width:0;}
    .ldp-boost-input::placeholder{color:var(--primary-medium,#999);font-size:12px;}
    .ldp-boost-submit{width:22px;height:22px;padding:0;display:flex;flex:none;
      align-items:center;justify-content:center;border-radius:50%;
      border:1px solid #3ea66b;background:transparent;color:#3ea66b;
      cursor:pointer;font-size:14px;line-height:1;transition:all .15s;}
    .ldp-boost-submit:hover{background:#3ea66b;color:#fff;}
    .ldp-boost-submit:disabled{opacity:.5;cursor:default;pointer-events:none;}
    .ldp-boost-cancel{width:22px;height:22px;padding:0;display:flex;flex:none;
      align-items:center;justify-content:center;border-radius:50%;
      border:1px solid var(--danger,#cc4b4b);background:transparent;
      color:var(--danger,#cc4b4b);cursor:pointer;font-size:16px;line-height:1;
      transition:all .15s;}
    .ldp-boost-cancel:hover{background:var(--danger,#cc4b4b);color:#fff;}
    .ldp-btn.ldp-boost-btn{font-size:12px;}
    .ldp-btn.ldp-boost-btn:disabled{opacity:.35;cursor:default;pointer-events:none;}
  `;
  document.head.appendChild(style);

  /* 图标 */
  const ICONS = {
    like: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
    reply: '<path d="M1024 640q0 94.857143-72.571429 257.714286-1.714286 4-6 13.714286t-7.714286 17.142857-7.428571 12.571429q-6.857143 9.714286-16 9.714286-8.571429 0-13.428571-5.714286t-4.857143-14.285714q0-5.142857 1.428571-15.142857t1.428571-13.428571q2.857143-38.857143 2.857143-70.285714 0-57.714286-10-103.428571t-27.714286-79.142857-45.714286-57.714286-60.285714-39.714286-76-24.285714-88-12.285714-100.285714-3.428571l-128 0 0 146.285714q0 14.857143-10.857143 25.714286t-25.714286 10.857143-25.714286-10.857143l-292.571429-292.571429q-10.857143-10.857143-10.857143-25.714286t10.857143-25.714286l292.571429-292.571429q10.857143-10.857143 25.714286-10.857143t25.714286 10.857143 10.857143 25.714286l0 146.285714 128 0q407.428571 0 500 230.285714 30.285714 76.571429 30.285714 190.285714z"/>',
    boost: '<path d="M1010.092957 38.19946a31.779551 31.779551 0 0 0-24.399655-24.399655C921.294212 0 870.914925 0 820.715635 0c-206.397081 0-330.195331 110.398439-422.574025 255.99638H189.744557A95.998643 95.998643 0 0 0 104.005769 308.975631l-98.838602 197.597206A47.999321 47.999321 0 0 0 48.146559 575.991855h207.537065l-44.939364 44.939365a63.999095 63.999095 0 0 0 0 90.49872l101.79856 101.81856a63.999095 63.999095 0 0 0 90.51872 0L448.000905 768.309136V975.986199a47.999321 47.999321 0 0 0 69.399019 42.979392l197.397208-98.778603a95.818645 95.818645 0 0 0 52.999251-85.798787V625.571154c145.177947-92.598691 255.99638-216.796934 255.99638-422.17403 0.199997-50.399287 0.199997-100.798575-13.699806-165.197664zM767.99638 335.995249a79.998869 79.998869 0 1 1 79.998869-79.998869 79.998869 79.998869 0 0 1-79.998869 79.998869z"/>',
    bookmark: '<path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/>',
    newTab: '<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>'
  };

  /* ============ 2. 工具函数 ============ */
  const esc = (s) => (s || '').replace(/[<>&]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  function fmtTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const diff = Date.now() - t;
    const min = 60000, hour = 60 * min, day = 24 * hour;
    if (diff < min) return '刚刚';
    if (diff < hour) return Math.floor(diff / min) + ' 分钟前';
    if (diff < day) return Math.floor(diff / hour) + ' 小时前';
    if (diff < 30 * day) return Math.floor(diff / day) + ' 天前';
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  const csrfToken = () =>
      (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /**
   * queueRequest：把一个异步任务串行接到全局请求队列尾部。
   * 保证：
   *   1. 任意时刻只有一个任务在执行（不会并发发请求）；
   *   2. 每个任务开始前，距离上一个任务发起时间至少隔 REQUEST_MIN_INTERVAL 毫秒；
   *   3. 某个任务失败不会卡住队列，后续任务照常按顺序执行。
   */
  function queueRequest(task) {
    const run = requestQueueTail.then(async () => {
      const wait = REQUEST_MIN_INTERVAL - (Date.now() - lastRequestTime);
      if (wait > 0) await sleep(wait);
      lastRequestTime = Date.now();
      return task();
    });
    requestQueueTail = run.catch(() => {}); // 吞掉错误，避免影响队列后续任务
    return run;
  }

  async function fetchJSON(url) {
    return queueRequest(() => fetchWithRetry(url));
  }

  /**
   * fetchWithRetry：实际发起请求；命中 429 时按 Retry-After 响应头
   * （若服务端提供）或指数退避（500ms → 1000ms → 2000ms）等待后重试，
   * 最多重试 RETRY_MAX_ATTEMPTS 次；其他非 2xx 状态码不重试，直接抛出。
   */
  async function fetchWithRetry(url) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        credentials: 'include', headers: { 'Accept': 'application/json' },
      });
      if (res.ok) return res.json();
      if (res.status === 429 && attempt < RETRY_MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : RETRY_BASE_DELAY * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
      throw new Error('HTTP ' + res.status);
    }
  }

  async function apiSend(url, method, params, extraHeaders) {
    const opt = {
      method,
      credentials: 'include',
      headers: Object.assign({
        'Accept': 'application/json',
        'X-CSRF-Token': csrfToken(),
        'X-Requested-With': 'XMLHttpRequest',
      }, extraHeaders || {}),
    };
    if (params instanceof FormData) {
      opt.body = params;
    } else if (params) {
      opt.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      opt.body = new URLSearchParams(params).toString();
    }
    const res = await fetch(url, opt);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json().catch(() => ({}));
  }

  async function ensureMe() {
    if (ME_USERNAME !== null) return ME_USERNAME;
    try {
      const s = await fetchJSON(`${BASE}/session/current.json`);
      ME_USERNAME = (s.current_user && s.current_user.username) || '';
    } catch (e) { ME_USERNAME = ''; }
    return ME_USERNAME;
  }

  function likeInfo(p) {
    const like = (p.actions_summary || []).find((a) => a.id === 2) || {};
    return { count: like.count || 0, acted: !!like.acted, canAct: !!like.can_act };
  }

  /* ============ 2.5 通知链接解析 ============ */
  /**
   * 解析当前页面 URL 或传入的 href，提取 topicId 和可选的 targetPostNumber。
   * 支持格式：
   *   /t/slug/123           → topicId=123, target=null（首次/已读跳转）
   *   /t/slug/123/456       → topicId=123, target=456
   *   /t/123                → topicId=123
   *   /t/123/456            → topicId=123, target=456
   */
  function parseTopicHref(href) {
    if (!href) return null;
    // 带 slug：/t/slug/id  或  /t/slug/id/postNumber
    let m = href.match(/\/t\/[^/]+\/(\d+)(?:\/(\d+))?/);
    if (m) return { topicId: m[1], targetPostNumber: m[2] ? +m[2] : null };
    // 无 slug：/t/id  或  /t/id/postNumber
    m = href.match(/\/t\/(\d+)(?:\/(\d+))?/);
    if (m) return { topicId: m[1], targetPostNumber: m[2] ? +m[2] : null };
    return null;
  }

  /* ============ 2.6 Boosts 气泡渲染辅助 ============ */
  function renderBoosts(boosts) {
    if (!boosts || !boosts.length) return '';
    return boosts.map((b) => {
      const bAvatar = b.user && b.user.avatar_template
          ? BASE + b.user.avatar_template.replace('{size}', '36') : '';
      const canDel = !!b.can_delete;
      return `<div class="ldp-boost-bubble" data-boost-id="${b.id}">` +
          (bAvatar ? `<img class="ldp-b-avatar" src="${bAvatar}" alt="">` : '') +
          `<p>${b.cooked || ''}</p>` +
          (canDel ? `<button class="ldp-boost-del" title="删除此Boost">×</button>` : '') +
          `</div>`;
    }).join('');
  }

  /* ============ 3. 单图灯箱 ============ */
  function openLightbox(src) {
    if (!src) return;
    const lb = document.createElement('div');
    lb.className = 'ldp-lightbox';
    lb.innerHTML = `
      <button class="ldp-lb-x" title="关闭（Esc）">×</button>
      <div class="ldp-lb-stage"><img alt=""></div>`;
    const stage = lb.querySelector('.ldp-lb-stage');
    const img = lb.querySelector('.ldp-lb-stage img');
    img.src = src;
    const close = () => { lb.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    lb.querySelector('.ldp-lb-x').addEventListener('click', close);
    img.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    stage.addEventListener('click', (e) => { if (e.target === stage) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(lb);
  }

  function resolveOriginalSrc(imgEl) {
    const a = imgEl.closest('a.lightbox, a[href]');
    if (a && a.getAttribute('href')) {
      const href = a.getAttribute('href');
      if (/\.(png|jpe?g|gif|webp|bmp|avif)(\?|#|$)/i.test(href) || a.classList.contains('lightbox')) {
        return href;
      }
    }
    return imgEl.getAttribute('data-large-src') || imgEl.currentSrc || imgEl.src;
  }

  /* ============ 4. 已读追踪器 ============ */
  function createReadTracker(topicId, scrollRoot) {
    const dwell = new Map();
    const reported = new Map();
    const visible = new Set();
    let lastTick = Date.now();
    let tickTimer = null, flushTimer = null;

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const pn = +en.target.dataset.postNumber;
        if (!pn) return;
        if (en.isIntersecting && en.intersectionRatio >= 0.5) visible.add(pn);
        else visible.delete(pn);
      });
    }, { root: scrollRoot, threshold: [0, 0.5, 1] });

    const tick = () => {
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;
      if (document.visibilityState === 'visible') {
        visible.forEach((pn) => dwell.set(pn, (dwell.get(pn) || 0) + delta));
      }
    };

    const markRead = (pn) => {
      const node = scrollRoot.querySelector(`.ldp-post[data-post-number="${pn}"]`);
      if (node) node.classList.add('ldp-read');
    };

    const flush = async () => {
      const params = { topic_id: topicId };
      let total = 0, any = false;
      dwell.forEach((ms, pn) => {
        if (ms < READ_THRESHOLD) return;
        const inc = ms - (reported.get(pn) || 0);
        if (inc <= 0) return;
        params[`timings[${pn}]`] = inc;
        total += inc;
        reported.set(pn, ms);
        any = true;
      });
      if (!any) return;
      params.topic_time = total;
      try {
        await apiSend(`${BASE}/topics/timings`, 'POST', params, { 'X-SILENCE-LOGGER': 'true' });
        Object.keys(params).forEach((k) => {
          const m = k.match(/^timings\[(\d+)\]$/);
          if (m) markRead(+m[1]);
        });
      } catch (e) {
        Object.keys(params).forEach((k) => {
          const m = k.match(/^timings\[(\d+)\]$/);
          if (m) reported.set(+m[1], (reported.get(+m[1]) || 0) - params[k]);
        });
      }
    };

    return {
      observe(node) { if (node) io.observe(node); },
      start() {
        lastTick = Date.now();
        tickTimer = setInterval(tick, 1000);
        flushTimer = setInterval(flush, FLUSH_INTERVAL);
      },
      stop() {
        clearInterval(tickTimer);
        clearInterval(flushTimer);
        io.disconnect();
        tick();
        flush();
      },
    };
  }

  /* ============ 5. 双向切片加载器 ============ */
  /**
   * createSliceLoader：替换原先的顺序 pump 加载器。
   *
   * 核心思路：
   *   - init() 获取完整 stream 数组（所有 post_id），同时拿到已读进度、1 楼原帖。
   *   - calcWindow(targetPostNumber) 根据目标楼层在 stream 中的位置，计算初始渲染窗口：
   *       [windowStart, windowEnd)  ← 均以 stream 下标表示
   *     并让 upCursor = windowStart、downCursor = windowEnd，后续向两端扩展。
   *   - fetchSlice(ids) 批量请求帖子数据，写入 cache。
   *   - loadDown() / loadUp() 对外暴露：向下/向上各追加一批。
   *     向上追加时返回 { posts, heightBefore } 以便调用方做高度补偿防跳动。
   */
  function createSliceLoader(topicId) {
    let stream = [];          // 全部 post_id（不含 1 楼）
    let streamFull = [];      // 包含 1 楼的原始 stream
    const cache = new Map();  // postId → post 数据
    let topic = null;

    // 双向游标（stream 数组下标）
    let upCursor = 0;         // 上方还能加载的起始位置（向上加载时往前移）
    let downCursor = 0;       // 下方还能加载的起始位置（向下加载时往后移）

    // 各方向是否已到达边界
    let topReached = false;
    let bottomReached = false;

    // ---- 网络请求 ----
    async function fetchSlice(ids) {
      const missing = ids.filter((id) => !cache.has(id));
      if (!missing.length) return;
      for (let attempt = 0; attempt < 2 && missing.length; attempt++) {
        const qs = missing.map((id) => `post_ids[]=${id}`).join('&');
        try {
          const part = await fetchJSON(`${BASE}/t/${topicId}/posts.json?${qs}`);
          part.post_stream.posts.forEach((p) => cache.set(p.id, p));
        } catch (e) { /* 失败静默，由上层决策 */ }
        // 重算 missing
        const stillMissing = missing.filter((id) => !cache.has(id));
        missing.length = 0;
        stillMissing.forEach((id) => missing.push(id));
      }
    }

    // ---- 初始化 ----
    async function init() {
      await ensureMe();
      const res = await fetch(`${BASE}/t/${topicId}.json?track_visit=true&forceLoad=true`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Discourse-Present': 'true',
          'Discourse-Track-View': 'true',
          'Discourse-Track-View-Topic-Id': String(topicId),
        },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      topic = data;
      streamFull = data.post_stream.stream || [];
      // stream 不含 1 楼（1 楼永久常驻，单独处理）
      stream = streamFull.filter((id) => {
        const cached = data.post_stream.posts.find((p) => p.id === id);
        return !(cached && cached.post_number === 1);
      });
      data.post_stream.posts.forEach((p) => cache.set(p.id, p));

      const op = (topic.details && topic.details.created_by && topic.details.created_by.username)
          || (data.post_stream.posts.find((p) => p.post_number === 1) || {}).username
          || null;
      topic._opUsername = op;
      topic._opPost = data.post_stream.posts.find((p) => p.post_number === 1) || null;
      return topic;
    }

    /**
     * calcWindow：根据目标楼层（post_number）计算初始切片窗口，
     * 并预加载这批数据到 cache。
     *
     * 三种场景：
     *   targetPostNumber == null → 未看过，从头加载（windowStart=0）
     *   targetPostNumber > 0     → 跳转到指定楼层（居中对齐）
     */
    async function calcWindow(targetPostNumber) {
      if (!targetPostNumber || targetPostNumber <= 1) {
        // 场景 A：从头加载
        upCursor = 0;
        downCursor = Math.min(PAGE_SIZE, stream.length);
        topReached = true;
        bottomReached = downCursor >= stream.length;
        const ids = stream.slice(0, downCursor);
        await fetchSlice(ids);
        return {
          posts: ids.map((id) => cache.get(id)).filter(Boolean),
          targetPostNumber: null,
        };
      }

      // 场景 B/C：跳转到指定楼层 —— 找到其在 stream 中的下标
      // 注意：targetPostNumber-2 只是"假设没有楼层被删除"时的近似值。
      // 一旦帖子里有楼层被删除，post_number 和 stream 数组下标就不再一一对应，
      // 窗口半径较小时（SLICE_RADIUS=20）这个偏差很容易让目标楼层落到窗口外，
      // 导致最后 locatePost 找不到节点、无法自动滚动过去。
      // 因此这里优先问服务端要一份"精确定位"的数据（Discourse 支持 post_number 参数，
      // 会返回真实围绕该楼层的帖子），用返回的真实 post_id 在 stream 里 indexOf 拿到准确下标；
      // 只有这次请求失败时才退回旧的估算法兜底。
      let safeIdx = null;
      try {
        const anchor = await fetchJSON(`${BASE}/t/${topicId}.json?post_number=${targetPostNumber}`);
        const anchorPosts = (anchor.post_stream && anchor.post_stream.posts) || [];
        anchorPosts.forEach((p) => cache.set(p.id, p));
        const exactPost = anchorPosts.find((p) => p.post_number === targetPostNumber);
        if (exactPost) {
          const idx = stream.indexOf(exactPost.id);
          if (idx >= 0) safeIdx = idx;
        }
      } catch (e) { /* 精确定位请求失败，退回估算 */ }

      if (safeIdx === null) {
        const approxIdx = Math.max(0, targetPostNumber - 2); // stream 不含 1 楼，故 -2
        safeIdx = Math.min(approxIdx, stream.length - 1);
      }

      // 窗口半径直接就是 SLICE_RADIUS（楼层数），目标楼层前后各约 20 楼
      const halfWindow = SLICE_RADIUS;
      let wStart = Math.max(0, safeIdx - halfWindow);
      let wEnd = Math.min(stream.length, safeIdx + halfWindow);

      upCursor = wStart;
      downCursor = wEnd;
      topReached = wStart === 0;
      bottomReached = wEnd >= stream.length;

      let ids = stream.slice(wStart, wEnd);
      await fetchSlice(ids);

      // 尝试精确定位 targetPostNumber（用已加载数据校正）
      let exactTargetId = null;
      for (const id of ids) {
        const p = cache.get(id);
        if (p && p.post_number === targetPostNumber) { exactTargetId = id; break; }
      }

      // 兜底：极端情况下（比如精确定位请求也失败、又叠加估算偏差）目标仍不在窗口内，
      // 按 SLICE_RADIUS 为步长向两侧各多扩展一批，尽量避免彻底找不到目标
      const EXPAND_MAX = 3;
      for (let i = 0; i < EXPAND_MAX && !exactTargetId && !(topReached && bottomReached); i++) {
        if (!bottomReached) {
          const end = Math.min(wEnd + halfWindow, stream.length);
          const extra = stream.slice(wEnd, end);
          if (extra.length) {
            await fetchSlice(extra);
            ids = ids.concat(extra);
            wEnd = end;
            downCursor = wEnd;
            bottomReached = wEnd >= stream.length;
          } else {
            bottomReached = true;
          }
        }
        for (const id of ids) {
          const p = cache.get(id);
          if (p && p.post_number === targetPostNumber) { exactTargetId = id; break; }
        }
        if (exactTargetId || (topReached && bottomReached)) break;

        if (!topReached) {
          const start = Math.max(0, wStart - halfWindow);
          const extra = stream.slice(start, wStart);
          if (extra.length) {
            await fetchSlice(extra);
            ids = extra.concat(ids);
            wStart = start;
            upCursor = wStart;
            topReached = wStart === 0;
          } else {
            topReached = true;
          }
        }
        for (const id of ids) {
          const p = cache.get(id);
          if (p && p.post_number === targetPostNumber) { exactTargetId = id; break; }
        }
      }

      return {
        posts: ids.map((id) => cache.get(id)).filter(Boolean),
        targetPostNumber,
        targetPostId: exactTargetId,
      };
    }

    /** 向下追加一批 */
    async function loadDown() {
      if (bottomReached) return { posts: [], done: true };
      const end = Math.min(downCursor + PAGE_SIZE, stream.length);
      const ids = stream.slice(downCursor, end);
      await fetchSlice(ids);
      downCursor = end;
      bottomReached = downCursor >= stream.length;
      return {
        posts: ids.map((id) => cache.get(id)).filter(Boolean),
        done: bottomReached,
      };
    }

    /** 向上追加一批（需调用方做高度补偿） */
    async function loadUp() {
      if (topReached) return { posts: [], done: true };
      const start = Math.max(0, upCursor - PAGE_SIZE);
      const ids = stream.slice(start, upCursor);
      await fetchSlice(ids);
      upCursor = start;
      topReached = upCursor === 0;
      return {
        posts: ids.map((id) => cache.get(id)).filter(Boolean),
        done: topReached,
      };
    }

    return {
      fetchSlice,
      loadDown,
      loadUp,
      get topic() { return topic; },
      get topReached() { return topReached; },
      get bottomReached() { return bottomReached; },
      get cache() { return cache; },
      get stream() { return stream; },
      set stream(val) { stream = val; },
      // 允许外部设置游标状态（用于阶段2初始化）
      set upCursor(val) { upCursor = val; },
      set downCursor(val) { downCursor = val; },
      set topReached(val) { topReached = val; },
      set bottomReached(val) { bottomReached = val; },
    };
  }

  /* ============ 6. 楼层归位 ============ */
  function attachPost(p, ctx) {
    if (p.post_number === 1) {
      // 1 楼永久常驻：已存在则跳过（防止重复渲染）
      if (ctx.topicEl.querySelector('.ldp-post')) return;
      const node = renderPost(p, false, ctx);
      ctx.topicEl.appendChild(node);
      ctx.tracker.observe(node);
      return;
    }
    if (ctx.nodeMap.has(p.post_number)) return;

    const parentNum = p.reply_to_post_number;
    const node = renderPost(p, !!(parentNum && parentNum !== 1), ctx);
    ctx.nodeMap.set(p.post_number, node);

    const parentNode = parentNum && parentNum !== 1 ? ctx.nodeMap.get(parentNum) : null;
    if (parentNum && parentNum !== 1 && !parentNode) {
      ctx.pending.push({ num: p.post_number, parent: parentNum });
      ctx.commentsEl.appendChild(node);
    } else if (parentNode) {
      parentNode.querySelector(':scope > .ldp-children').appendChild(node);
    } else {
      ctx.commentsEl.appendChild(node);
    }
    ctx.tracker.observe(node);
    if (p.reply_count > 0) ctx.repliesIO.observe(node);
  }

  function reflowPending(ctx) {
    if (!ctx.pending.length) return;
    const rest = [];
    ctx.pending.forEach((it) => {
      const child = ctx.nodeMap.get(it.num);
      const parent = ctx.nodeMap.get(it.parent);
      if (child && parent) {
        parent.querySelector(':scope > .ldp-children').appendChild(child);
      } else {
        rest.push(it);
      }
    });
    ctx.pending = rest;
  }

  /* ============ 7. 渲染单条 ============ */
  function renderPost(p, isReply, ctx) {
    const avatar = p.avatar_template
        ? BASE + p.avatar_template.replace('{size}', '48') : '';
    const { count, acted, canAct } = likeInfo(p);
    const isOP = ctx.op && p.username === ctx.op;
    const isME = ME_USERNAME && p.username === ME_USERNAME;
    const time = fmtTime(p.created_at);

    let cooked = p.cooked || '';
    cooked = (() => {
      const tmp = document.createElement('div');
      tmp.innerHTML = cooked;
      tmp.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const isImageLink = /\.(png|jpe?g|gif|webp|bmp|avif)(\?|#|$)/i.test(href);
        const isLightbox = a.classList.contains('lightbox');
        if (!isImageLink && !isLightbox) {
          if (!a.getAttribute('target')) a.setAttribute('target', '_blank');
        }
      });
      return tmp.innerHTML;
    })();

    const boostsHtml = renderBoosts(p.boosts || []);
    const canBoost = p.can_boost === true;

    const node = document.createElement('div');
    node.className = 'ldp-post' + (isReply ? ' ldp-reply' : '');
    node.dataset.postId = p.id;
    node.dataset.postNumber = p.post_number;
    node.innerHTML = `
      <div class="ldp-post-head">
        ${avatar ? `<img class="ldp-avatar" src="${avatar}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="ldp-author">${esc(p.name || p.username)}</span>
        <span class="ldp-user">@${esc(p.username)}</span>
        ${isOP ? '<span class="ldp-op">OP</span>' : ''}
        ${isME ? '<span class="ldp-me">ME</span>' : ''}
        ${time ? `<span class="ldp-time">· ${esc(time)}</span>` : ''}
        <span class="ldp-floor">#${p.post_number}</span>
      </div>
      <div class="ldp-content">${cooked}</div>
      <div class="ldp-boosts-list">${boostsHtml}</div>
      <div class="ldp-boost-input-wrap">
        <input type="text" class="ldp-boost-input" maxlength="50"
          placeholder="Boost ${esc(p.username)}… (最多16字符)">
        <button class="ldp-boost-submit" title="发送">✓</button>
        <button class="ldp-boost-cancel" title="取消">×</button>
      </div>
      <div class="ldp-actions">
        <button class="ldp-btn ldp-like ${acted ? 'liked' : ''}"
          data-acted="${acted ? '1' : '0'}" ${canAct || acted ? '' : 'disabled'} title="点赞">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;vertical-align:middle;">${ICONS.like}</svg>
          <span class="ldp-like-count">${count}</span>
        </button>
        <button class="ldp-btn ldp-replybtn" title="回复">
            <svg viewBox="0 0 1024 1024" style="width:12px;height:12px;fill:currentColor;vertical-align:middle;">${ICONS.reply}</svg>
        </button>
        <button class="ldp-btn ldp-boost-btn" ${canBoost ? '' : 'disabled'} title="Boost">
          <svg viewBox="0 0 1024 1024" style="width:12px;height:12px;fill:currentColor;vertical-align:middle;">${ICONS.boost}</svg>
        </button>
      </div>
      <div class="ldp-children"></div>
      <div class="ldp-sub-loading">加载楼中楼中…</div>
      <div class="ldp-sub-actions"><button class="ldp-btn ldp-load-more-replies">展示更多回复 ↓</button></div>
    `;
    return node;
  }

  /* ============ 8. 回复框 ============ */
  function ensureReplyBox(post) {
    let box = post.querySelector(':scope > .ldp-replybox');
    if (box) return box;
    const username = (post.querySelector(':scope > .ldp-post-head .ldp-user')?.textContent || '').replace(/^@/, '');
    box = document.createElement('div');
    box.className = 'ldp-replybox';
    box.innerHTML = `<textarea placeholder="回复 @${esc(username)} … (最少16个字符)"></textarea><button class="ldp-send">发送</button><span class="ldp-reply-tip">✓ 已发送</span>`;
    const textarea = box.querySelector('textarea');
    bindPasteEvent(textarea);
    const actions = post.querySelector(':scope > .ldp-actions');
    if (actions) actions.after(box);
    else post.appendChild(box);
    return box;
  }

  /* ============ 图片粘贴上传 ============ */
  async function uploadImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'composer');
    formData.append('synchronous', 'true');
    return apiSend(`${BASE}/uploads.json`, 'POST', formData);
  }

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    textarea.value = val.substring(0, start) + text + val.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
  }

  function bindPasteEvent(textarea) {
    textarea.addEventListener('paste', async (e) => {
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const placeholder = `[正在上传图片 ${file.name} ...]`;
          insertAtCursor(textarea, placeholder);
          textarea.classList.add('uploading');
          try {
            const res = await uploadImage(file);
            if (res && res.short_url) {
              const markdown = `![${res.original_filename}|${res.width}x${res.height}](${res.short_url})`;
              textarea.value = textarea.value.replace(placeholder, markdown);
            } else {
              throw new Error('上传返回数据异常');
            }
          } catch (err) {
            textarea.value = textarea.value.replace(placeholder, `[图片上传失败: ${err.message}]`);
          } finally {
            textarea.classList.remove('uploading');
          }
        }
      }
    });
  }

  /* ============ 9. 楼中楼分批渲染 ============ */
  function renderSubReplyBatch(postNumber, ctx) {
    const state = ctx.subReplyState.get(postNumber);
    const parentNode = ctx.nodeMap.get(postNumber)
        || ctx.topicEl.querySelector(`.ldp-post[data-post-number="${postNumber}"]`);
    if (!state || !parentNode) return;

    const start = state.renderedCount;
    const limit = start === 0 ? SUB_REPLY_INITIAL_SIZE : SUB_REPLY_PAGE_SIZE;
    const batch = state.all.slice(start, start + limit);

    batch.forEach((rp) => {
      if (!rp.reply_to_post_number) rp.reply_to_post_number = postNumber;
      attachPost(rp, ctx);
    });
    state.renderedCount += batch.length;
    reflowPending(ctx);

    const actionEl = parentNode.querySelector(':scope > .ldp-sub-actions');
    const btnEl = actionEl && actionEl.querySelector('.ldp-load-more-replies');
    const remaining = state.all.length - state.renderedCount;
    if (remaining > 0) {
      if (actionEl) actionEl.style.display = 'block';
      if (btnEl) btnEl.textContent = `展示更多回复（还剩 ${remaining} 条） ↓`;
    } else if (actionEl) {
      actionEl.style.display = 'none';
    }
  }

  /* ============ 10. 事件委托 ============ */
  function bindActions(modal, ctx) {
    modal.addEventListener('click', async (e) => {
      const anchor = e.target.closest('a');
      if (anchor && anchor.target === '_blank') return;

      const img = e.target.closest('.ldp-content img');
      if (img) { e.preventDefault(); e.stopPropagation(); openLightbox(resolveOriginalSrc(img)); return; }

      const moreBtn = e.target.closest('.ldp-load-more-replies');
      if (moreBtn) {
        const post = moreBtn.closest('.ldp-post');
        renderSubReplyBatch(+post.dataset.postNumber, ctx);
        return;
      }

      const postNode = e.target.closest('.ldp-post');
      if (!postNode) return;
      const postId = postNode.dataset.postId, postNumber = +postNode.dataset.postNumber;

      const likeBtn = e.target.closest('.ldp-like');
      if (likeBtn && !likeBtn.disabled) {
        const countEl = likeBtn.querySelector('.ldp-like-count'), acted = likeBtn.dataset.acted === '1';
        likeBtn.disabled = true;
        try {
          if (!acted) {
            await apiSend(`${BASE}/post_actions`, 'POST', { id: postId, post_action_type_id: 2, flag_topic: false });
            likeBtn.classList.add('liked'); likeBtn.dataset.acted = '1';
            countEl.textContent = (+countEl.textContent) + 1;
          } else {
            await apiSend(`${BASE}/post_actions/${postId}?post_action_type_id=2`, 'DELETE');
            likeBtn.classList.remove('liked'); likeBtn.dataset.acted = '0';
            countEl.textContent = Math.max(0, (+countEl.textContent) - 1);
          }
        } catch (err) { alert('操作失败：' + err.message); } finally { likeBtn.disabled = false; }
        return;
      }

      const replyBtn = e.target.closest('.ldp-replybtn');
      if (replyBtn) {
        const box = ensureReplyBox(postNode);
        box.classList.toggle('open');
        if (box.classList.contains('open')) box.querySelector('textarea').focus();
        return;
      }

      const boostBtn = e.target.closest('.ldp-boost-btn');
      if (boostBtn && !boostBtn.disabled) {
        const wrap = postNode.querySelector(':scope > .ldp-boost-input-wrap');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        wrap.classList.toggle('open', opening);
        if (opening) wrap.querySelector('.ldp-boost-input').focus();
        return;
      }

      const boostCancel = e.target.closest('.ldp-boost-cancel');
      if (boostCancel) {
        const wrap = boostCancel.closest('.ldp-boost-input-wrap');
        if (wrap) { wrap.classList.remove('open'); wrap.querySelector('.ldp-boost-input').value = ''; }
        return;
      }

      const boostSubmit = e.target.closest('.ldp-boost-submit');
      if (boostSubmit && !boostSubmit.disabled) {
        const wrap = boostSubmit.closest('.ldp-boost-input-wrap');
        const input = wrap && wrap.querySelector('.ldp-boost-input');
        const raw = input ? input.value.trim() : '';
        if (!raw) { input && input.focus(); return; }
        if (raw.length > 16) { alert('Boost内容不能超过16个字符'); return; }
        boostSubmit.disabled = true;
        try {
          const res = await apiSend(`${BASE}/discourse-boosts/posts/${postId}/boosts`, 'POST', { raw });
          if (res && res.id) {
            const listEl = postNode.querySelector(':scope > .ldp-boosts-list');
            if (listEl) {
              const bAvatar = res.user && res.user.avatar_template
                  ? BASE + res.user.avatar_template.replace('{size}', '36') : '';
              const newBubble = document.createElement('div');
              newBubble.className = 'ldp-boost-bubble ldp-flash';
              newBubble.dataset.boostId = res.id;
              newBubble.innerHTML =
                  (bAvatar ? `<img class="ldp-b-avatar" src="${bAvatar}" alt="">` : '') +
                  `<p>${res.cooked || ''}</p>` +
                  `<button class="ldp-boost-del" title="删除此Boost">×</button>`;
              listEl.appendChild(newBubble);
            }
            input.value = '';
            wrap.classList.remove('open');
            const btn = postNode.querySelector(':scope > .ldp-actions > .ldp-boost-btn');
            if (btn) btn.disabled = true;
            if (postNumber === 1) {
              const fBoost = ctx.scrollRoot.closest('.ldp-modal').querySelector('.ldp-f-boost');
              if (fBoost) { fBoost.disabled = true; fBoost.style.opacity = '0.4'; }
            }
          }
        } catch (err) { alert('发射失败：' + err.message); }
        finally { boostSubmit.disabled = false; }
        return;
      }

      const boostDel = e.target.closest('.ldp-boost-del');
      if (boostDel) {
        const bubble = boostDel.closest('.ldp-boost-bubble');
        const boostId = bubble && bubble.dataset.boostId;
        if (!boostId) return;
        try {
          await apiSend(`${BASE}/discourse-boosts/boosts/${boostId}`, 'DELETE');
          bubble.remove();
          const btn = postNode.querySelector(':scope > .ldp-actions > .ldp-boost-btn');
          if (btn) btn.disabled = false;
          if (postNumber === 1) {
            const fBoost = ctx.scrollRoot.closest('.ldp-modal').querySelector('.ldp-f-boost');
            if (fBoost) { fBoost.disabled = false; fBoost.style.opacity = '1'; }
          }
        } catch (err) { alert('删除失败：' + err.message); }
        return;
      }

      const sendBtn = e.target.closest('.ldp-send');
      if (sendBtn) {
        const box = sendBtn.closest('.ldp-replybox'),
            textarea = box.querySelector('textarea'),
            raw = textarea.value.trim();
        if (!raw) return;
        if (raw.length < 16) { alert('帖子必须至少为16个字符'); return; }
        sendBtn.disabled = true;
        sendBtn.textContent = '发送中…';
        try {
          const data = await apiSend(`${BASE}/posts`, 'POST', {
            raw,
            topic_id: ctx.topicId,
            reply_to_post_number: postNumber,
            nested_post: true,
          });
          const postData = data && data.post ? data.post : data;
          if (postData && postData.cooked) {
            const isTopLevel = postNumber === 1;
            const newNode = renderPost({
              id: postData.id,
              post_number: postData.post_number,
              username: postData.username || ME_USERNAME,
              name: postData.name,
              avatar_template: postData.avatar_template,
              cooked: postData.cooked,
              created_at: postData.created_at || new Date().toISOString(),
              reply_to_post_number: postNumber,
              actions_summary: [],
              boosts: [],
              can_boost: true,
            }, !isTopLevel, ctx);
            newNode.classList.add('ldp-flash');
            if (isTopLevel) {
              ctx.commentsEl.prepend(newNode);
              newNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
              const childrenContainer = postNode.querySelector(':scope > .ldp-children');
              childrenContainer.prepend(newNode);
            }
            ctx.nodeMap.set(postData.post_number, newNode);
            ctx.tracker.observe(newNode);
            ctx.totalComments = (ctx.totalComments || 0) + 1;
            updateCommentsHeader(ctx);
            const tip = box.querySelector('.ldp-reply-tip');
            if (tip) { tip.classList.add('show'); setTimeout(() => tip.classList.remove('show'), 1500); }
            box.classList.remove('open');
            textarea.value = '';
          }
        } catch (err) {
          alert('回复失败：' + err.message);
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = '发送';
        }
        return;
      }
    });
  }

  /* ============ 11. 楼中楼补全（分批渲染 + 节流 + 停顿检测） ============ */
  function createRepliesIO(ctx) {
    const fetched = new Set();
    const hoverTimers = new Map();

    return new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const postId = en.target.dataset.postId;
        const postNumber = +en.target.dataset.postNumber;
        if (!postId) return;

        if (en.isIntersecting) {
          if (fetched.has(postId) || hoverTimers.has(postId)) return;
          const timer = setTimeout(async () => {
            hoverTimers.delete(postId);
            fetched.add(postId);
            const loadingEl = en.target.querySelector(':scope > .ldp-sub-loading');
            if (loadingEl) loadingEl.style.display = 'block';
            try {
              const replies = await fetchJSON(`${BASE}/posts/${postId}/replies.json`);
              if (loadingEl) loadingEl.style.display = 'none';
              if (!replies || !replies.length) return;
              ctx.subReplyState.set(postNumber, { all: replies, renderedCount: 0 });
              renderSubReplyBatch(postNumber, ctx);
            } catch (e) {
              if (loadingEl) loadingEl.style.display = 'none';
              fetched.delete(postId);
            }
          }, REPLIES_HOVER_DELAY);
          hoverTimers.set(postId, timer);
        } else {
          if (hoverTimers.has(postId)) {
            clearTimeout(hoverTimers.get(postId));
            hoverTimers.delete(postId);
          }
        }
      });
    }, { root: ctx.scrollRoot, rootMargin: '120px', threshold: 0.1 });
  }

  /* ============ 12. 收藏 ============ */
  function bindBookmark(btn, topic) {
    let bookmarked = !!topic.bookmarked, bookmarkId = topic.bookmark_id || null;
    const sync = () => { btn.classList.toggle('bookmarked', bookmarked); };
    sync();
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (!bookmarked) {
          const data = await apiSend(`${BASE}/bookmarks`, 'POST', { bookmarkable_id: topic.id, bookmarkable_type: 'Topic' });
          bookmarkId = data && data.id ? data.id : bookmarkId; bookmarked = true;
        } else if (bookmarkId) {
          await apiSend(`${BASE}/bookmarks/${bookmarkId}`, 'DELETE'); bookmarked = false; bookmarkId = null;
        } else {
          await apiSend(`${BASE}/t/${topic.id}/remove_bookmarks`, 'PUT'); bookmarked = false;
        }
        sync();
      } catch (err) { alert('收藏操作失败：' + err.message); } finally { btn.disabled = false; }
    });
  }

  function bindFooterLike(btn, countEl, opPost) {
    if (!opPost) { btn.disabled = true; return; }
    const { count, acted, canAct } = likeInfo(opPost);
    let liked = acted;
    countEl.textContent = count;
    btn.classList.toggle('liked', liked);
    btn.disabled = !(canAct || acted);
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        if (!liked) {
          await apiSend(`${BASE}/post_actions`, 'POST', { id: opPost.id, post_action_type_id: 2, flag_topic: false });
          liked = true; btn.classList.add('liked');
          countEl.textContent = (+countEl.textContent) + 1;
        } else {
          await apiSend(`${BASE}/post_actions/${opPost.id}?post_action_type_id=2`, 'DELETE');
          liked = false; btn.classList.remove('liked');
          countEl.textContent = Math.max(0, (+countEl.textContent) - 1);
        }
      } catch (err) { alert('操作失败：' + err.message); } finally { btn.disabled = false; }
    });
  }

  function updateCommentsHeader(ctx) {
    if (ctx.countEl) ctx.countEl.textContent = ctx.totalComments ? `（${ctx.totalComments}）` : '';
    if (ctx.emptyEl) ctx.emptyEl.style.display = ctx.totalComments ? 'none' : '';
    if (ctx.footerReplyCountEl) ctx.footerReplyCountEl.textContent = ctx.totalComments || 0;
  }

  const SKELETON_HTML = `
    <div class="ldp-sk-head">
      <div class="ldp-sk ldp-sk-avatar"></div>
      <div class="ldp-sk ldp-sk-line ldp-sk-w40"></div>
    </div>
    <div class="ldp-sk-para">
      <div class="ldp-sk ldp-sk-line ldp-sk-w100"></div>
      <div class="ldp-sk ldp-sk-line ldp-sk-w90"></div>
      <div class="ldp-sk ldp-sk-line ldp-sk-w80"></div>
      <div class="ldp-sk ldp-sk-line ldp-sk-w60"></div>
    </div>
    <div class="ldp-sk-divider"></div>
    <div class="ldp-sk-comment">
      <div class="ldp-sk ldp-sk-avatar"></div>
      <div class="ldp-sk-cbody ldp-sk-para">
        <div class="ldp-sk ldp-sk-line ldp-sk-w30"></div>
        <div class="ldp-sk ldp-sk-line ldp-sk-w90"></div>
        <div class="ldp-sk ldp-sk-line ldp-sk-w60"></div>
      </div>
    </div>`;

  /* ============ 13. 定位：展开楼中楼并高亮目标 ============ */
  /**
   * waitForScrollEnd：等待某个可滚动容器的滚动真正"停下来"。
   *
   * scrollIntoView({behavior:'smooth'}) 是异步、由浏览器驱动的动画，调用后
   * JS 会立刻继续往下执行，并不会等动画播完。如果外层只用 requestAnimationFrame
   * 等一帧就认为"滚动已完成"，实际上动画可能还要再跑几百毫秒——这段时间如果提前
   * 解除 isAnchoring 锁，滚动过程中途经的 scrollTop 变化会误触发 pumpUp/pumpDown，
   * 新插入的楼层会和还在进行中的滚动动画打架，把目标楼层挤出视口。
   *
   * 做法：监听 scroll 事件，只要连续 IDLE_MS 内没有新的 scroll 事件，就认为动画已经
   * 停止；同时加一个安全兜底超时，防止极端情况下（例如浏览器完全不触发 scroll 事件）
   * 一直等不到结束。
   */
  function waitForScrollEnd(el, timeoutMs = 1200) {
    const IDLE_MS = 120;
    return new Promise((resolve) => {
      let done = false;
      let idleTimer = null;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('scroll', onScroll);
        clearTimeout(idleTimer);
        clearTimeout(safety);
        resolve();
      };
      const onScroll = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(finish, IDLE_MS);
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      // 若 scrollIntoView 判定目标已在原地（无需滚动），可能压根不会触发 scroll 事件，
      // 这里先给一次初始 idle 计时，避免无限等待
      idleTimer = setTimeout(finish, IDLE_MS);
      const safety = setTimeout(finish, timeoutMs);
    });
  }

  /**
   * locatePost：在已渲染完毕后，定位到指定楼层。
   *
   * 步骤：
   *   1. 在 nodeMap 里找目标楼层节点；
   *   2. 若目标是楼中楼（有 reply_to_post_number），先确保父楼层的楼中楼已完全展开；
   *   3. 滚动到目标节点并触发 ldp-flash 高亮。
   *
   * @param {number} targetPostNumber  - 目标楼层号
   * @param {object} ctx               - 全局上下文
   */
  async function locatePost(targetPostNumber, ctx) {
    if (!targetPostNumber || targetPostNumber <= 1) return;

    // 等待 DOM 稳定（requestAnimationFrame 后执行）
    await new Promise((r) => requestAnimationFrame(r));

    let targetNode = ctx.nodeMap.get(targetPostNumber);

    if (!targetNode) {
      // 节点可能尚未渲染（切片窗口未覆盖），直接放弃（极端边界情况）
      return;
    }

    // 检查目标是否是楼中楼（其 DOM 父节点是否在 .ldp-children 内）
    const parentContainer = targetNode.parentElement;
    const isSubReply = parentContainer && parentContainer.classList.contains('ldp-children');

    if (isSubReply) {
      // 找到父楼层的 post_number
      const parentPostNode = parentContainer.closest('.ldp-post');
      if (parentPostNode) {
        const parentPostNumber = +parentPostNode.dataset.postNumber;
        // 确保该父楼层的楼中楼已全部展开（把剩余未渲染的子回复全部渲出来）
        const state = ctx.subReplyState.get(parentPostNumber);
        if (state) {
          // 循环渲染直到目标 post_number 被渲染或所有子回复渲染完
          while (state.renderedCount < state.all.length) {
            renderSubReplyBatch(parentPostNumber, ctx);
            // 检查目标节点是否已经渲染出来
            if (ctx.nodeMap.has(targetPostNumber)) break;
          }
          // 更新 targetNode（可能刚刚被渲染出来）
          targetNode = ctx.nodeMap.get(targetPostNumber);
        } else {
          // subReplyState 还没拉取，需要手动触发一次 replies 接口加载
          const parentPostId = parentPostNode.dataset.postId;
          if (parentPostId) {
            try {
              const loadingEl = parentPostNode.querySelector(':scope > .ldp-sub-loading');
              if (loadingEl) loadingEl.style.display = 'block';
              const replies = await fetchJSON(`${BASE}/posts/${parentPostId}/replies.json`);
              if (loadingEl) loadingEl.style.display = 'none';
              if (replies && replies.length) {
                ctx.subReplyState.set(parentPostNumber, { all: replies, renderedCount: 0 });
                // 全量渲染直到目标出现
                const st = ctx.subReplyState.get(parentPostNumber);
                while (st.renderedCount < st.all.length) {
                  renderSubReplyBatch(parentPostNumber, ctx);
                  if (ctx.nodeMap.has(targetPostNumber)) break;
                }
                targetNode = ctx.nodeMap.get(targetPostNumber);
              }
            } catch (e) { /* 忽略，定位失败不阻塞 */ }
          }
        }
      }
    }

    if (!targetNode) return;

    // 等一帧确保 DOM 已更新
    await new Promise((r) => requestAnimationFrame(r));

    targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 等滚动动画真正停下来，再继续（见 waitForScrollEnd 注释）。
    // 这一步必须在这里 await 完，locatePost 才能返回——外层就是靠
    // "await locatePost(...)" 来判断何时可以安全解锁 isAnchoring 的。
    await waitForScrollEnd(ctx.scrollRoot);

    // 滚动已经稳定，此时再判断目标是否真的进入视口并触发高亮：
    // 用临时 IntersectionObserver 监听目标节点进入视口，
    // 一旦 intersectionRatio >= 0.5 即认为已到位，触发 flash 并立即解绑。
    const flashObs = new IntersectionObserver((entries, obs) => {
      const en = entries.find((e) => e.isIntersecting && e.intersectionRatio >= 0.5);
      if (!en) return;
      obs.disconnect();
      const node = en.target;
      node.classList.remove('ldp-flash');
      void node.offsetWidth; // 强制 reflow，确保动画重播
      node.classList.add('ldp-flash');
      setTimeout(() => node.classList.remove('ldp-flash'), 1700);
    }, { root: ctx.scrollRoot, threshold: [0.5] });
    flashObs.observe(targetNode);
    // 安全兜底：1.5s 后若仍未触发则强制解绑，防止 observer 泄漏
    // （滚动已经稳定，正常情况下应该几乎立刻就能命中一次 intersecting 回调）
    setTimeout(() => flashObs.disconnect(), 1500);
  }

  /* ============ 14. 弹窗主体 ============ */
  let CURRENT_OVERLAY = null;

  /**
   * openModal(topicId, targetPostNumber)
   *
   * targetPostNumber 来源：
   *   - null / undefined → 场景 A（首次打开，从头加载）
   *   - 0                → 场景 B（已读过，跳到第一条未读）
   *   - N > 0            → 场景 C（通知直达，跳到第 N 楼）
   *
   * 优化策略：两阶段并行加载
   *   阶段 1：请求 topic.json → 立即渲染 1 楼 → 移除骨架屏
   *   阶段 2：解析 stream → 计算窗口 → 加载评论（后台进行）
   */
  async function openModal(topicId, targetPostNumber) {
    if (CURRENT_OVERLAY) { CURRENT_OVERLAY.remove(); CURRENT_OVERLAY = null; }

    const abortController = new AbortController();
    const overlay = document.createElement('div');
    overlay.className = 'ldp-overlay';
    overlay.innerHTML = `
      <div class="ldp-modal">
        <div class="ldp-header">
          <div style="flex:1">
            <h2 class="ldp-title"><span class="ldp-sk ldp-sk-title"></span></h2>
            <div class="ldp-meta"><span class="ldp-sk ldp-sk-meta"></span></div>
          </div>
          <div class="ldp-head-btns">
            <button class="ldp-close" title="关闭">×</button>
          </div>
        </div>
        <div class="ldp-body">
          <div class="ldp-topic"></div>
          <div class="ldp-comments-header">评论<span class="ldp-comments-count"></span></div>
          <div class="ldp-load-up-tip"><span class="ldp-tip-icon">⌛</span>正在向上加载…</div>
          <div class="ldp-up-sentinel"></div>
          <div class="ldp-comments"><div class="ldp-comments-empty">暂无评论</div></div>
          <div class="ldp-loading-tip"><span class="ldp-tip-icon">⌛</span>正在加载评论…</div>
          <div class="ldp-down-sentinel"></div>
          <div class="ldp-load-down-tip"><span class="ldp-tip-icon">⌛</span>正在向下加载…</div>
          <div class="ldp-loadmask">${SKELETON_HTML}</div>
        </div>
        <div class="ldp-footer" hidden>
          <button class="ldp-fbtn ldp-f-like" disabled title="点赞">
            <svg viewBox="0 0 24 24" fill="currentColor">${ICONS.like}</svg>
            <span class="ldp-f-like-count">0</span>
          </button>
          <button class="ldp-fbtn ldp-f-reply" title="回复帖子">
            <svg viewBox="0 0 1024 1024" fill="currentColor">${ICONS.reply}</svg>
            <span class="ldp-f-reply-count">0</span>
          </button>
          <button class="ldp-fbtn ldp-f-boost" title="给楼主发送Boost">
            <svg viewBox="0 0 1024 1024" style="width:16px;height:16px;">${ICONS.boost}</svg>
          </button>
          <button class="ldp-fbtn ldp-f-bookmark" title="加入书签">
            <svg viewBox="0 0 24 24" fill="currentColor">${ICONS.bookmark}</svg>
          </button>
          <a class="ldp-fbtn ldp-f-open" href="#" target="_blank" rel="noopener" title="打开原贴">
            <svg viewBox="0 0 24 24" fill="currentColor">${ICONS.newTab}</svg>
          </a>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    CURRENT_OVERLAY = overlay;

    const modal = overlay.querySelector('.ldp-modal');
    const body = overlay.querySelector('.ldp-body');
    const topicEl = overlay.querySelector('.ldp-topic');
    const commentsEl = overlay.querySelector('.ldp-comments');
    const countEl = overlay.querySelector('.ldp-comments-count');
    const emptyEl = overlay.querySelector('.ldp-comments-empty');
    const upSentinel = overlay.querySelector('.ldp-up-sentinel');
    const downSentinel = overlay.querySelector('.ldp-down-sentinel');
    const maskEl = overlay.querySelector('.ldp-loadmask');
    const loadingTip = overlay.querySelector('.ldp-loading-tip');
    const loadUpTip = overlay.querySelector('.ldp-load-up-tip');
    const loadDownTip = overlay.querySelector('.ldp-load-down-tip');
    const footerEl = overlay.querySelector('.ldp-footer');
    const fLikeBtn = overlay.querySelector('.ldp-f-like');
    const fLikeCountEl = overlay.querySelector('.ldp-f-like-count');
    const fReplyBtn = overlay.querySelector('.ldp-f-reply');
    const fReplyCountEl = overlay.querySelector('.ldp-f-reply-count');
    const fBoostBtn = overlay.querySelector('.ldp-f-boost');
    const fBookmarkBtn = overlay.querySelector('.ldp-f-bookmark');
    const fOpenLink = overlay.querySelector('.ldp-f-open');

    const loader = createSliceLoader(topicId);
    const tracker = createReadTracker(topicId, body);
    const ctx = {
      topicId, op: null, topicEl, commentsEl, countEl, emptyEl,
      scrollRoot: body,
      nodeMap: new Map(),
      pending: [],
      tracker,
      totalComments: 0,
      repliesIO: null,
      subReplyState: new Map(),
      footerReplyCountEl: fReplyCountEl,
    };
    ctx.repliesIO = createRepliesIO(ctx);

    // 双向加载节流标志
    let loadingDown = false, loadingUp = false;
    let downDone = false, upDone = false;
    // 初始化锚定锁：calcWindow 渲染+定位完成前禁止哨兵/scroll 误触发加载
    let isAnchoring = false;

    const close = () => {
      abortController.abort(); // 取消所有进行中的请求
      tracker.stop();
      ctx.repliesIO.disconnect();
      overlay.remove();
      if (CURRENT_OVERLAY === overlay) CURRENT_OVERLAY = null;
      document.removeEventListener('keydown', onEsc);
    };
    function onEsc(e) { if (e.key === 'Escape') close(); }
    overlay.querySelector('.ldp-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onEsc);

    /* ---- 底部"已加载全部评论"提示 ---- */
    function showBottomTip() {
      if (!body.querySelector('.ldp-bottom-tip')) {
        const tip = document.createElement('div');
        tip.className = 'ldp-bottom-tip';
        tip.textContent = '已加载全部评论';
        body.insertBefore(tip, downSentinel.nextSibling);
      }
    }

    /* ---- 向下加载 ---- */
    async function pumpDown() {
      if (isAnchoring || loadingDown || downDone) return;
      loadingDown = true;
      loadDownTip.classList.add('show');
      try {
        const { posts, done } = await loader.loadDown();
        posts.forEach((p) => attachPost(p, ctx));
        reflowPending(ctx);
        downDone = done;
        if (done) {
          loadDownTip.classList.remove('show');
          showBottomTip();
        }
      } catch (e) { /* 静默 */ }
      finally {
        loadingDown = false;
        loadDownTip.classList.remove('show');
      }
    }

    /* ---- 向上加载（防跳动） ---- */
    async function pumpUp() {
      if (isAnchoring || loadingUp || upDone) return;
      loadingUp = true;
      loadUpTip.classList.add('show');
      try {
        const oldScrollHeight = body.scrollHeight;
        const oldScrollTop = body.scrollTop;

        // 向上加载时只把"直接回复1楼"的顶层评论插入主评论流；
        // 楼中楼（嵌套回复，reply_to_post_number 指向的是别的楼层而不是1楼）
        // 交给已有的 repliesIO 机制——等它的父楼层随后被加载、进入视口时，
        // 会按需通过 /posts/{id}/replies.json 拉取，和 pumpDown 效果一致。
        // 原因：向上是"从后往前"取，如果这一批混进了嵌套回复，它的父楼层
        // （post_number 更小）很可能还没加载出来，attachPost 只能先把它硬塞成
        // 顶层评论、等父楼层加载后再靠 reflowPending 挪过去——会出现同一条
        // 评论先在顶层露一下脸、然后又"消失"重新出现在楼中楼里的跳动感。
        //
        // 由于一批 PAGE_SIZE 条里可能全是嵌套回复（没有一条顶层），
        // 这种情况下自动再往上多取一批，保证每次 pumpUp 都有可见进展。
        const PUMP_UP_EXPAND_MAX = 5;
        let posts = [];
        let done = false;
        let topLevelPosts = [];
        for (let i = 0; i <= PUMP_UP_EXPAND_MAX; i++) {
          const res = await loader.loadUp();
          posts = posts.concat(res.posts);
          done = res.done;
          topLevelPosts = posts.filter((p) => !p.reply_to_post_number || p.reply_to_post_number === 1);
          if (topLevelPosts.length > 0 || done) break;
        }

        if (topLevelPosts.length > 0) {
          // 把帖子 prepend 到 commentsEl 前面（保持时序正确）
          // 先反序：原来 posts 是从旧到新，prepend 需要从新到旧依次插入
          const fragment = document.createDocumentFragment();
          const tempCtx = Object.assign({}, ctx, {
            commentsEl: fragment, // 让 attachPost 内部直接 append 到 fragment
            nodeMap: ctx.nodeMap,
            topicEl: ctx.topicEl,
          });
          topLevelPosts.forEach((p) => attachPost(p, tempCtx));
          reflowPending(tempCtx);

          // 一次性插入到 commentsEl 顶部
          commentsEl.prepend(fragment);

          // 高度补偿：防止向上插入内容导致视口跳动
          requestAnimationFrame(() => {
            const newScrollHeight = body.scrollHeight;
            body.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
          });
        }

        upDone = done;
        if (done) {
          loadUpTip.classList.remove('show');
          if (!body.querySelector('.ldp-top-tip')) {
            const tip = document.createElement('div');
            tip.className = 'ldp-top-tip';
            tip.textContent = '已是最早的评论';
            commentsEl.before(tip);
          }
        }
      } catch (e) { /* 静默 */ }
      finally {
        loadingUp = false;
        loadUpTip.classList.remove('show');
      }
    }

    /* ---- IntersectionObserver 监听上下哨兵 ---- */
    const sentinelDownIO = new IntersectionObserver(
        (entries) => { if (entries.some((en) => en.isIntersecting)) pumpDown(); },
        { root: body, rootMargin: '300px' }
    );
    const sentinelUpIO = new IntersectionObserver(
        (entries) => { if (entries.some((en) => en.isIntersecting)) pumpUp(); },
        { root: body, rootMargin: '600px' }
    );

    /* ---- scroll 事件兜底 ---- */
    body.addEventListener('scroll', () => {
      if (isAnchoring) return;
      const { scrollTop, scrollHeight, clientHeight } = body;
      if (scrollHeight - scrollTop - clientHeight < 400) pumpDown();
      if (scrollTop < 800) pumpUp();
    }, { passive: true });

    /* ---- 主初始化流程（两阶段并行加载） ---- */
    let topicData = null;

    try {
      // ====== 阶段 1：快速渲染 1 楼 ======
      // 并行发起：topic.json + ensureMe()
      const topicPromise = fetch(`${BASE}/t/${topicId}.json?track_visit=true&forceLoad=true`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Discourse-Present': 'true',
          'Discourse-Track-View': 'true',
          'Discourse-Track-View-Topic-Id': String(topicId),
        },
        signal: abortController.signal,
      }).then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });

      const mePromise = ensureMe().catch(() => {}); // 失败静默，不影响加载

      // 等待 topic.json 返回
      topicData = await topicPromise;

      // 提取基本信息
      const opPost = topicData.post_stream.posts.find(p => p.post_number === 1);
      const opUsername = (topicData.details && topicData.details.created_by && topicData.details.created_by.username)
          || (opPost && opPost.username) || null;

      ctx.op = opUsername;
      ctx.totalComments = Math.max(0, (topicData.posts_count || 1) - 1);

      // 更新标题和元数据
      overlay.querySelector('.ldp-title').textContent = topicData.title;
      overlay.querySelector('.ldp-meta').textContent =
          `${topicData.posts_count} 帖 · ${topicData.views || 0} 浏览 · 楼主 @${ctx.op || '?'}`;
      updateCommentsHeader(ctx);

      // 渲染 1 楼
      if (opPost) {
        const opNode = renderPost(opPost, false, ctx);
        ctx.topicEl.appendChild(opNode);
        ctx.nodeMap.set(1, opNode);
      }

      // 立即移除骨架屏
      maskEl.classList.add('hide');
      setTimeout(() => maskEl.remove(), 300);

      // 绑定底部操作栏
      fOpenLink.href = `${BASE}/t/${topicData.id}`;
      bindBookmark(fBookmarkBtn, topicData);
      bindFooterLike(fLikeBtn, fLikeCountEl, opPost);

      const canBoostOp = !!(opPost && opPost.can_boost);
      if (!canBoostOp) { fBoostBtn.disabled = true; fBoostBtn.style.opacity = '0.4'; }
      fBoostBtn.addEventListener('click', () => {
        if (fBoostBtn.disabled) return;
        const opNode = ctx.topicEl.querySelector('.ldp-post');
        if (!opNode) return;
        const wrap = opNode.querySelector(':scope > .ldp-boost-input-wrap');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        wrap.classList.toggle('open', opening);
        if (opening) { wrap.querySelector('.ldp-boost-input').focus(); wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });

      fReplyBtn.addEventListener('click', () => {
        const opNode = ctx.topicEl.querySelector('.ldp-post');
        if (!opNode) return;
        const box = ensureReplyBox(opNode);
        box.classList.toggle('open');
        if (box.classList.contains('open')) { box.querySelector('textarea').focus(); box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
      footerEl.hidden = false;

      bindActions(modal, ctx);
      tracker.start();

      // ====== 阶段 2：后台加载评论 ======
      // 解析 stream 数组并初始化 loader 的内部状态
      const streamFull = topicData.post_stream.stream || [];
      const stream = streamFull.filter(id => {
        const cached = topicData.post_stream.posts.find(p => p.id === id);
        return !(cached && cached.post_number === 1);
      });

      // 初始化 loader 的 cache 和 stream（关键！）
      topicData.post_stream.posts.forEach(p => loader.cache.set(p.id, p));
      loader.stream = stream;  // 设置内部 stream 数组

      // 计算实际目标楼层
      let resolvedTarget = null;
      if (targetPostNumber === 0) {
        const lastRead = topicData.last_read_post_number || 0;
        const highest = topicData.highest_post_number || 1;
        if (lastRead > 0 && lastRead < highest) {
          resolvedTarget = lastRead + 1;
        }
      } else if (targetPostNumber > 0) {
        resolvedTarget = targetPostNumber;
      }

      // 计算初始窗口
      let windowIds = [];
      let exactTargetId = null;

      if (!resolvedTarget || resolvedTarget <= 1) {
        // 从头加载
        const windowEnd = Math.min(PAGE_SIZE, stream.length);
        windowIds = stream.slice(0, windowEnd);
        loader.upCursor = 0;
        loader.downCursor = windowEnd;
        loader.topReached = true;
        loader.bottomReached = windowEnd >= stream.length;
      } else {
        // 跳转到指定楼层
        let safeIdx = Math.max(0, Math.min(resolvedTarget - 2, stream.length - 1));

        // 尝试精确定位
        try {
          const anchor = await fetchJSON(`${BASE}/t/${topicId}.json?post_number=${resolvedTarget}`);
          const anchorPosts = (anchor.post_stream && anchor.post_stream.posts) || [];
          anchorPosts.forEach(p => loader.cache.set(p.id, p));
          const exactPost = anchorPosts.find(p => p.post_number === resolvedTarget);
          if (exactPost) {
            const idx = stream.indexOf(exactPost.id);
            if (idx >= 0) safeIdx = idx;
          }
        } catch (e) {}

        const halfWindow = SLICE_RADIUS;
        const wStart = Math.max(0, safeIdx - halfWindow);
        const wEnd = Math.min(stream.length, safeIdx + halfWindow);
        windowIds = stream.slice(wStart, wEnd);
        loader.upCursor = wStart;
        loader.downCursor = wEnd;
        loader.topReached = wStart === 0;
        loader.bottomReached = wEnd >= stream.length;

        // 查找目标楼层 ID
        for (const id of windowIds) {
          const p = loader.cache.get(id);
          if (p && p.post_number === resolvedTarget) { exactTargetId = id; break; }
        }
      }

      // 请求评论
      if (windowIds.length > 0) {
        try {
          await loader.fetchSlice(windowIds);
          const posts = windowIds.map(id => loader.cache.get(id)).filter(Boolean);
          posts.forEach(p => attachPost(p, ctx));
          reflowPending(ctx);
        } catch (err) {
          // 评论加载失败，降级显示（1楼已正常显示）
          console.error('评论加载失败:', err);
        }
      }

      // 初始化双向游标状态
      upDone = loader.topReached;
      downDone = loader.bottomReached;
      // 初始窗口已覆盖到最后一楼（如短贴一次性加载完，或跳转楼层靠近末尾），
      // 此时不会再触发 pumpDown()，需要在这里主动补上底部提示
      if (downDone) showBottomTip();

      // 挂载哨兵监听器（总是挂载）
      isAnchoring = true;
      sentinelDownIO.observe(downSentinel);
      if (!upDone) sentinelUpIO.observe(upSentinel);

      // 定位 & 高亮
      if (resolvedTarget && exactTargetId) {
        await locatePost(resolvedTarget, ctx);
      } else {
        body.scrollTop = 0;
      }
      isAnchoring = false;

      // 等待 ME 加载完成，更新标签
      await mePromise;

    } catch (err) {
      if (err.name === 'AbortError') {
        // 用户关闭弹框，静默退出
        return;
      }
      // 阶段 1 失败，显示错误
      if (maskEl) maskEl.remove();
      body.innerHTML = `<div class="ldp-error">加载失败：${esc(err.message)}</div>`;
    }
  }

  /* ============ 15. 拦截标题/通知点击 ============ */
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a.title, a.raw-topic-link, a.search-link, a.search-result-topic, a[href*="/t/"]');
    if (!a || a.classList.contains('ldp-link-open') || a.classList.contains('ldp-f-open')) return;

    const href = a.getAttribute('href') || '';
    const parsed = parseTopicHref(href);
    if (!parsed) return;

    const inMenu = !!a.closest(MENU_PANEL_SEL);
    const inSearch = !!a.closest(SEARCH_SEL);
    const isTitle = a.classList.contains('title') || a.classList.contains('raw-topic-link')
        || a.classList.contains('search-link') || a.classList.contains('search-result-topic');

    if (!isTitle && !inMenu && !inSearch) return;

    e.preventDefault();
    e.stopPropagation();

    const { topicId, targetPostNumber } = parsed;

    if (inMenu && targetPostNumber) {
      // 通知面板点击：有具体楼层号 → 场景 C（直接跳指定楼层）
      openModal(topicId, targetPostNumber);
    } else if (isTitle || inSearch) {
      // 列表页/搜索结果点击标题 → 场景 A/B 自动判断
      // 传 0 触发"已读跳未读"逻辑，openModal 内部会检查 last_read_post_number
      openModal(topicId, 0);
    } else {
      // 其他情况（菜单里的帖子链接，无具体楼层）→ 场景 A/B
      openModal(topicId, 0);
    }
  }, true);
})();