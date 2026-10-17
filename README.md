# 内容总看板

Shawn 的内容看板，三条线放在一起：四时日月（抖音节气养生）、隔洋看世界（今日头条外媒看中国）、大蒜粒机研所（微信公众号深读）。

打开：**https://howardrock88.github.io/content-board/**

数据就是本仓库的 GitHub Issues。机器人改议题，看板就更新，不用重新部署。关闭的议题是归档，不会出现在看板上。

## 看板上有什么

打开是一块铺满屏幕的卡片桌面：四个数字（等你拍板、卡住、进行中、本周完成）、等你拍板的清单、卡住的原因、三条栏目各自的阶段计数和近况，以及最近动态。第二视图是「产线」：三条栏目，每条四个阶段。视频的最后一站是已发布，文章（大蒜粒机研所）的最后一站是已完成。卡住挂在该栏目下面并写着原因。搜索和筛选在 ⌘K。设计说明见 [DESIGN.md](DESIGN.md)。

- 状态是：待做、进行中、卡住、待验收，以及终点。视频的终点是已发布，文章的终点是已完成。卡住不是和另外四段并排的第五列。
- 首页把待验收放进「等你拍板」，卡住单独列出原因。
- 每条内容有标题、栏目、负责人、北京时间的相对更新时间。
- 可以按栏目、负责人筛选，也可以搜索标题和说明。
- 点开一条能看 Markdown 正文、产出链接、评论进度，以及 GitHub 上的议题。

手机上今日是纵向叠起来的卡片。产线上一次看一条栏目，用顶部切换。宽屏同时看三条线。

## 只读和写入

页面直接调用 GitHub 的公开接口，不需要登录就能看。未登录每小时 60 次：页面把结果放在这台浏览器的 localStorage 里，每 5 分钟自动刷新一次，也可以手动刷新。没有条目时不会去拉评论。

要拖拽改状态、新建条目或写评论，打开「设置」，粘贴一个**只用于本仓库**的 fine-grained personal access token（Issues 读写）。Token 只存在这台浏览器里，不会进仓库。没有 Token 时拖拽是关的。

不要在公共电脑上保存 Token。议题是公开的，不要把账号、密码写进 Issue。

## 正文约定

```markdown
## 说明
（这条内容要做什么。）

## 产出链接
（一行一个链接。）

## 卡住原因
（未卡住就留空。）
```

卡住时再发一条评论，第一行是 `卡住原因：…`。机器人步骤见 [BOT_GUIDE.md](BOT_GUIDE.md)。

## 部署

`main` 上的推送会跑两个工作流：

- `Deploy GitHub Pages` 把 `site/` 发布到 GitHub Pages。使用 `actions/configure-pages`（`enablement: true`）、`actions/upload-pages-artifact`、`actions/deploy-pages`。
- `Ensure labels` 按 `labels.json` 创建或更新栏目、状态、负责标签，重复运行也安全。权限是 `issues: write`。

`enablement: true` 会尝试把 Pages 的构建源设成 GitHub Actions。默认的 `GITHUB_TOKEN` **不能**创建 Pages 站点（它没有 `administration: write`，Actions 也不允许给它这个权限）。

合并到 `main` 之后，如果部署失败并出现 `Get Pages site failed` 或 HTTP 404，做一次这个设置，然后重跑 **Deploy GitHub Pages**：

**Settings → Pages → Build and deployment → Source → GitHub Actions**

中文界面：设置 → Pages → 构建和部署 → 源 → GitHub Actions。

这个选项要等部署工作流已经在默认分支上才会出现。设好之后，以后推 `main` 会自己部署。仓库里不放任何密钥。

## 本地预览

```bash
npm test
python3 -m http.server 4173 --directory site
```

示例布局：http://127.0.0.1:4173/?demo=1

不带 `demo=1` 时会读取本仓库的真实议题。
