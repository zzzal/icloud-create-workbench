import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../src/config.js";
import { decryptSecret } from "../src/crypto.js";
import { createIcloudClient, REGION_CONFIG } from "../src/icloud/client.js";
import { parseCookieContext } from "../src/icloud/cookie.js";

class UsageError extends Error {}

function selectAccount(config, id) {
  const db = new DatabaseSync(config.databasePath, { readOnly: true });
  try {
    const accounts = db.prepare(`SELECT id, region, status, maildomain_host, cookie_encrypted
      FROM accounts WHERE status != 'deleted' ORDER BY id`).all();
    if (id === undefined && accounts.length !== 1) {
      throw new UsageError(accounts.length
        ? `请指定账号 ID。可用 ID：${accounts.map(row => row.id).join(", ")}`
        : "工作台里没有可诊断的账号。");
    }
    const account = id === undefined ? accounts[0] : accounts.find(row => row.id === Number(id));
    if (!account) throw new UsageError("指定的账号不存在。");
    return account;
  } finally {
    db.close();
  }
}

function cookiePair(part) {
  const equals = part.indexOf("=");
  if (equals < 1) return null;
  return [part.slice(0, equals).trim(), part.slice(equals + 1).trim()];
}

function cookieValues(header) {
  const cookies = new Map();
  for (const part of header.split(";")) {
    const pair = cookiePair(part);
    if (!pair) continue;
    const [name, value] = pair;
    if (!cookies.has(name)) cookies.set(name, new Set());
    cookies.get(name).add(value);
  }
  return cookies;
}

function harCookiePairs(message, headerName) {
  const headers = (message?.headers || []).filter(header => header.name?.toLowerCase() === headerName);
  const raw = headers.flatMap(header => headerName === "cookie"
    ? header.value.split(";")
    : header.value.split(/\r?\n/).map(line => line.split(";", 1)[0]));
  return [
    ...(message?.cookies || []).filter(item => item.name && typeof item.value === "string").map(item => [item.name, item.value]),
    ...raw.map(cookiePair).filter(Boolean)
  ];
}

function browserRequest(entry) {
  let url;
  try {
    url = new URL(entry.request.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/^(?:[a-z0-9-]+\.)*icloud\.com(?:\.cn)?$/.test(url.hostname)) return null;
  const at = Date.parse(entry.startedDateTime);
  if (!Number.isFinite(at)) return null;
  const kind = /^www\.icloud\.com(?:\.cn)?$/.test(url.hostname) && /^\/icloudplus\/?$/.test(url.pathname) ? "home"
    : /^p\d+-maildomainws\./.test(url.hostname) && url.pathname === "/v2/hme/list" && entry.request.method === "GET" ? "list"
      : url.pathname === "/setup/ws/1/validate" ? "validate" : "other";
  const duration = entry.time;
  const receiving = entry.timings?.receive;
  const responseAt = Number.isFinite(duration) && duration >= 0
    ? at + (Number.isFinite(receiving) && receiving >= 0 ? Math.max(0, duration - receiving) : duration)
    : null;
  const received = new Map();
  for (const [name, value] of harCookiePairs(entry.request, "cookie")) {
    if (!received.has(name)) received.set(name, new Set());
    received.get(name).add(value);
  }
  return {
    kind, at, responseAt, host: url.hostname, status: Number(entry.response?.status) || 0,
    sent: received, set: harCookiePairs(entry.response, "set-cookie")
  };
}

function describeChange(before, after) {
  if (!before?.size || !after.size) return null;
  const values = [];
  let changed = 0;
  let added = 0;
  let removed = 0;
  for (const [name, current] of after) {
    const prior = before.get(name);
    const newValues = [...current].filter(value => !prior?.has(value));
    values.push(...newValues.map(value => [name, value]));
    if (!prior) added += 1;
    else if (newValues.length || prior.size !== current.size) changed += 1;
  }
  for (const name of before.keys()) {
    if (!after.has(name)) removed += 1;
  }
  return { changed, added, removed, values };
}

function traceBrowserHar(path) {
  let entries;
  try {
    entries = JSON.parse(readFileSync(path, "utf8")).log.entries;
  } catch {
    throw new UsageError("无法读取 HAR 文件，请检查本机文件路径。");
  }
  if (!Array.isArray(entries)) throw new UsageError("文件里没有 HAR 网络记录。");
  const requests = entries.map(browserRequest).filter(Boolean).sort((left, right) => left.at - right.at);
  const responses = requests.filter(request => request.responseAt !== null && request.set.length)
    .sort((left, right) => left.responseAt - right.responseAt);
  const first = requests[0]?.at || 0;
  const brief = request => ({
    ms: request.at - first, host: request.host, request: request.kind, status: request.status
  });
  let home;
  let previousList;
  const lists = [];
  for (const request of requests) {
    if (request.kind === "home") home = request;
    if (request.kind !== "list" || request.status < 200 || request.status >= 300) continue;
    const sameHost = previousList ? previousList.host === request.host : null;
    const baseline = sameHost ? previousList : home;
    const change = describeChange(baseline?.sent, request.sent);
    const matchingResponses = [];
    const matched = new Set();
    if (change) {
      for (const source of responses) {
        if (source.responseAt > request.at) break;
        if (source.at >= request.at) continue;
        let matches = 0;
        for (const [index, [name, value]] of change.values.entries()) {
          if (matched.has(index) || !source.set.some(item => item[0] === name && item[1] === value)) continue;
          matched.add(index);
          matches += 1;
        }
        if (matches) matchingResponses.push({ ...brief(source), responseMs: source.responseAt - first, matches });
      }
    }
    lists.push({
      ...brief(request), sameHostAsPreviousList: sameHost, sentCookieNames: request.sent.size,
      baseline: baseline ? { ...brief(baseline), sentCookieNames: baseline.sent.size } : null,
      difference: change ? {
        changed: change.changed, added: change.added, removed: change.removed,
        valuesWithoutObservedResponse: change.values.length - matched.size
      } : null,
      matchingResponses
    });
    previousList = request;
  }
  return {
    homeRequests: requests.filter(request => request.kind === "home").map(request => ({ ...brief(request), sentCookieNames: request.sent.size })),
    observedSetCookieResponses: requests.filter(request => request.set.length).length,
    lists
  };
}

function compareBrowserSnapshot(account, saved, encryptionKey) {
  if (process.stdin.isTTY) throw new UsageError("请通过管道传入浏览器复制的列表请求。");
  const curl = readFileSync(0, "utf8");
  const browser = parseCookieContext(curl);
  if (!browser.maildomainHost || !/\/v2\/hme\/list(?=[?\s"'])/.test(curl) || browser.region !== account.region) {
    throw new UsageError("请使用同一区域 iCloud 的隐藏邮件地址列表请求。");
  }
  const fresh = cookieValues(browser.cookie);
  if (browser.cookie === curl.trim() || ![...fresh.keys()].some(name => /^x-apple-/i.test(name))) {
    throw new UsageError("列表请求里没有可比较的 Apple Cookie，请重新复制请求。");
  }
  let changed = 0;
  let added = 0;
  let removed = 0;
  for (const [name, values] of fresh) {
    const before = saved.get(name);
    if (!before) added += 1;
    else if (before.size !== values.size || [...values].some(value => !before.has(value))) changed += 1;
  }
  for (const name of saved.keys()) {
    if (!fresh.has(name)) removed += 1;
  }
  const entries = [...fresh.keys()].sort().map(name => [name, [...fresh.get(name)].sort()]);
  const fingerprintKey = createHmac("sha256", encryptionKey).update("icloud-browser-comparison-v1").digest();
  const browserFingerprint = createHmac("sha256", fingerprintKey)
    .update(JSON.stringify([account.id, browser.maildomainHost.toLowerCase(), entries]))
    .digest("hex").slice(0, 16);
  return { sameHost: account.maildomain_host === browser.maildomainHost, changed, added, removed, browserFingerprint };
}

function responseCookies(response, sent) {
  const headers = response.headers.getSetCookie();
  let sameNameDifferentValue = 0;
  let newName = 0;
  let expired = 0;
  for (const header of headers) {
    const [cookie, ...options] = header.split(";");
    const pair = cookiePair(cookie);
    if (!pair) continue;
    const attrs = new Map(options.map(cookiePair).filter(Boolean).map(([name, value]) => [name.toLowerCase(), value]));
    const maxAge = attrs.get("max-age");
    const isExpired = /^-?\d+$/.test(maxAge) ? Number(maxAge) <= 0 : Date.parse(attrs.get("expires")) <= Date.now();
    if (isExpired) {
      expired += 1;
      continue;
    }
    const [name, value] = pair;
    if (sent.has(name)) {
      if (!sent.get(name).has(value)) sameNameDifferentValue += 1;
    } else {
      newName += 1;
    }
  }
  return { count: headers.length, sameNameDifferentValue, newName, expired };
}

async function responseResult(response) {
  const body = await response.clone().json().catch(() => null);
  const reason = [body?.reason, body?.error, body?.error?.errorMessage]
    .filter(value => typeof value === "string").join(" ");
  if (/invalid global session/i.test(reason)) return "invalid-global-session";
  if (body?.success === true) return "success";
  if (response.ok && body?.dsInfo) return "validated";
  return "other";
}

async function traceRequests(config, account, cookie, sent) {
  const region = REGION_CONFIG[account.region];
  const mailHostPattern = account.region === "china"
    ? /^p\d+-maildomainws\.icloud\.com\.cn$/i : /^p\d+-maildomainws\.icloud\.com$/i;
  const preferredHost = mailHostPattern.test(account.maildomain_host) ? account.maildomain_host.toLowerCase() : region.maildomainHost;
  const listHosts = new Set([preferredHost, region.maildomainHost]);
  const validation = new URL(region.validateUrl);
  const records = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    const isValidation = url.href === validation.href;
    if (!isValidation && (url.protocol !== "https:" || !listHosts.has(url.host) || url.pathname !== "/v2/hme/list")) {
      throw new Error("Unsupported diagnostic URL");
    }
    const trace = { host: url.hostname, request: isValidation ? "validate" : "list" };
    records.push(trace);
    try {
      const response = await originalFetch(url, { ...init, redirect: "error" });
      trace.status = response.status;
      trace.setCookie = responseCookies(response, sent);
      trace.result = await responseResult(response);
      return response;
    } catch (error) {
      const code = error.cause?.code || error.code || error.name;
      trace.result = typeof code === "string" && /^[\w-]{1,40}$/.test(code) ? code : "request-failed";
      throw error;
    }
  };

  try {
    const client = createIcloudClient({
      clientBuildNumber: config.clientBuildNumber,
      clientMasteringNumber: config.clientMasteringNumber,
      timeoutMs: 8000,
      retries: 1
    });
    await client.validateSession(cookie, account.region, preferredHost).catch(() => {});
    await client.listAddresses(cookie, account.region, preferredHost).catch(() => {});
    return records;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

try {
  const args = process.argv.slice(2);
  if (args[0] === "--trace-browser") {
    if (args.length !== 2) throw new UsageError("请在 --trace-browser 后提供一个本机 HAR 文件路径。");
    console.log(JSON.stringify(traceBrowserHar(args[1]), null, 2));
  } else {
    const compare = args.includes("--compare-browser");
    const ids = args.filter(arg => arg !== "--compare-browser");
    if (ids.length > 1 || ids.some(id => !/^[1-9]\d*$/.test(id))) {
      throw new UsageError("用法：node --env-file=.env scripts/diagnose-icloud-session.js [账号ID] [--compare-browser]");
    }
    const config = loadConfig();
    const account = selectAccount(config, ids[0]);
    if (!Object.hasOwn(REGION_CONFIG, account.region)) throw new UsageError("账号区域无效。");
    const cookie = decryptSecret(account.cookie_encrypted, config.encryptionKey);
    const sent = cookieValues(cookie);
    const report = compare ? { browserComparison: compareBrowserSnapshot(account, sent, config.encryptionKey) }
      : { requests: await traceRequests(config, account, cookie, sent) };
    console.log(JSON.stringify({ accountId: account.id, region: account.region, status: account.status, ...report }, null, 2));
  }
} catch (error) {
  console.error(error instanceof UsageError ? error.message : "诊断无法完成，请检查本地配置和数据库。");
  process.exitCode = 1;
}
