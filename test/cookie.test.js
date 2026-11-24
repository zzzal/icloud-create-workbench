import assert from "node:assert/strict";
import test from "node:test";
import { parseCookieContext } from "../src/icloud/cookie.js";
import { createCookieJar } from "../src/icloud/jar.js";
import { createIcloudClient } from "../src/icloud/client.js";

test("从 cURL 里抽出 Cookie 和分区主机", () => {
  const curl = `curl 'https://p68-maildomainws.icloud.com/v2/hme/list' -H 'cookie: X-APPLE-WEBAUTH-USER=abc; other=1'`;
  const parsed = parseCookieContext(curl, "auto");
  assert.equal(parsed.cookie, "X-APPLE-WEBAUTH-USER=abc; other=1");
  assert.equal(parsed.region, "global");
  assert.equal(parsed.maildomainHost, "p68-maildomainws.icloud.com");
});

test("识别中国区和 base64 Cookie", () => {
  const cookie = "X-APPLE-WEBAUTH-USER=cn";
  const text = [
    "HIDEMYEMAIL_REGION=china",
    "HIDEMYEMAIL_MAILDOMAIN_HOST=p217-maildomainws.icloud.com.cn",
    `HIDEMYEMAIL_COOKIE_BASE64=${Buffer.from(cookie).toString("base64")}`
  ].join("\n");
  const parsed = parseCookieContext(text, "auto");
  assert.equal(parsed.cookie, cookie);
  assert.equal(parsed.region, "china");
  assert.equal(parsed.maildomainHost, "p217-maildomainws.icloud.com.cn");
});

test("保留原始 Cookie 字符串", () => {
  const parsed = parseCookieContext("X-APPLE-WEBAUTH-USER=raw", "global");
  assert.equal(parsed.cookie, "X-APPLE-WEBAUTH-USER=raw");
  assert.equal(parsed.region, "global");
});

test("浏览器复制的 cURL 支持 -b，缺失 Cookie 时提示重新复制", () => {
  const curl = "curl 'https://p52-maildomainws.icloud.com/v2/hme/list?key=value' \\\n  -b 'X-APPLE-WEBAUTH-USER=fixture; pref=one' \\\n  -H 'accept: */*'";
  const parsed = parseCookieContext(curl);
  assert.equal(parsed.maildomainHost, "p52-maildomainws.icloud.com");
  assert.equal(parsed.cookie, "X-APPLE-WEBAUTH-USER=fixture; pref=one");
  assert.equal(parseCookieContext("curl 'https://p52-maildomainws.icloud.com/v2/hme/list' -H 'X-APPLE-FIXTURE: placeholder'").cookie, "");
});

test("校验列表时只向当前区域的 iCloud 邮件分区发送凭据", async t => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async url => {
    requests.push(url.hostname);
    return new Response(JSON.stringify({ success: true, result: { hmeEmails: [] } }));
  });
  const client = createIcloudClient();
  await client.listAddresses("fixture", "global", "p52-maildomainws.icloud.com.example.test");
  await client.listAddresses("fixture", "china", "p52-maildomainws.icloud.com");
  assert.deepEqual(requests, [
    "setup.icloud.com",
    "p68-keyvalueservice.icloud.com",
    "p68-maildomainws.icloud.com",
    "setup.icloud.com.cn",
    "p217-keyvalueservice.icloud.com.cn",
    "p217-maildomainws.icloud.com.cn"
  ]);
});

test("首页 cURL 抽出 Cookie，分区留到校验时再确定", () => {
  const curl = "curl --url 'https://www.icloud.com/icloudplus/' \\\n  -b 'X-APPLE-WEBAUTH-USER=\"v=1:s=0:d=1\"; X-APPLE-WEBAUTH-TOKEN=home'";
  const parsed = parseCookieContext(curl);
  assert.equal(parsed.region, "global");
  assert.equal(parsed.maildomainHost, "");
  assert.match(parsed.cookie, /X-APPLE-WEBAUTH-TOKEN=home/);
});

test("过期的 Set-Cookie 会删掉同名项", () => {
  const jar = createCookieJar("X-APPLE-WEBAUTH-TOKEN=stale; X-APPLE-WEBAUTH-USER=v=1:s=1:d=1");
  jar.apply("X-APPLE-WEBAUTH-TOKEN=gone; Max-Age=0; Path=/");
  assert.equal(jar.header(), "X-APPLE-WEBAUTH-USER=v=1:s=1:d=1");
});

test("列表前同步 iCloud 邮箱偏好，并用响应里的新 TOKEN 请求列表", async t => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push({
      host: url.hostname,
      path: url.pathname,
      method: init.method,
      cookie: init.headers.Cookie,
      body: init.body,
      type: init.headers["Content-Type"],
      dsid: url.searchParams.get("dsid")
    });
    if (url.pathname.endsWith("/validate")) {
      return new Response(JSON.stringify({
        dsInfo: { dsid: 123, isHideMyEmailFeatureAvailable: true },
        userPartition: 52
      }), { status: 200 });
    }
    if (url.pathname === "/json/sync") {
      const headers = new Headers();
      headers.append("set-cookie", "X-APPLE-WEBAUTH-TOKEN=rotated; Domain=icloud.com; Path=/; HttpOnly");
      return new Response("{}", { status: 200, headers });
    }
    const headers = new Headers();
    headers.append("set-cookie", "X-APPLE-WEBAUTH-TOKEN=after-list; Domain=icloud.com; Path=/; HttpOnly");
    return new Response(JSON.stringify({ success: true, result: { hmeEmails: [] } }), { status: 200, headers });
  });
  const client = createIcloudClient();
  const result = await client.listAddresses(
    "X-APPLE-WEBAUTH-USER=v=1:s=1:d=123; X-APPLE-WEBAUTH-TOKEN=stale",
    "global",
    "p52-maildomainws.icloud.com"
  );
  assert.equal(seen[0].host, "setup.icloud.com");
  assert.equal(seen[0].path, "/setup/ws/1/validate");
  assert.match(seen[0].cookie, /X-APPLE-WEBAUTH-TOKEN=stale/);
  assert.equal(seen[1].host, "p52-keyvalueservice.icloud.com");
  assert.equal(seen[1].method, "POST");
  assert.equal(seen[1].type, "text/plain;charset=UTF-8");
  assert.equal(seen[1].dsid, "123");
  assert.equal(seen[1].body, JSON.stringify({
    "service-id": "appleprefs",
    apps: [{ "app-id": "hidemyemail", "registry-version": "" }]
  }));
  assert.equal(seen[2].host, "p52-maildomainws.icloud.com");
  assert.equal(seen[2].path, "/v2/hme/list");
  assert.equal(seen[2].dsid, "123");
  assert.match(seen[2].cookie, /X-APPLE-WEBAUTH-TOKEN=rotated/);
  assert.doesNotMatch(seen[2].cookie, /X-APPLE-WEBAUTH-TOKEN=stale/);
  assert.match(result.cookie, /X-APPLE-WEBAUTH-TOKEN=after-list/);
  assert.equal(JSON.stringify(result.addresses).includes("rotated"), false);
});

test("会话校验改为 POST，并带回 Set-Cookie 后的凭据", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(url.searchParams.get("clientBuildNumber"), "2642Build23");
    assert.equal(url.searchParams.get("clientMasteringNumber"), "2642Build23");
    assert.equal(url.searchParams.get("clientId").length, 36);
    const headers = new Headers();
    headers.append("set-cookie", "X-APPLE-WEBAUTH-VALIDATE=fresh; Domain=icloud.com; Path=/; HttpOnly");
    headers.append("set-cookie", "X-APPLE-WEBAUTH-TOKEN=from-validate; Domain=icloud.com; Path=/; HttpOnly");
    return new Response(JSON.stringify({
      dsInfo: { appleId: "ada@icloud.com", dsid: 42, fullName: "Ada", isHideMyEmailFeatureAvailable: true },
      userPartition: 52
    }), { status: 200, headers });
  });
  const client = createIcloudClient();
  const result = await client.validateSession("X-APPLE-WEBAUTH-USER=v=1:s=1:d=42; X-APPLE-WEBAUTH-TOKEN=old", "global");
  assert.match(result.cookie, /X-APPLE-WEBAUTH-VALIDATE=fresh/);
  assert.match(result.cookie, /X-APPLE-WEBAUTH-TOKEN=from-validate/);
  assert.doesNotMatch(result.cookie, /X-APPLE-WEBAUTH-TOKEN=old/);
  assert.equal(result.maildomainHost, "p52-maildomainws.icloud.com");
  assert.equal(JSON.stringify({ appleId: result.appleId, dsid: result.dsid }).includes("from-validate"), false);
});
