import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { buildDemo } from "../site/js/demo.js";
import { nextLink } from "../site/js/api.js";
import {
  attentionKind,
  BODY_TEMPLATE,
  bodyFromSummary,
  columnFor,
  finalStatusForIssue,
  extractOutputLinks,
  extractSection,
  LANE_LABELS,
  labelsForStatus,
  isDoneStatus,
  matchesFilters,
  moveStatusesForIssue,
  normalizeIssue,
  OWNER_LABELS,
  relativeTime,
  absoluteTime,
  displayCommentBody,
  isShawnComment,
  renderMarkdown,
  resolveStuckReason,
  shawnCommentBody,
  STATUS_LABELS,
  upsertSection,
} from "../site/js/parse.js";

const labels = JSON.parse(fs.readFileSync(new URL("../labels.json", import.meta.url), "utf8"));

test("label catalog matches the board and stays within GitHub limits", () => {
  const names = labels.map((label) => label.name).sort();
  const expected = [...LANE_LABELS, ...STATUS_LABELS, ...OWNER_LABELS].sort();
  assert.deepEqual(names, expected);
  for (const label of labels) {
    assert.match(label.color, /^[0-9A-F]{6}$/);
    assert.ok(label.description.length > 0 && label.description.length <= 100);
  }
  const laneColors = labels.filter((label) => label.name.startsWith("栏目/")).map((label) => label.color);
  assert.equal(new Set(laneColors).size, laneColors.length);
});

test("guide and readme keep the operating rules", () => {
  const guide = fs.readFileSync(new URL("../BOT_GUIDE.md", import.meta.url), "utf8");
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(guide, /## 产出链接/);
  assert.match(guide, /## 卡住原因/);
  assert.match(guide, /卡住原因：/);
  assert.match(guide, /不要删除/);
  assert.match(guide, /已发布/);
  assert.match(guide, /状态\//);
  assert.match(readme, /Settings → Pages → Build and deployment → Source → GitHub Actions/);
  assert.match(readme, /https:\/\/howardrock88\.github\.io\/content-board\//);
});

test("repository files do not contain a token", () => {
  const files = [
    "site/index.html",
    "site/js/app.js",
    "site/js/api.js",
    "site/js/parse.js",
    "site/js/demo.js",
    "README.md",
    "BOT_GUIDE.md",
    ".github/workflows/pages.yml",
    ".github/workflows/labels.yml",
  ];
  for (const file of files) {
    const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /github_pat_[A-Za-z0-9_]{20,}/);
    assert.doesNotMatch(text, /ghp_[A-Za-z0-9]{20,}/);
  }
});

test("status changes leave exactly one 状态 label", () => {
  assert.deepEqual(
    labelsForStatus(["栏目/四时日月", "状态/待做", "状态/进行中", "负责/Shawn"], "卡住"),
    ["栏目/四时日月", "负责/Shawn", "状态/卡住"],
  );
});

test("stuck reason prefers the newest comment, then the body section", () => {
  const body = `## 卡住原因\n封面标题太长。\n`;
  const comments = [
    { body: "先看了一版。", createdAt: "2026-10-16T08:00:00Z" },
    { body: "卡住原因：抖音封面安全区把标题裁掉了。", createdAt: "2026-10-16T09:00:00Z" },
  ];
  assert.equal(resolveStuckReason(body, comments), "抖音封面安全区把标题裁掉了。");
  assert.equal(resolveStuckReason(body, []), "封面标题太长。");
  assert.equal(resolveStuckReason("卡住原因：缺对照表", []), "缺对照表");
  assert.equal(resolveStuckReason(BODY_TEMPLATE, []), "");
});

test("output links come only from the agreed section", () => {
  const body = `## 说明\n看 https://example.com/ignore\n\n## 产出链接\n- [成片](https://example.com/video)\n`;
  assert.deepEqual(extractOutputLinks(body), [{ href: "https://example.com/video", label: "成片" }]);
  assert.deepEqual(extractOutputLinks(BODY_TEMPLATE), []);
  assert.deepEqual(extractOutputLinks("产出链接：https://example.com/a."), [{ href: "https://example.com/a", label: "https://example.com/a" }]);
});

test("section edits do not clobber neighboring sections", () => {
  const next = upsertSection(BODY_TEMPLATE, "卡住原因", "缺公开对照表");
  assert.equal(extractSection(next, "卡住原因"), "缺公开对照表");
  assert.match(extractSection(next, "说明"), /这条内容要做什么/);
  assert.match(extractSection(next, "产出链接"), /一行一个链接/);
  const filled = bodyFromSummary("霜降短视频");
  assert.equal(extractSection(filled, "说明"), "霜降短视频");
});

test("markdown escapes html and only links http(s)", () => {
  const hostile = renderMarkdown("<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n[片](https://example.com/a)");
  assert.doesNotMatch(hostile, /<script>/);
  assert.match(hostile, /&lt;script&gt;/);
  assert.doesNotMatch(hostile, /href="javascript/);
  assert.match(hostile, /href="https:\/\/example\.com\/a"/);
  assert.match(hostile, /rel="noopener noreferrer"/);
});

test("attention list is 卡住, then 待验收, then 负责 Shawn", () => {
  const stuck = normalizeIssue({ number: 1, title: "a", labels: ["状态/卡住"], updated_at: "2026-10-16T00:00:00Z" });
  const review = normalizeIssue({ number: 2, title: "b", labels: ["状态/待验收", "负责/Shawn"], updated_at: "2026-10-16T00:00:00Z" });
  const mine = normalizeIssue({ number: 3, title: "c", labels: ["状态/进行中", "负责/Shawn"], updated_at: "2026-10-16T00:00:00Z" });
  const published = normalizeIssue({ number: 4, title: "d", labels: ["状态/已发布", "负责/视频运营"], updated_at: "2026-10-16T00:00:00Z" });
  const missing = normalizeIssue({ number: 5, title: "e", labels: ["栏目/四时日月"], updated_at: "2026-10-16T00:00:00Z" });
  assert.equal(attentionKind(stuck), "卡住");
  assert.equal(attentionKind(review), "待验收");
  assert.equal(attentionKind(mine), "Shawn");
  assert.equal(attentionKind(published), "");
  const finished = normalizeIssue({ number: 6, title: "f", labels: ["栏目/大蒜粒机研所", "状态/已完成", "负责/大蒜粒机研所写作"], updated_at: "2026-10-16T00:00:00Z", state: "closed" });
  assert.equal(columnFor(finished), "已完成");
  assert.equal(isDoneStatus(columnFor(finished)), true);
  assert.equal(isDoneStatus(columnFor(published)), true);
  assert.equal(finalStatusForIssue(finished), "已完成");
  assert.equal(finalStatusForIssue(published), "已发布");
  assert.deepEqual(moveStatusesForIssue(finished), ["待做", "进行中", "卡住", "待验收", "已完成"]);
  assert.ok(!moveStatusesForIssue(published).includes("已完成"));
  assert.equal(columnFor(missing), "待做");
  assert.equal(missing.missingStatus, true);
  assert.equal(matchesFilters(stuck, { lane: "栏目/四时日月" }), false);
  assert.equal(matchesFilters(missing, { q: "四时" }), true);
});

test("relative times use the Asia/Shanghai calendar", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  assert.equal(relativeTime("2026-10-16T09:59:30Z", now), "刚刚");
  assert.equal(relativeTime("2026-10-16T09:20:00Z", now), "40 分钟前");
  assert.equal(relativeTime("2026-10-16T06:00:00Z", now), "4 小时前");
  assert.equal(relativeTime("2026-10-15T10:00:00Z", now), "昨天");
  assert.equal(relativeTime("2026-10-14T10:00:00Z", now), "2 天前");
  assert.match(absoluteTime("2026-10-16T10:00:00Z"), /18:00/);
  assert.match(absoluteTime("2026-10-16T10:00:00Z"), /北京时间/);
});

test("demo desk covers every column and shows comment reasons", () => {
  const { issues, comments } = buildDemo(Date.parse("2026-10-16T10:00:00Z"));
  const counts = Object.fromEntries(["待做", "进行中", "卡住", "待验收", "已发布", "已完成"].map((status) => [status, 0]));
  for (const issue of issues) counts[columnFor(issue)] += 1;
  assert.deepEqual(counts, { 待做: 2, 进行中: 3, 卡住: 2, 待验收: 3, 已发布: 2, 已完成: 1 });
  const article = issues.find((issue) => issue.number === 116);
  assert.equal(finalStatusForIssue(article), "已完成");
  assert.equal(columnFor(article), "已完成");
  const stuck = issues.find((issue) => issue.number === 126);
  const related = comments.filter((comment) => comment.issueNumber === 126);
  assert.equal(resolveStuckReason(stuck.body, related), "抖音封面安全区把标题裁掉了，等 Shawn 定一行不超过 8 个字的标题。");
  assert.ok(issues.filter((issue) => attentionKind(issue)).length >= 5);
});

test("board comments carry the Shawn marker and hide it when shown", () => {
  const posted = shawnCommentBody("  开头改一下\n今天给 ");
  assert.equal(posted, "【Shawn】\n开头改一下\n今天给");
  assert.equal(isShawnComment(posted), true);
  assert.equal(isShawnComment("【Shawn】"), true);
  assert.equal(isShawnComment("卡住原因：封面太长"), false);
  assert.equal(isShawnComment("口播已录。\n【Shawn】\n不是开头"), false);
  assert.equal(displayCommentBody(posted), "开头改一下\n今天给");
  assert.equal(displayCommentBody("口播已录。"), "口播已录。");
  assert.equal(displayCommentBody("【Shawn】"), "");
});

test("parses a GitHub link header", () => {
  const header = '<https://api.github.com/repos/o/r/issues?page=2>; rel="next", <https://api.github.com/repos/o/r/issues?page=5>; rel="last"';
  assert.equal(nextLink(header), "https://api.github.com/repos/o/r/issues?page=2");
  assert.equal(nextLink(null), null);
});
