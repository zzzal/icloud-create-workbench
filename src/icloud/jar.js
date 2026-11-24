/** 把浏览器 Cookie 头和 Set-Cookie 收成一份可继续发送的头。不记录值。 */
export function createCookieJar(cookieHeader = "") {
  const items = new Map();

  function canonical(name) {
    for (const key of items.keys()) {
      if (key.toLowerCase() === name.toLowerCase()) return key;
    }
    return name;
  }

  function store(name, value) {
    const key = canonical(name);
    if (key !== name) items.delete(key);
    items.set(name, value);
  }

  function load(header) {
    for (const part of String(header || "").split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      store(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
    }
  }

  function apply(setCookie) {
    const [pair, ...attrs] = String(setCookie || "").split(";").map(part => part.trim()).filter(Boolean);
    if (!pair) return;
    const eq = pair.indexOf("=");
    if (eq <= 0) return;
    const name = pair.slice(0, eq).trim();
    let value = pair.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    const attributes = new Map(attrs.map(attribute => {
      const index = attribute.indexOf("=");
      return index === -1
        ? [attribute.toLowerCase(), ""]
        : [attribute.slice(0, index).trim().toLowerCase(), attribute.slice(index + 1).trim()];
    }));
    const maxAge = attributes.get("max-age");
    if (maxAge !== undefined && maxAge !== "" && Number(maxAge) <= 0) {
      items.delete(canonical(name));
      return;
    }
    const expires = attributes.get("expires");
    if (expires) {
      const timestamp = Date.parse(expires);
      if (Number.isFinite(timestamp) && timestamp <= Date.now()) {
        items.delete(canonical(name));
        return;
      }
    }
    store(name, value);
  }

  function reset(header) {
    items.clear();
    load(header);
  }

  load(cookieHeader);
  return {
    apply,
    applyAll(cookies) {
      for (const cookie of cookies || []) apply(cookie);
    },
    reset,
    header() {
      return [...items].map(([name, value]) => `${name}=${value}`).join("; ");
    }
  };
}
