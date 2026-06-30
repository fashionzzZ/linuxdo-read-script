// ==UserScript==
// @name         LinuxDo 增强阅读
// @namespace    https://linux.do/
// @version      1.0.2
// @license      MIT
// @description  在 LINUX DO 列表页点击标题即可弹窗预览整帖，楼中楼展示、点赞、回复、收藏、原图灯箱一应俱全，并按真实阅读节奏上报已读进度——无需离开列表页，也无需反复返回。
// @author       Fashion
// @match        https://linux.do/*
// @icon         https://cdn3.ldstatic.com/optimized/4X/6/a/6/6a6affc7b1ce8140279e959d32671304db06d5ab_2_180x180.png
// @grant        none
// @run-at       document-idle
// @downloadURL https://update.greasyfork.org/scripts/584412/LinuxDo%20%E5%A2%9E%E5%BC%BA%E9%98%85%E8%AF%BB.user.js
// @updateURL https://update.greasyfork.org/scripts/584412/LinuxDo%20%E5%A2%9E%E5%BC%BA%E9%98%85%E8%AF%BB.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const BASE = location.origin;
  const PAGE_SIZE = 20;
  const READ_THRESHOLD = 1500;
  const FLUSH_INTERVAL = 5000;
  let ME_USERNAME = null;

  const MENU_PANEL_SEL = '.menu-panel, .user-menu, .quick-access-panel, .notifications';

  /* ============ 1. 样式 ============ */
  const style = document.createElement('style');
  style.textContent = `
    .ldp-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;
      align-items:center;justify-content:center;background:rgba(0,0,0,.55);}
    .ldp-modal{display:flex;flex-direction:column;
      width:min(880px,92vw);height:86vh;
      border-radius:12px;overflow:hidden;font-size:14px;
      line-height:1.65;background:var(--secondary,#fff);color:var(--primary,#222);
      box-shadow:0 16px 50px rgba(0,0,0,.4);}
    .ldp-header{display:flex;align-items:flex-start;gap:10px;padding:16px 20px;
      border-bottom:1px solid var(--primary-low,#e5e5e5);}
    .ldp-title{margin:0;font-size:18px;font-weight:700;}
    .ldp-meta{font-size:12px;opacity:.7;margin-top:4px;}
    .ldp-head-btns{display:flex;gap:8px;align-items:center;}
    .ldp-open{cursor:pointer;border:1px solid var(--primary-low,#ccc);
      background:transparent;color:inherit;border-radius:6px;padding:4px 10px;
      font-size:12px;white-space:nowrap;text-decoration:none;}
    .ldp-open:hover{background:var(--primary-very-low,#f0f0f0);}
    .ldp-bookmark{cursor:pointer;border:1px solid var(--primary-low,#ccc);
      background:transparent;color:inherit;border-radius:6px;padding:4px 10px;
      font-size:12px;white-space:nowrap;}
    .ldp-bookmark.on{background:var(--tertiary,#08c);color:#fff;border-color:transparent;}
    .ldp-close{cursor:pointer;border:none;background:transparent;font-size:22px;
      line-height:1;color:inherit;padding:0 4px;}
    .ldp-body{flex:1;min-height:0;position:relative;
      padding:8px 20px 20px;overflow-y:auto;overscroll-behavior:contain;}

    /* 加载遮罩 + 转圈动画 */
    .ldp-loadmask{position:absolute;inset:0;z-index:5;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:14px;background:var(--secondary,#fff);color:inherit;}
    .ldp-spinner{width:38px;height:38px;border-radius:50%;
      border:3px solid var(--primary-low,#e0e0e0);
      border-top-color:var(--tertiary,#08c);
      animation:ldp-spin .8s linear infinite;}
    .ldp-loadmask-text{font-size:13px;opacity:.6;}
    .ldp-loadmask.hide{opacity:0;pointer-events:none;transition:opacity .25s ease;}
    @keyframes ldp-spin{to{transform:rotate(360deg);}}

    /* 楼主帖区块 */
    .ldp-topic{padding:4px 0 14px;}
    .ldp-topic .ldp-post{border-bottom:none;}

    /* 评论区分隔 + 左上角“评论”标题 */
    .ldp-comments-header{display:flex;align-items:center;gap:8px;
      margin:6px 0 2px;padding-top:14px;border-top:2px solid var(--primary-low,#e0e0e0);
      font-size:15px;font-weight:700;letter-spacing:.5px;}
    .ldp-comments-header::before{content:"💬";font-size:14px;}
    .ldp-comments-count{font-size:12px;font-weight:500;opacity:.6;}
    .ldp-comments{padding-top:4px;}
    .ldp-comments-empty{padding:18px 0;text-align:center;opacity:.5;font-size:13px;}

    .ldp-post{padding:12px 0;border-bottom:1px solid var(--primary-low,#eee);}
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
    .ldp-replybox{margin-top:8px;}
    .ldp-replybox textarea{width:100%;min-height:70px;box-sizing:border-box;
      border:1px solid var(--primary-low,#ccc);border-radius:6px;padding:8px;
      font:inherit;background:var(--secondary,#fff);color:inherit;resize:vertical;}
    .ldp-send{margin-top:6px;background:var(--tertiary,#08c);color:#fff;border:none;
      border-radius:6px;padding:6px 14px;cursor:pointer;}
    .ldp-loadmore,.ldp-error{padding:24px;text-align:center;opacity:.7;}
    .ldp-link-open{margin-top:10px;display:inline-block;font-size:12px;}
    .ldp-sentinel{height:1px;}
    /* 单图灯箱 */
    .ldp-lightbox{position:fixed;inset:0;z-index:2147483600;display:flex;
      flex-direction:column;background:rgba(0,0,0,.9);}
    .ldp-lb-stage{flex:1;overflow:auto;display:flex;align-items:center;
      justify-content:center;padding:20px;}
    .ldp-lb-stage img{display:block;max-width:94vw;max-height:88vh;
      width:auto;height:auto;border-radius:4px;cursor:zoom-out;
      box-shadow:0 10px 40px rgba(0,0,0,.6);}
    .ldp-lb-x{position:fixed;top:14px;right:18px;z-index:1;cursor:pointer;border:none;
      background:transparent;color:#fff;font-size:30px;line-height:1;}
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
  // 想用绝对时间，把上面整段换成：
  // function fmtTime(iso){const d=new Date(iso);if(isNaN(d.getTime()))return'';
  //   const p=n=>String(n).padStart(2,'0');
  //   return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;}

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
    if (params) {
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

  /* ============ 5. 分块加载 ============ */
  function createLoader(topicId) {
    let stream = [];
    const cache = new Map();
    let cursor = 0;
    let topic = null;

    async function init() {
      await ensureMe();
      const data = await fetchJSON(`${BASE}/t/${topicId}.json`);
      topic = data;
      stream = data.post_stream.stream || [];
      data.post_stream.posts.forEach((p) => cache.set(p.id, p));
      const op = (topic.details && topic.details.created_by && topic.details.created_by.username)
          || (data.post_stream.posts.find((p) => p.post_number === 1) || {}).username
          || null;
      topic._opUsername = op;
      return topic;
    }

    async function next() {
      if (cursor >= stream.length) return { posts: [], done: true };
      const slice = stream.slice(cursor, cursor + PAGE_SIZE);
      cursor += slice.length;
      const missing = slice.filter((id) => !cache.has(id));
      if (missing.length) {
        const qs = missing.map((id) => `post_ids[]=${id}`).join('&');
        try {
          const part = await fetchJSON(`${BASE}/t/${topicId}/posts.json?${qs}`);
          part.post_stream.posts.forEach((p) => cache.set(p.id, p));
        } catch (e) { /* 忽略单块失败 */ }
      }
      const posts = slice.map((id) => cache.get(id)).filter(Boolean);
      return { posts, done: cursor >= stream.length };
    }

    return { init, next, get topic() { return topic; } };
  }

  /* ============ 6. 楼层归位（区分楼主帖 / 评论区 / 楼中楼）============ */
  function attachPost(p, ctx) {
    // 楼主帖（#1）单独进 topic 区，不进 nodeMap、不计入评论
    if (p.post_number === 1) {
      const node = renderPost(p, false, ctx);
      ctx.topicEl.appendChild(node);
      ctx.tracker.observe(node);
      return;
    }

    if (ctx.nodeMap.has(p.post_number)) return; // 去重

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
    ctx.repliesIO.observe(node);
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

  /* ============ 7. 渲染单条（楼层号置于行末，@ID 后跟时间）============ */
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
        ${isOP ? '<span class="ldp-op">OP</span>' : ''}
        ${isME ? '<span class="ldp-me">ME</span>' : ''}
        <span class="ldp-user">@${esc(p.username)}</span>
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
    `;
    node.querySelectorAll('.ldp-content img').forEach((im) => {
      im.loading = 'lazy';
      im.decoding = 'async';
    });
    return node;
  }

  /* ============ 8. 回复框惰性创建 ============ */
  function ensureReplyBox(post) {
    let box = post.querySelector(':scope > .ldp-replybox');
    if (box) return box;
    const username = (post.querySelector(':scope > .ldp-post-head .ldp-user')?.textContent || '')
        .replace(/^@/, '');
    box = document.createElement('div');
    box.className = 'ldp-replybox';
    box.innerHTML = `
      <textarea placeholder="回复 @${esc(username)} …"></textarea>
      <button class="ldp-send">发送</button>`;
    const children = post.querySelector(':scope > .ldp-children');
    post.insertBefore(box, children);
    return box;
  }

  /* ============ 9. 事件委托：图片灯箱 / 点赞 / 回复 ============ */
  function bindActions(modal, ctx) {
    modal.addEventListener('click', async (e) => {
      const img = e.target.closest('.ldp-content img');
      if (img) {
        e.preventDefault();
        e.stopPropagation();
        openLightbox(resolveOriginalSrc(img));
        return;
      }

      const post = e.target.closest('.ldp-post');
      if (!post) return;
      const postId = post.dataset.postId;
      const postNumber = +post.dataset.postNumber;

      const likeBtn = e.target.closest('.ldp-like');
      if (likeBtn && !likeBtn.disabled) {
        const countEl = likeBtn.querySelector('.ldp-like-count');
        const acted = likeBtn.dataset.acted === '1';
        likeBtn.disabled = true;
        try {
          if (!acted) {
            await apiSend(`${BASE}/post_actions`, 'POST',
                { id: postId, post_action_type_id: 2, flag_topic: false });
            likeBtn.classList.add('liked');
            likeBtn.dataset.acted = '1';
            countEl.textContent = (+countEl.textContent) + 1;
          } else {
            await apiSend(`${BASE}/post_actions/${postId}?post_action_type_id=2`, 'DELETE');
            likeBtn.classList.remove('liked');
            likeBtn.dataset.acted = '0';
            countEl.textContent = Math.max(0, (+countEl.textContent) - 1);
          }
        } catch (err) {
          alert('操作失败：' + err.message + '（取消赞有时间限制，或需登录/权限）');
        } finally {
          likeBtn.disabled = false;
        }
        return;
      }

      const replyBtn = e.target.closest('.ldp-replybtn');
      if (replyBtn) {
        const box = ensureReplyBox(post);
        box.classList.toggle('open');
        if (box.classList.contains('open')) box.querySelector('textarea').focus();
        return;
      }

      const sendBtn = e.target.closest('.ldp-send');
      if (sendBtn) {
        const box = sendBtn.closest('.ldp-replybox');
        const textarea = box.querySelector('textarea');
        const raw = textarea.value.trim();
        if (!raw) return;
        sendBtn.disabled = true; sendBtn.textContent = '发送中…';
        try {
          const data = await apiSend(`${BASE}/posts`, 'POST', {
            raw, topic_id: ctx.topicId,
            reply_to_post_number: postNumber, nested_post: true,
          });
          box.classList.remove('open');
          textarea.value = '';
          if (data && data.cooked) {
            const newNode = renderPost({
              id: data.id, post_number: data.post_number,
              username: data.username || ME_USERNAME, name: data.name,
              avatar_template: data.avatar_template, cooked: data.cooked,
              created_at: data.created_at || new Date().toISOString(),
              reply_to_post_number: postNumber, actions_summary: [],
            }, true, ctx);
            post.querySelector(':scope > .ldp-children').appendChild(newNode);
            ctx.tracker.observe(newNode);
          }
        } catch (err) {
          alert('回复失败：' + err.message + '（需登录或权限不足）');
        } finally {
          sendBtn.disabled = false; sendBtn.textContent = '发送';
        }
        return;
      }
    });
  }

  /* ============ 10. 楼中楼按需补全（父楼进视口拉 replies.json）============ */
  function createRepliesIO(ctx) {
    const fetched = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach(async (en) => {
        if (!en.isIntersecting) return;
        const postId = en.target.dataset.postId;
        const postNumber = +en.target.dataset.postNumber;
        if (!postId || fetched.has(postId)) return;
        fetched.add(postId);
        try {
          const replies = await fetchJSON(`${BASE}/posts/${postId}/replies.json`);
          (replies || []).forEach((rp) => {
            if (!rp.reply_to_post_number) rp.reply_to_post_number = postNumber;
            attachPost(rp, ctx);
          });
          reflowPending(ctx);
        } catch (e) { /* 忽略补全失败 */ }
      });
    }, { root: ctx.scrollRoot, rootMargin: '120px', threshold: 0.1 });
    return io;
  }

  /* ============ 11. 收藏（整帖）============ */
  function bindBookmark(btn, topic) {
    let bookmarked = !!topic.bookmarked;
    let bookmarkId = topic.bookmark_id || null;
    const sync = () => {
      btn.classList.toggle('on', bookmarked);
      btn.textContent = bookmarked ? '★ 已收藏' : '☆ 收藏本帖';
    };
    sync();

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (!bookmarked) {
          const data = await apiSend(`${BASE}/bookmarks`, 'POST', {
            bookmarkable_id: topic.id, bookmarkable_type: 'Topic',
          });
          bookmarkId = data && data.id ? data.id : bookmarkId;
          bookmarked = true;
        } else if (bookmarkId) {
          await apiSend(`${BASE}/bookmarks/${bookmarkId}`, 'DELETE');
          bookmarked = false; bookmarkId = null;
        } else {
          await apiSend(`${BASE}/t/${topic.id}/remove_bookmarks`, 'PUT');
          bookmarked = false;
        }
        sync();
      } catch (err) {
        alert('收藏操作失败：' + err.message + '（需登录或权限不足）');
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* 评论区标题：显示总评论数（总帖数 - 楼主帖） */
  function updateCommentsHeader(ctx) {
    if (ctx.countEl) {
      ctx.countEl.textContent = ctx.totalComments ? `（${ctx.totalComments}）` : '';
    }
    if (ctx.emptyEl) ctx.emptyEl.style.display = ctx.totalComments ? 'none' : '';
  }

  /* ============ 12. 弹窗主体 + 哨兵加载 ============ */
  let CURRENT_OVERLAY = null; // 弹窗单例

  async function openModal(topicId, titleHint) {
    if (CURRENT_OVERLAY) { CURRENT_OVERLAY.remove(); CURRENT_OVERLAY = null; }

    const overlay = document.createElement('div');
    overlay.className = 'ldp-overlay';
    overlay.innerHTML = `
      <div class="ldp-modal">
        <div class="ldp-header">
          <div style="flex:1">
            <h2 class="ldp-title">${esc(titleHint || '加载中…')}</h2>
            <div class="ldp-meta"></div>
          </div>
          <div class="ldp-head-btns">
            <button class="ldp-bookmark" hidden>☆ 收藏本帖</button>
            <a class="ldp-open" href="#" target="_blank" rel="noopener" hidden>↗ 打开原帖</a>
            <button class="ldp-close" title="关闭">×</button>
          </div>
        </div>
        <div class="ldp-body">
          <div class="ldp-topic"></div>
          <div class="ldp-comments-header">评论<span class="ldp-comments-count"></span></div>
          <div class="ldp-comments">
            <div class="ldp-comments-empty">暂无评论</div>
          </div>
          <div class="ldp-sentinel"></div>
          <div class="ldp-loadmask">
            <div class="ldp-spinner"></div>
            <div class="ldp-loadmask-text">正在加载帖子…</div>
          </div>
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
    const sentinel = overlay.querySelector('.ldp-sentinel');
    const maskEl = overlay.querySelector('.ldp-loadmask');

    const loader = createLoader(topicId);
    const tracker = createReadTracker(topicId, body);

    const ctx = {
      topicId, op: null,
      topicEl, commentsEl, countEl, emptyEl, scrollRoot: body,
      nodeMap: new Map(), pending: [], tracker,
      totalComments: 0, repliesIO: null,
    };
    ctx.repliesIO = createRepliesIO(ctx);

    let loading = false, done = false;

    const close = () => {
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

    try {
      const topic = await loader.init();
      ctx.op = topic._opUsername;
      ctx.totalComments = Math.max(0, (topic.posts_count || 1) - 1); // 总评论数
      overlay.querySelector('.ldp-title').textContent = topic.title;
      overlay.querySelector('.ldp-meta').textContent =
          `${topic.posts_count} 帖 · ${topic.views || 0} 浏览 · 楼主 @${ctx.op || '?'}`;
      updateCommentsHeader(ctx); // 立即显示总评论数与空态

      const openBtn = overlay.querySelector('.ldp-open');
      openBtn.href = `${BASE}/t/${topic.id}`;
      openBtn.hidden = false;

      const bmBtn = overlay.querySelector('.ldp-bookmark');
      bmBtn.hidden = false;
      bindBookmark(bmBtn, topic);

      bindActions(modal, ctx);
      tracker.start();

      const loadMore = async () => {
        if (loading || done) return;
        loading = true;
        const tip = document.createElement('div');
        tip.className = 'ldp-loadmore'; tip.textContent = '加载中…';
        body.insertBefore(tip, sentinel);
        try {
          const { posts, done: isDone } = await loader.next();
          posts.forEach((p) => attachPost(p, ctx));
          reflowPending(ctx);
          tip.remove();
          done = isDone;
          if (done) {
            const link = document.createElement('a');
            link.className = 'ldp-link-open';
            link.href = `${BASE}/t/${topic.id}`; link.target = '_blank';
            link.textContent = '已到底 · 在新标签页打开原帖 →';
            body.insertBefore(link, sentinel);
          }
        } catch (e) {
          tip.textContent = '加载失败，滚动重试';
        } finally {
          loading = false;
        }
      };

      // 哨兵触底加载
      const sentinelIO = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) loadMore();
      }, { root: body, rootMargin: '200px' });
      sentinelIO.observe(sentinel);

      await loadMore();
      if (!done && body.scrollHeight <= body.clientHeight) await loadMore();

      // 首屏就绪，淡出加载遮罩
      maskEl.classList.add('hide');
      setTimeout(() => maskEl.remove(), 300);
    } catch (err) {
      if (maskEl) maskEl.remove();
      body.innerHTML = `<div class="ldp-error">加载失败：${esc(err.message)}（可能需要登录或帖子受限）</div>`;
    }
  }

  /* ============ 13. 拦截标题点击（含用户菜单/通知面板）============ */
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a.title, a.raw-topic-link, a[href*="/t/"]');
    if (!a || a.classList.contains('ldp-link-open') || a.classList.contains('ldp-open')) return;
    const inMenu = !!a.closest(MENU_PANEL_SEL);
    const isTitle = a.classList.contains('title') || a.classList.contains('raw-topic-link');
    if (!isTitle && !inMenu) return;
    const m = (a.getAttribute('href') || '').match(/\/t\/(?:[^\/]+\/)?(\d+)/);
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    openModal(m[1], a.textContent.trim());
  }, true);
})();
