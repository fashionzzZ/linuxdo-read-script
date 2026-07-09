// ==UserScript==
// @name         LinuxDo 增强阅读
// @namespace    https://linux.do/
// @version      1.0.8
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
  const PAGE_SIZE = 20;
  const READ_THRESHOLD = 1500;
  const FLUSH_INTERVAL = 5000;
  let ME_USERNAME = null;

  // --- 楼中楼分批加载 & 请求节流 相关配置 ---
  const SUB_REPLY_INITIAL_SIZE = 3;   // 楼中楼默认展示条数
  const SUB_REPLY_PAGE_SIZE = 10;     // 每次点击“展示更多”追加条数
  const REPLIES_FETCH_MIN_INTERVAL = 300; // 楼中楼接口请求最小间隔(ms)
  const REPLIES_HOVER_DELAY = 400;    // 楼层在视口停留超过此时长才触发抓取(ms)
  let lastRepliesFetchTime = 0; // 楼中楼请求节流用的时间戳

  const MENU_PANEL_SEL = '.menu-panel, .user-menu, .quick-access-panel, .notifications';
  const SEARCH_SEL = '.search-results, .fps-result, .search-menu, .search-menu-container, .search-result-topic';

  /* ============ 1. 样式 ============ */
  const style = document.createElement('style');
  style.textContent = `
    .ldp-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;
      align-items:center;justify-content:center;background:rgba(0,0,0,.55);}
    .ldp-modal{display:flex;flex-direction:column;
      width: 90%;max-width: 1000px;height:90vh;
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
    .ldp-sk-w30{width:30%;} .ldp-sk-w40{width:40%;} .ldp-sk-w60{width:60%;}
    .ldp-sk-w80{width:80%;} .ldp-sk-w90{width:90%;} .ldp-sk-w100{width:100%;}
    .ldp-sk-para .ldp-sk-line{margin-bottom:8px;}
    .ldp-sk-divider{height:1px;background:var(--primary-low,#e0e0e0);margin:16px 0 12px;}
    .ldp-sk-comment{display:flex;gap:10px;margin-bottom:18px;}
    .ldp-sk-comment .ldp-sk-avatar{width:28px;height:28px;}
    .ldp-sk-cbody{flex:1;}

    /* 楼主帖区块 */
    .ldp-topic{padding:4px 0 14px;}
    .ldp-topic .ldp-post{border-bottom:none;}

    /* 评论区分隔 + 左上角“评论”标题 */
    .ldp-comments-header{display:flex;align-items:center;gap:8px;
      margin:6px 0 2px;padding-top:14px;border-top:2px solid var(--primary-low,#e0e0e0);
      font-size:16px;font-weight:700;letter-spacing:.5px;}
    .ldp-comments-header::before{content:"💬";font-size:14px;}
    .ldp-comments-count{font-size:12px;font-weight:500;opacity:.6;}
    .ldp-comments{padding-top:4px;}
    .ldp-comments-empty{padding:18px 0;text-align:center;opacity:.5;font-size:13px;}

    .ldp-post{padding:12px 0;border-bottom:1px solid var(--primary-low,#eee);}
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
    .ldp-children{margin-left:22px;padding-left:14px;
      border-left:2px solid var(--tertiary,#08c);}
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

    /* 楼中楼“展示更多回复”按钮 */
    .ldp-sub-actions{margin-left:22px;padding-left:14px;margin-top:2px;display:none;}
    .ldp-load-more-replies{font-size:12px;color:var(--tertiary,#08c);font-weight:600;
      opacity:.9;padding:4px 0;}
    .ldp-load-more-replies:hover{opacity:1;text-decoration:underline;}
    .ldp-sub-loading{font-size:12px;opacity:.5;margin-left:22px;padding-left:14px;
      margin-top:2px;display:none;}

    /* 下拉加载评论时的底部加载提示 */
    .ldp-loading-tip{padding:14px 0;text-align:center;font-size:13px;
      color:var(--primary-medium,#888);display:none;user-select:none;}
    .ldp-loading-tip.show{display:block;}
    .ldp-loading-tip .ldp-tip-icon{display:inline-block;margin-right:6px;
      animation:ldp-spin .9s linear infinite;}
    @keyframes ldp-spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
  `;
  document.head.appendChild(style);

  /* ============ 2. 工具 ============ */
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

  // 专用于楼中楼 replies 接口的节流请求，与其它接口的 fetchJSON 互不影响
  async function fetchRepliesThrottled(url) {
    const now = Date.now();
    const wait = REPLIES_FETCH_MIN_INTERVAL - (now - lastRepliesFetchTime);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRepliesFetchTime = Date.now();
    return fetchJSON(url);
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

  /* ============ 5. 加载器 ============ */
  function createLoader(topicId) {
    let stream = [];
    const cache = new Map();
    let cursor = 0;
    let topic = null;
    let failStreak = 0;

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
      stream = data.post_stream.stream || [];
      data.post_stream.posts.forEach((p) => cache.set(p.id, p));
      const op = (topic.details && topic.details.created_by && topic.details.created_by.username)
          || (data.post_stream.posts.find((p) => p.post_number === 1) || {}).username
          || null;
      topic._opUsername = op;
      topic._opPost = data.post_stream.posts.find((p) => p.post_number === 1) || null;
      return topic;
    }

    async function next() {
      if (cursor >= stream.length) return { posts: [], done: true };
      const slice = stream.slice(cursor, cursor + PAGE_SIZE);
      let missing = slice.filter((id) => !cache.has(id));

      for (let attempt = 0; attempt < 2 && missing.length; attempt++) {
        const qs = missing.map((id) => `post_ids[]=${id}`).join('&');
        try {
          const part = await fetchJSON(`${BASE}/t/${topicId}/posts.json?${qs}`);
          part.post_stream.posts.forEach((p) => cache.set(p.id, p));
        } catch (e) {}
        missing = slice.filter((id) => !cache.has(id));
      }

      if (missing.length) {
        failStreak++;
        if (failStreak >= 4) {
          cursor += slice.length;
          failStreak = 0;
          const posts = slice.map((id) => cache.get(id)).filter(Boolean);
          return { posts, done: cursor >= stream.length };
        }
        return { posts: [], done: false, retry: true };
      }

      failStreak = 0;
      cursor += slice.length;
      const posts = slice.map((id) => cache.get(id)).filter(Boolean);
      return { posts, done: cursor >= stream.length };
    }

    return { init, next, get topic() { return topic; } };
  }

  /* ============ 6. 楼层归位 ============ */
  function attachPost(p, ctx) {
    if (p.post_number === 1) {
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
    // 仅当该楼层确实存在回复时才纳入楼中楼观察队列（减少无意义的 IO 开销）
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
      <div class="ldp-content">${p.cooked || ''}</div>
      <div class="ldp-actions">
        <button class="ldp-btn ldp-like ${acted ? 'liked' : ''}"
          data-acted="${acted ? '1' : '0'}" ${canAct || acted ? '' : 'disabled'}>
          ♥ <span class="ldp-like-count">${count}</span>
        </button>
        <button class="ldp-btn ldp-replybtn">↩ 回复</button>
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
    box.innerHTML = `<textarea placeholder="回复 @${esc(username)} … (支持直接粘贴图片)"></textarea><button class="ldp-send">发送</button><span class="ldp-reply-tip">✓ 已发送</span>`;

    const textarea = box.querySelector('textarea');
    bindPasteEvent(textarea); // 绑定粘贴事件

    const actions = post.querySelector(':scope > .ldp-actions');
    if (actions) actions.after(box);
    else post.appendChild(box);
    return box;
  }

  /* ============ 图片粘贴上传逻辑 ============ */
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

          const originalPlaceholder = `\n[正在上传图片 ${file.name} ...]\n`;
          insertAtCursor(textarea, originalPlaceholder);
          textarea.classList.add('uploading');

          try {
            const res = await uploadImage(file);
            if (res && res.short_url) {
              // Discourse 返回的 short_url 通常是 upload://xxx 格式
              // 构造 Markdown 引用
              const markdown = `\n![${res.original_filename}|${res.width}x${res.height}](${res.short_url})\n`;
              textarea.value = textarea.value.replace(originalPlaceholder, markdown);
            } else {
              throw new Error('上传返回数据异常');
            }
          } catch (err) {
            textarea.value = textarea.value.replace(originalPlaceholder, `\n[图片上传失败: ${err.message}]\n`);
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
    const parentNode = ctx.nodeMap.get(postNumber) || (ctx.topicEl.querySelector(`.ldp-post[data-post-number="${postNumber}"]`));
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
      const img = e.target.closest('.ldp-content img');
      if (img) { e.preventDefault(); e.stopPropagation(); openLightbox(resolveOriginalSrc(img)); return; }

      // 楼中楼“展示更多回复”按钮
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

      // 发送回复
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

          // 拿到回复数据
          const postData = data && data.post ? data.post : data;

          if (postData && postData.cooked) {
            const isTopLevel = postNumber === 1; // 回复楼主帖时按普通顶级评论处理，而非楼中楼
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
            if (tip) {
              tip.classList.add('show');
              setTimeout(() => tip.classList.remove('show'), 1500);
            }

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
          // 停顿检测：楼层需在视口停留 REPLIES_HOVER_DELAY 才真正发起请求，快速划过则不触发
          const timer = setTimeout(async () => {
            hoverTimers.delete(postId);
            fetched.add(postId);
            const loadingEl = en.target.querySelector(':scope > .ldp-sub-loading');
            if (loadingEl) loadingEl.style.display = 'block';
            try {
              const replies = await fetchRepliesThrottled(`${BASE}/posts/${postId}/replies.json`);
              if (loadingEl) loadingEl.style.display = 'none';
              if (!replies || !replies.length) return;
              ctx.subReplyState.set(postNumber, { all: replies, renderedCount: 0 });
              renderSubReplyBatch(postNumber, ctx); // 首批只渲染 SUB_REPLY_INITIAL_SIZE 条
            } catch (e) {
              if (loadingEl) loadingEl.style.display = 'none';
              fetched.delete(postId); // 失败允许下次进入视口重试
            }
          }, REPLIES_HOVER_DELAY);
          hoverTimers.set(postId, timer);
        } else {
          // 离开视口时若尚未真正发起请求，则取消该次触发
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
    const textEl = btn.querySelector('.ldp-f-bookmark-text') || btn;
    const sync = () => { btn.classList.toggle('bookmarked', bookmarked); textEl.textContent = bookmarked ? '已收藏' : '收藏'; };
    sync();
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (!bookmarked) {
          const data = await apiSend(`${BASE}/bookmarks`, 'POST', { bookmarkable_id: topic.id, bookmarkable_type: 'Topic' });
          bookmarkId = data && data.id ? data.id : bookmarkId; bookmarked = true;
        } else if (bookmarkId) {
          await apiSend(`${BASE}/bookmarks/${bookmarkId}`, 'DELETE'); bookmarked = false; bookmarkId = null;
        } else { await apiSend(`${BASE}/t/${topic.id}/remove_bookmarks`, 'PUT'); bookmarked = false; }
        sync();
      } catch (err) { alert('收藏操作失败：' + err.message); } finally { btn.disabled = false; }
    });
  }

  /* 底部悬浮操作栏的点赞按钮：对楼主帖（1 楼）执行点赞/取消点赞 */
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

  /* 骨架屏 HTML */
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

  /* ============ 13. 弹窗主体 + 循环泵加载 ============ */
  let CURRENT_OVERLAY = null;

  async function openModal(topicId) {
    if (CURRENT_OVERLAY) { CURRENT_OVERLAY.remove(); CURRENT_OVERLAY = null; }
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
          <div class="ldp-comments"><div class="ldp-comments-empty">暂无评论</div></div>
          <div class="ldp-loading-tip"><span class="ldp-tip-icon">⌛</span>正在加载评论…</div>
          <div class="ldp-sentinel"></div>
          <div class="ldp-loadmask">${SKELETON_HTML}</div>
        </div>
        <div class="ldp-footer" hidden>
          <button class="ldp-fbtn ldp-f-like" disabled title="点赞">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <span class="ldp-f-like-count">0</span>
          </button>
          <button class="ldp-fbtn ldp-f-reply" title="回复帖子">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
            <span class="ldp-f-reply-count">0</span>
          </button>
          <button class="ldp-fbtn ldp-f-bookmark" title="收藏">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
            <span class="ldp-f-bookmark-text">收藏</span>
          </button>
          <a class="ldp-fbtn ldp-f-open" href="#" target="_blank" rel="noopener" title="新标签页打开">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            <span>打开原帖</span>
          </a>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    CURRENT_OVERLAY = overlay;

    const modal = overlay.querySelector('.ldp-modal'), body = overlay.querySelector('.ldp-body');
    const topicEl = overlay.querySelector('.ldp-topic'), commentsEl = overlay.querySelector('.ldp-comments');
    const countEl = overlay.querySelector('.ldp-comments-count'), emptyEl = overlay.querySelector('.ldp-comments-empty');
    const sentinel = overlay.querySelector('.ldp-sentinel'), maskEl = overlay.querySelector('.ldp-loadmask');
    const loadingTip = overlay.querySelector('.ldp-loading-tip');
    const footerEl = overlay.querySelector('.ldp-footer');
    const fLikeBtn = overlay.querySelector('.ldp-f-like'), fLikeCountEl = overlay.querySelector('.ldp-f-like-count');
    const fReplyBtn = overlay.querySelector('.ldp-f-reply'), fBookmarkBtn = overlay.querySelector('.ldp-f-bookmark');
    const fReplyCountEl = overlay.querySelector('.ldp-f-reply-count');
    const fOpenLink = overlay.querySelector('.ldp-f-open');

    const loader = createLoader(topicId), tracker = createReadTracker(topicId, body);
    const ctx = {
      topicId, op: null, topicEl, commentsEl, countEl, emptyEl, scrollRoot: body,
      nodeMap: new Map(), pending: [], tracker, totalComments: 0, repliesIO: null,
      subReplyState: new Map(), // 楼中楼原始数据 + 已渲染数量的状态表
      footerReplyCountEl: fReplyCountEl, // 底部悬浮操作栏的评论数展示
    };
    ctx.repliesIO = createRepliesIO(ctx);

    let loading = false, done = false, pendingRetry = false;

    const close = () => { tracker.stop(); ctx.repliesIO.disconnect(); overlay.remove(); if (CURRENT_OVERLAY === overlay) CURRENT_OVERLAY = null; document.removeEventListener('keydown', onEsc); };
    function onEsc(e) { if (e.key === 'Escape') close(); }
    overlay.querySelector('.ldp-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onEsc);

    const sentinelVisible = () => { const br = body.getBoundingClientRect(), sr = sentinel.getBoundingClientRect(); return sr.top <= br.bottom + 300; };

    const pump = async () => {
      if (loading) return;
      loading = true;
      // 只要还没加载完，进入循环前先亮出底部提示
      if (!done) loadingTip.classList.add('show');
      try {
        while (!done && (sentinelVisible() || pendingRetry)) {
          pendingRetry = false;
          const { posts, done: isDone, retry } = await loader.next();
          posts.forEach((p) => attachPost(p, ctx));
          reflowPending(ctx);
          if (retry) {
            pendingRetry = true;
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          done = isDone;
        }
        if (done && !overlay.querySelector('.ldp-link-open')) {
          const link = document.createElement('a');
          link.className = 'ldp-link-open'; link.href = `${BASE}/t/${topicId}`; link.target = '_blank';
          link.textContent = '已到底 · 在新标签页打开原帖 →';
          body.insertBefore(link, sentinel);
        }
      } catch (e) {} finally {
        loading = false;
        // 本轮抓取结束（无论成功、失败或已到底）都收起提示
        loadingTip.classList.remove('show');
      }
    };

    try {
      const topic = await loader.init();
      ctx.op = topic._opUsername; ctx.totalComments = Math.max(0, (topic.posts_count || 1) - 1);
      overlay.querySelector('.ldp-title').textContent = topic.title;
      overlay.querySelector('.ldp-meta').textContent = `${topic.posts_count} 帖 · ${topic.views || 0} 浏览 · 楼主 @${ctx.op || '?'}`;
      updateCommentsHeader(ctx);

      fOpenLink.href = `${BASE}/t/${topic.id}`;
      bindBookmark(fBookmarkBtn, topic);
      bindFooterLike(fLikeBtn, fLikeCountEl, topic._opPost);
      fReplyBtn.addEventListener('click', () => {
        const opNode = ctx.topicEl.querySelector('.ldp-post');
        if (!opNode) return;
        const box = ensureReplyBox(opNode);
        box.classList.toggle('open');
        if (box.classList.contains('open')) {
          box.querySelector('textarea').focus();
          box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      footerEl.hidden = false;

      bindActions(modal, ctx);
      tracker.start();

      const sentinelIO = new IntersectionObserver((entries) => { if (entries.some((en) => en.isIntersecting)) pump(); }, { root: body, rootMargin: '300px' });
      sentinelIO.observe(sentinel);
      body.addEventListener('scroll', () => { if (sentinelVisible()) pump(); }, { passive: true });

      await pump();
      maskEl.classList.add('hide');
      setTimeout(() => maskEl.remove(), 300);
    } catch (err) {
      if (maskEl) maskEl.remove();
      body.innerHTML = `<div class="ldp-error">加载失败：${esc(err.message)}</div>`;
    }
  }

  /* ============ 14. 拦截标题点击 ============ */
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a.title, a.raw-topic-link, a.search-link, a.search-result-topic, a[href*="/t/"]');
    if (!a || a.classList.contains('ldp-link-open') || a.classList.contains('ldp-f-open')) return;
    const inMenu = !!a.closest(MENU_PANEL_SEL), inSearch = !!a.closest(SEARCH_SEL);
    const isTitle = a.classList.contains('title') || a.classList.contains('raw-topic-link') || a.classList.contains('search-link') || a.classList.contains('search-result-topic');
    if (!isTitle && !inMenu && !inSearch) return;
    const m = (a.getAttribute('href') || '').match(/\/t\/(?:[^\/]+\/)?(\d+)/);
    if (!m) return;
    e.preventDefault(); e.stopPropagation();
    openModal(m[1]);
  }, true);
})();