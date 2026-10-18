// Pure rules shared by the board, the tests, and BOT_GUIDE.md.
// Issues in this repo are the database. Closed issues are archived.

export const REPO = { owner: "howardrock88", repo: "content-board" };

export const STATUSES = ["待做", "进行中", "卡住", "待验收", "已发布", "已完成"];
export const ARTICLE_LANE = "栏目/大蒜粒机研所";

export const LANES = [
  {
    label: "栏目/四时日月",
    name: "四时日月",
    platform: "抖音 · 节气养生视频",
  },
  {
    label: "栏目/隔洋看世界",
    name: "隔洋看世界",
    platform: "今日头条 · 外媒看中国剪辑视频",
  },
  {
    label: "栏目/大蒜粒机研所",
    name: "大蒜粒机研所",
    platform: "微信公众号 · AI / 具身智能 / 芯片深读",
  },
];

export const OWNERS = [
  "Shawn",
  "节气养生视频制作",
  "视频运营",
  "视频质量审核",
  "隔洋看世界选题",
  "隔洋看世界制作组",
  "大蒜粒机研所策略顾问",
  "大蒜粒机研所选题",
  "大蒜粒机研所写作",
];

export const STATUS_LABELS = STATUSES.map((status) => `状态/${status}`);
export const LANE_LABELS = LANES.map((lane) => lane.label);
export const OWNER_LABELS = OWNERS.map((owner) => `负责/${owner}`);

export const BODY_TEMPLATE = `## 说明
（这条内容要做什么、给谁看、做到什么程度。）

## 产出链接
（发布后一行一个链接。）

## 卡住原因
（未卡住就留空。卡住时写一句人话，并另发一条评论说明原因。）
`;

const DISPLAY_PRIORITY = ["卡住", "待验收", "进行中", "待做", "已完成", "已发布"];

export function isDoneStatus(status) {
  return status === "已发布" || status === "已完成";
}

export function finalStatusForLane(label) {
  return label === ARTICLE_LANE ? "已完成" : "已发布";
}

export function finalStatusForIssue(issue) {
  return (issue?.lanes || []).includes(ARTICLE_LANE) ? "已完成" : "已发布";
}

export function stagesForLane(label) {
  return ["待做", "进行中", "待验收", finalStatusForLane(label)];
}

export function moveStatusesForIssue(issue) {
  return ["待做", "进行中", "卡住", "待验收", finalStatusForIssue(issue)];
}

export function laneMeta(label) {
  return LANES.find((lane) => lane.label === label) || null;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeReg(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSection(body, title) {
  const text = String(body || "").replace(/\r\n/g, "\n");
  const re = new RegExp(`^#{1,3}[ \\t]*${escapeReg(title)}[ \\t]*$`, "m");
  const match = re.exec(text);
  if (!match) return "";
  const rest = text.slice(match.index + match[0].length);
  const nextHeading = rest.search(/\n#{1,3}[ \t]+\S/);
  const raw = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  return raw.trim();
}

export function upsertSection(body, title, content) {
  const text = String(body || "").replace(/\r\n/g, "\n");
  const section = `## ${title}\n${String(content || "").trim()}\n`;
  const re = new RegExp(`^#{1,3}[ \\t]*${escapeReg(title)}[ \\t]*$`, "m");
  const match = re.exec(text);
  if (!match) {
    const base = text.trimEnd();
    return base ? `${base}\n\n${section}` : section;
  }
  const before = text.slice(0, match.index);
  const rest = text.slice(match.index + match[0].length);
  const nextHeading = rest.search(/\n#{1,3}[ \t]+\S/);
  const after = nextHeading === -1 ? "" : rest.slice(nextHeading + 1);
  return `${before}${section}${after ? `\n${after.replace(/^\n/, "")}` : ""}`;
}

export function bodyFromSummary(summary) {
  const text = String(summary || "").trim();
  if (!text) return BODY_TEMPLATE;
  return upsertSection(BODY_TEMPLATE, "说明", text);
}

function cleanLine(line) {
  return String(line || "").replace(/^[-*]\s+/, "").trim();
}

function isPlaceholder(line) {
  if (!line) return true;
  if (/^[（(]/.test(line)) return true;
  if (/^(无|暂无|待填写|未填写|留空|无。|暂无。)$/.test(line)) return true;
  if (/^[-—–]+$/.test(line)) return true;
  return false;
}

export function firstMeaningfulLine(text) {
  for (const line of String(text || "").split("\n")) {
    const cleaned = cleanLine(line).replace(/^卡住原因\s*[:：]\s*/, "").trim();
    if (!isPlaceholder(cleaned)) return cleaned;
  }
  return "";
}

export function resolveStuckReason(body, comments) {
  const sorted = [...(comments || [])].sort(
    (a, b) => Date.parse(b.createdAt || b.created_at || 0) - Date.parse(a.createdAt || a.created_at || 0),
  );
  for (const comment of sorted) {
    const match = String(comment.body || "").match(/卡住原因\s*[:：]\s*([^\n]+)/);
    if (!match) continue;
    const line = firstMeaningfulLine(match[1]);
    if (line) return line;
  }
  if (hasSection(body, "卡住原因")) return firstMeaningfulLine(extractSection(body, "卡住原因"));
  const inline = String(body || "").match(/卡住原因\s*[:：]\s*([^\n]+)/);
  if (inline) return firstMeaningfulLine(inline[1]);
  return "";
}

function hasSection(body, title) {
  const text = String(body || "").replace(/\r\n/g, "\n");
  return new RegExp(`^#{1,3}[ \\t]*${escapeReg(title)}[ \\t]*$`, "m").test(text);
}

export function extractOutputLinks(body) {
  const chunks = [];
  const section = extractSection(body, "产出链接");
  if (section) chunks.push(section);
  const inline = String(body || "").match(/产出链接\s*[:：]\s*(https?:\/\/\S+)/);
  if (inline) chunks.push(inline[1]);
  const links = [];
  const seen = new Set();
  const blob = chunks.join("\n");
  const markdown = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match;
  while ((match = markdown.exec(blob))) addLink(links, seen, match[2], match[1]);
  const bare = /https?:\/\/[^\s<)]+/g;
  while ((match = bare.exec(blob))) addLink(links, seen, match[0], "");
  return links;
}

function addLink(links, seen, href, label) {
  const url = String(href || "").trim().replace(/[.,;:!?，。；、）)]+$/g, "");
  if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
  seen.add(url);
  const text = label && label !== url ? label : url;
  links.push({ href: url, label: text });
}

export function normalizeIssue(raw) {
  const labels = (raw.labels || [])
    .map((label) => (typeof label === "string" ? label : label?.name))
    .filter(Boolean);
  const statuses = labels
    .filter((name) => name.startsWith("状态/"))
    .map((name) => name.slice("状态/".length))
    .filter((name) => STATUSES.includes(name));
  return {
    number: raw.number,
    title: String(raw.title || "").trim() || "未命名",
    body: raw.body || "",
    htmlUrl: raw.html_url || "",
    updatedAt: raw.updated_at || raw.created_at || new Date(0).toISOString(),
    createdAt: raw.created_at || raw.updated_at || new Date(0).toISOString(),
    labels,
    statuses,
    lanes: labels.filter((name) => name.startsWith("栏目/")),
    owners: labels.filter((name) => name.startsWith("负责/")).map((name) => name.slice("负责/".length)),
    missingStatus: statuses.length === 0,
    duplicateStatus: statuses.length > 1,
  };
}

export function normalizeComment(raw) {
  const match = String(raw.issue_url || "").match(/\/issues\/(\d+)$/);
  return {
    id: raw.id,
    issueNumber: match ? Number(match[1]) : raw.issueNumber ?? null,
    body: raw.body || "",
    createdAt: raw.created_at || raw.createdAt || new Date(0).toISOString(),
    updatedAt: raw.updated_at || raw.updatedAt || raw.created_at || raw.createdAt || new Date(0).toISOString(),
    user: raw.user?.login || raw.user || "未知",
  };
}

export function columnFor(issue) {
  return DISPLAY_PRIORITY.find((status) => issue.statuses.includes(status)) || "待做";
}

export function labelsForStatus(labels, status) {
  const next = (labels || []).filter((name) => !String(name).startsWith("状态/"));
  if (status) next.push(`状态/${status}`);
  return next;
}

export function attentionKind(issue) {
  const column = columnFor(issue);
  if (!issue.missingStatus && column === "卡住") return "卡住";
  if (!issue.missingStatus && column === "待验收") return "待验收";
  if (issue.owners.includes("Shawn")) return "Shawn";
  return "";
}

export function attentionRank(issue) {
  const kind = attentionKind(issue);
  if (kind === "卡住") return 0;
  if (kind === "待验收") return 1;
  if (kind === "Shawn" && isDoneStatus(columnFor(issue))) return 3;
  if (kind === "Shawn") return 2;
  return 9;
}

export function byUpdatedDesc(a, b) {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

export function byAttention(a, b) {
  const rank = attentionRank(a) - attentionRank(b);
  if (rank) return rank;
  return byUpdatedDesc(a, b);
}

export function matchesFilters(issue, filters = {}, reason = "") {
  if (filters.lane && filters.lane !== "all" && !issue.lanes.includes(filters.lane)) return false;
  if (filters.owner && filters.owner !== "all" && !issue.owners.includes(filters.owner)) return false;
  const query = String(filters.q || "").trim().toLowerCase();
  if (!query) return true;
  const haystack = [issue.title, issue.body, reason, issue.owners.join(" "), issue.lanes.join(" "), issue.statuses.join(" ")]
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

export function commentsForIssue(comments, number) {
  return (comments || [])
    .filter((comment) => comment.issueNumber === number)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

const SHAWN_MARK = "【Shawn】";

function normalizedCommentBody(body) {
  return String(body ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

export function shawnCommentBody(text) {
  return `${SHAWN_MARK}\n${String(text ?? "").trim()}`;
}

export function isShawnComment(body) {
  const text = normalizedCommentBody(body);
  return text === SHAWN_MARK || text.startsWith(`${SHAWN_MARK}\n`);
}

export function displayCommentBody(body) {
  const text = normalizedCommentBody(body);
  if (text.startsWith(`${SHAWN_MARK}\n`)) return text.slice(SHAWN_MARK.length + 1);
  if (text === SHAWN_MARK) return "";
  return text;
}

export function shanghaiDayKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function absoluteTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const text = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${text} 北京时间`;
}

export function relativeTime(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return absoluteTime(iso).replace(/ 北京时间$/, "");
  if (diffMs < 60_000) return "刚刚";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const dayDiff = Math.round((Date.parse(shanghaiDayKey(now)) - Date.parse(shanghaiDayKey(date))) / 86_400_000);
  if (dayDiff <= 0) return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  if (dayDiff === 1) return "昨天";
  if (dayDiff < 30) return `${dayDiff} 天前`;
  return absoluteTime(iso).replace(/ 北京时间$/, "");
}

function isBlockStart(line) {
  return /^(#{1,4}\s+|```|>\s?|[-*]\s+|\d+\.\s+|---\s*$|\*\*\*\s*$)/.test(line);
}

function inline(source) {
  let html = escapeHtml(source).replace(/\uE000/g, "");
  const holders = [];
  const hold = (snippet) => {
    holders.push(snippet);
    return `\uE000${holders.length - 1}\uE000`;
  };
  html = html.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) =>
    hold(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`),
  );
  html = html.replace(/(^|[\s（(])((?:https?:\/\/)[^\s<]+)/g, (_, pre, url) => {
    const clean = url.replace(/[.,;:!?，。；、）)]+$/g, "");
    const trail = url.slice(clean.length);
    return `${pre}${hold(`<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`)}${trail}`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return html.replace(/\uE000(\d+)\uE000/g, (_, index) => holders[Number(index)]);
}

export function renderMarkdown(source) {
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("```")) {
      const buffer = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        buffer.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(buffer.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4);
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buffer = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        buffer.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote><p>${inline(buffer.join(" "))}</p></blockquote>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^[-*]\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\d+\.\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const buffer = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      buffer.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${inline(buffer.join(" "))}</p>`);
  }
  return blocks.join("\n");
}
