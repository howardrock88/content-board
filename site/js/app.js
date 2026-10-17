// 内容：一块扁平的卡片桌面。
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
import { icon } from "./icons.js";
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
  shanghaiDayKey,
  STATUSES,
  upsertSection,
} from "./parse.js";

const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has("demo");
const PIPELINE = ["待做", "进行中", "待验收", "已发布"];
const THEME_KEY = "content-board:theme";

const state = {
  demo: DEMO,
  view: PARAMS.get("view") === "board" || PARAMS.get("view") === "line" ? "line" : "today",
  mobileLane: LANES[0].label,
  mobileLaneChosen: false,
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
  today: document.querySelector("#today"),
  stats: document.querySelector("#stats"),
  wait: document.querySelector("#wait"),
  stuck: document.querySelector("#stuck-list"),
  feed: document.querySelector("#feed"),
  channels: document.querySelector("#channels"),
  lineSwitch: document.querySelector("#line-switch"),
  date: document.querySelector("#mast-date"),
  filterNote: document.querySelector("#filter-note"),
  sync: document.querySelector("#sync-line"),
  error: document.querySelector("#error-line"),
  mode: document.querySelector("#mode-pill"),
  progress: document.querySelector("#progress"),
  refresh: document.querySelector("#refresh"),
  demoBanner: document.querySelector("#demo-banner"),
  drawer: document.querySelector("#drawer"),
  drawerContent: document.querySelector("#drawer-content"),
  drawerGithub: document.querySelector("#drawer-github"),
  drawerDemo: document.querySelector("#drawer-demo-note"),
  commentBody: document.querySelector("#comment-body"),
  commentSubmit: document.querySelector("#comment-submit"),
  toast: document.querySelector("#toast"),
  palette: document.querySelector("#palette"),
  paletteQ: document.querySelector("#palette-q"),
  paletteList: document.querySelector("#palette-list"),
  viewToday: document.querySelector("#view-today"),
  viewBoard: document.querySelector("#view-board"),
  theme: document.querySelector("#theme-toggle"),
};

let refreshTimer = 0;
let toastTimer = 0;
let drag = null;
let suppressClickUntil = 0;
let paletteItems = [];
let paletteIndex = 0;

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

function needsShawn(issue) {
  return Boolean(attentionKind(issue)) && columnFor(issue) !== "已发布";
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

function shanghaiParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  return bag;
}

function cnNumber(value) {
  const digits = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const n = Number(value);
  if (n <= 10) return n === 10 ? "十" : digits[n];
  if (n < 20) return `十${digits[n % 10]}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? "十" : digits[tens] + "十"}${ones ? digits[ones] : ""}`;
}

function dateLine(date = new Date()) {
  const parts = shanghaiParts(date);
  const week = { Sun: "星期日", Mon: "星期一", Tue: "星期二", Wed: "星期三", Thu: "星期四", Fri: "星期五", Sat: "星期六" };
  return `${cnNumber(parts.month)}月${cnNumber(parts.day)}日 · ${week[parts.weekday] || ""} · 北京`;
}

function weekStartKey(date = new Date()) {
  const [year, month, day] = shanghaiDayKey(date).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = utc.getUTCDay();
  const delta = weekday === 0 ? 6 : weekday - 1;
  utc.setUTCDate(utc.getUTCDate() - delta);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function publishedThisWeek(issue, start = weekStartKey()) {
  if (columnFor(issue) !== "已发布") return false;
  const key = shanghaiDayKey(new Date(issue.updatedAt));
  return key >= start;
}

function excerpt(text, limit = 72) {
  const line = String(text || "")
    .split("\n")
    .map((row) => row.replace(/^[-*]\s+/, "").replace(/^卡住原因\s*[:：]\s*/, "").trim())
    .find((row) => row && !/^[（(]/.test(row) && !/^(无|暂无|待填写|未填写|留空)/.test(row));
  if (!line) return "";
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

function setView(view) {
  state.view = view === "line" || view === "board" ? "line" : "today";
  document.documentElement.dataset.view = state.view;
  const url = new URL(location.href);
  if (state.view === "line") url.searchParams.set("view", "line");
  else url.searchParams.delete("view");
  history.replaceState(null, "", url);
  renderLists();
}

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#0E1014" : "#F5F6F8";
  if (els.theme) els.theme.setAttribute("aria-label", theme === "dark" ? "切换到浅色" : "切换到深色");
}

function renderChrome(visible) {
  els.demoBanner.hidden = !state.demo;
  els.mode.textContent = state.demo ? "示例" : state.writable ? "可写入" : "只读";
  els.mode.classList.toggle("is-write", state.writable && !state.demo);
  els.refresh.disabled = state.loading;
  els.refresh.setAttribute("aria-busy", state.loading ? "true" : "false");
  els.progress.hidden = !state.loading;
  const attention = visible.filter(needsShawn);
  document.title = attention.length ? `(${attention.length}) 内容总看板` : "内容总看板";
  const showError = Boolean(state.error) && state.issues.length > 0;
  els.error.hidden = !showError;
  els.error.textContent = showError ? state.error : "";
  els.sync.textContent = syncLine();
  els.viewToday.setAttribute("aria-pressed", state.view === "today" ? "true" : "false");
  els.viewBoard.setAttribute("aria-pressed", state.view === "line" ? "true" : "false");
  renderFilterNote();
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

function renderFilterNote() {
  if (!filtersActive()) {
    els.filterNote.hidden = true;
    els.filterNote.replaceChildren();
    return;
  }
  const bits = [];
  if (state.filters.lane !== "all") {
    const lane = LANES.find((item) => item.label === state.filters.lane);
    bits.push(lane ? lane.name : state.filters.lane);
  }
  if (state.filters.owner !== "all") bits.push(state.filters.owner);
  if (state.filters.q.trim()) bits.push(`「${state.filters.q.trim()}」`);
  const clear = h("button", { type: "button" }, "清除");
  clear.addEventListener("click", () => clearFilters());
  els.filterNote.replaceChildren(`只看 ${bits.join(" · ")} · `, clear);
  els.filterNote.hidden = false;
}

function activeLane() {
  if (state.mobileLaneChosen) return state.mobileLane;
  if (state.filters.lane !== "all") return state.filters.lane;
  return LANES[0].label;
}

const LANE_TONE = {
  "栏目/四时日月": "1",
  "栏目/隔洋看世界": "2",
  "栏目/大蒜粒机研所": "3",
};
const LANE_ICON = { 1: "leaf", 2: "globe", 3: "cpu" };
const STATUS_TONE = {
  待做: "todo",
  进行中: "moving",
  待验收: "review",
  已发布: "shipped",
  卡住: "stuck",
};

function badge(name, tone) {
  const cls = String(tone).startsWith("lane-") ? `badge ${tone}` : `badge tone-${tone}`;
  return h("span", { class: cls }, [icon(name)]);
}

function progressBar(issues, pending) {
  const counts = PIPELINE.map((status) => ({
    status,
    n: pending ? 0 : issues.filter((issue) => columnFor(issue) === status).length,
  }));
  const total = counts.reduce((sum, item) => sum + item.n, 0);
  const bar = h("div", {
    class: "bar",
    role: "img",
    "aria-label": counts.map((item) => `${item.status} ${pending ? "—" : item.n}`).join("，"),
  });
  if (!total) bar.append(h("i", { class: "seg tone-todo", style: "flex:1" }));
  else {
    for (const item of counts) {
      if (!item.n) continue;
      bar.append(h("i", { class: `seg tone-${STATUS_TONE[item.status]}`, style: `flex:${item.n}` }));
    }
  }
  return bar;
}

function initial(name) {
  const text = String(name || "").trim();
  if (!text || text === "未指定") return "?";
  return /^[A-Za-z]/.test(text) ? text.slice(0, 1).toUpperCase() : text.slice(0, 1);
}

function avatar(name, lane) {
  const tone = LANE_TONE[lane] ? `lane-${LANE_TONE[lane]}` : "tone-todo";
  return h("span", { class: `avatar ${tone}`, title: name || "未指定" }, initial(name));
}

function statusChip(status) {
  return h("span", { class: `chip tone-${STATUS_TONE[status] || "todo"}` }, status);
}

function laneChip(lane) {
  const meta = lane ? laneMeta(lane) : null;
  const tone = LANE_TONE[lane] ? `lane-${LANE_TONE[lane]}` : "tone-todo";
  return h("span", { class: `chip ${tone}` }, meta ? meta.name : "未分栏目");
}

function statTile(value, label, tone, iconName) {
  return h("article", { class: `stat tone-${tone}` }, [
    badge(iconName, tone),
    h("div", { class: "stat-copy" }, [h("b", {}, value), h("span", {}, label)]),
  ]);
}

function openFromRow(event, number) {
  if (event.target.closest(".row-actions") || event.target.closest("a")) return;
  openDrawer(number);
}

function bindRow(row, number) {
  row.tabIndex = 0;
  row.addEventListener("click", (event) => openFromRow(event, number));
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest(".row-actions") || event.target.closest("a")) return;
    event.preventDefault();
    openDrawer(number);
  });
}

function brief(issue) {
  const text = String(issue.body || "").replace(/\r\n/g, "\n");
  const match = text.match(/^#{1,3}[ \t]*说明[ \t]*$/m);
  if (!match) return "";
  const rest = text.slice(match.index + match[0].length);
  const next = rest.search(/\n#{1,3}[ \t]+\S/);
  const raw = (next === -1 ? rest : rest.slice(0, next)).trim();
  const line = raw.split("\n").map((row) => row.replace(/^[-*]\s+/, "").trim()).find(Boolean) || "";
  if (!line || /^[（(]/.test(line)) return "";
  return line.length > 64 ? `${line.slice(0, 64)}…` : line;
}

function ownerName(issue) {
  return issue.owners.length ? issue.owners.join("、") : "未指定";
}

function issueFacts(issue) {
  return h("span", { class: "chips" }, [
    laneChip(issue.lanes[0]),
    statusChip(columnFor(issue)),
    h("span", { class: "when" }, relativeTime(issue.updatedAt)),
  ]);
}

function actionButtons(issue) {
  const actions = h("div", { class: "row-actions" });
  const open = h("button", { type: "button" }, "打开");
  open.addEventListener("click", (event) => {
    event.stopPropagation();
    openDrawer(issue.number);
  });
  actions.append(open);
  if (state.writable) {
    const pass = h("button", { type: "button", class: "pass" }, "通过");
    pass.addEventListener("click", (event) => {
      event.stopPropagation();
      commitStatus(issue.number, "已发布");
    });
    actions.append(pass);
  }
  return actions;
}

function renderHome(visible) {
  const failed = !state.loading && Boolean(state.error) && !state.issues.length;
  const loading = state.loading && !state.issues.length;
  const knownEmpty = !state.loading && !state.error && !state.issues.length;
  els.date.textContent = dateLine();
  const mark = failed || loading ? "—" : null;
  const review = visible.filter((issue) => columnFor(issue) === "待验收");
  const stuck = visible.filter((issue) => columnFor(issue) === "卡住");
  const moving = visible.filter((issue) => columnFor(issue) === "进行中");
  const shipped = visible.filter((issue) => publishedThisWeek(issue));
  els.stats.replaceChildren(
    statTile(mark || String(review.length), "等你拍板", "review", "check"),
    statTile(mark || String(stuck.length), "卡住", "stuck", "alert"),
    statTile(mark || String(moving.length), "进行中", "moving", "clock"),
    statTile(mark || String(shipped.length), "本周已发布", "shipped", "send"),
  );
  renderWait(review, { failed, loading, knownEmpty });
  renderStuck(stuck, { failed, loading });
  renderFeed(visible, { failed, loading });
  renderChannels(visible, { failed, loading });
}

function renderWait(items, { failed, loading, knownEmpty }) {
  const sorted = [...items].sort(byUpdatedDesc);
  els.wait.replaceChildren(tileHead("等你拍板", failed || loading ? "" : String(sorted.length), "review", "check"));
  const body = h("div", { class: "tile-body" });
  if (loading) {
    body.append(h("p", { class: "quiet" }, "正在读取议题…"));
  } else if (failed) {
    body.append(h("p", { class: "quiet" }, state.error || "网络不通，暂时无法联系 GitHub。"));
  } else if (!sorted.length) {
    body.append(h("p", { class: "quiet" }, knownEmpty || !filtersActive() ? "没有要拍板的。" : "这个筛选下没有要拍板的。"));
    if (knownEmpty) {
      body.append(h("p", { class: "quiet" }, [
        h("a", { href: "?demo=1" }, "先看示例"),
        " · ",
        h("a", { href: "https://github.com/howardrock88/content-board/blob/main/BOT_GUIDE.md", target: "_blank", rel: "noopener noreferrer" }, "机器人怎么写议题"),
      ]));
    }
  } else {
    for (const issue of sorted) {
      const row = h("div", { class: "row", "data-id": issue.number }, [
        avatar(ownerName(issue), issue.lanes[0]),
        h("div", { class: "row-copy" }, [
          h("span", { class: "row-title" }, issue.title),
          brief(issue) ? h("span", { class: "brief" }, brief(issue)) : null,
          issueFacts(issue),
        ]),
        actionButtons(issue),
      ]);
      bindRow(row, issue.number);
      body.append(row);
    }
  }
  els.wait.append(body);
}

function renderStuck(items, { failed, loading }) {
  const sorted = [...items].sort(byUpdatedDesc);
  els.stuck.replaceChildren(tileHead("卡住", failed || loading ? "" : String(sorted.length), "stuck", "alert"));
  const body = h("div", { class: "tile-body" });
  if (loading) body.append(h("p", { class: "quiet" }, "正在读取议题…"));
  else if (failed) body.append(h("p", { class: "quiet" }, "没能读到卡住的条目。"));
  else if (!sorted.length) body.append(h("p", { class: "quiet" }, filtersActive() ? "这个筛选下没有卡住的。" : "没有卡住的。"));
  else {
    for (const issue of sorted) {
      const reason = reasonFor(issue) || "还没有写原因";
      const row = h("div", { class: "row", "data-id": issue.number }, [
        avatar(ownerName(issue), issue.lanes[0]),
        h("div", { class: "row-copy" }, [
          h("span", { class: "row-title" }, issue.title),
          h("span", { class: "reason" }, reason),
          issueFacts(issue),
        ]),
      ]);
      bindRow(row, issue.number);
      body.append(row);
    }
  }
  els.stuck.append(body);
}

function renderFeed(visible, { failed, loading }) {
  const events = failed || loading ? [] : activityEvents(visible);
  els.feed.replaceChildren(tileHead("最近动态", events.length ? String(events.length) : "", "neutral", "pulse"));
  const body = h("div", { class: "tile-body" });
  if (loading) body.append(h("p", { class: "quiet" }, "正在读取议题…"));
  else if (failed) body.append(h("p", { class: "quiet" }, "动态还没读到。"));
  else if (!events.length) body.append(h("p", { class: "quiet" }, "还没有新的动态。"));
  else {
    for (const event of events) {
      const row = h("div", { class: "row", "data-id": event.number }, [
        avatar(event.who || "动", event.lane),
        h("div", { class: "row-copy" }, [
          h("span", { class: "row-title" }, event.title),
          event.excerpt ? h("span", { class: event.stuck ? "reason" : "brief" }, event.excerpt) : null,
          h("span", { class: "chips" }, [
            event.lane ? laneChip(event.lane) : null,
            event.stuck ? statusChip("卡住") : null,
            h("span", { class: "when" }, event.who ? `${event.who} · ${relativeTime(event.at)}` : relativeTime(event.at)),
          ]),
        ]),
      ]);
      bindRow(row, event.number);
      body.append(row);
    }
  }
  els.feed.append(body);
}

function tileHead(title, count, tone, iconName) {
  return h("div", { class: `tile-head tone-${tone}` }, [
    h("div", { class: "tile-title" }, [badge(iconName, tone), h("h2", {}, title)]),
    count ? h("span", { class: "count" }, count) : null,
  ]);
}

function renderChannels(visible, { failed, loading }) {
  els.channels.replaceChildren();
  for (const lane of LANES) {
    const excluded = state.filters.lane !== "all" && state.filters.lane !== lane.label;
    const tone = LANE_TONE[lane.label];
    const tile = h("article", { class: `channel${excluded ? " is-muted" : ""}`, "data-lane": lane.label });
    tile.append(h("div", { class: "channel-top" }, [
      h("div", { class: "channel-id" }, [
        badge(LANE_ICON[tone], `lane-${tone}`),
        h("div", {}, [h("h3", { class: "channel-name" }, lane.name), h("p", { class: "channel-plat" }, lane.platform)]),
      ]),
    ]));
    const main = h("div", { class: "channel-main" });
    if (excluded) {
      main.append(h("p", { class: "quiet" }, "这条线不在当前筛选里。"));
      tile.append(main);
      els.channels.append(tile);
      continue;
    }
    const laneIssues = visible.filter((issue) => issue.lanes.includes(lane.label));
    main.append(progressBar(laneIssues, failed || loading));
    const counts = h("div", { class: "counts" });
    for (const status of PIPELINE) {
      const count = failed || loading ? "—" : String(laneIssues.filter((issue) => columnFor(issue) === status).length);
      counts.append(h("div", { class: `tone-${STATUS_TONE[status]}` }, [
        h("b", {}, count),
        h("small", {}, status),
      ]));
    }
    const stuck = laneIssues.filter((issue) => columnFor(issue) === "卡住");
    const stuckCount = failed || loading ? "—" : String(stuck.length);
    main.append(counts, h("p", { class: `stuck-note${stuck.length ? "" : " is-zero"}` }, `${stuckCount} 卡住`));
    const recent = [...laneIssues].sort(byUpdatedDesc).filter((issue) => columnFor(issue) !== "已发布").slice(0, 3);
    const body = h("div", { class: "tile-body" });
    if (failed) body.append(h("p", { class: "quiet" }, "还没读到。"));
    else if (loading) body.append(h("p", { class: "quiet" }, "正在读取…"));
    else if (!laneIssues.length) body.append(h("p", { class: "quiet" }, "还没有内容。"));
    else if (!recent.length) body.append(h("p", { class: "quiet" }, "最近都已发布。"));
    else {
      for (const issue of recent) {
        const row = h("div", { class: "row", "data-id": issue.number }, [
          avatar(ownerName(issue), issue.lanes[0]),
          h("div", { class: "row-copy" }, [
            h("span", { class: "row-title" }, issue.title),
            issueFacts(issue),
          ]),
        ]);
        bindRow(row, issue.number);
        body.append(row);
      }
    }
    main.append(body);
    tile.append(main);
    els.channels.append(tile);
  }
}

function activityEvents(visible) {
  const ids = new Set(visible.map((issue) => issue.number));
  const events = [];
  for (const comment of state.comments) {
    if (!ids.has(comment.issueNumber)) continue;
    const issue = state.issues.find((item) => item.number === comment.issueNumber);
    if (!issue) continue;
    events.push({
      at: comment.createdAt,
      title: issue.title,
      number: issue.number,
      excerpt: excerpt(comment.body),
      who: comment.user,
      lane: issue.lanes[0] || "",
      stuck: /卡住原因\s*[:：]/.test(comment.body || ""),
    });
  }
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (events.length) return events.slice(0, 6);
  return [...visible].sort(byUpdatedDesc).slice(0, 6).map((issue) => ({
    at: issue.updatedAt,
    title: issue.title,
    number: issue.number,
    excerpt: columnFor(issue),
    who: issue.owners[0] || "",
    lane: issue.lanes[0] || "",
    stuck: columnFor(issue) === "卡住",
  }));
}

function renderLine(visible) {
  const laneId = activeLane();
  const tops = new Map([...els.board.querySelectorAll(".lane-body")].map((lane) => [lane.dataset.lane, lane.scrollTop]));
  els.lineSwitch.replaceChildren();
  for (const lane of LANES) {
    const button = h("button", {
      type: "button",
      class: `${lane.label === laneId ? "is-current" : ""} lane-${LANE_TONE[lane.label]}`,
      role: "tab",
      "data-lane": lane.label,
      "aria-selected": lane.label === laneId ? "true" : "false",
    }, lane.name);
    button.addEventListener("click", () => {
      state.mobileLane = lane.label;
      state.mobileLaneChosen = true;
      renderLists();
    });
    els.lineSwitch.append(button);
  }
  els.board.replaceChildren();
  if (state.loading && !state.issues.length) {
    els.board.append(h("p", { class: "stage-empty" }, "正在读取议题…"));
    return;
  }
  if (!state.loading && state.error && !state.issues.length) {
    els.board.append(h("p", { class: "stage-empty" }, state.error || "网络不通，暂时无法联系 GitHub。"));
    return;
  }
  for (const lane of LANES) {
    const laneIssues = visible.filter((issue) => issue.lanes.includes(lane.label));
    const section = h("section", {
      class: `lane${lane.label === laneId ? " is-current" : ""}`,
      "data-lane": lane.label,
      "aria-label": lane.name,
    });
    const tone = LANE_TONE[lane.label];
    section.append(h("div", { class: "lane-head" }, [
      h("div", { class: "lane-id" }, [
        badge(LANE_ICON[tone], `lane-${tone}`),
        h("div", {}, [h("h2", {}, lane.name), h("small", {}, lane.platform)]),
      ]),
    ]));
    const body = h("div", { class: "lane-body", "data-lane": lane.label });
    for (const status of PIPELINE) {
      body.append(renderStage(status, laneIssues.filter((issue) => columnFor(issue) === status)));
    }
    body.append(renderStage("卡住", laneIssues.filter((issue) => columnFor(issue) === "卡住"), true));
    section.append(body);
    els.board.append(section);
  }
  for (const lane of els.board.querySelectorAll(".lane-body")) {
    lane.scrollTop = tops.get(lane.dataset.lane) || 0;
  }
}

function renderStage(status, items, stuck = false) {
  const stage = h("section", {
    class: `stage${stuck ? " is-stuck" : ""}`,
    "data-status": status,
    "aria-label": status,
  });
  stage.append(h("div", { class: "stage-head" }, [
    h("h3", {}, status),
    h("span", {}, String(items.length)),
  ]));
  if (!items.length) stage.append(h("p", { class: "stage-empty" }, "空"));
  for (const issue of [...items].sort(byUpdatedDesc)) stage.append(renderMini(issue));
  return stage;
}

function renderMini(issue) {
  const column = columnFor(issue);
  const card = h("article", { class: "mini", "data-id": issue.number, tabindex: "0" });
  if (state.writable) {
    card.append(h("button", {
      type: "button",
      class: "grip",
      "data-drag": "1",
      "aria-label": "拖拽以更改状态",
      title: "拖拽以更改状态",
    }, [icon("grip")]));
  }
  const body = h("div", { class: "row-copy" });
  body.append(h("h3", {}, issue.title));
  const flags = [issue.missingStatus ? "未标状态" : "", issue.duplicateStatus ? "状态重复" : ""].filter(Boolean);
  body.append(h("p", { class: "chips" }, [
    avatar(ownerName(issue), issue.lanes[0]),
    laneChip(issue.lanes[0]),
    statusChip(column),
    h("span", { class: "when" }, [relativeTime(issue.updatedAt), flags.join(" · ")].filter(Boolean).join(" · ")),
  ]));
  if (column === "卡住") {
    body.append(h("p", { class: "stuck-reason" }, reasonFor(issue) || "还没有写原因"));
  }
  card.append(body);
  return card;
}

function renderLists() {
  if (state.dragActive) return;
  const visible = visibleIssues();
  renderHome(visible);
  renderLine(visible);
  renderChrome(visible);
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
  for (const label of issue.lanes) tags.append(h("span", { class: "tag" }, laneChip(label)));
  content.append(
    h("p", { class: "drawer-kicker" }, `#${issue.number} · ${absoluteTime(issue.updatedAt)}`),
    h("h2", {}, issue.title),
    tags,
  );
  if (column === "卡住") content.append(h("p", { class: "reason-callout" }, reason ? `卡住：${reason}` : "卡住：还没有写原因"));
  content.append(h("h3", { class: "section-label" }, "移动到"));
  const moves = h("div", { class: "move-row" });
  for (const status of STATUSES) {
    const current = column === status && !issue.missingStatus && !issue.duplicateStatus;
    const button = h("button", { type: "button", class: `tone-${STATUS_TONE[status] || "todo"}${current ? " is-current" : ""}` }, status);
    button.disabled = !state.writable || current;
    button.addEventListener("click", () => commitStatus(issue.number, status));
    moves.append(button);
  }
  content.append(moves);
  if (!state.writable) content.append(h("p", { class: "hint" }, "只读。设置里粘贴 Token 后可以改状态。"));
  if (links.length) {
    content.append(h("h3", { class: "section-label" }, "产出链接"));
    const list = h("div", { class: "output-links" });
    for (const link of links) list.append(h("a", { href: link.href, target: "_blank", rel: "noopener noreferrer" }, link.label));
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
  if (!state.demo) els.drawerGithub.href = issue.htmlUrl || `https://github.com/howardrock88/content-board/issues/${issue.number}`;
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
    dialog.addEventListener("close", () => {
      form.removeEventListener("submit", onSubmit);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      if (!settled) resolve(null);
    }, { once: true });
    dialog.showModal();
    if (confirm) ok.focus();
    else input.focus();
  });
}

function openSettings(message) {
  const dialog = document.querySelector("#settings");
  document.querySelector("#token-input").value = "";
  document.querySelector("#settings-message").textContent = message || (state.demo ? "当前是示例数据，保存的 Token 不会在这个页面里使用。" : state.writable ? "这台浏览器已经保存了 Token。" : "还没有 Token，看板是只读的。");
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

function clearFilters() {
  state.filters = { lane: "all", owner: "all", q: "" };
  if (els.paletteQ) els.paletteQ.value = "";
  renderLists();
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

function paletteCommands() {
  const raw = els.paletteQ.value.trim();
  const q = raw.toLowerCase();
  const items = [];
  const push = (item) => {
    const blob = `${item.label} ${item.keywords || ""}`.toLowerCase();
    if (q && !blob.includes(q)) return;
    items.push(item);
  };
  if (raw) {
    items.push({
      group: "搜索",
      label: `查找「${raw}」`,
      run: () => {
        state.filters.q = raw;
        renderLists();
      },
    });
    for (const issue of state.issues) {
      if (!`${issue.title} ${issue.number}`.toLowerCase().includes(q)) continue;
      items.push({
        group: "内容",
        label: issue.title,
        hint: `#${issue.number}`,
        run: () => openDrawer(issue.number),
      });
    }
  }
  if (filtersActive()) items.push({ group: "当前", label: "清除筛选", run: clearFilters });
  push({ group: "页面", label: "今日", hint: state.view === "today" ? "当前" : "", run: () => setView("today") });
  push({ group: "页面", label: "产线", hint: state.view === "line" ? "当前" : "", keywords: "看板", run: () => setView("line") });
  push({ group: "栏目", label: "全部栏目", hint: state.filters.lane === "all" ? "当前" : "", run: () => { state.filters.lane = "all"; renderLists(); } });
  for (const lane of LANES) {
    push({
      group: "栏目",
      label: lane.name,
      hint: state.filters.lane === lane.label ? "当前" : lane.platform,
      keywords: lane.platform,
      run: () => { state.filters.lane = lane.label; renderLists(); },
    });
  }
  push({ group: "负责", label: "全部负责", hint: state.filters.owner === "all" ? "当前" : "", run: () => { state.filters.owner = "all"; renderLists(); } });
  for (const owner of OWNERS) {
    push({
      group: "负责",
      label: owner,
      hint: state.filters.owner === owner ? "当前" : "",
      run: () => { state.filters.owner = owner; renderLists(); },
    });
  }
  push({ group: "动作", label: "刷新", run: () => refresh({ manual: true }) });
  push({ group: "动作", label: "切换外观", run: () => applyTheme(currentTheme() === "dark" ? "light" : "dark") });
  push({ group: "动作", label: "设置", run: () => openSettings() });
  push({ group: "动作", label: "新建", run: () => document.querySelector("#create").click() });
  return items.slice(0, 30);
}

function renderPalette() {
  paletteItems = paletteCommands();
  if (paletteIndex >= paletteItems.length) paletteIndex = 0;
  els.paletteList.replaceChildren();
  if (!paletteItems.length) {
    els.paletteList.append(h("p", { class: "palette-empty" }, "没有匹配"));
    return;
  }
  let group = "";
  paletteItems.forEach((item, index) => {
    if (item.group !== group) {
      group = item.group;
      els.paletteList.append(h("div", { class: "palette-group" }, group));
    }
    const button = h("button", {
      type: "button",
      class: `palette-item${index === paletteIndex ? " is-active" : ""}`,
      role: "option",
      "data-index": String(index),
      "aria-selected": index === paletteIndex ? "true" : "false",
    }, [h("span", {}, item.label), item.hint ? h("span", { class: "hint" }, item.hint) : null]);
    button.addEventListener("click", () => {
      paletteIndex = index;
      runPalette();
    });
    button.addEventListener("mousemove", () => {
      if (paletteIndex === index) return;
      paletteIndex = index;
      paintPaletteActive();
    });
    els.paletteList.append(button);
  });
}

function paintPaletteActive() {
  for (const node of els.paletteList.querySelectorAll(".palette-item")) {
    const on = Number(node.dataset.index) === paletteIndex;
    node.classList.toggle("is-active", on);
    node.setAttribute("aria-selected", on ? "true" : "false");
    if (on) node.scrollIntoView({ block: "nearest" });
  }
}

function runPalette() {
  const item = paletteItems[paletteIndex];
  if (!item) return;
  els.palette.close();
  item.run();
}

function openPalette() {
  els.paletteQ.value = state.filters.q;
  paletteIndex = 0;
  renderPalette();
  if (!els.palette.open) els.palette.showModal();
  els.paletteQ.focus();
  els.paletteQ.select();
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
  document.querySelectorAll(".stage[data-status]").forEach((node) => node.classList.toggle("is-drop", Boolean(status) && node.dataset.status === status));
  const scroller = document.elementFromPoint(event.clientX, event.clientY)?.closest(".lane-body");
  if (scroller) {
    const rect = scroller.getBoundingClientRect();
    if (event.clientY < rect.top + 36) scroller.scrollTop -= 14;
    else if (event.clientY > rect.bottom - 36) scroller.scrollTop += 14;
  }
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
  const stage = node?.closest(".stage");
  return stage?.dataset.status || "";
}

function ensureFloater() {
  let floater = document.querySelector("#drag-floater");
  if (!floater) {
    floater = h("div", { id: "drag-floater", hidden: "" });
    document.body.append(floater);
  }
  return floater;
}

function bootDialogs() {
  document.querySelector("#settings-open").addEventListener("click", () => {
    if (els.palette.open) els.palette.close();
    openSettings();
  });
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
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "k") {
      event.preventDefault();
      if (els.palette.open) els.palette.close();
      else openPalette();
      return;
    }
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) return;
    event.preventDefault();
    openPalette();
  });
  els.paletteQ.addEventListener("input", () => {
    paletteIndex = 0;
    renderPalette();
  });
  els.palette.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      paletteIndex = paletteItems.length ? (paletteIndex + 1) % paletteItems.length : 0;
      paintPaletteActive();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      paletteIndex = paletteItems.length ? (paletteIndex - 1 + paletteItems.length) % paletteItems.length : 0;
      paintPaletteActive();
    } else if (event.key === "Enter") {
      event.preventDefault();
      runPalette();
    }
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
  document.documentElement.dataset.view = state.view;
  applyTheme(currentTheme());
  fillSelect(document.querySelector("#new-lane"), LANES.map((lane) => [lane.label, lane.name]), "选择栏目");
  fillSelect(document.querySelector("#new-owner"), OWNERS.map((owner) => [owner, owner]), "选择负责");
  bootDialogs();
  bootKeys();
  els.viewToday.addEventListener("click", () => setView("today"));
  els.viewBoard.addEventListener("click", () => setView("line"));
  document.querySelector("#palette-open").addEventListener("click", openPalette);
  els.theme.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
  els.refresh.addEventListener("click", () => {
    if (els.palette.open) els.palette.close();
    refresh({ manual: true });
  });
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
