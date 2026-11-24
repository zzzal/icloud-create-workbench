# iCloud+ 首页到隐藏邮件地址列表的请求流程

在已登录的 Chrome 中，点击 iCloud+ 首页的「隐藏邮件地址」会打开子应用。子应用通过 XHR 发出 `GET /v2/hme/list`，Chrome 会从自己的 Cookie 存储中选取当时适用于目标主机的 Cookie，并附到请求上。一次现场对照确认，列表请求里的 `X-APPLE-WEBAUTH-VALIDATE` 来自 Apple 的会话校验响应，`X-APPLE-WEBAUTH-TOKEN` 则来自列表请求之前的一条后台响应。以下观察来自全球区 `icloud.com` 的已登录会话。

## 从首页到列表请求

1. **打开 iCloud+ 首页。** 访问 `https://www.icloud.com/icloudplus/`。页面已登录时会继续使用 Chrome 中的会话。前端根路由从 `webServices.premiummailsettings` 获得隐藏邮件地址服务，并可在首页加载时预取列表。本次在刷新首页后、点击入口前，已经看到一条成功的 `/v2/hme/list` 请求。
2. **点击「隐藏邮件地址」。** 首页调用 `loadRemoteInstance()`，在 iframe 中加载隐藏邮件地址子应用。检查到的英文版入口路径为 `applications/hidemyemail/current/en-us/index.html`。
3. **子应用初始化并请求列表。** `hmeList` 经 `premiumMailSettingsFetch` 通过 XHR 发出 `GET /v2/hme/list`。目标是账号所在分区的 `maildomainws` 主机，本次观察到的是 `p52-maildomainws.icloud.com`。点击后新增的列表请求返回了 HTTP `200`。首页预取和点击后加载都可能出现同一路径，可以根据点击时间和 Network 的 **Initiator** 区分。

## 两枚 Cookie 的来源

| 列表请求中的 Cookie | 现场对应的响应 | 值的比对结果 |
| --- | --- | --- |
| `X-APPLE-WEBAUTH-VALIDATE` | `setup.icloud.com/setup/ws/1/validate` | 列表请求发送的值与该响应 `Set-Cookie` 中的值一致。关闭并重新打开面板时，这枚 Cookie 值保持不变。 |
| `X-APPLE-WEBAUTH-TOKEN` | `feedbackws.icloud.com/reportStats` | 在一次关闭并重新打开面板的观察中，该后台请求发送的是旧值，响应 `Set-Cookie` 写入了新值，随后列表请求发送的值与新值完全一致。 |

这两枚 Cookie 的作用域都是 `icloud.com` 和 `Path=/`，可覆盖本次请求的 `maildomainws` 子域。Chrome 收到并接受 `Set-Cookie` 后更新本地存储，随后发出的符合条件的请求使用更新后的值。观察到的 `X-APPLE-WEBAUTH-TOKEN` 带有 `HttpOnly`，页面脚本无法直接读取，但由脚本发起的合规 XHR 仍可由 Chrome 携带它。 [HTTP `Set-Cookie` 属性说明](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#attributes)

首页请求的 `Cookie` 头只记录首页发出请求时携带的值。在首页加载与列表请求之间，Apple 子域的响应可以更新共享 Cookie，同一 Chrome 登录会话里的两次列表请求也可能因此携带不同的值。Apple 签发新值的条件、有效期以及哪些响应会在其他会话中改写令牌，仍未确定。

## 在 Chrome 中复查

1. 在已登录的 iCloud+ 标签页打开 DevTools 的 **Network（网络）**，开启 **Preserve log（保留日志）**，清空当前记录后刷新首页。
2. 点击「隐藏邮件地址」，按 `/v2/hme/list` 过滤。根据点击时间和 **Initiator** 定位子应用发出的新请求，确认状态码，在 **Cookies** 或 **Request Headers** 中查看实际发送的 Cookie。
3. 分别用 `set-cookie-name:X-APPLE-WEBAUTH-TOKEN` 和 `set-cookie-name:X-APPLE-WEBAUTH-VALIDATE` 筛选响应。对照列表请求发出前各候选响应的 `Set-Cookie`，在本机确认同名项的值是否相等，同时检查域和路径。记录匹配的主机、路径、状态码和相等结果即可。 [Chrome DevTools 网络筛选说明](https://developer.chrome.com/docs/devtools/network/reference/#filter-by-properties)

## cURL 验证结果

| 输入和测试步骤 | 结果 |
| --- | --- |
| 使用当时保存的首页 Cookie 请求会话校验。 | 测试中的 `GET` 和空 `POST` 都返回 HTTP `421`。应用该响应中的一条 `Set-Cookie` 后再查列表，返回 HTTP `401`。 |
| 使用一条浏览器成功列表请求中已有的 Cookie，直接请求列表。 | 当次返回 HTTP `200`，说明该请求的凭据在测试时仍有效。 |
| 使用最近一次测试时工作台保存的凭据，直接请求列表。 | 返回 HTTP `401`，错误为 `Invalid global session`，响应中没有 `Set-Cookie`。 |

目前验证成功的是使用当时仍有效的列表凭据执行只读请求。从单次首页 Cookie 快照出发，通过 cURL 获得可用列表凭据的完整流程尚未复现。

## 工作台如何跟上轮换

列表响应本身不写 Cookie。点击「隐藏邮件地址」时，下一次 `GET /v2/hme/list` 发出的 `X-APPLE-WEBAUTH-TOKEN` 来自紧挨在它前面的 `POST https://p{分区}-keyvalueservice.icloud.com/json/sync`。请求体是 `{"service-id":"appleprefs","apps":[{"app-id":"hidemyemail","registry-version":""}]}`，`Content-Type` 为 `text/plain;charset=UTF-8`。`dsid` 取自 `X-APPLE-WEBAUTH-USER` 里的 `d=`。

导入时粘贴 `https://www.icloud.com/icloudplus/` 的 cURL。每次请求 `/v2/hme/list` 之前，工作台用这份 Cookie 依次调用 `POST /setup/ws/1/validate` 和分区上的 `POST /json/sync`，合并非失败响应里的 `Set-Cookie`，再把更新后的 Cookie 发给列表。新 Cookie 会加密写回数据库。接口响应不返回 Cookie。

校验返回 `401` 或 `421` 时，不保存被清空的 Cookie。这时需要重新复制一条仍处于登录状态的首页 cURL。 [导入和更新逻辑](../src/services/accounts.js) · [iCloud HTTP 客户端](../src/icloud/client.js)
