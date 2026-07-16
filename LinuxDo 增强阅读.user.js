// ==UserScript==
// @name         LinuxDo 增强阅读
// @namespace    https://linux.do/
// @version      1.3.0
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
  const READ_THRESHOLD = 1500;
  const FLUSH_INTERVAL = 5000;
  let ME_USERNAME = null;

  // --- 嵌套树 API 状态管理 ---
  const idToPost = new Map();     // postId → post 数据（混合索引）
  let nestedTreeRoots = [];       // 顶层回复数组
  let nestedHasMoreRoots = false; // 是否有更多顶层回复
  let nestedRootsPage = 0;        // 当前已加载的分页号

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

  async function fetchJSON(url) {
    const res = await fetch(url, {
      credentials: 'include', headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
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

  /* ============ 2.5 嵌套树 API 封装 ============ */
  /**
   * fetchNestedTree：获取话题的嵌套树形结构（权威树 API）。
   * @param {number} topicId - 话题 ID
   * @param {number} page - 分页号（0 表示第一页）
   * @returns {Promise<{roots: Array, has_more_roots: boolean, page: number, topic: object, opPost: object}>}
   */
  async function fetchNestedTree(topicId, page = 0) {
    let url = `${BASE}/n/-/${topicId}.json?sort=old`;
    if (page > 0) url += `&page=${page}`;
    return await fetchJSON(url);
  }

  /**
   * fetchNestedChildren：获取指定帖子的所有直接回复（用于"展示更多"按钮）。
   * @param {number} topicId - 话题 ID
   * @param {number} postNumber - 帖子楼号
   * @returns {Promise<{children: Array, has_more: boolean, page: number}>}
   */
  async function fetchNestedChildren(topicId, postNumber) {
    const url = `${BASE}/n/-/${topicId}/children/${postNumber}.json?sort=old&page=0&depth=1`;
    return await fetchJSON(url);
  }

  /**
   * indexTree：递归将嵌套树数据索引到 idToPost Map。
   * @param {Array} posts - 帖子数组（可能包含 children）
   */
  function indexTree(posts) {
    if (!posts || !posts.length) return;
    posts.forEach(post => {
      idToPost.set(post.id, post);
      if (post.children && post.children.length > 0) {
        indexTree(post.children);
      }
    });
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


  /* ============ 6. 树形递归渲染 ============ */
  /**
   * renderNestedTree：递归渲染嵌套树结构。
   * @param {Array} posts - 帖子数组（可能包含 children）
   * @param {HTMLElement} container - DOM 容器
   * @param {object} ctx - 全局上下文
   * @param {number} depth - 当前树深度（用于缩进）
   */
  function renderNestedTree(posts, container, ctx, depth = 0) {
    if (!posts || !posts.length) return;

    posts.forEach(post => {
      const node = renderPost(post, depth > 0, ctx, depth);
      container.appendChild(node);
      ctx.tracker.observe(node);
      ctx.nodeMap.set(post.post_number, node);

      // 递归渲染子回复
      if (post.children && post.children.length > 0) {
        const childrenEl = node.querySelector('.ldp-children');
        renderNestedTree(post.children, childrenEl, ctx, depth + 1);
      }

      // 渲染"展示更多"按钮
      const remaining = (post.direct_reply_count || 0) - (post.children?.length || 0);
      if (remaining > 0) {
        renderLoadMoreButton(post, node, remaining, depth);
      }
    });
  }

  /**
   * renderLoadMoreButton：渲染"展示更多回复"按钮。
   * @param {object} post - 父帖子数据
   * @param {HTMLElement} node - 父帖子 DOM 节点
   * @param {number} remaining - 剩余未加载数量
   * @param {number} depth - 树深度
   */
  function renderLoadMoreButton(post, node, remaining, depth) {
    const actionsEl = node.querySelector(':scope > .ldp-sub-actions');
    if (!actionsEl) return;

    actionsEl.style.display = 'block';
    const btn = actionsEl.querySelector('.ldp-load-more-replies');
    if (btn) {
      btn.textContent = `展示更多回复（还剩 ${remaining} 条） ↓`;
    }
  }

  /* ============ 7. 楼层归位（已废弃，保留用于扁平流降级） ============ */
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

  /* ============ 7. 渲染单条 ============ */
  /**
   * renderPost：渲染单个帖子节点。
   * @param {object} p - 帖子数据
   * @param {boolean} isReply - 是否是回复（已废弃，兼容性保留）
   * @param {object} ctx - 全局上下文
   * @param {number} depth - 树深度（用于缩进）
   */
  function renderPost(p, isReply, ctx, depth = 0) {
    // 检测已删除的评论（缺少作者信息或内容）
    const isDeleted = !p.username || !p.cooked || p.deleted_at;

    if (isDeleted) {
      // 渲染已删除评论的占位符
      const node = document.createElement('div');
      node.className = 'ldp-post ldp-reply';
      node.dataset.postId = p.id;
      node.dataset.postNumber = p.post_number;
      node.style.opacity = '0.5';
      node.innerHTML = `
        <div class="ldp-post-head">
          <span class="ldp-author" style="opacity: 0.5;">（帖子已被作者删除）</span>
          <span class="ldp-floor">#${p.post_number}</span>
        </div>
        <div class="ldp-children"></div>
      `;
      return node;
    }

    // 正常评论的渲染逻辑
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
    node.className = 'ldp-post' + (depth > 0 ? ' ldp-reply' : '');
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

  /* ============ 9. 加载剩余子回复 ============ */
  /**
   * loadAllChildren：加载指定帖子的所有剩余子回复。
   * @param {number} postId - 帖子 ID
   * @param {number} postNumber - 帖子楼号
   * @param {HTMLElement} button - "展示更多"按钮
   * @param {object} ctx - 全局上下文
   */
  async function loadAllChildren(postId, postNumber, button, ctx) {
    button.disabled = true;
    button.textContent = '加载中...';
    try {
      const response = await fetchNestedChildren(ctx.topicId, postNumber);
      const post = idToPost.get(postId);
      if (!post) throw new Error('帖子数据未找到');

      // 更新内存中的 children 数组
      post.children = response.children;
      indexTree(response.children);

      // 重新渲染子回复
      const postNode = button.closest('.ldp-post');
      const childrenEl = postNode.querySelector('.ldp-children');
      childrenEl.innerHTML = '';
      renderNestedTree(response.children, childrenEl, ctx, 1);

      // 移除按钮
      button.remove();
    } catch (e) {
      alert('加载失败：' + e.message);
      button.disabled = false;
      button.textContent = '展示更多回复 ↓';
    }
  }

  /* ============ 9. 楼层归位辅助函数 ============ */
  /**
   * reflowPending：重新组织等待父节点的帖子。
   * 当子帖子的父节点还未渲染时，会先放到 pending 数组，
   * 父节点渲染后调用此函数重新组织DOM结构。
   */
  function reflowPending(ctx) {
    if (!ctx.pending || !ctx.pending.length) return;
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
        const postId = +post.dataset.postId;
        const postNumber = +post.dataset.postNumber;
        await loadAllChildren(postId, postNumber, moreBtn, ctx);
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
            }, !isTopLevel, ctx, isTopLevel ? 0 : 1);
            newNode.classList.add('ldp-flash');
            if (isTopLevel) {
              ctx.commentsEl.prepend(newNode);
              newNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
              const childrenContainer = postNode.querySelector(':scope > .ldp-children');
              if (childrenContainer) {
                childrenContainer.prepend(newNode);
              } else {
                console.warn('Parent post has no .ldp-children container');
              }
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

    const tracker = createReadTracker(topicId, body);
    const ctx = {
      topicId, op: null, topicEl, commentsEl, countEl, emptyEl,
      scrollRoot: body,
      nodeMap: new Map(),
      tracker,
      totalComments: 0,
      footerReplyCountEl: fReplyCountEl,
    };

    const close = () => {
      abortController.abort(); // 取消所有进行中的请求
      tracker.stop();
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

    /* ---- 主初始化流程（嵌套树 API 加载） ---- */
    let topicData = null;

    try {
      // ====== 阶段 1：加载嵌套树数据 ======
      const mePromise = ensureMe().catch(() => {});

      // 处理跳转到指定楼层的情况（包含通知跳转和已读跳未读）
      let resolvedTarget = targetPostNumber;
      let cachedTopicDetail = null;  // 缓存"已读跳未读"阶段拉到的话题详情，供后面复用，避免重复请求

      // 如果是"已读跳未读"场景（targetPostNumber === 0），需要先获取已读进度
      if (targetPostNumber === 0) {
        // 先获取话题元数据以确定已读进度
        try {
          const metaRes = await fetch(`${BASE}/t/${topicId}.json?track_visit=true&forceLoad=true`, {
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
          if (metaRes.ok) {
            const metaData = await metaRes.json();
            cachedTopicDetail = metaData;
            const lastRead = metaData.last_read_post_number || 0;
            const highest = metaData.highest_post_number || 1;
            // 如果有未读评论，跳转到第一条未读
            if (lastRead > 0 && lastRead < highest) {
              resolvedTarget = lastRead + 1;
            }
          }
        } catch (e) {
          // 获取已读进度失败，忽略并从头加载
        }
      }

      // 如果需要跳转到指定楼层（通知跳转或已读跳未读）
      if (resolvedTarget && resolvedTarget > 1) {
        // 使用扁平流 API 精确定位
        try {
          const anchorUrl = `${BASE}/t/${topicId}.json?post_number=${resolvedTarget}&track_visit=true&forceLoad=true`;
          const anchorRes = await fetch(anchorUrl, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: {
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
          });
          if (!anchorRes.ok) throw new Error('HTTP ' + anchorRes.status);
          const anchorData = await anchorRes.json();

          // 提取基本信息
          let opPost = anchorData.post_stream.posts.find(p => p.post_number === 1);
          const targetPost = anchorData.post_stream.posts.find(p => p.post_number === resolvedTarget);
          const opNotInWindow = !opPost;  // 标记楼主是否不在当前窗口

          // 如果窗口中不包含楼主，从话题详情中获取（优先复用前面已拉取的缓存，避免重复请求）
          if (opNotInWindow) {
            if (cachedTopicDetail) {
              opPost = cachedTopicDetail.post_stream.posts.find(p => p.post_number === 1);
            } else {
              try {
                const topicDetailRes = await fetch(`${BASE}/t/${topicId}.json?track_visit=true&forceLoad=true`, {
                  method: 'GET',
                  credentials: 'include',
                  cache: 'no-store',
                  headers: { 'Accept': 'application/json' },
                });

                if (topicDetailRes.ok) {
                  const topicDetail = await topicDetailRes.json();
                  cachedTopicDetail = topicDetail;
                  opPost = topicDetail.post_stream.posts.find(p => p.post_number === 1);
                }
              } catch (e) {
                console.error('加载楼主帖子失败:', e);
              }
            }
          }

          // 如果仍然没有楼主数据，使用占位符
          if (!opPost) {
            const opUsername = (anchorData.details && anchorData.details.created_by && anchorData.details.created_by.username) || '未知';
            opPost = {
              id: anchorData.post_stream.stream ? anchorData.post_stream.stream[0] : 0,
              post_number: 1,
              username: opUsername,
              name: opUsername,
              cooked: '<p style="opacity: 0.5;">楼主帖子加载失败</p>',
              created_at: anchorData.created_at || new Date().toISOString(),
              actions_summary: [],
              boosts: [],
              can_boost: false,
            };
          }

          ctx.op = opPost.username;
          ctx.totalComments = anchorData.posts_count - 1;

          // 更新标题和元数据
          overlay.querySelector('.ldp-title').textContent = anchorData.title;
          overlay.querySelector('.ldp-meta').textContent =
              `${anchorData.posts_count} 帖 · ${anchorData.views || 0} 浏览 · 楼主 @${ctx.op || '?'}`;
          updateCommentsHeader(ctx);

          // 渲染 1 楼
          const opNode = renderPost(opPost, false, ctx, 0);
          ctx.topicEl.appendChild(opNode);
          ctx.nodeMap.set(1, opNode);
          ctx.tracker.observe(opNode);

          // 立即移除骨架屏
          maskEl.classList.add('hide');
          setTimeout(() => maskEl.remove(), 300);

          // 绑定底部操作栏
          fOpenLink.href = `${BASE}/t/${topicId}`;
          bindBookmark(fBookmarkBtn, anchorData);
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

          // 初始化 pending 数组（用于构建楼中楼）
          ctx.pending = [];
          ctx.repliesIO = { observe: () => {}, disconnect: () => {} };  // 兼容占位

          // 保存完整的帖子流（用于双向加载）
          const streamFull = anchorData.post_stream.stream || [];
          const stream = streamFull.filter(id => {
            const cached = anchorData.post_stream.posts.find(p => p.id === id);
            return !(cached && cached.post_number === 1);
          });

          // 初始化双向加载状态
          const postCache = new Map();
          anchorData.post_stream.posts.forEach(p => postCache.set(p.id, p));

          let upCursor = 0;
          let downCursor = stream.length;
          let topReached = false;
          let bottomReached = false;
          let loadingDown = false;
          let loadingUp = false;
          let isAnchoring = true;  // 锚定锁：定位完成前禁止触发加载

          // 计算已加载的楼层范围
          const loadedPostIds = new Set(anchorData.post_stream.posts.map(p => p.id));
          const firstLoadedId = anchorData.post_stream.posts[0]?.id;
          const lastLoadedId = anchorData.post_stream.posts[anchorData.post_stream.posts.length - 1]?.id;

          if (firstLoadedId && streamFull.includes(firstLoadedId)) {
            upCursor = streamFull.indexOf(firstLoadedId);
            topReached = upCursor === 0;
          }
          if (lastLoadedId && streamFull.includes(lastLoadedId)) {
            downCursor = streamFull.indexOf(lastLoadedId) + 1;
            bottomReached = downCursor >= streamFull.length;
          }

          // 渲染目标楼层周围的帖子（使用 attachPost 构建楼中楼关系）
          loadingTip.classList.add('show');
          anchorData.post_stream.posts.forEach(post => {
            if (post.post_number === 1) return;  // 已渲染
            attachPost(post, ctx);
          });
          reflowPending(ctx);
          loadingTip.classList.remove('show');

          // 定位到目标楼层
          if (targetPost) {
            const targetNode = ctx.nodeMap.get(resolvedTarget);
            if (targetNode) {
              targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
              targetNode.classList.add('ldp-flash');
              setTimeout(() => targetNode.classList.remove('ldp-flash'), 1700);
            }
          }

          // ====== 添加双向加载逻辑 ======
          async function fetchPosts(postIds) {
            if (!postIds || !postIds.length) return [];
            const qs = postIds.map(id => `post_ids[]=${id}`).join('&');
            const res = await fetchJSON(`${BASE}/t/${topicId}/posts.json?${qs}`);
            return res.post_stream.posts || [];
          }

          async function loadDown() {
            if (isAnchoring || loadingDown || bottomReached || downCursor >= streamFull.length) return;
            loadingDown = true;
            loadDownTip.classList.add('show');
            try {
              const batch = streamFull.slice(downCursor, Math.min(downCursor + PAGE_SIZE, streamFull.length));
              if (batch.length === 0) {
                bottomReached = true;
                showBottomTip();
                return;
              }

              const posts = await fetchPosts(batch);
              posts.forEach(p => {
                if (p.post_number === 1 || loadedPostIds.has(p.id)) return;
                loadedPostIds.add(p.id);
                attachPost(p, ctx);
              });
              reflowPending(ctx);

              downCursor += batch.length;
              bottomReached = downCursor >= streamFull.length;

              if (bottomReached) showBottomTip();
            } catch (e) {
              console.error('向下加载失败:', e);
            } finally {
              loadingDown = false;
              loadDownTip.classList.remove('show');
            }
          }

          async function loadUp() {
            if (isAnchoring || loadingUp || topReached || upCursor <= 0) return;
            loadingUp = true;
            loadUpTip.classList.add('show');
            try {
              const oldScrollHeight = body.scrollHeight;
              const oldScrollTop = body.scrollTop;

              const start = Math.max(0, upCursor - PAGE_SIZE);
              const batch = streamFull.slice(start, upCursor);
              if (batch.length === 0) {
                topReached = true;
                if (!body.querySelector('.ldp-top-tip')) {
                  const tip = document.createElement('div');
                  tip.className = 'ldp-top-tip';
                  tip.textContent = '已是最早的评论';
                  commentsEl.before(tip);
                }
                return;
              }

              const posts = await fetchPosts(batch);

              // 按 stream 顺序处理帖子（不要反转）
              // streamFull 中的顺序：[id1, id2, id3...] 对应楼层号顺序
              // fetchPosts 返回的帖子顺序可能与请求顺序不同，需要按 stream 顺序重新排序
              const postIdToPost = new Map(posts.map(p => [p.id, p]));
              const orderedPosts = batch
                  .map(id => postIdToPost.get(id))
                  .filter(Boolean);

              const fragment = document.createDocumentFragment();
              const tempCtx = Object.assign({}, ctx, {
                commentsEl: fragment,
                nodeMap: ctx.nodeMap,
                topicEl: ctx.topicEl,
              });

              orderedPosts.forEach(p => {
                if (p.post_number === 1 || loadedPostIds.has(p.id)) return;
                loadedPostIds.add(p.id);
                attachPost(p, tempCtx);
              });
              reflowPending(tempCtx);

              commentsEl.prepend(fragment);

              // 高度补偿
              requestAnimationFrame(() => {
                const newScrollHeight = body.scrollHeight;
                body.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
              });

              upCursor = start;
              topReached = upCursor === 0;

              if (topReached && !body.querySelector('.ldp-top-tip')) {
                const tip = document.createElement('div');
                tip.className = 'ldp-top-tip';
                tip.textContent = '已是最早的评论';
                commentsEl.before(tip);
              }
            } catch (e) {
              console.error('向上加载失败:', e);
            } finally {
              loadingUp = false;
              loadUpTip.classList.remove('show');
            }
          }

          // 监听滚动事件
          if (!bottomReached) {
            const sentinelDownIO = new IntersectionObserver(
                (entries) => { if (entries.some(en => en.isIntersecting) && !isAnchoring) loadDown(); },
                { root: body, rootMargin: '300px' }
            );
            sentinelDownIO.observe(downSentinel);
          }

          if (!topReached) {
            const sentinelUpIO = new IntersectionObserver(
                (entries) => { if (entries.some(en => en.isIntersecting) && !isAnchoring) loadUp(); },
                { root: body, rootMargin: '600px' }
            );
            sentinelUpIO.observe(upSentinel);
          }

          body.addEventListener('scroll', () => {
            if (isAnchoring) return;
            const { scrollTop, scrollHeight, clientHeight } = body;
            if (scrollHeight - scrollTop - clientHeight < 400) loadDown();
            if (scrollTop < 800) loadUp();
          }, { passive: true });

          // 延迟解锁锚定（等待滚动动画完成）
          setTimeout(() => {
            isAnchoring = false;
          }, 1200);

          showBottomTip();

        } catch (e) {
          alert('加载失败：' + e.message);
        }

        await mePromise;
        return;  // 跳转场景直接返回，不加载完整嵌套树
      }

      // 正常浏览：加载嵌套树 API
      const nestedResponse = await fetchNestedTree(topicId, 0);

      // 检查服务器返回的是嵌套树还是扁平流（私有话题等）
      if (nestedResponse.roots && nestedResponse.roots.length >= 0) {
        // 成功获取嵌套树数据
        const opPost = nestedResponse.op_post;
        let roots = nestedResponse.roots;
        const topicMeta = nestedResponse.topic;
        nestedHasMoreRoots = nestedResponse.has_more_roots || false;
        nestedRootsPage = nestedResponse.page || 0;
        nestedTreeRoots = roots;

        if (!opPost) {
          throw new Error('服务器返回数据缺少 OP 帖子');
        }

        // 建立混合索引
        idToPost.clear();
        idToPost.set(opPost.id, opPost);
        indexTree(roots);

        // 构造 topicData 对象（兼容后续逻辑）
        topicData = {
          id: topicMeta?.id || topicId,
          title: topicMeta?.title || '',
          posts_count: topicMeta?.posts_count || 1,
          views: 0,
          post_stream: {
            posts: [opPost, ...roots],
            stream: []
          },
          details: {
            created_by: { username: opPost.username }
          }
        };

        ctx.op = opPost.username;
        ctx.totalComments = (topicMeta?.posts_count || 1) - 1;  // 总评论数 = 总帖子数 - 楼主

        // 更新标题和元数据
        overlay.querySelector('.ldp-title').textContent = topicMeta?.title || `话题 #${topicId}`;
        overlay.querySelector('.ldp-meta').textContent =
            `${topicMeta?.posts_count || 1} 帖 · 楼主 @${ctx.op || '?'}`;
        updateCommentsHeader(ctx);

        // 渲染 1 楼
        const opNode = renderPost(opPost, false, ctx, 0);
        ctx.topicEl.appendChild(opNode);
        ctx.nodeMap.set(1, opNode);
        ctx.tracker.observe(opNode);

        // 立即移除骨架屏
        maskEl.classList.add('hide');
        setTimeout(() => maskEl.remove(), 300);

        // 绑定底部操作栏
        fOpenLink.href = `${BASE}/t/${topicId}`;
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

        // ====== 阶段 2：渲染嵌套树 ======
        loadingTip.classList.add('show');
        try {
          renderNestedTree(roots, commentsEl, ctx, 1);
          loadingTip.classList.remove('show');

          // 如果有更多顶层回复，添加滚动监听器
          if (nestedHasMoreRoots) {
            let isLoadingMore = false;  // 加载锁

            // IntersectionObserver 监听底部哨兵
            const sentinelDownIO = new IntersectionObserver(
                (entries) => {
                  if (entries.some((en) => en.isIntersecting) && !isLoadingMore) {
                    loadMoreRoots();
                  }
                },
                { root: body, rootMargin: '300px' }
            );
            sentinelDownIO.observe(downSentinel);

            // scroll 事件兜底
            body.addEventListener('scroll', () => {
              if (isLoadingMore) return;
              const { scrollTop, scrollHeight, clientHeight } = body;
              if (scrollHeight - scrollTop - clientHeight < 400) {
                loadMoreRoots();
              }
            }, { passive: true });

            // 加载更多顶层回复
            async function loadMoreRoots() {
              if (!nestedHasMoreRoots || isLoadingMore) return;

              isLoadingMore = true;
              loadDownTip.classList.add('show');
              try {
                const nextPage = nestedRootsPage + 1;
                const response = await fetchNestedTree(topicId, nextPage);

                if (response.roots && response.roots.length > 0) {
                  // 去重：过滤已存在的帖子
                  const existingIds = new Set(nestedTreeRoots.map(r => r.id));
                  const newRoots = response.roots.filter(r => !existingIds.has(r.id));

                  if (newRoots.length > 0) {
                    // 追加新数据到索引
                    indexTree(newRoots);

                    // 追加到内存树
                    nestedTreeRoots = nestedTreeRoots.concat(newRoots);

                    // 渲染新数据
                    renderNestedTree(newRoots, commentsEl, ctx, 1);
                  }

                  // 更新状态
                  nestedHasMoreRoots = response.has_more_roots || false;
                  nestedRootsPage = response.page || nextPage;

                  if (!nestedHasMoreRoots) {
                    showBottomTip();
                  }
                } else {
                  // 没有新数据，停止加载
                  nestedHasMoreRoots = false;
                  showBottomTip();
                }
              } catch (e) {
                console.error('加载更多评论失败:', e);
              } finally {
                isLoadingMore = false;
                loadDownTip.classList.remove('show');
              }
            }
          } else {
            showBottomTip();
          }
        } catch (err) {
          loadingTip.classList.remove('show');
          alert('渲染评论失败：' + err.message);
        }

      } else if (nestedResponse.flat_topic) {
        // 服务器返回扁平流（私有话题等）
        alert('此话题不支持树形视图，请刷新页面使用标准视图');
        return;
      } else {
        throw new Error('服务器返回数据格式异常');
      }

      // 等待 ME 加载完成
      await mePromise;

    } catch (err) {
      if (err.name === 'AbortError') {
        // 用户关闭弹框，静默退出
        return;
      }
      // 加载失败，显示错误
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