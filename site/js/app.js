// 内容总看板
// 数据是本仓库的 GitHub Issues。未登录读取，写入用的 token 只留在 localStorage。
// 关闭的议题视为归档。示例模式（?demo=1）不请求 GitHub，也不写入缓存。

import {
  clearToken,
  createComment,
  createIssue,
  FRESH_MS,
  getToken,
  loadBoard,
  loadCache,
  patchIssue,
  probeToken,
  saveCache,
  setToken,
} from "./api.js";
import { buildDemo } from "./demo.js";
import {
  absoluteTime,
  attentionKind,
  bodyFromSummary,
  byAttention,
  byUpdatedDesc,
  columnFor,
  commentsForIssue,
  extractOutputLinks,
  labelsForStatus,
  laneMeta,
  LANES,
  matchesFilters,
  OWNERS,
  relativeTime,
  renderMarkdown,
  resolveStuckReason,
  STATUSES,
  upsertSection,
} from "./parse.js";

const DEMO = new URLSearchParams(location.search).has("demo");

const state = {
  demo: DEMO,
  issues: [],
  comments: [],
  fetchedAt: null,
  rateRemaining: null,
  rateReset: null,
  truncated: false,
  commentsFailed: false,
  loading: false,
  error: "",
  writable: DEMO || Boolean(getToken()),
  filters: { lane: "all", owner: "all", q: "" },
  mobileStatus: "待做",
  mobileChosen: false,
  openId: null,
  commentDraft: "",
  dragActive: false,
};

const els = {
  board: document.querySelector("#board"),
  summary: document.querySelector("#summary"),
  attention: document.querySelector("#attention"),
  statusSwitch: document.querySelector("#status-switch"),
  sync: document.querySelector("#sync-line"),
  error: document.querySelector("#error-line"),
  result: document.querySelector("#result-count"),
  mode: document.querySelector("#mode-pill"),
  progress: document.querySelector("#progress"),
  refresh: document.querySelector("#refresh"),
  clear: document.querySelector("#clear-filters"),
  search: document.querySelector("#filter-q"),
  owner: document.querySelector("#filter-owner"),
  lanes: document.querySelector("#filter-lanes"),
  demoBanner: document.querySelector("#demo-banner"),
  drawer: document.querySelector("#drawer"),
  drawerContent: document.querySelector("#drawer-content"),
  drawerGithub: document.querySelector("#drawer-github"),
  drawerDemo: document.querySelector("#drawer-demo-note"),
  commentBody: document.querySelector("#comment-body"),
  commentSubmit: document.querySelector("#comment-submit"),
  toast: document.querySelector("#toast"),
};

let refreshTimer = 0;
let toastTimer = 0;
let drag = null;
let suppressClickUntil = 0;

const SKINS = ["editorial", "eastern", "glass"];

function skin() {
  const value = document.documentElement.dataset.skin || "";
  return SKINS.includes(value) ? value : "";
}

function motifChar(label) {
  if (String(label).endsWith("四时日月")) return "日";
  if (String(label).endsWith("隔洋看世界")) return "洋";
  if (String(label).endsWith("大蒜粒机研所")) return "研";
  return "稿";
}

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

function commentsGrouped() {
  const map = new Map();
  for (const comment of state.comments) {
    const list = map.get(comment.issueNumber) || [];
    list.push(comment);
    map.set(comment.issueNumber, list);
  }
  return map;
}

function reasonFor(issue, grouped = commentsGrouped()) {
  return resolveStuckReason(issue.body, grouped.get(issue.number) || []);
}

function visibleIssues() {
  const grouped = commentsGrouped();
  return state.issues.filter((issue) => matchesFilters(issue, state.filters, reasonFor(issue, grouped)));
}

function filtersActive() {
  return state.filters.lane !== "all" || state.filters.owner !== "all" || Boolean(state.filters.q.trim());
}

function persist() {
  if (state.demo) return;
  saveCache({
    issues: state.issues,
    comments: state.comments,
    fetchedAt: state.fetchedAt,
    rateRemaining: state.rateRemaining,
    rateReset: state.rateReset,
    truncated: state.truncated,
  });
}

function applyPayload(payload) {
  state.issues = payload.issues || [];
  state.comments = payload.comments || [];
  state.fetchedAt = payload.fetchedAt || null;
  state.rateRemaining = payload.rateRemaining ?? null;
  state.rateReset = payload.rateReset ?? null;
  state.truncated = Boolean(payload.truncated);
  if (!state.mobileChosen) state.mobileStatus = preferredMobileStatus();
}

function preferredMobileStatus() {
  if (state.issues.some((issue) => attentionKind(issue) === "卡住")) return "卡住";
  if (state.issues.some((issue) => attentionKind(issue) === "待验收")) return "待验收";
  return "待做";
}

function renderChrome() {
  els.demoBanner.hidden = !state.demo;
  els.mode.textContent = state.demo ? "示例" : state.writable ? "可写入" : "只读";
  els.mode.classList.toggle("is-write", state.writable && !state.demo);
  els.refresh.disabled = state.loading;
  els.refresh.setAttribute("aria-busy", state.loading ? "true" : "false");
  els.progress.hidden = !state.loading;
  els.clear.hidden = !filtersActive();
  const visible = visibleIssues();
  els.result.textContent = filtersActive() ? `显示 ${visible.length} / ${state.issues.length}` : `共 ${state.issues.length} 条`;
  const attention = visible.filter((issue) => attentionKind(issue));
  document.title = attention.length ? `(${attention.length}) 内容总看板` : "内容总看板";
  els.error.hidden = !state.error;
  els.error.textContent = state.error || "";
  els.sync.textContent = syncLine();
  paintSkinChrome();
}

function paintSkinChrome() {
  const node = document.querySelector("#mast-date");
  if (node) {
    if (!skin()) node.hidden = true;
    else {
      node.hidden = false;
      const date = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(new Date());
      const name = { editorial: "刊物", eastern: "节气", glass: "琉璃" }[skin()];
      node.textContent = `${date} · 北京时间 · ${name}`;
    }
  }
  const bar = document.querySelector("#skin-switch");
  if (!bar) return;
  const hrefFor = (theme) => {
    const next = new URLSearchParams(location.search);
    if (theme) next.set("theme", theme);
    else next.delete("theme");
    const query = next.toString();
    return query ? `?${query}` : "./";
  };
  const link = (theme, label) => {
    const anchor = h("a", { href: hrefFor(theme) }, label);
    if ((theme || "") === skin()) anchor.setAttribute("aria-current", "page");
    return anchor;
  };
  bar.replaceChildren("设计方向 ", link("", "现行"), " · ", link("editorial", "刊物"), " · ", link("eastern", "节气"), " · ", link("glass", "琉璃"));
}

function syncLine() {
  if (state.demo) return "示例数据 · 未请求 GitHub";
  if (!state.fetchedAt) return state.loading ? "正在读取议题…" : "还没有同步";
  const when = absoluteTime(new Date(state.fetchedAt).toISOString());
  const rate = state.rateRemaining == null ? "" : ` · 未登录额度剩余 ${state.rateRemaining}/60`;
  const mode = state.writable ? " · 可写入" : " · 只读";
  const slow = state.rateRemaining != null && state.rateRemaining < 8 ? " · 额度偏低，自动刷新已放慢" : "";
  const trunc = state.truncated ? " · 只拉了最近的一部分" : "";
  const comments = state.commentsFailed ? " · 评论暂时用的是上次缓存" : "";
  return `上次同步 ${when}${rate}${mode}${slow}${trunc}${comments}`;
}

function renderSummary(visible) {
  els.summary.replaceChildren();
  if (skin()) {
    renderArtSummary();
    return;
  }
  for (const status of STATUSES) {
    const count = visible.filter((issue) => columnFor(issue) === status).length;
    const button = h("button", { type: "button", class: `stat${state.mobileStatus === status ? " is-current" : ""}` }, [
      h("b", {}, String(count)),
      h("span", {}, status),
    ]);
    button.addEventListener("click", () => jumpTo(status));
    els.summary.append(button);
  }
}

function scopedIssues() {
  const grouped = commentsGrouped();
  return state.issues.filter((issue) => matchesFilters(issue, { ...state.filters, lane: "all" }, reasonFor(issue, grouped)));
}

function renderArtSummary() {
  const pool = scopedIssues();
  const row = h("div", { class: "lane-row" });
  for (const lane of LANES) {
    const items = pool.filter((issue) => issue.lanes.includes(lane.label));
    const on = state.filters.lane === lane.label;
    const stats = STATUSES.map((status) => `${status} ${items.filter((issue) => columnFor(issue) === status).length}`).join(" · ");
    const button = h("button", {
      type: "button",
      class: `lane-tile${on ? " is-on" : ""}`,
      "data-lane": lane.label,
      "aria-pressed": on ? "true" : "false",
    }, [
      h("span", { class: "lane-motif", "aria-hidden": "true" }, motifChar(lane.label)),
      h("span", { class: "lane-copy" }, [h("strong", {}, lane.name), h("em", {}, lane.platform)]),
      h("b", { class: "lane-total" }, String(items.length)),
      h("span", { class: "lane-stats" }, stats),
    ]);
    button.addEventListener("click", () => {
      state.filters.lane = on ? "all" : lane.label;
      paintLanes();
      renderLists();
    });
    row.append(button);
  }
  els.summary.append(row);
}

function renderAttention(visible) {
  if (skin()) {
    renderArtAttention(visible);
    return;
  }
  const items = visible.filter((issue) => attentionKind(issue)).sort(byAttention);
  els.attention.className = items.length ? "attention is-hot" : "attention is-clear";
  els.attention.replaceChildren();
  const head = h("div", { class: "attention-head" }, [
    h("h2", {}, "需要你处理"),
    h("span", {}, items.length ? String(items.length) : "现在没有"),
  ]);
  els.attention.append(head);
  if (!items.length) return;
  const list = h("div", { class: "attention-list" });
  for (const issue of items) {
    const kind = attentionKind(issue);
    const label = kind === "Shawn" ? "负责 Shawn" : kind;
    const button = h("button", { type: "button", class: `attention-card kind-${kind}` }, [
      h("span", { class: "kind" }, label),
      h("strong", {}, issue.title),
    ]);
    button.addEventListener("click", () => openDrawer(issue.number));
    list.append(button);
  }
  els.attention.append(list);
}

function renderArtAttention(visible) {
  const items = visible.filter((issue) => attentionKind(issue)).sort(byAttention);
  els.attention.className = items.length ? "attention is-hot" : "attention is-clear";
  els.attention.replaceChildren();
  els.attention.append(
    h("div", { class: "attention-head" }, [
      h("h2", {}, "需要你处理"),
      h("span", {}, items.length ? `${items.length} 条` : "现在没有"),
    ]),
  );
  if (!items.length) {
    els.attention.append(h("p", { class: "attention-empty" }, "没有需要你处理的。待验收、卡住，或负责 Shawn 的稿件会出现在这里。"));
    return;
  }
  const feature = items[0];
  const kind = attentionKind(feature);
  const lead = h("button", { type: "button", class: `attention-feature kind-${kind}` }, [
    h("span", { class: "kind" }, kind === "Shawn" ? "负责 Shawn" : kind),
    h("strong", {}, feature.title),
    h("span", { class: "byline" }, [
      laneMeta(feature.lanes[0])?.name || "未分栏目",
      " · ",
      feature.owners[0] || "未指定",
      " · ",
      relativeTime(feature.updatedAt),
    ]),
  ]);
  lead.addEventListener("click", () => openDrawer(feature.number));
  els.attention.append(lead);
  const rest = items.slice(1);
  if (!rest.length) return;
  const list = h("div", { class: "attention-list" });
  for (const issue of rest) {
    const itemKind = attentionKind(issue);
    const button = h("button", { type: "button", class: `attention-card kind-${itemKind}` }, [
      h("span", { class: "kind" }, itemKind === "Shawn" ? "负责 Shawn" : itemKind),
      h("strong", {}, issue.title),
    ]);
    button.addEventListener("click", () => openDrawer(issue.number));
    list.append(button);
  }
  els.attention.append(list);
}

function renderStatusSwitch(visible) {
  els.statusSwitch.replaceChildren();
  for (const status of STATUSES) {
    const count = visible.filter((issue) => columnFor(issue) === status).length;
    const button = h(
      "button",
      {
        type: "button",
        class: `status-tab${state.mobileStatus === status ? " is-current" : ""}`,
        role: "tab",
        "data-status": status,
        "aria-selected": state.mobileStatus === status ? "true" : "false",
      },
      [status, h("small", {}, String(count))],
    );
    button.addEventListener("click", () => jumpTo(status));
    els.statusSwitch.append(button);
  }
}

function jumpTo(status) {
  state.mobileStatus = status;
  state.mobileChosen = true;
  renderLists();
  document.querySelector(`.column[data-status="${status}"]`)?.scrollIntoView({ inline: "start", block: "nearest" });
}

function renderBoard(visible) {
  const left = els.board.scrollLeft;
  const tops = new Map([...els.board.querySelectorAll(".column")].map((column) => [column.dataset.status, column.scrollTop]));
  els.board.replaceChildren();
  if (state.loading && !state.issues.length) {
    els.board.append(h("p", { class: "empty" }, "正在读取议题…"));
    return;
  }
  if (!state.issues.length) {
    els.board.append(emptyState());
    return;
  }
  for (const status of STATUSES) {
    const items = visible.filter((issue) => columnFor(issue) === status).sort(byUpdatedDesc);
    const column = h("section", {
      class: `column${state.mobileStatus === status ? " is-current" : ""}`,
      "data-status": status,
      "aria-label": status,
    });
    const headKids = [
      h("h2", {}, [h("span", { class: "status-dot", "data-status": status }), status]),
      h("span", { class: "count-badge" }, String(items.length)),
    ];
    if (skin()) headKids.unshift(h("span", { class: "column-mark", "aria-hidden": "true" }, status));
    column.append(h("header", { class: "column-head" }, headKids));
    const list = h("div", { class: "column-list" });
    if (!items.length) list.append(h("p", { class: "column-empty" }, filtersActive() ? "没有匹配的条目" : "空"));
    for (const issue of items) list.append(renderCard(issue));
    column.append(list);
    els.board.append(column);
  }
  els.board.scrollLeft = left;
  for (const column of els.board.querySelectorAll(".column")) {
    column.scrollTop = tops.get(column.dataset.status) || 0;
  }
}

function emptyState() {
  if (skin() && !state.error) {
    const word = { editorial: "空白", eastern: "空", glass: "00" }[skin()];
    return h("div", { class: "empty empty-stage" }, [
      h("p", { class: "empty-kicker" }, word),
      h("h2", {}, "看板上还没有进行中的内容"),
      h("p", {}, "在本仓库新建 Issue，打上栏目、状态、负责标签，刷新后就会出现。关闭的 Issue 会归档。"),
      h("p", {}, [
        h("a", {
          href: "https://github.com/howardrock88/content-board/blob/main/BOT_GUIDE.md",
          target: "_blank",
          rel: "noopener noreferrer",
        }, "机器人怎么写议题"),
      ]),
      h("p", {}, [h("a", { href: "?demo=1" }, "先看示例布局")]),
    ]);
  }
  const wrap = h("div", { class: "empty" });
  if (state.error) {
    wrap.append(h("p", {}, state.error));
    return wrap;
  }
  wrap.append(
    h("p", {}, "看板上还没有进行中的内容。"),
    h("p", {}, "在本仓库新建 Issue，打上栏目、状态、负责标签，刷新后就会出现。关闭的 Issue 会归档。"),
    h("p", {}, [
      h(
        "a",
        {
          href: "https://github.com/howardrock88/content-board/blob/main/BOT_GUIDE.md",
          target: "_blank",
          rel: "noopener noreferrer",
        },
        "机器人怎么写议题",
      ),
    ]),
    h("p", {}, [h("a", { href: "?demo=1" }, "先看示例布局")]),
  );
  return wrap;
}

function renderCard(issue) {
  if (skin()) return renderArtCard(issue);
  const column = columnFor(issue);
  const reason = column === "卡住" ? reasonFor(issue) : "";
  const card = h("article", {
    class: `card${column === "卡住" ? " is-stuck" : ""}`,
    "data-id": issue.number,
    tabindex: "0",
  });
  const tags = h("div", { class: "tags" });
  if (state.writable) {
    tags.append(h("button", { type: "button", class: "drag-handle", "data-drag": "1", "aria-label": "拖拽以更改状态", title: "拖拽以更改状态" }, "拖"));
  }
  if (!issue.lanes.length) tags.append(h("span", { class: "tag tag-missing" }, "未分栏目"));
  for (const label of issue.lanes) {
    const meta = laneMeta(label);
    tags.append(h("span", { class: "tag", "data-lane": label, title: meta ? meta.platform : label }, meta ? meta.name : label));
  }
  if (issue.missingStatus) tags.append(h("span", { class: "flag" }, "未标状态"));
  if (issue.duplicateStatus) tags.append(h("span", { class: "flag" }, "状态重复"));
  card.append(
    h("div", { class: "card-top" }, [
      tags,
      h("time", { datetime: issue.updatedAt, title: absoluteTime(issue.updatedAt) }, relativeTime(issue.updatedAt)),
    ]),
    h("h3", { class: "card-title" }, issue.title),
  );
  if (column === "卡住") card.append(h("p", { class: "stuck-reason", title: reason }, reason ? `原因：${reason}` : "原因：未填写"));
  const owners = issue.owners.length ? issue.owners : ["未指定"];
  const meta = h("div", { class: "card-meta" });
  meta.append(h("span", {}, `#${issue.number}`));
  const people = h("span", {});
  owners.forEach((name, index) => {
    if (index) people.append("、");
    people.append(h("span", { class: name === "Shawn" ? "owner is-shawn" : "owner" }, name));
  });
  meta.append(people);
  card.append(meta);
  return card;
}

function renderArtCard(issue) {
  const column = columnFor(issue);
  const reason = column === "卡住" ? reasonFor(issue) : "";
  const lane = issue.lanes[0] || "";
  const meta = laneMeta(lane);
  const card = h("article", {
    class: `card story${column === "卡住" ? " is-stuck" : ""}`,
    "data-id": issue.number,
    "data-lane": lane || null,
    "data-status": column,
    tabindex: "0",
  });
  const kicker = h("div", { class: "story-kicker" }, [
    h("span", { class: "story-no" }, String(issue.number).padStart(3, "0")),
    h("span", { class: "story-channel" }, meta ? meta.name : "未分栏目"),
    h("span", { class: "story-seal", "data-status": column }, column),
  ]);
  if (state.writable) {
    kicker.append(h("button", { type: "button", class: "drag-handle", "data-drag": "1", "aria-label": "拖拽以更改状态", title: "拖拽以更改状态" }, "拖"));
  }
  if (issue.missingStatus) kicker.append(h("span", { class: "flag" }, "未标状态"));
  if (issue.duplicateStatus) kicker.append(h("span", { class: "flag" }, "状态重复"));
  card.append(
    h("span", { class: "story-motif", "aria-hidden": "true" }, motifChar(lane)),
    kicker,
    h("h3", { class: "card-title" }, issue.title),
  );
  if (column === "卡住") card.append(h("p", { class: "stuck-reason" }, reason || "未写原因"));
  const owners = issue.owners.length ? issue.owners.join("、") : "未指定";
  card.append(h("div", { class: "card-meta" }, [
    h("span", { class: "story-owner" }, owners),
    h("time", { datetime: issue.updatedAt, title: absoluteTime(issue.updatedAt) }, relativeTime(issue.updatedAt)),
  ]));
  return card;
}

function renderLists() {
  if (state.dragActive) return;
  const visible = visibleIssues();
  renderSummary(visible);
  renderAttention(visible);
  renderStatusSwitch(visible);
  renderBoard(visible);
  renderChrome();
  if (state.openId && els.drawer.open) fillDrawer(state.openId);
}

function openDrawer(number) {
  if (state.openId !== number) state.commentDraft = "";
  state.openId = number;
  fillDrawer(number);
  if (!els.drawer.open) els.drawer.showModal();
}

function fillDrawer(number) {
  const issue = state.issues.find((item) => item.number === number);
  if (!issue) return;
  const column = columnFor(issue);
  const reason = reasonFor(issue);
  const links = extractOutputLinks(issue.body);
  const content = els.drawerContent;
  content.replaceChildren();
  const tags = h("div", { class: "tags" });
  for (const label of issue.lanes) {
    const meta = laneMeta(label);
    tags.append(h("span", { class: "tag", "data-lane": label }, meta ? meta.name : label));
  }
  content.append(
    h("p", { class: "drawer-kicker" }, `#${issue.number} · ${absoluteTime(issue.updatedAt)}`),
    h("h2", {}, issue.title),
    tags,
  );
  if (column === "卡住") {
    content.append(h("p", { class: "reason-callout" }, reason ? `卡住：${reason}` : "卡住：还没有写原因"));
  }
  content.append(h("h3", { class: "section-label" }, "移动到"));
  const moves = h("div", { class: "move-row" });
  for (const status of STATUSES) {
    const current = column === status && !issue.missingStatus && !issue.duplicateStatus;
    const button = h("button", { type: "button", class: current ? "is-current" : "" }, status);
    button.disabled = !state.writable || current;
    button.addEventListener("click", () => commitStatus(issue.number, status));
    moves.append(button);
  }
  content.append(moves);
  if (!state.writable) content.append(h("p", { class: "hint" }, "只读。设置里粘贴 Token 后可以改状态。"));
  if (links.length) {
    content.append(h("h3", { class: "section-label" }, "产出链接"));
    const list = h("div", { class: "output-links" });
    for (const link of links) {
      list.append(h("a", { href: link.href, target: "_blank", rel: "noopener noreferrer" }, link.label));
    }
    content.append(list);
  }
  const bodyView = h("div", { class: "markdown" });
  bodyView.innerHTML = renderMarkdown(issue.body || "（这条议题还没有正文。）");
  content.append(h("h3", { class: "section-label" }, "正文"), bodyView);
  content.append(h("h3", { class: "section-label" }, "进度"));
  const timeline = commentsForIssue(state.comments, issue.number);
  if (!timeline.length) content.append(h("p", { class: "hint" }, "还没有进度评论。"));
  else {
    const list = h("ol", { class: "timeline" });
    for (const comment of timeline) {
      const item = h("li");
      item.append(h("p", { class: "who" }, `${comment.user} · ${relativeTime(comment.createdAt)} · ${absoluteTime(comment.createdAt)}`));
      const body = h("div", { class: "markdown" });
      body.innerHTML = renderMarkdown(comment.body || "");
      item.append(body);
      list.append(item);
    }
    content.append(list);
  }
  els.drawerGithub.hidden = state.demo;
  els.drawerDemo.hidden = !state.demo;
  if (!state.demo) {
    els.drawerGithub.href = issue.htmlUrl || `https://github.com/howardrock88/content-board/issues/${issue.number}`;
  }
  const box = els.commentBody;
  box.disabled = !state.writable;
  els.commentSubmit.disabled = !state.writable;
  box.placeholder = state.demo
    ? "示例评论，只留在这个页面"
    : state.writable
      ? "写这次做了什么、下一步是什么"
      : "只读。在设置里粘贴 Token 后可以写评论。";
  if (document.activeElement !== box) box.value = state.commentDraft;
}

function replaceIssue(issue) {
  const index = state.issues.findIndex((item) => item.number === issue.number);
  if (index === -1) state.issues.unshift(issue);
  else state.issues[index] = issue;
}

async function commitStatus(number, status) {
  const current = state.issues.find((item) => item.number === number);
  if (!current || !state.writable) return;
  const same = columnFor(current) === status && !current.missingStatus && !current.duplicateStatus;
  if (same) return;
  let reason = "";
  if (status === "卡住") {
    reason = await ask({
      title: "标成卡住",
      text: "写一句原因。会写进正文的「卡住原因」，并发表一条评论。",
      placeholder: "缺什么、卡在谁、下一步要谁做",
      required: true,
    });
    if (!reason) return;
  } else if (status === "已发布") {
    const ok = await ask({
      title: "标成已发布",
      text: "已发布只由 Shawn 确认。确定把这条内容标成已发布？",
      confirm: true,
      okLabel: "标成已发布",
    });
    if (!ok) return;
  }
  const issue = state.issues.find((item) => item.number === number);
  if (!issue) return;
  const previous = structuredClone(issue);
  const labels = labelsForStatus(issue.labels, status);
  const body = reason ? upsertSection(issue.body, "卡住原因", reason) : issue.body;
  const optimistic = {
    ...issue,
    labels,
    statuses: [status],
    missingStatus: false,
    duplicateStatus: false,
    body,
    updatedAt: new Date().toISOString(),
  };
  replaceIssue(optimistic);
  if (reason) state.comments.push(localComment(number, `卡住原因：${reason}`));
  renderLists();
  try {
    if (!state.demo) {
      const token = getToken();
      const payload = { labels };
      if (reason) payload.body = body;
      const updated = await patchIssue(number, payload, token);
      replaceIssue(updated);
      if (reason) {
        try {
          const comment = await createComment(number, `卡住原因：${reason}`, token);
          state.comments = state.comments.filter((item) => item.issueNumber !== number || item.user !== "本机");
          state.comments.push(comment);
        } catch {
          toast("状态已改，评论没有发出去。");
        }
      }
      persist();
    }
    renderLists();
  } catch (error) {
    replaceIssue(previous);
    if (reason) state.comments = state.comments.filter((item) => !(item.issueNumber === number && item.user === "本机"));
    renderLists();
    toast(error.message || "没能改状态");
  }
}

function localComment(number, body) {
  const now = new Date().toISOString();
  return { id: `local-${number}-${Date.now()}`, issueNumber: number, body, createdAt: now, updatedAt: now, user: state.demo ? "Shawn" : "本机" };
}

async function submitComment(event) {
  event.preventDefault();
  const body = els.commentBody.value.trim();
  const number = state.openId;
  if (!body || !number || !state.writable) return;
  try {
    const comment = state.demo ? { ...localComment(number, body), user: "Shawn" } : await createComment(number, body, getToken());
    state.comments.push(comment);
    const issue = state.issues.find((item) => item.number === number);
    if (issue) issue.updatedAt = comment.createdAt;
    state.commentDraft = "";
    els.commentBody.value = "";
    if (!state.demo) persist();
    renderLists();
    toast(state.demo ? "示例评论已留在这个页面" : "评论已发布");
  } catch (error) {
    toast(error.message || "评论没发出去");
  }
}

async function submitNew(event) {
  event.preventDefault();
  if (!state.writable) {
    openSettings("新建内容需要写入 Token。");
    return;
  }
  const title = document.querySelector("#new-title").value.trim();
  const lane = document.querySelector("#new-lane").value;
  const owner = document.querySelector("#new-owner").value;
  const summary = document.querySelector("#new-summary").value;
  if (!title) return;
  if (!LANES.some((item) => item.label === lane) || !OWNERS.includes(owner)) return;
  const labels = ["状态/待做", lane, `负责/${owner}`];
  const body = bodyFromSummary(summary);
  try {
    els.progress.hidden = false;
    const created = state.demo
      ? localIssue({ title, body, labels, number: nextDemoNumber() })
      : await createIssue({ title, body, labels }, getToken());
    state.issues.unshift(created);
    if (!state.demo) persist();
    document.querySelector("#composer").close();
    event.target.reset();
    renderLists();
    openDrawer(created.number);
    toast(state.demo ? "已在示例里新建" : `已创建 #${created.number}`);
  } catch (error) {
    toast(error.message || "没能创建");
  } finally {
    els.progress.hidden = !state.loading;
  }
}

function nextDemoNumber() {
  return state.issues.reduce((max, issue) => Math.max(max, issue.number), 200) + 1;
}

function localIssue({ title, body, labels, number }) {
  const now = new Date().toISOString();
  return {
    number,
    title,
    body,
    htmlUrl: "https://github.com/howardrock88/content-board/issues",
    updatedAt: now,
    createdAt: now,
    labels,
    statuses: ["待做"],
    lanes: labels.filter((name) => name.startsWith("栏目/")),
    owners: labels.filter((name) => name.startsWith("负责/")).map((name) => name.slice("负责/".length)),
    missingStatus: false,
    duplicateStatus: false,
  };
}

function ask({ title, text, placeholder = "", required = false, confirm = false, okLabel = "确定", value = "" }) {
  const dialog = document.querySelector("#prompt");
  const input = document.querySelector("#prompt-input");
  const hint = document.querySelector("#prompt-hint");
  const form = document.querySelector("#prompt-form");
  const ok = document.querySelector("#prompt-ok");
  const cancel = document.querySelector("#prompt-cancel");
  document.querySelector("#prompt-title").textContent = title;
  document.querySelector("#prompt-text").textContent = text || "";
  hint.textContent = "";
  input.hidden = confirm;
  input.required = required;
  input.value = value;
  input.placeholder = placeholder;
  ok.textContent = okLabel;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      if (!confirm && required && !input.value.trim()) {
        hint.textContent = "请填写原因";
        input.focus();
        return;
      }
      finish(confirm ? true : input.value.trim());
    };
    const onCancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    form.addEventListener("submit", onSubmit);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener(
      "close",
      () => {
        form.removeEventListener("submit", onSubmit);
        cancel.removeEventListener("click", onCancel);
        dialog.removeEventListener("cancel", onCancel);
        if (!settled) resolve(null);
      },
      { once: true },
    );
    dialog.showModal();
    if (confirm) ok.focus();
    else input.focus();
  });
}

function openSettings(message) {
  const dialog = document.querySelector("#settings");
  document.querySelector("#token-input").value = "";
  document.querySelector("#settings-message").textContent =
    message || (state.demo ? "当前是示例数据，保存的 Token 不会在这个页面里使用。" : state.writable ? "这台浏览器已经保存了 Token。" : "还没有 Token，看板是只读的。");
  if (!dialog.open) dialog.showModal();
}

async function saveToken(event) {
  event.preventDefault();
  const input = document.querySelector("#token-input");
  const message = document.querySelector("#settings-message");
  const token = input.value.trim();
  if (token.length < 20) {
    message.textContent = "Token 太短。请粘贴 fine-grained personal access token。";
    return;
  }
  message.textContent = "正在检查…";
  const result = await probeToken(token);
  message.textContent = result.message;
  if (!result.ok) return;
  setToken(token);
  input.value = "";
  state.writable = true;
  renderLists();
}

function setupFilters() {
  const all = h("button", { type: "button", class: "chip is-on", "data-lane": "all" }, "全部");
  all.addEventListener("click", () => {
    state.filters.lane = "all";
    paintLanes();
    renderLists();
  });
  els.lanes.append(all);
  for (const lane of LANES) {
    const button = h("button", { type: "button", class: "chip", "data-lane": lane.label }, [
      h("span", { class: "dot", style: `background:${dotColor(lane.label)}` }),
      lane.name,
    ]);
    button.addEventListener("click", () => {
      state.filters.lane = lane.label;
      paintLanes();
      renderLists();
    });
    els.lanes.append(button);
  }
  els.owner.append(h("option", { value: "all" }, "全部"));
  for (const owner of OWNERS) els.owner.append(h("option", { value: owner }, owner));
  fillSelect(document.querySelector("#new-lane"), LANES.map((lane) => [lane.label, lane.name]), "选择栏目");
  fillSelect(document.querySelector("#new-owner"), OWNERS.map((owner) => [owner, owner]), "选择负责");
  paintLanes();
}

function dotColor(label) {
  if (label.endsWith("四时日月")) return "#9a3412";
  if (label.endsWith("隔洋看世界")) return "#1d4ed8";
  return "#6d28d9";
}

function paintLanes() {
  for (const button of els.lanes.querySelectorAll(".chip")) {
    button.classList.toggle("is-on", (button.dataset.lane || "all") === state.filters.lane);
    button.setAttribute("aria-pressed", button.classList.contains("is-on") ? "true" : "false");
  }
}

function fillSelect(select, pairs, placeholder) {
  select.replaceChildren();
  if (placeholder) {
    const option = h("option", { value: "" }, placeholder);
    option.disabled = true;
    option.selected = true;
    select.append(option);
  }
  for (const [value, label] of pairs) select.append(h("option", { value }, label));
}

function schedule() {
  clearTimeout(refreshTimer);
  if (state.demo) return;
  const age = state.fetchedAt ? Date.now() - state.fetchedAt : FRESH_MS;
  let delay = Math.max(5_000, FRESH_MS - age);
  if (state.rateRemaining != null && state.rateRemaining < 8 && state.rateReset) {
    delay = Math.max(delay, state.rateReset * 1000 - Date.now() + 1500);
  }
  refreshTimer = setTimeout(() => refresh({ manual: false }), delay);
}

async function refresh({ manual }) {
  if (state.demo) {
    if (manual) toast("示例数据不请求 GitHub");
    return;
  }
  if (state.loading) return;
  if (!manual && state.fetchedAt && Date.now() - state.fetchedAt < FRESH_MS - 2000) {
    schedule();
    return;
  }
  state.loading = true;
  renderLists();
  const previousComments = state.comments;
  try {
    const result = await loadBoard({ token: getToken() });
    const comments = result.commentsFailed ? previousComments : result.comments;
    applyPayload({ ...result, comments });
    state.commentsFailed = result.commentsFailed;
    state.error = "";
    state.loading = false;
    renderLists();
    if (manual) toast("已刷新");
    else if (result.commentsFailed) toast("议题已更新，评论没能拉下来。");
  } catch (error) {
    state.loading = false;
    state.error = error.message || "刷新失败";
    renderLists();
    toast(state.error);
  } finally {
    state.loading = false;
    schedule();
  }
}

function onPointerDown(event) {
  if (!state.writable || event.button !== 0) return;
  const handle = event.target.closest("[data-drag]");
  if (!handle) return;
  const card = handle.closest("[data-id]");
  if (!card) return;
  event.preventDefault();
  drag = {
    id: Number(card.dataset.id),
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    hover: "",
  };
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.active) {
    if (distance < 8) return;
    drag.active = true;
    state.dragActive = true;
    document.body.classList.add("is-dragging");
    document.querySelector(`[data-id="${drag.id}"]`)?.classList.add("is-source");
    const issue = state.issues.find((item) => item.number === drag.id);
    const floater = ensureFloater();
    floater.textContent = issue ? issue.title : "移动";
    floater.hidden = false;
  }
  const floater = ensureFloater();
  floater.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 12}px)`;
  const status = statusAt(event.clientX, event.clientY);
  drag.hover = status;
  document.querySelectorAll("[data-status]").forEach((node) => node.classList.toggle("is-drop", Boolean(status) && node.dataset.status === status));
  const board = els.board;
  const rect = board.getBoundingClientRect();
  if (event.clientX < rect.left + 48) board.scrollLeft -= 18;
  else if (event.clientX > rect.right - 48) board.scrollLeft += 18;
}

function onPointerUp(event) {
  if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("pointerup", onPointerUp);
  document.removeEventListener("pointercancel", onPointerUp);
  const { id, active, hover } = drag;
  drag = null;
  state.dragActive = false;
  if (active) suppressClickUntil = Date.now() + 400;
  document.body.classList.remove("is-dragging");
  document.querySelector("#drag-floater")?.setAttribute("hidden", "");
  document.querySelectorAll(".is-drop").forEach((node) => node.classList.remove("is-drop"));
  document.querySelectorAll(".is-source").forEach((node) => node.classList.remove("is-source"));
  const issue = state.issues.find((item) => item.number === id);
  if (active && hover && issue && (columnFor(issue) !== hover || issue.missingStatus || issue.duplicateStatus)) {
    commitStatus(id, hover);
    return;
  }
  renderLists();
}

function statusAt(x, y) {
  const node = document.elementFromPoint(x, y);
  const target = node?.closest("[data-status]");
  if (!target || target.closest("[data-id]")) {
    const column = node?.closest(".column");
    return column?.dataset.status || target?.dataset.status || "";
  }
  return target.dataset.status || "";
}

function ensureFloater() {
  let floater = document.querySelector("#drag-floater");
  if (!floater) {
    floater = h("div", { id: "drag-floater", hidden: "" });
    document.body.append(floater);
  }
  return floater;
}

function bootFilters() {
  setupFilters();
  els.search.addEventListener("input", () => {
    state.filters.q = els.search.value;
    renderLists();
  });
  els.owner.addEventListener("change", () => {
    state.filters.owner = els.owner.value;
    renderLists();
  });
  els.clear.addEventListener("click", () => {
    state.filters = { lane: "all", owner: "all", q: "" };
    els.search.value = "";
    els.owner.value = "all";
    paintLanes();
    renderLists();
  });
}

function bootDialogs() {
  document.querySelector("#settings-open").addEventListener("click", () => openSettings());
  document.querySelector("#create").addEventListener("click", () => {
    if (!state.writable) {
      openSettings("新建内容需要写入 Token。");
      return;
    }
    document.querySelector("#composer").showModal();
  });
  document.querySelector("#settings-form").addEventListener("submit", saveToken);
  document.querySelector("#token-clear").addEventListener("click", () => {
    clearToken();
    state.writable = state.demo;
    document.querySelector("#token-input").value = "";
    document.querySelector("#settings-message").textContent = "已从这台浏览器清除。";
    renderLists();
  });
  document.querySelector("#composer-form").addEventListener("submit", submitNew);
  document.querySelector("#comment-form").addEventListener("submit", submitComment);
  els.commentBody.addEventListener("input", () => {
    state.commentDraft = els.commentBody.value;
  });
  document.querySelector("#drawer-close").addEventListener("click", () => els.drawer.close());
  els.drawer.addEventListener("click", (event) => {
    const rect = els.drawer.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) els.drawer.close();
  });
  els.drawer.addEventListener("close", () => {
    const id = state.openId;
    state.openId = null;
    document.querySelector(`[data-id="${id}"]`)?.focus();
  });
  for (const button of document.querySelectorAll("[data-close]")) {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  }
}

function bootKeys() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) return;
    event.preventDefault();
    els.search.focus();
  });
  els.board.addEventListener("click", (event) => {
    if (Date.now() < suppressClickUntil) return;
    if (event.target.closest("[data-drag]")) return;
    const card = event.target.closest("[data-id]");
    if (!card) return;
    openDrawer(Number(card.dataset.id));
  });
  els.board.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-id]");
    if (!card || event.target !== card) return;
    event.preventDefault();
    openDrawer(Number(card.dataset.id));
  });
  els.board.addEventListener("pointerdown", onPointerDown, { passive: false });
}

function boot() {
  bootFilters();
  bootDialogs();
  bootKeys();
  els.refresh.addEventListener("click", () => refresh({ manual: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || state.demo) return;
    if (!state.fetchedAt || Date.now() - state.fetchedAt >= FRESH_MS) refresh({ manual: false });
  });
  if (state.demo) {
    const demo = buildDemo();
    applyPayload({ ...demo, fetchedAt: Date.now() });
    renderLists();
    return;
  }
  const cache = loadCache();
  if (cache) applyPayload(cache);
  renderLists();
  const fresh = cache && Date.now() - cache.fetchedAt < FRESH_MS;
  if (fresh) schedule();
  else refresh({ manual: false });
}

boot();
