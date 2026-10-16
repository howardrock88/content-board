// Public reads stay inside the unauthenticated 60 requests/hour budget:
// one paged issues request, plus one paged comments request only when
// there is something on the board. Writes use a token that never leaves
// localStorage. Nothing in this file belongs in the repository.

import { REPO, normalizeComment, normalizeIssue } from "./parse.js";

const API = "https://api.github.com";
const TOKEN_KEY = "content-board:token";
const CACHE_KEY = "content-board:cache:v1";

export const FRESH_MS = 5 * 60 * 1000;
export const ISSUE_PAGE_CAP = 4;
export const COMMENT_PAGE_CAP = 3;

export class ApiError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "ApiError";
    this.status = extra.status;
    this.remaining = extra.remaining;
    this.reset = extra.reset;
  }
}

function storageGet(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function storageSet(key, value) {
  globalThis.localStorage.setItem(key, value);
}

function storageRemove(key) {
  globalThis.localStorage.removeItem(key);
}

export function getToken() {
  return storageGet(TOKEN_KEY);
}

export function setToken(token) {
  storageSet(TOKEN_KEY, token);
}

export function clearToken() {
  try {
    storageRemove(TOKEN_KEY);
  } catch {
    // Storage can be blocked; the in-memory session simply stays read-only.
  }
}

export function loadCache() {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.issues) || !Array.isArray(data.comments)) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveCache(data) {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify({ version: 1, ...data }));
  } catch {
    // A full or blocked localStorage should not take the board down.
  }
}

export function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    if (!/rel="next"/.test(part)) continue;
    const match = part.match(/<([^>]+)>/);
    if (match) return match[1];
  }
  return null;
}

async function request(url, { token, method = "GET", body } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  try {
    return await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("网络不通，暂时无法联系 GitHub。");
  }
}

async function fail(response) {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  let detail = "";
  try {
    const data = await response.json();
    detail = data.message || "";
  } catch {
    detail = "";
  }
  if (response.status === 401) throw new ApiError("Token 无效或已过期。", { status: 401 });
  if ((response.status === 403 || response.status === 429) && remaining === "0") {
    throw new ApiError("未登录接口每小时 60 次，额度已用完。先用这台浏览器里的缓存。", {
      status: response.status,
      remaining,
      reset,
    });
  }
  if (response.status === 403) throw new ApiError("没有权限做这次修改。", { status: 403, remaining, reset });
  if (response.status === 422 && /label/i.test(detail)) {
    throw new ApiError("标签还不存在。等 Ensure labels 工作流在 main 上跑完再试。", { status: 422 });
  }
  throw new ApiError(detail ? `GitHub 拒绝了请求：${detail}` : `请求失败（${response.status}）。`, {
    status: response.status,
    remaining,
    reset,
  });
}

export async function fetchPaged(start, { token, maxPages }) {
  const items = [];
  let url = start.startsWith("http") ? start : `${API}${start}`;
  let pages = 0;
  let remaining = null;
  let reset = null;
  let truncated = false;
  while (url && pages < maxPages) {
    const response = await request(url, { token });
    remaining = response.headers.get("x-ratelimit-remaining");
    reset = response.headers.get("x-ratelimit-reset");
    if (!response.ok) await fail(response);
    const data = await response.json();
    if (Array.isArray(data)) items.push(...data);
    pages += 1;
    const next = nextLink(response.headers.get("Link"));
    if (next && pages >= maxPages) {
      truncated = true;
      url = null;
    } else {
      url = next;
    }
  }
  return { items, remaining, reset, truncated };
}

function repoPath(path) {
  return `${API}/repos/${REPO.owner}/${REPO.repo}${path}`;
}

export async function loadBoard({ token } = {}) {
  const issuesResult = await fetchPaged(
    `/repos/${REPO.owner}/${REPO.repo}/issues?state=open&per_page=100&sort=updated&direction=desc`,
    { token, maxPages: ISSUE_PAGE_CAP },
  );
  const issues = issuesResult.items.filter((item) => !item.pull_request).map(normalizeIssue);
  let comments = [];
  let commentsFailed = false;
  let remaining = issuesResult.remaining;
  let reset = issuesResult.reset;
  let truncated = issuesResult.truncated;
  if (issues.length) {
    try {
      const commentsResult = await fetchPaged(
        `/repos/${REPO.owner}/${REPO.repo}/issues/comments?per_page=100&sort=updated&direction=desc`,
        { token, maxPages: COMMENT_PAGE_CAP },
      );
      comments = commentsResult.items.map(normalizeComment).filter((comment) => comment.issueNumber);
      remaining = commentsResult.remaining;
      reset = commentsResult.reset;
      truncated = truncated || commentsResult.truncated;
    } catch (error) {
      commentsFailed = true;
      if (error instanceof ApiError && error.remaining != null) {
        remaining = error.remaining;
        reset = error.reset;
      }
    }
  }
  return {
    issues,
    comments,
    commentsFailed,
    fetchedAt: Date.now(),
    rateRemaining: remaining == null ? null : Number(remaining),
    rateReset: reset == null ? null : Number(reset),
    truncated,
  };
}

export async function probeToken(token) {
  const repo = await request(repoPath(""), { token });
  if (repo.status === 401) return { ok: false, message: "Token 无效或已过期。" };
  if (repo.ok) return { ok: true, message: "可以读取这个仓库。写入会在第一次改状态时确认。" };
  if (repo.status === 404 || repo.status === 403) {
    const issues = await request(repoPath("/issues?state=open&per_page=1"), { token });
    if (issues.ok) return { ok: true, message: "可以读取议题。写入会在第一次改状态时确认。" };
    return { ok: false, message: "这个 Token 读不了本仓库的议题。请用只含此仓库 Issues 读写权限的 fine-grained token。" };
  }
  return { ok: false, message: `验证失败（${repo.status}）。` };
}

export async function patchIssue(number, payload, token) {
  const response = await request(repoPath(`/issues/${number}`), { token, method: "PATCH", body: payload });
  if (!response.ok) await fail(response);
  return normalizeIssue(await response.json());
}

export async function createIssue({ title, body, labels }, token) {
  const response = await request(repoPath("/issues"), {
    token,
    method: "POST",
    body: { title, body, labels },
  });
  if (!response.ok) await fail(response);
  return normalizeIssue(await response.json());
}

export async function createComment(number, body, token) {
  const response = await request(repoPath(`/issues/${number}/comments`), {
    token,
    method: "POST",
    body: { body },
  });
  if (!response.ok) await fail(response);
  return normalizeComment(await response.json());
}
