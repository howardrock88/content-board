import { normalizeComment, normalizeIssue } from "./parse.js";

function ago(now, hours) {
  return new Date(now - hours * 3_600_000).toISOString();
}

function issue(now, fields) {
  return normalizeIssue({
    html_url: "https://github.com/howardrock88/content-board/issues",
    user: { login: "demo" },
    ...fields,
    labels: fields.labels.map((name) => ({ name })),
    updated_at: ago(now, fields.hoursAgo),
    created_at: ago(now, fields.hoursAgo + 20),
  });
}

function comment(fields) {
  return normalizeComment({
    id: fields.id,
    issue_url: `https://api.github.com/repos/howardrock88/content-board/issues/${fields.issue}`,
    body: fields.body,
    created_at: fields.createdAt,
    user: { login: fields.user },
  });
}

// Sample desk used by ?demo=1. It never touches the GitHub API and is never cached.
export function buildDemo(now = Date.now()) {
  const issues = [
    issue(now, {
      number: 128,
      hoursAgo: 2,
      title: "霜降：菜市场的萝卜，润燥不用甜汤",
      labels: ["栏目/四时日月", "状态/进行中", "负责/节气养生视频制作"],
      body: `## 说明
40 秒口播。开头是菜市场的萝卜，落点是「润燥不是喝很甜的汤」。字幕还差最后三句。

## 产出链接
- [剪辑工程](https://example.com/shuangjiang-cut)

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 127,
      hoursAgo: 5,
      title: "寒露：三个早睡动作",
      labels: ["栏目/四时日月", "状态/待验收", "负责/视频质量审核"],
      body: `## 说明
成片已交。请 Shawn 看字幕是否把「少刷手机」说重了，以及封面字是否出安全区。

## 产出链接
- [待验收成片](https://example.com/hanlu-review)

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 126,
      hoursAgo: 1,
      title: "秋分食养封面返工",
      labels: ["栏目/四时日月", "状态/卡住", "负责/视频运营"],
      body: `## 说明
正片已发过一版封面，标题在预览里被裁切。

## 产出链接
- [现封面](https://example.com/qiufen-cover)

## 卡住原因
封面标题太长。
`,
    }),
    issue(now, {
      number: 125,
      hoursAgo: 24 * 3,
      title: "白露：秋梨膏怎么吃才不发胖",
      labels: ["栏目/四时日月", "状态/已发布", "负责/视频运营"],
      body: `## 说明
已发。评论区在问剂量，下一支可以接「一天几勺」。

## 产出链接
- [抖音成片](https://example.com/bailu)

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 124,
      hoursAgo: 0.5,
      title: "路透：中国机器人出口，剪 60 秒",
      labels: ["栏目/隔洋看世界", "状态/待做", "负责/隔洋看世界选题"],
      body: `## 说明
路透社一条出口数据。只要画面里的工厂和港口，不要播音员的立场句。60 秒内。

## 产出链接
（发布后一行一个链接。）

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 123,
      hoursAgo: 4,
      title: "BBC 镜头里的中国高铁",
      labels: ["栏目/隔洋看世界", "状态/进行中", "负责/隔洋看世界制作组"],
      body: `## 说明
从纪录片里摘车站、车厢、时刻表三个镜头，配一行中文事实核对。

## 产出链接
（发布后一行一个链接。）

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 122,
      hoursAgo: 24 * 6,
      title: "经济学人：县城咖啡",
      labels: ["栏目/隔洋看世界", "状态/已发布", "负责/Shawn"],
      body: `## 说明
Shawn 亲自核过标题后发出。可以关议题归档。

## 产出链接
- [头条成片](https://example.com/county-coffee)

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 121,
      hoursAgo: 0.7,
      title: "外媒标题核对清单",
      labels: ["栏目/隔洋看世界", "状态/待验收", "负责/Shawn"],
      body: `## 说明
本周三条外媒标题的核对表，Shawn 看完才能发。重点是不要把预测写成已发生。

## 产出链接
- [核对表](https://example.com/headline-check)

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 120,
      hoursAgo: 8,
      title: "具身智能：灵巧手这一年",
      labels: ["栏目/大蒜粒机研所", "状态/待做", "负责/大蒜粒机研所选题"],
      body: `## 说明
公众号深读选题。范围是灵巧手的传感器和数据，不写成产品横评。

## 产出链接
（发布后一行一个链接。）

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 119,
      hoursAgo: 3,
      title: "深读：HBM 供给是怎么卡上的",
      labels: ["栏目/大蒜粒机研所", "状态/进行中", "负责/大蒜粒机研所写作"],
      body: `## 说明
前半写产能，后半写谁买得到。数字只用来源能公开引用的财报。

## 产出链接
（发布后一行一个链接。）

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 118,
      hoursAgo: 2.4,
      title: "为什么机器人公司都在囤数据",
      labels: ["栏目/大蒜粒机研所", "状态/待验收", "负责/大蒜粒机研所策略顾问"],
      body: `## 说明
策略顾问定了结构：数据从哪来、为什么买不到、和芯片的关系。稿在待验收。

## 产出链接
- [稿件](https://example.com/robot-data)

## 卡住原因
（未卡住就留空。）
`,
    }),
    issue(now, {
      number: 117,
      hoursAgo: 6,
      title: "端侧模型到底能跑在什么芯片上",
      labels: ["栏目/大蒜粒机研所", "状态/卡住", "负责/大蒜粒机研所写作"],
      body: `## 说明
想做一张读者能看懂的对照，不写成参数堆砌。

## 产出链接
（发布后一行一个链接。）

## 卡住原因
缺一张能公开引用的芯片对照。
`,
    }),
  ];

  const comments = [
    comment({
      id: 1,
      issue: 128,
      user: "节气养生视频制作",
      createdAt: ago(now, 2),
      body: "口播已录。字幕还差「少糖」那三句，录完就交审核。",
    }),
    comment({
      id: 2,
      issue: 126,
      user: "视频运营",
      createdAt: ago(now, 3),
      body: "封面第一版用了秋分餐桌，字数超了。",
    }),
    comment({
      id: 3,
      issue: 126,
      user: "视频运营",
      createdAt: ago(now, 1),
      body: "卡住原因：抖音封面安全区把标题裁掉了，等 Shawn 定一行不超过 8 个字的标题。",
    }),
    comment({
      id: 4,
      issue: 119,
      user: "大蒜粒机研所写作",
      createdAt: ago(now, 3),
      body: "供给链前半写完了。今晚补公开财报里的产能数字，先不标卡住。",
    }),
    comment({
      id: 5,
      issue: 117,
      user: "大蒜粒机研所写作",
      createdAt: ago(now, 6),
      body: "卡住原因：缺一张能公开引用的芯片对照表，有了才能继续写后半。",
    }),
  ];

  return { issues, comments };
}
