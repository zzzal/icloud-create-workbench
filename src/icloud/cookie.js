/** 从原始 Cookie、请求头或 cURL 中抽出 iCloud 会话和分区主机。 */
export function parseCookieContext(content, requestedRegion = "auto") {
  const text = String(content || "").trim();
  const normalized = text.replace(/(?:\\|\^)\s*\r?\n/g, " ");
  const regionLine = text.match(/^HIDEMYEMAIL_REGION=(global|china)\s*$/m);
  let region = regionLine ? regionLine[1] : requestedRegion;

  let maildomainHost = "";
  const hostLine = text.match(/^HIDEMYEMAIL_MAILDOMAIN_HOST=([^\s]+)\s*$/m);
  if (hostLine) maildomainHost = hostLine[1].trim();

  if (!maildomainHost) {
    const full = normalized.match(/https:\/\/(p\d+-maildomainws\.icloud\.com(?:\.cn)?)/i);
    if (full) {
      maildomainHost = full[1];
    } else {
      const shard = normalized.match(/https:\/\/(p\d+)-[^/\s'"]+\.icloud\.com(\.cn)?/i);
      if (shard) maildomainHost = `${shard[1]}-maildomainws.icloud.com${shard[2] || ""}`;
    }
  }

  if (region === "auto") {
    if (/icloud\.com\.cn/i.test(normalized)) region = "china";
    else if (/icloud\.com/i.test(normalized)) region = "global";
  }

  const encoded = text.match(/^HIDEMYEMAIL_COOKIE_BASE64=([A-Za-z0-9+/=]+)\s*$/m);
  if (encoded) {
    return {
      cookie: Buffer.from(encoded[1], "base64").toString("utf8").trim(),
      region,
      maildomainHost
    };
  }

  const cookieArg = normalized.match(/(?:^|\s)(?:-b|--cookie)\s+(?:\^?"|')(.+?)(?:\^?"|')(?=\s+-|\s*$)/is);
  if (cookieArg) {
    return {
      cookie: cookieArg[1].replaceAll('^"', '"').replaceAll('\\"', '"').trim(),
      region,
      maildomainHost
    };
  }

  const headerArg = normalized.match(/(?:-H|--header)\s+\^?(['"])\s*cookie\s*:\s*(.*?)\^?\1/is);
  if (headerArg) {
    return { cookie: headerArg[2].trim(), region, maildomainHost };
  }

  const header = normalized.match(/^\s*cookie\s*:\s*(.+?)\s*$/is);
  if (header) {
    return { cookie: header[1].trim().replace(/^['"]|['"]$/g, ""), region, maildomainHost };
  }

  return { cookie: /^curl(?:\.exe)?(?:\s|$)/i.test(text) ? "" : text, region, maildomainHost };
}
