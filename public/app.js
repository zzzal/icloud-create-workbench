import { currentLocale, explicitLocale, setLocale, subscribeLocale, t } from "./i18n.js";

const app = document.querySelector("#app");
const state = {
  tab: "overview",
  notice: "",
  noticeTone: "info",
  username: "",
  accounts: [],
  credentialTarget: null,
  overview: null,
  campaigns: [],
  batches: [],
  addresses: null,
  addressState: "",
  addressPage: 1,
  addressPageSize: 50,
  settingDrafts: {},
  inbox: null,
  inboxSelection: "",
  inboxHistory: null,
  inboxQuery: "",
  inboxLoadedQuery: "",
  inboxPage: 1,
  inboxFilter: "all",
  inboxSyncing: false,
  imapDrafts: {},
  imapHosts: {}
};

const pages = {
  overview: { title: "概览", icon: "grid" },
  accounts: { title: "导入凭据", icon: "key", detail: "导入并校验 iCloud+ 登录凭据，统一管理已连接的 Apple ID。" },
  campaigns: { title: "生成邮箱", icon: "plusMail", detail: "按批次生成隐藏邮件地址，查看任务进度和生成日志。" },
  addresses: { title: "邮箱库存", icon: "archive", detail: "查看已生成的iCloud邮箱，按平台标签筛选，并导出库存。" },
  inbox: { title: "接收邮件", icon: "inbox", detail: "随机获取一个未使用的iCloud邮箱，并查看、复制收到的验证码。" },
  settings: { title: "设置", icon: "settings", detail: "调整每批数量、默认生成数量、每个账号的邮箱上限、冷却和重试间隔。保存后立即生效。" }
};

const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/>',
  key: '<circle cx="8.5" cy="15.5" r="4.5"/><path d="M12 12 21 3m-5 5 3 3m0-6 2 2"/>',
  plusMail: '<path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9M3 7l9 6 3-2m4-8v6m-3-3h6"/>',
  archive: '<path d="M3 7h18v3H3z"/><path d="M5 10v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/><path d="M10 14h4"/>',
  inbox: '<path d="m3 13 2.8-7.7A2 2 0 0 1 7.7 4h8.6a2 2 0 0 1 1.9 1.3L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13h5l2 3h4l2-3h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-.7 2.2-2.2 1-2.2-.5-1.6 2.7L4 10v4l-1.7 1.6 1.6 2.7 2.2-.5 2.2 1 .7 2.2h6l.7-2.2 2.2-1 2.2.5 1.6-2.7L20 14v-4l1.7-1.6-1.6-2.7-2.2.5-2.2-1L15 3z"/>',
  cloud: '<path d="M7 18a4 4 0 1 1 .7-7.9 5.5 5.5 0 0 1 10.7 1.4A3.3 3.3 0 0 1 18 18z"/>',
  shield: '<path d="M12 22s7-3.5 7-10V5l-7-3-7 3v7c0 6.5 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m2-15a3 3 0 0 1 0 6m4 9v-2a4 4 0 0 0-3-3.9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  logout: '<path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5m-1-8h12m-4-4 4 4-4 4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5m-4.5-2a8 8 0 0 1 13.2-4L20 12M4 12l2.3 6a8 8 0 0 0 13.2-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};

const statusLabels = {
  active: "有效", expired: "已过期", running: "进行中", paused: "已暂停", completed: "已完成", stopped: "已停止",
  unused: "未使用", used: "已使用"
};
function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const generationRefreshMs = 2000;
function generationRefreshLabel() {
  return t("每 {n} 秒自动更新", { n: generationRefreshMs / 1000 });
}
const inboxRefreshMs = 5000;
const inboxPageSize = 10;
const addressPageSizes = [20, 50, 100, 200];
let inboxSearchTimer;
const inboxFilters = [
  ["all", "全部"],
  ["code", "有验证码"],
  ["waiting", "待收件"],
  ["unmatched", "未归类"]
];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.className = value;
    else if (key === "selected") node.selected = Boolean(value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  const list = Array.isArray(children) ? children.flat() : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  svg.innerHTML = iconPaths[name];
  return svg;
}

function iconTile(name, tone = "blue") {
  return el("span", { className: `icon-tile ${tone}` }, icon(name));
}

function brand() {
  return el("div", { className: "brand" }, [
    el("span", { className: "brand-mark" }, icon("cloud")),
    el("div", {}, [el("strong", {}, t("iCloud邮箱")), el("span", {}, t("iCloud+ 工作台"))])
  ]);
}

function localeControl() {
  const explicit = explicitLocale();
  return el("label", { className: "locale-switch" }, [
    el("span", { className: "visually-hidden" }, t("语言")),
    el("select", {
      "aria-label": t("语言"),
      "data-keep": "locale-switch",
      onChange: event => setLocale(event.currentTarget.value)
    }, [
      el("option", { value: "system", selected: !explicit }, t("跟随系统")),
      el("option", { value: "zh-CN", selected: explicit === "zh-CN" }, "简体中文"),
      el("option", { value: "zh-TW", selected: explicit === "zh-TW" }, "繁體中文"),
      el("option", { value: "en", selected: explicit === "en" }, "English")
    ])
  ]);
}

function formatCount(value) {
  if (value === undefined || value === null || value === "") return "—";
  return Number(value).toLocaleString(currentLocale() === "zh-TW" ? "zh-Hant" : currentLocale());
}

function navigateButton(id, label, className, iconName) {
  return el("button", {
    type: "button",
    className,
    onClick: () => navigate(id)
  }, [iconName ? icon(iconName) : null, label]);
}

async function navigate(tab) {
  state.tab = tab;
  state.notice = "";
  state.credentialTarget = null;
  try {
    await refresh();
  } catch (error) {
    showNotice(error.message, "error");
    render();
  }
  window.scrollTo(0, 0);
  document.querySelector("#page-title")?.focus({ preventScroll: true });
}

function showNotice(message, tone = "info") {
  state.notice = message;
  state.noticeTone = tone;
}

function emptyState(iconName, title, detail) {
  return el("div", { className: "empty-state" }, [
    iconTile(iconName),
    el("strong", {}, title),
    detail ? el("p", { className: "muted" }, detail) : null
  ]);
}

function tableView(headers, rows, empty, className = "") {
  return el("div", { className: `table-scroll ${className}`, tabindex: "0" }, el("table", {}, [
    el("thead", {}, el("tr", {}, headers.map(name => el("th", { scope: "col" }, name)))),
    el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { colspan: headers.length }, empty)))
  ]));
}

function panelHeading(title, action) {
  return el("div", { className: "panel-heading" }, [el("h2", {}, title), action]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    if (Number.isInteger(data.remaining)) error.remaining = data.remaining;
    if (Number.isInteger(data.accountLimit)) error.accountLimit = data.accountLimit;
    if (Number.isInteger(data.currentTotal)) error.currentTotal = data.currentTotal;
    throw error;
  }
  return data;
}

function statusPill(status) {
  const className = status === "running" ? "pill in-progress"
    : ["active", "completed", "unused"].includes(status) ? "pill"
      : status === "expired" ? "pill stop" : "pill neutral";
  const label = statusLabels[status] || status;
  return el("span", { className }, label ? t(label) : "—");
}

function renderLogin() {
  const form = el("form", {
    className: "stack login-form",
    onSubmit: async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = Object.fromEntries(new FormData(form));
      const submit = form.querySelector("button");
      submit.disabled = true;
      submit.textContent = t("正在登录…");
      try {
        state.username = (await api("/api/login", { method: "POST", body: JSON.stringify(body) })).username;
        await boot();
      } catch (error) {
        const notice = form.querySelector(".notice");
        notice.hidden = false;
        notice.textContent = t(error.message);
        submit.disabled = false;
        submit.textContent = t("登录工作台");
      }
    }
  }, [
    el("div", { className: "login-heading" }, [
      el("h1", {}, t("登录工作台")),
      el("p", { className: "muted" }, t("使用工作台管理员账号登录。"))
    ]),
    el("div", { className: "notice error", role: "alert", hidden: true }),
    field(t("用户名"), "", el("input", { name: "username", placeholder: t("输入用户名"), autocomplete: "username", required: true })),
    field(t("密码"), "", el("input", { name: "password", type: "password", placeholder: t("输入密码"), autocomplete: "current-password", required: true })),
    el("button", { className: "primary", type: "submit" }, t("登录工作台"))
  ]);
  app.replaceChildren(el("main", { className: "login" }, [
    el("div", { className: "login-visual" }, [
      el("img", { src: "/cloud-mail.webp", alt: "", width: "1020", height: "680" })
    ]),
    el("div", { className: "login-content" }, [
      el("div", { className: "login-tools" }, localeControl()),
      brand(),
      form
    ])
  ]));
}

function shell(content) {
  const { title, detail } = pages[state.tab];
  app.replaceChildren(el("div", { className: "app-frame" }, [
    el("aside", { className: "sidebar" }, [
      brand(),
      el("nav", { className: "nav", "aria-label": t("工作台导航") }, Object.entries(pages).map(([id, page]) => tabButton(id, page))),
      el("div", { className: "sidebar-footer" }, [
        el("button", { className: "logout", type: "button", onClick: logout }, [icon("logout"), t("退出登录")])
      ]),
    ]),
    el("div", { className: "workspace" }, [
      el("header", { className: "topbar" }, [
        el("div", { className: "breadcrumb" }, [
          el("span", {}, t("工作台")), icon("chevron"), el("strong", {}, t(title))
        ]),
        el("div", { className: "topbar-actions" }, [
          localeControl(),
          state.username ? el("div", { className: "profile" }, [
            el("span", { className: "avatar", "aria-hidden": "true" }, Array.from(state.username)[0].toUpperCase()),
            el("span", { className: "profile-name" }, state.username)
          ]) : null
        ])
      ]),
      el("main", { className: "main" }, [
        detail ? el("header", { className: "page-heading" }, [
          el("h1", { id: "page-title", tabindex: "-1" }, t(title)),
          el("p", { className: "muted" }, t(detail))
        ]) : null,
        state.notice ? el("div", { className: `notice ${state.noticeTone}`, role: state.noticeTone === "error" ? "alert" : "status" }, [
          icon("info"), t(state.notice)
        ]) : null,
        content
        ])
    ])
  ]));
}

function tabButton(id, page) {
  return el("button", {
    type: "button",
    "aria-current": state.tab === id ? "page" : undefined,
    onClick: () => navigate(id)
  }, [icon(page.icon), t(page.title)]);
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
    state.tab = "overview";
    state.notice = "";
    state.username = "";
    state.credentialTarget = null;
    state.inbox = null;
    state.inboxSelection = "";
    state.inboxHistory = null;
    state.inboxQuery = "";
    state.inboxLoadedQuery = "";
    state.inboxPage = 1;
    state.inboxFilter = "all";
    state.imapDrafts = {};
    state.imapHosts = {};
    state.settingDrafts = {};
    renderLogin();
  } catch (error) {
    showNotice(error.message, "error");
    render();
  }
}

function externalLink(href, label) {
  return el("a", { href, target: "_blank", rel: "noreferrer" }, label);
}

function importGuide() {
  const steps = [
    {
      title: "打开 iCloud+ 并登录",
      detail: "使用已经开通「隐藏邮件地址」的 Apple ID，并完成双重认证并登录。",
      extra: el("div", { className: "row" }, [
        externalLink("https://www.icloud.com/icloudplus/", t("打开全球区")),
        externalLink("https://www.icloud.com.cn/icloudplus/", t("打开中国区"))
      ])
    },
    {
      title: "打开网络面板",
      detail: "按 F12，macOS 也可以按 Option + Command + I。进入「网络 / Network」，勾选「保留日志 / Preserve log」。"
    },
    {
      title: "刷新 iCloud+ 首页",
      detail: "保持登录状态刷新"
    },
    {
      title: "选中首页请求",
      detail: "选中文档请求 www.icloud.com/icloudplus/，状态是 200 或 304。"
    },
    {
      title: "复制为 cURL",
      detail: "右键该请求，选择「复制」→「复制为 cURL」。"
    },
    {
      title: "粘贴并保存",
      detail: "将 cURL 粘贴到导入表单。已有账号可以点「更新凭据」。校验通过后会保存到对应 Apple ID。"
    }
  ];
  return el("section", { className: "card guide", "aria-label": t("获取登录凭据") }, [
    panelHeading(t("如何获取登录凭据")),
    el("ol", { className: "steps" }, steps.map((step, index) => el("li", {}, [
      el("span", { className: "step-no", "aria-hidden": "true" }, String(index + 1)),
      el("div", {}, [
        el("strong", {}, t(step.title)),
        el("p", {}, t(step.detail)),
        step.extra || null
      ])
    ])))
  ]);
}

function overviewPanel() {
  const overview = state.overview || { credentials: [] };
  const rows = overview.credentials.map(account => el("tr", {}, [
    el("td", {}, accountIdentity(account)),
    el("td", {}, statusPill(account.valid ? "active" : "expired")),
    el("td", {}, account.mailboxCount),
    el("td", {}, account.messageCount)
  ]));
  const metrics = [
    ["shield", "blue", "有效凭据", overview.validCount, overview.expiredCount ? t("{n} 条已过期", { n: overview.expiredCount }) : "可用于生成邮箱"],
    ["users", "violet", "已导入账号", overview.accountCount, "已导入的 Apple ID"],
    ["mail", "cyan", "iCloud邮箱", overview.mailboxCount, "生成和同步的地址"],
    ["inbox", "mint", "已收邮件", overview.messageCount, "归入iCloud邮箱的邮件"]
  ];
  const shortcuts = [
    ["campaigns", "violet", "创建任务，按批次生成地址"],
    ["inbox", "mint", "查看转发邮件和验证码"],
    ["settings", "cyan", "调整批次和冷却规则"]
  ];
  return el("div", { className: "dashboard" }, [
    el("header", { className: "hero" }, [
      el("img", { className: "hero-art", src: "/cloud-mail.webp", alt: "", width: "1020", height: "680" }),
      el("div", { className: "hero-content" }, [
        el("h1", { id: "page-title", tabindex: "-1" }, t("iCloud 邮箱")),
        el("p", {}, t("使用 iCloud+ 生成隐藏邮件地址，集中管理邮箱库存、转发邮件和验证码。")),
        el("div", { className: "row hero-actions" }, [
          navigateButton("accounts", t("导入凭据"), "primary", "plus"),
          navigateButton("campaigns", t("生成邮箱"), "hero-secondary", "plusMail")
        ])
      ])
    ]),
    el("section", { className: "metric-grid", "aria-label": t("邮箱统计") }, metrics.map(([name, tone, label, count, detail]) =>
      el("article", { className: "card metric" }, [
        el("div", { className: "metric-main" }, [
          el("div", {}, [el("p", { className: "metric-label" }, t(label)), el("p", { className: "metric-value" }, formatCount(count))]),
          iconTile(name, tone)
        ]),
        el("p", { className: "muted metric-detail" }, t(detail))
      ])
    )),
    el("div", { className: "dashboard-grid" }, [
      el("section", { className: "card data-panel credentials-panel" }, [
        panelHeading(t("凭据状态"), rows.length
          ? el("button", { type: "button", className: "small", onClick: recheckCredentials }, [icon("refresh"), t("重新检测")])
          : navigateButton("accounts", t("导入凭据"), "small subtle", "plus")),
        tableView([t("Apple ID"), t("状态"), t("邮箱"), t("邮件")], rows,
          emptyState("key", t("还没有导入凭据"), t("导入 iCloud+ 登录请求后，账号状态会显示在这里。")))
      ]),
      el("section", { className: "card shortcuts-panel" }, [
        panelHeading(t("快捷操作")),
        el("div", { className: "shortcuts" }, shortcuts.map(([id, tone, detail]) => el("button", {
          type: "button",
          className: "shortcut",
          onClick: () => navigate(id)
        }, [
          iconTile(pages[id].icon, tone),
          el("span", { className: "shortcut-copy" }, [el("strong", {}, t(pages[id].title)), el("small", {}, t(detail))]),
          icon("chevron")
        ])))
      ])
    ])
  ]);
}

function accountIdentity(account) {
  return el("div", { className: "account-identity" }, [
    el("strong", {}, account.displayName || account.appleId),
    account.displayName && account.displayName !== account.appleId ? el("div", { className: "muted" }, account.appleId) : null
  ]);
}

async function recheckCredentials() {
  const accounts = state.accounts || [];
  if (!accounts.length) return;
  showNotice("正在检测凭据…");
  render();
  try {
    for (const account of accounts) {
      await api(`/api/accounts/${account.id}/check`, { method: "POST", body: "{}" });
    }
    showNotice("凭据已重新检测", "success");
    await refresh();
  } catch (error) {
    showNotice(error.message, "error");
    render();
  }
}

function selectCredentialTarget(id) {
  state.credentialTarget = id;
  state.notice = "";
  render();
  document.querySelector("#credential-request")?.focus();
}

function accountPanel() {
  const target = state.accounts.find(account => account.id === state.credentialTarget);
  const submitLabel = target ? t("校验并更新") : t("校验并保存");
  const form = el("form", {
    className: "card stack",
    onSubmit: async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = Object.fromEntries(new FormData(form));
      const submit = form.querySelector("button[type=submit]");
      const notice = form.querySelector(".notice");
      submit.disabled = true;
      submit.textContent = t("正在校验 Apple ID 和列表…");
      notice.hidden = true;
      try {
        const url = target ? `/api/accounts/${target.id}/cookie` : "/api/accounts";
        await api(url, { method: "POST", body: JSON.stringify(body) });
        form.reset();
        if (!form.isConnected) return;
        state.credentialTarget = null;
        showNotice(target ? "凭据已更新，可以继续原任务" : "凭据校验通过，已保存", "success");
        await refresh();
      } catch (error) {
        notice.hidden = false;
        notice.textContent = t(error.message);
      } finally {
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    }
  }, [
    panelHeading(target ? t("更新凭据") : t("导入 cURL"), target ? el("button", {
      type: "button", className: "small", onClick: () => selectCredentialTarget(null)
    }, t("取消更新")) : null),
    target ? accountIdentity(target) : null,
    el("div", { className: "notice error", role: "alert", hidden: true }),
    field(t("账号区域"), "", el("select", { name: "region" }, [
      el("option", { value: "auto" }, t("自动识别区域")),
      el("option", { value: "global" }, t("全球区")),
      el("option", { value: "china" }, t("中国区"))
    ])),
    field(t("cURL 或 Cookie"), t("粘贴 iCloud+ 首页请求。每次拉列表前会自动换上所需 Cookie。"), el("textarea", {
      id: "credential-request", name: "cookie", placeholder: t("粘贴 Copy as cURL 的结果"), autocomplete: "off", spellcheck: "false", required: true
    })),
    el("button", { className: "primary", type: "submit" }, submitLabel)
  ]);

  const rows = state.accounts.map(account => el("tr", {}, [
    el("td", {}, accountIdentity(account)),
    el("td", {}, t({ global: "全球区", china: "中国区" }[account.region] || account.region)),
    el("td", {}, account.userPartition || "—"),
    el("td", {}, account.addressCount),
    el("td", {}, statusPill(account.status)),
    el("td", {}, account.cooldownUntil ? formatDateTime(account.cooldownUntil) : "—"),
    el("td", {}, el("div", { className: "row" }, [
      el("button", { type: "button", onClick: () => selectCredentialTarget(account.id) }, t("更新凭据")),
      el("button", { onClick: () => act(`/api/accounts/${account.id}/check`, "POST") }, t("检测")),
      el("button", { onClick: () => act(`/api/accounts/${account.id}/sync`, "POST") }, t("同步")),
      el("button", { onClick: () => generateNow(account) }, t("生成一批")),
      el("button", { className: "danger", onClick: () => act(`/api/accounts/${account.id}`, "DELETE") }, t("删除"))
    ]))
  ]));
  return el("div", { className: "stack" }, [
    el("div", { className: "grid" }, [form, el("section", { className: "card data-panel" }, [
      panelHeading(t("已导入账号")),
      tableView([t("Apple ID"), t("区域"), t("分区"), t("库存"), t("状态"), t("冷却至"), t("操作")], rows, emptyState("users", t("还没有账号")), "wide-table")
    ])]),
    importGuide()
  ]);
}

async function generateNow(account) {
  const count = Number(window.prompt(t("本批数量（1-5）"), "5") || "");
  if (!count) return;
  await act(`/api/accounts/${account.id}/generate`, "POST", { count, labelPrefix: account.labelPrefix });
}

function field(label, hint, control, hintAttrs = {}) {
  return el("label", { className: "field" }, [
    el("span", { className: "field-label" }, label),
    control,
    hint ? el("span", { className: "muted field-hint", ...hintAttrs }, hint) : null
  ]);
}

function generationLimits() {
  return {
    batchLimit: state.settings?.batchLimit || 5,
    targetDefault: state.settings?.targetDefault || 100,
    accountLimit: state.settings?.accountLimit || 700
  };
}

function roomForAccount(accountId) {
  const limit = generationLimits().accountLimit;
  const account = state.accounts.find(item => item.id === Number(accountId));
  const current = account?.addressCount || 0;
  return { current, limit, remaining: Math.max(0, limit - current) };
}

function quantityHint(accountId) {
  if (!state.accounts.some(item => item.id === Number(accountId))) {
    return t("本次任务要生成的数量，和已有邮箱分开计算。");
  }
  const room = roomForAccount(accountId);
  return t("本次任务要生成的数量。该账号已有 {current} 个，最多 {limit} 个，还能生成 {remaining} 个。", room);
}

function showLimitDialog(title, message) {
  document.querySelector("#quantity-dialog")?.close();
  const dialog = el("dialog", {
    id: "quantity-dialog",
    className: "notice-dialog",
    "aria-labelledby": "quantity-dialog-title",
    onClose: () => dialog.remove()
  }, [
    el("form", { method: "dialog" }, [
      el("h2", { id: "quantity-dialog-title" }, title),
      el("p", {}, message),
      el("div", { className: "row" }, [
        el("button", { className: "primary", type: "submit", autofocus: true }, t("知道了"))
      ])
    ])
  ]);
  document.body.append(dialog);
  dialog.showModal();
}

function rejectOverLimit(form, room) {
  const input = form.querySelector("[name=targetTotal]");
  if (room.remaining > 0 && input) input.value = String(room.remaining);
  const title = room.remaining > 0 ? t("生成数量超出上限") : t("已达到邮箱上限");
  const message = room.remaining > 0
    ? t("超出每个账号最多 {limit} 个邮箱。当前已有 {current} 个，还能生成 {remaining} 个，已自动填入。", room)
    : t("该账号已有 {current} 个邮箱，已达到每个账号最多 {limit} 个，不能再生成。", room);
  showLimitDialog(title, message);
}

function campaignForm() {
  const limits = generationLimits();
  const active = state.accounts.filter(item => item.status === "active");
  const options = active.map(item => el("option", { value: item.id }, item.appleId));
  return el("form", {
    className: "card stack campaign-form",
    onSubmit: async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector("button[type=submit]");
      const notice = form.querySelector(".notice");
      const body = Object.fromEntries(new FormData(form));
      body.accountId = Number(body.accountId);
      body.targetTotal = Number(body.targetTotal);
      body.batchSize = Number(body.batchSize);
      const room = roomForAccount(body.accountId);
      if (body.targetTotal > room.remaining) {
        rejectOverLimit(form, room);
        return;
      }
      submit.disabled = true;
      submit.textContent = t("正在创建…");
      notice.hidden = true;
      try {
        await api("/api/campaigns", { method: "POST", body: JSON.stringify(body) });
        form.reset();
        notice.className = "notice success";
        notice.setAttribute("role", "status");
        notice.textContent = t("生成任务已创建");
        notice.hidden = false;
        await refreshGeneration();
      } catch (error) {
        if (Number.isInteger(error.remaining)) {
          rejectOverLimit(form, {
            current: Number.isInteger(error.currentTotal) ? error.currentTotal : room.current,
            limit: Number.isInteger(error.accountLimit) ? error.accountLimit : room.limit,
            remaining: error.remaining
          });
          return;
        }
        notice.className = "notice error";
        notice.setAttribute("role", "alert");
        notice.textContent = t(error.message);
        notice.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = t("创建任务");
      }
    }
  }, [
    panelHeading(t("新建生成任务")),
    el("div", { className: "notice error", role: "alert", hidden: true }),
    field(t("凭据"), "", el("select", {
      name: "accountId",
      required: true,
      onChange: event => {
        const hint = event.currentTarget.form?.querySelector("[data-quantity-hint]");
        if (hint) hint.textContent = quantityHint(event.currentTarget.value);
      }
    }, options.length ? options : [el("option", { value: "" }, t("先导入凭据"))])),
    el("div", { className: "campaign-quantities" }, [
      field(t("生成数量"), quantityHint(active[0]?.id), el("input", { name: "targetTotal", type: "number", min: "1", max: "700", value: String(limits.targetDefault), required: true }), { "data-quantity-hint": "" }),
      field(t("每批数量"), "", el("input", { name: "batchSize", type: "number", min: "1", max: String(limits.batchLimit), value: String(limits.batchLimit), required: true }))
    ]),
    field(t("标签前缀（选填）"), "", el("input", { name: "labelPrefix", placeholder: t("留空使用账号前缀"), maxlength: "24", title: t("最多 24 个字母、数字、下划线或短横线") })),
    el("button", { className: "primary", type: "submit", disabled: !options.length }, t("创建任务"))
  ]);
}

function campaignTable() {
  const reservedAccounts = new Set(state.campaigns
    .filter(item => ["running", "paused"].includes(item.status))
    .map(item => item.accountId));
  const rows = state.campaigns.map(item => {
    const count = item.createdCount;
    const resumeBlocked = item.status === "stopped" && reservedAccounts.has(item.accountId);
    return el("tr", {}, [
      el("td", {}, item.appleId),
      el("td", {}, el("div", { className: "task-progress" }, [
        el("span", {}, `${count} / ${item.targetTotal}`),
        el("progress", { value: count, max: item.targetTotal, "aria-label": t("本次生成进度") }),
        item.batch ? el("span", { className: "batch-progress" }, t("本批 {completed} / {total}", item.batch)) : null
      ])),
      el("td", {}, statusPill(item.status)),
      el("td", {}, item.nextRunAt ? formatDateTime(item.nextRunAt) : "—"),
      el("td", {}, item.lastError ? t(item.lastError) : "—"),
      el("td", {}, el("div", { className: "row" }, [
        item.status === "running" ? el("button", {
          "data-keep": `pause-${item.id}`, title: t("当前地址处理完成后暂停"),
          onClick: () => act(`/api/campaigns/${item.id}/pause`, "POST")
        }, t("暂停")) : null,
        ["paused", "stopped"].includes(item.status) ? el("button", {
          "data-keep": `resume-${item.id}`, disabled: resumeBlocked,
          title: resumeBlocked ? t("请先停止该账号的现有任务") : undefined,
          onClick: () => act(`/api/campaigns/${item.id}/resume`, "POST")
        }, t("继续")) : null,
        ["running", "paused"].includes(item.status) ? el("button", {
          "data-keep": `stop-${item.id}`, title: t("停止后可以为此账号新建任务"),
          onClick: () => act(`/api/campaigns/${item.id}/stop`, "POST")
        }, t("停止")) : null,
        el("button", { className: "danger", "data-keep": `delete-campaign-${item.id}`, onClick: () => act(`/api/campaigns/${item.id}`, "DELETE") }, t("删除"))
      ]))
    ]);
  });
  return tableView([t("账号"), t("本次进度"), t("状态"), t("下次运行"), t("最近错误"), t("操作")], rows,
    emptyState("plusMail", t("还没有生成任务")), "wide-table");
}

function logLine(time, account, message, tone, detail) {
  return el("li", { className: tone ? `log-line ${tone}` : "log-line" }, [
    el("time", { dateTime: time }, formatDateTime(time)),
    el("span", { className: "log-account" }, account || "—"),
    el("span", { className: "log-message" }, message),
    el("button", {
      type: "button",
      className: "small log-detail",
      "aria-haspopup": "dialog",
      onClick: () => openGenerationDetail(detail)
    }, t("详情"))
  ]);
}

function generationLog() {
  const live = state.campaigns
    .filter(item => item.status === "running" || item.status === "paused" || item.lastError)
    .map(item => {
      const batch = item.batch ? t("，本批 {completed} / {total}", item.batch) : "";
      const error = item.lastError ? t("。{error}", { error: t(item.lastError) }) : "";
      const tone = item.lastError ? "error" : item.status === "running" ? "live" : "";
      return logLine(
        item.updatedAt,
        item.appleId,
        `${t(statusLabels[item.status] || item.status)} ${item.createdCount} / ${item.targetTotal}${batch}${error}`,
        tone,
        { kind: "campaign", id: item.id }
      );
    });
  const history = state.batches.map(item => logLine(
    item.createdAt,
    item.appleId,
    item.error ? t("本批 {generated}/{requested} 未完成：{error}", { generated: item.generated, requested: item.requested, error: t(item.error) }) : t("完成本批 {generated}/{requested}", item),
    item.error ? "error" : "",
    { kind: "batch", id: item.id }
  ));
  const lines = [...live, ...history];
  return lines.length
    ? el("ol", { className: "log-list" }, lines)
    : el("p", { className: "muted" }, t("还没有生成日志。开始任务后，每一批的结果会记在这里。"));
}

function logCount() {
  const live = state.campaigns.filter(item => item.status === "running" || item.status === "paused" || item.lastError).length;
  return t("{n} 条", { n: live + state.batches.length });
}

function openGenerationDetail(detail) {
  document.querySelector("#generation-detail")?.remove();
  const dialog = el("dialog", {
    id: "generation-detail",
    className: "detail-dialog",
    "aria-labelledby": "generation-detail-title",
    onClose: () => dialog.remove()
  }, [
    el("div", { className: "detail-dialog-header" }, [
      el("div", { className: "detail-dialog-heading" }, [
        el("h2", { id: "generation-detail-title" }, detail.kind === "campaign" ? t("任务明细") : t("本批明细")),
        el("p", { id: "generation-detail-summary", className: "muted" }, t("正在加载…"))
      ]),
      el("button", { type: "button", className: "small", autofocus: true, onClick: () => dialog.close() }, t("关闭"))
    ]),
    el("div", { id: "generation-detail-body", className: "detail-scroll" })
  ]);
  document.body.append(dialog);
  dialog.showModal();
  api(`/api/generation-details?kind=${encodeURIComponent(detail.kind)}&id=${encodeURIComponent(detail.id)}`)
    .then(data => {
      if (dialog.isConnected) fillGenerationDetail(dialog, data);
    })
    .catch(error => {
      if (!dialog.isConnected) return;
      dialog.querySelector("#generation-detail-summary").textContent = t("明细加载失败");
      dialog.querySelector("#generation-detail-body").replaceChildren(el("p", { className: "muted" }, t(error.message)));
    });
}

function fillGenerationDetail(dialog, data) {
  const progress = data.kind === "campaign" && Number.isInteger(data.targetTotal)
    ? `${data.generated} / ${data.targetTotal}`
    : `${data.generated} / ${data.requested}`;
  const when = data.createdAt ? formatDateTime(data.createdAt) : "";
  dialog.querySelector("#generation-detail-title").textContent = data.kind === "campaign" ? t("任务明细") : t("本批明细");
  dialog.querySelector("#generation-detail-summary").textContent = [data.appleId || "—", progress, when].filter(Boolean).join(" · ");
  const failures = (data.failures || []).filter(item => item.label || item.error !== data.error);
  const children = [];
  if (data.error) children.push(el("p", { className: "detail-failure" }, t(data.error)));
  if (failures.length) {
    children.push(el("ul", { className: "detail-list" }, failures.map(item => el("li", { className: "detail-failure" }, t(item.error || "生成失败")))));
  }
  if (data.items?.length) {
    children.push(el("ol", { className: "detail-list" }, data.items.map(item => el("li", { className: "detail-item" }, [
      el("span", { className: "detail-email" }, item.email),
      el("time", { className: "detail-time", dateTime: item.createdAt || "" }, item.createdAt ? formatDateTime(item.createdAt) : "—"),
      item.state === "used" || item.state === "unused"
        ? statusPill(item.state)
        : el("span", { className: "pill neutral" }, t("已不在库存"))
    ]))));
  } else {
    children.push(el("p", { className: "muted detail-empty" }, data.kind === "campaign" ? t("这个任务还没有生成新的邮箱。") : t("这次没有生成新的邮箱。")));
  }
  dialog.querySelector("#generation-detail-body").replaceChildren(...children);
}

function addressFilterChoices(tags = state.addresses?.tags || []) {
  return [
    ["", "全部"],
    ...tags.filter(tag => tag && tag !== "unused" && tag !== "used").map(tag => [tag, tag])
  ];
}

function addressFilterSignature(tags) {
  return addressFilterChoices(tags).map(([value, label]) => `${value}:${label}`).join("|");
}

function syncAddressFilter(select) {
  if (!select) return;
  const choices = addressFilterChoices();
  if (!choices.some(([value]) => value === state.addressState)) state.addressState = "";
  const signature = addressFilterSignature();
  if (select.getAttribute("data-options") === signature) {
    select.value = state.addressState;
    return;
  }
  select.setAttribute("data-options", signature);
  select.replaceChildren(...choices.map(([value, label]) => el("option", {
    value, selected: value === state.addressState
  }, t(label))));
}

function addressPanel() {
  const controls = el("form", {
    className: "row table-controls",
    onSubmit: event => {
      event.preventDefault();
      const next = new FormData(event.currentTarget).get("state") || "";
      if (next !== state.addressState) state.addressPage = 1;
      state.addressState = next;
      return refreshAddresses();
    }
  }, [
    el("select", {
      name: "state", id: "address-state-filter", "aria-label": t("邮箱标签"),
      "data-options": addressFilterSignature()
    }, addressFilterChoices().map(([value, label]) => el("option", { value, selected: value === state.addressState }, t(label)))),
    el("button", { type: "submit" }, t("筛选")),
    el("a", { className: "button", href: "/api/addresses.csv" }, t("导出 CSV"))
  ]);
  return el("section", { id: "address-panel", className: "card data-panel" }, [
    panelHeading(el("span", { id: "address-total" }, addressTitle()), controls),
    el("div", { id: "address-table", "data-view": addressViewKey() }, addressTable()),
    addressPagination()
  ]);
}

function addressViewKey(addresses = state.addresses, filter = state.addressState) {
  const pageSize = addresses?.pageSize || state.addressPageSize;
  return `${filter}:${addresses?.page || state.addressPage || 1}:${pageSize}:${addresses?.total ?? 0}`;
}

function changeAddressPage(page) {
  if (page === state.addressPage) return;
  state.addressPage = page;
  return refreshAddresses();
}

function changeAddressPageSize(size) {
  const next = Number(size);
  if (!addressPageSizes.includes(next) || next === state.addressPageSize) return;
  state.addressPageSize = next;
  state.addressPage = 1;
  return refreshAddresses();
}

function addressPagination() {
  const total = state.addresses?.total ?? 0;
  const pageSize = addressPageSizes.includes(state.addressPageSize) ? state.addressPageSize : 50;
  const page = state.addressPage || state.addresses?.page || 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return el("nav", { id: "address-pagination", className: "mail-pagination address-pagination", "aria-label": t("邮箱库存分页") }, [
    el("span", { className: "directory-count", role: "status" }, t("第 {page} / {pages} 页", { page, pages })),
    el("div", { className: "address-pager" }, [
      el("label", { className: "address-page-size" }, [
        t("每页数量"),
        el("select", {
          "aria-label": t("每页数量"),
          "data-keep": "address-page-size",
          onChange: event => changeAddressPageSize(event.currentTarget.value)
        }, addressPageSizes.map(size => el("option", { value: size, selected: size === pageSize }, String(size))))
      ]),
      el("button", {
        className: "small icon-button pager-prev", type: "button", disabled: page <= 1,
        "aria-label": t("上一页"), title: t("上一页"), "data-keep": "address-prev-page",
        onClick: () => changeAddressPage(page - 1)
      }, icon("chevron")),
      el("button", {
        className: "small icon-button", type: "button", disabled: page >= pages,
        "aria-label": t("下一页"), title: t("下一页"), "data-keep": "address-next-page",
        onClick: () => changeAddressPage(page + 1)
      }, icon("chevron"))
    ])
  ]);
}

function addressTagPill(tag) {
  if (!tag || tag === "unknown") return el("span", { className: "muted" }, "—");
  return statusPill(tag === "trash" ? "unused" : tag);
}

function platformTagPills(tags) {
  const list = (tags || []).filter(tag => tag && tag !== "unused" && tag !== "used");
  if (!list.length) return el("span", { className: "muted" }, "—");
  return el("span", { className: "platform-tags" }, list.map(tag => statusPill(tag)));
}

function addressTitle() {
  return t("邮箱库存（{n}）", { n: state.addresses?.total ?? 0 });
}

function addressTable() {
  const rows = (state.addresses?.rows || []).map(row => el("tr", {}, [
    el("td", {}, el("code", {}, row.email)),
    el("td", {}, platformTagPills(row.platforms)),
    el("td", {}, row.appleId),
    el("td", {}, statusPill(row.state === "used" ? "used" : "unused"))
  ]));
  return tableView([t("邮箱"), t("标签"), t("账号"), t("状态")], rows,
    emptyState("mail", state.addressState ? t("没有符合条件的邮箱") : t("库存暂无邮箱")), "wide-table");
}

function inboxPanel() {
  return el("div", { id: "inbox-page", className: "stack inbox-page" }, [
    el("div", { className: "card inbox-toolbar" }, [
      el("div", { id: "inbox-connection", className: "inbox-connection" }, inboxConnection()),
      el("div", { className: "row inbox-tools" }, [
        el("button", {
          id: "inbox-random-button", type: "button",
          onClick: () => claimRandomMailbox()
        }, [icon("mail"), t("随机获取")]),
        el("button", {
          id: "inbox-settings-button", type: "button", "aria-expanded": "false", "aria-controls": "inbox-settings",
          onClick: () => toggleInboxSettings()
        }, [icon("settings"), t("收件设置")]),
        el("button", {
          id: "inbox-sync-button", className: "primary", type: "button",
          disabled: state.inboxSyncing || !inboxAccounts().some(account => account.imapReady),
          onClick: () => syncNow()
        }, [icon("refresh"), state.inboxSyncing ? t("正在收取…") : t("立即收取")])
      ])
    ]),
    el("div", { id: "inbox-feedback", className: "notice", role: "status", hidden: true }),
    el("div", { id: "inbox-copy-status", className: "visually-hidden", role: "status" }),
    el("section", { id: "inbox-settings", className: "card stack inbox-settings", hidden: true }, [
      panelHeading(t("连接 iCloud 收件"), externalLink("https://account.apple.com/", t("打开 Apple 账户"))),
      el("p", { className: "muted imap-description" }, t("在 Apple 账户的「登录和安全」中生成 App 专用密码，填写到对应账号。收件服务通过 imap.mail.me.com 的 993 端口读取转发邮件。")),
      el("div", { id: "inbox-settings-accounts", className: "stack" }, imapAccountsContent())
    ]),
    el("div", { className: "inbox-board" }, [
      el("section", { className: "card inbox-directory", "aria-label": t("邮箱列表") }, [
        panelHeading(t("邮箱列表"), el("span", { id: "mailbox-count", className: "directory-count" }, mailboxCount())),
        el("div", { className: "inbox-search" }, [
          icon("search"),
          el("input", {
            "data-keep": "inbox-query", value: state.inboxQuery, type: "search",
            "aria-label": t("搜索邮箱、验证码、主题或正文"), placeholder: t("搜索邮箱、验证码、主题或正文"),
            onInput: event => searchInbox(event.currentTarget.value)
          })
        ]),
        el("div", { className: "inbox-filters", role: "group", "aria-label": t("筛选邮箱") },
          inboxFilters.map(([id, title]) => el("button", {
            type: "button", "data-inbox-filter": id, "aria-pressed": String(state.inboxFilter === id),
            onClick: event => {
              state.inboxFilter = id;
              for (const button of event.currentTarget.parentElement.children) {
                button.setAttribute("aria-pressed", String(button.getAttribute("data-inbox-filter") === id));
              }
              updateMailboxList();
              if (state.inboxQuery.trim()) return refreshInbox();
            }
          }, t(title)))
        ),
        el("div", { id: "mailbox-list", className: "mailbox-list" }, mailboxRows())
      ]),
      el("div", { id: "inbox-detail", className: "stack inbox-detail" }, inboxDetail())
    ])
  ]);
}

function inboxAccounts() {
  return state.inbox?.accounts || [];
}

function inboxMailboxes() {
  return state.inbox?.mailboxes || [];
}

function mailboxKey(mailbox) {
  return `${mailbox.accountId}:${mailbox.email.toLowerCase()}`;
}

function inboxConnection() {
  const configured = inboxAccounts().filter(account => account.imapReady);
  const errors = configured.filter(account => account.imapError);
  const last = configured.filter(account => !account.imapError)
    .map(account => account.imapSyncedAt || "").sort().at(-1);
  const label = !configured.length ? t("未配置收件") : errors.length ? t("收件异常") : last ? t("自动收件中") : t("等待首次同步");
  const tone = !configured.length ? "neutral" : errors.length ? "stop" : last ? "" : "in-progress";
  const detail = errors.length ? t("{n} 个账号需检查", { n: errors.length })
    : last ? t("最近同步 {time}", { time: formatInboxTime(last) })
      : configured.length ? t("已配置 {n} 个账号", { n: configured.length }) : t("使用 App 专用密码连接 iCloud");
  return [
    iconTile("inbox"),
    el("div", { className: "inbox-connection-copy" }, [
      el("strong", {}, t("iCloud 收件")),
      el("span", { className: "muted" }, detail)
    ]),
    el("span", { className: `pill ${tone}` }, label)
  ];
}

function toggleInboxSettings() {
  const panel = document.querySelector("#inbox-settings");
  panel.hidden = !panel.hidden;
  document.querySelector("#inbox-settings-button").setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) panel.scrollIntoView({ block: "nearest" });
}

function formatInboxTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  if (sameDay) {
    const pad = number => String(number).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  return formatDateTime(value);
}

function mailboxCount() {
  return t("{n} 个邮箱", { n: visibleMailboxes(inboxMailboxes(), state.inboxFilter).length });
}

function visibleMailboxes(mailboxes, filter) {
  if (filter === "code") return mailboxes.filter(item => item.latestCode);
  if (filter === "waiting") return mailboxes.filter(item => item.matched && !item.messageCount);
  if (filter === "unmatched") return mailboxes.filter(item => !item.matched);
  return mailboxes;
}

function mailboxRows() {
  const all = inboxMailboxes();
  const filtered = visibleMailboxes(all, state.inboxFilter);
  const narrowed = all.length || state.inboxLoadedQuery;
  return filtered.length ? filtered.map(mailboxButton)
    : emptyState("mail", narrowed ? t("没有符合条件的邮箱") : t("还没有iCloud邮箱"),
      narrowed ? t("可以切换筛选条件或修改关键词。") : t("生成或同步邮箱后，地址会出现在这里。"));
}

function mailboxTags(item) {
  const tags = (item.tags || []).filter(tag => tag && tag !== "unused" && tag !== "used" && tag !== "unknown");
  if (tags.length) return tags;
  if (!item.state || item.state === "unknown") return [];
  return [item.state === "trash" ? "unused" : item.state];
}

function mailboxButton(item) {
  const key = mailboxKey(item);
  const meta = [
    ...mailboxTags(item).map(addressTagPill),
    !item.matched ? el("span", {}, t("未归类")) : null,
    item.searchMatches ? el("span", {}, t("{n} 封匹配", { n: item.searchMatches })) : null
  ].filter(Boolean);
  const side = [
    item.latestCode ? el("span", { className: "code-chip" }, item.latestCode) : null
  ].filter(Boolean);
  return el("button", {
    type: "button", className: "mailbox", "data-keep": `inbox-mailbox-${key}`,
    "aria-current": key === state.inboxSelection ? "true" : undefined,
    onClick: () => openMailbox(key)
  }, [
    iconTile(item.latestCode ? "key" : "mail", item.latestCode ? "mint" : "blue"),
    el("span", { className: "mailbox-copy" }, [
      el("strong", { className: "mailbox-email", title: item.email }, item.email),
      meta.length ? el("span", { className: "muted mailbox-meta" }, meta) : null
    ]),
    side.length ? el("span", { className: "mailbox-side" }, side) : null
  ]);
}

function updateMailboxList() {
  const list = document.querySelector("#mailbox-list");
  if (!list) return;
  const focus = list.contains(document.activeElement) ? captureFocus() : null;
  const scroll = list.scrollTop;
  const rows = mailboxRows();
  list.replaceChildren(...(Array.isArray(rows) ? rows : [rows]));
  list.scrollTop = scroll;
  document.querySelector("#mailbox-count").textContent = mailboxCount();
  restoreFocus(focus);
}

function revealSelectedMailbox() {
  const list = document.querySelector("#mailbox-list");
  const button = list?.querySelector(".mailbox[aria-current=true]");
  if (!list || !button) return;
  const padding = 8;
  const listRect = list.getBoundingClientRect();
  const rowRect = button.getBoundingClientRect();
  const visibleTop = Math.max(listRect.top, padding);
  const visibleBottom = Math.min(listRect.bottom, window.innerHeight - padding);
  if (rowRect.top >= visibleTop && rowRect.bottom <= visibleBottom) return;
  if (visibleBottom - visibleTop < 24) {
    button.scrollIntoView({ block: "center", inline: "nearest" });
    return;
  }
  const delta = rowRect.height >= visibleBottom - visibleTop
    ? rowRect.top - visibleTop
    : (rowRect.top + rowRect.height / 2) - (visibleTop + visibleBottom) / 2;
  list.scrollTop += delta;
}

function searchInbox(value) {
  state.inboxQuery = value;
  state.inboxPage = 1;
  document.querySelector("#mailbox-count").textContent = t("正在搜索…");
  window.clearTimeout(inboxSearchTimer);
  inboxSearchTimer = window.setTimeout(() => refreshInbox(), 250);
}

function inboxDetail() {
  const current = inboxMailboxes().find(mailbox => mailboxKey(mailbox) === state.inboxSelection);
  if (!current) {
    return el("section", { className: "card stack receiver-card" }, [
      panelHeading(t("验证码接收")),
      state.inboxLoadedQuery ? emptyState("inbox", t("没有匹配的结果"), t("可以调整关键词或筛选条件。"))
        : emptyState("inbox", t("请选择邮箱"), t("收到转发邮件后，验证码会显示在这里。"))
    ]);
  }
  const verification = current.latestVerification
    || (current.latestCode ? { code: current.latestCode, sender: current.latestSender, receivedAt: current.latestAt } : null);
  const waiting = current.messageCount ? t("已收邮件，暂无可识别验证码") : t("等待验证码");
  const description = !current.matched ? t("这组邮件暂未匹配到已知iCloud邮箱。")
    : current.imapReady ? t("发送到此地址的验证码会自动显示在这里。")
      : t("请先在收件设置中连接此邮箱对应的 iCloud 账号。");
  return [
    el("section", { className: "card receiver-card" }, [
      el("header", { className: "receiver-heading" }, [
        el("div", { className: "receiver-identity" }, [
          el("h2", {}, current.email),
          el("p", { className: "muted receiver-meta" }, [
            el("span", { className: "receiver-account" }, [current.label ? t(current.label) : t("iCloud邮箱"), " · ", current.appleId]),
            el("span", { className: "receiver-status" }, [
              ...mailboxTags(current).map(addressTagPill),
              current.latestAt ? el("time", { className: "receiver-time", dateTime: current.latestAt }, formatInboxTime(current.latestAt)) : null
            ])
          ])
        ]),
        inboxCopyButton(current.email, t("复制邮箱"), "inbox-copy-email")
      ]),
      el("div", { className: `verification-card ${verification ? "has-code" : "awaiting-code"}` }, verification
        ? [
          el("div", { className: "verification-content" }, [
            el("div", { className: "verification-title" }, [icon("key"), t("最新验证码")]),
            el("p", { className: "code-hero" }, verification.code),
            el("p", { className: "verification-meta" }, [
              verification.sender || t("未知发件人"),
              verification.receivedAt ? ` · ${formatInboxTime(verification.receivedAt)}` : ""
            ])
          ]),
          inboxCopyButton(verification.code, t("复制验证码"), "inbox-copy-code", "primary")
        ]
        : [
          el("div", { className: "verification-content" }, [
            el("div", { className: "verification-title" }, [icon("clock"), t("验证码接收")]),
            el("strong", { className: "code-wait" }, waiting),
            el("p", { className: "muted" }, current.messageCount ? t("在下方邮件记录中查看正文。") : description)
          ]),
          !current.imapReady && !current.messageCount ? el("button", {
            className: "small", type: "button", onClick: () => {
              if (document.querySelector("#inbox-settings").hidden) toggleInboxSettings();
              else document.querySelector("#inbox-settings").scrollIntoView({ block: "nearest" });
            }
          }, t("连接收件")) : null
        ])
    ]),
    mailHistory(current)
  ];
}

function mailHistory(mailbox) {
  const history = state.inboxHistory;
  const { messages = [], total = mailbox.messageCount, page = 1, pageSize = inboxPageSize } = history || {};
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const query = mailbox.searchMatches ? state.inboxLoadedQuery : "";
  return el("section", { className: "card mail-history" }, [
    panelHeading(query ? t("邮件搜索结果") : t("邮件记录"), el("span", { className: "directory-count" }, t("{n} 封", { n: total }))),
    messages.length ? el("div", {
      className: "mail-history-list", tabindex: "0", role: "region", "aria-label": t("邮件列表"),
      "data-history-view": JSON.stringify([mailboxKey(mailbox), query, page]),
      "data-keep": "inbox-history-list"
    }, messages.map((message, index) => historyItem(message, index, mailbox, query)))
      : emptyState("mail", !history && total ? t("正在加载邮件记录") : query ? t("没有匹配的邮件") : t("暂无邮件记录")),
    pages > 1 ? el("nav", { className: "mail-pagination", "aria-label": t("邮件记录分页") }, [
      el("button", {
        className: "small", type: "button", disabled: page <= 1, "data-keep": "inbox-prev-page",
        onClick: () => pageInbox(page - 1)
      }, t("上一页")),
      el("span", { className: "directory-count", role: "status" }, t("第 {page} / {pages} 页", { page, pages })),
      el("button", {
        className: "small", type: "button", disabled: page >= pages, "data-keep": "inbox-next-page",
        onClick: () => pageInbox(page + 1)
      }, t("下一页"))
    ]) : null
  ]);
}

function matchSnippet(body, query) {
  if (!query) return null;
  const index = body.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 36);
  const end = Math.min(body.length, index + query.length + 64);
  return el("p", { className: "mail-search-preview" }, [
    start ? "…" : null, body.slice(start, index),
    el("mark", {}, body.slice(index, index + query.length)), body.slice(index + query.length, end), end < body.length ? "…" : null
  ]);
}

function historyItem(message, index, mailbox, query) {
  const key = `${mailboxKey(mailbox)}:${message.id ?? index}`;
  const hasBody = message.body || message.hasHtml;
  return el("article", { className: "mail-item" }, [
    el("div", { className: "mail-history-row" }, [
      el("div", { className: "mail-history-copy" }, [
        el("h3", {}, message.subject || t("无主题")),
        el("p", { className: "muted" }, `${message.sender || t("未知发件人")} · ${formatInboxTime(message.receivedAt)}`)
      ]),
      message.code || hasBody ? el("div", { className: "row" }, [
        message.code ? el("div", { className: "row history-code" }, [
          el("span", { className: "code-chip" }, message.code),
          inboxCopyButton(message.code, t("复制"), `inbox-copy-${key}`, "small")
        ]) : null,
        hasBody ? el("button", {
          type: "button", className: "small", "aria-haspopup": "dialog", "data-keep": `inbox-body-${key}`,
          onClick: () => openMailBody(message, `inbox-body-${key}`)
        }, t("查看邮件正文")) : null
      ]) : null
    ]),
    message.body ? matchSnippet(message.body, query) : null
  ]);
}

function plainMailBody(body, empty = t("这封邮件没有可显示的正文。")) {
  return el("div", { className: "mail-body mail-body-text", tabindex: "0", "aria-label": t("邮件正文") },
    body?.trim() ? body.split(/\r?\n[ \t]*\r?\n+/).map(paragraph => el("p", {}, paragraph))
      : el("p", { className: "muted" }, empty)
  );
}

function mailHtmlFrame(html) {
  const srcdoc = `<!doctype html><html lang="${document.documentElement.lang || "zh-CN"}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: clamp(12px, 3vw, 22px);
        color: #16233d; background: #fff;
        font: 15px/1.65 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
        overflow-wrap: anywhere;
      }
      h1, h2, h3, h4, h5, h6 { line-height: 1.3; }
      h1:first-child, h2:first-child, h3:first-child, p:first-child { margin-top: 0; }
      blockquote { margin: 1em 0; padding-inline-start: 1em; border-inline-start: 3px solid #dce6f8; }
      img { max-width: 100% !important; height: auto !important; }
      table { max-width: 100% !important; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    </style></head><body>${html}</body></html>`;
  return el("iframe", { className: "mail-html-frame", sandbox: "", title: t("邮件正文"), srcdoc });
}

async function openMailBody(message, key) {
  const subject = message.subject || t("无主题");
  const request = new AbortController();
  const content = el("div", { className: "mail-dialog-content" }, message.hasHtml
    ? el("p", { className: "mail-body muted", role: "status" }, t("正在加载正文…"))
    : plainMailBody(message.body));
  const dialog = el("dialog", {
    className: "mail-dialog", "aria-labelledby": "mail-dialog-title",
    onClose: () => {
      request.abort();
      dialog.remove();
      restoreFocus({ key });
      const list = document.querySelector(".mail-history-list");
      if (list && !list.contains(document.activeElement)) list.focus({ preventScroll: true });
    }
  }, [
    el("header", { className: "mail-dialog-header" }, [
      el("div", { className: "mail-dialog-heading" }, [
        el("h2", { id: "mail-dialog-title", title: subject }, subject),
        el("p", { className: "muted" }, `${message.sender || t("未知发件人")} · ${formatInboxTime(message.receivedAt)}`)
      ]),
      el("button", { type: "button", autofocus: true, onClick: () => dialog.close() }, t("关闭"))
    ]),
    content
  ]);
  document.querySelector("#inbox-page").append(dialog);
  dialog.showModal();
  if (message.hasHtml) {
    try {
      const { html } = await api(`/api/inbox/messages/${message.id}/html`, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)])
      });
      if (dialog.open) content.replaceChildren(html ? mailHtmlFrame(html) : plainMailBody(message.body));
    } catch {
      if (dialog.open) content.replaceChildren(plainMailBody(message.body, t("载入正文失败，重新打开邮件可重试。")));
    }
  }
}

function updateInboxDetail() {
  const container = document.querySelector("#inbox-detail");
  if (!container) return;
  const focus = container.contains(document.activeElement) ? captureFocus() : null;
  const previousList = container.querySelector(".mail-history-list");
  const scroll = previousList?.scrollTop ?? 0;
  const detail = inboxDetail();
  container.replaceChildren(...(Array.isArray(detail) ? detail : [detail]));
  const list = container.querySelector(".mail-history-list");
  if (list && list.getAttribute("data-history-view") === previousList?.getAttribute("data-history-view")) {
    list.scrollTop = scroll;
  }
  restoreFocus(focus);
  if (list && ["inbox-prev-page", "inbox-next-page"].includes(focus?.key) && !container.contains(document.activeElement)) {
    list.focus({ preventScroll: true });
  }
}

function imapAccountsContent() {
  const accounts = inboxAccounts();
  return accounts.length ? accounts.map(imapForm)
    : el("div", { className: "row" }, [
      el("p", { className: "muted" }, t("导入 iCloud+ 凭据后即可连接收件。")),
      navigateButton("accounts", t("导入凭据"), "small subtle")
    ]);
}

function imapAccountStatus(account) {
  return [
    el("span", { className: `pill ${account.imapError ? "stop" : account.imapReady ? "" : "neutral"}` },
      account.imapError ? t("同步失败") : account.imapReady ? t("已配置") : t("未配置")),
    account.imapSyncedAt ? el("span", { className: "muted" },
      `${account.imapError ? t("最近尝试") : t("最近同步")} ${formatInboxTime(account.imapSyncedAt)}`) : null,
    account.imapError ? el("p", { className: "imap-error-text" }, t(account.imapError)) : null
  ].filter(Boolean);
}

function imapForm(account) {
  const host = state.imapHosts[account.id] ?? account.imapHost ?? "imap.mail.me.com";
  return el("form", {
    className: "stack imap-form",
    onSubmit: async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector("button[type=submit]");
      const feedback = form.querySelector(".imap-form-feedback");
      const password = state.imapDrafts[account.id] || "";
      submit.disabled = true;
      feedback.hidden = true;
      try {
        await api(`/api/accounts/${account.id}/imap`, {
          method: "POST",
          body: JSON.stringify({ appPassword: password, host: state.imapHosts[account.id] || host })
        });
        delete state.imapDrafts[account.id];
        delete state.imapHosts[account.id];
        form.querySelector("input[type=password]").value = "";
        await syncNow(account.id);
      } catch (error) {
        feedback.textContent = t(error.message);
        feedback.hidden = false;
      } finally {
        submit.disabled = false;
      }
    }
  }, [
    el("div", { className: "imap-account-heading" }, [
      accountIdentity(account),
      el("div", { id: `imap-status-${account.id}`, className: "imap-status" }, imapAccountStatus(account))
    ]),
    el("div", { className: "imap-fields" }, [
      field(t("App 专用密码"), "", el("input", {
        type: "password", "data-keep": `imap-${account.id}`, autocomplete: "new-password", required: !account.imapReady,
        value: state.imapDrafts[account.id] || "", placeholder: account.imapReady ? t("留空保留当前密码") : "xxxx-xxxx-xxxx-xxxx",
        onInput: event => { state.imapDrafts[account.id] = event.currentTarget.value; }
      })),
      field(t("收件服务器"), "", el("input", {
        "data-keep": `host-${account.id}`, value: host, spellcheck: "false",
        onInput: event => { state.imapHosts[account.id] = event.currentTarget.value; }
      }))
    ]),
    el("p", { className: "notice error imap-form-feedback", role: "alert", hidden: true }),
    el("div", { className: "row" }, [
      el("button", { className: "primary", type: "submit" }, t("保存并收取")),
      account.imapReady ? el("button", {
        type: "button", "data-account-sync": "", disabled: state.inboxSyncing, onClick: () => syncNow(account.id)
      }, t("立即收取")) : null,
      account.imapReady ? el("button", { className: "danger", type: "button", onClick: () => clearImap(account.id) }, t("清除密码")) : null
    ])
  ]);
}

async function claimRandomMailbox() {
  const button = document.querySelector("#inbox-random-button");
  if (button) button.disabled = true;
  inboxFeedback("");
  try {
    const claimed = await api("/api/inbox/random", { method: "POST", body: "{}" });
    state.inboxFilter = "all";
    state.inboxQuery = "";
    state.inboxPage = 1;
    state.inboxSelection = `${claimed.accountId}:${claimed.email.toLowerCase()}`;
    state.inboxHistory = null;
    const search = document.querySelector("[data-keep=inbox-query]");
    if (search) search.value = "";
    for (const filter of document.querySelectorAll("[data-inbox-filter]")) {
      filter.setAttribute("aria-pressed", String(filter.getAttribute("data-inbox-filter") === "all"));
    }
    updateMailboxList();
    updateInboxDetail();
    const copied = await copyText(claimed.email);
    await refreshInbox();
    inboxFeedback(copied ? t("已获取 {email}，并复制到剪贴板。", { email: claimed.email }) : t("已获取 {email}。", { email: claimed.email }), "success");
    revealSelectedMailbox();
  } catch (error) {
    inboxFeedback(t(error.message), "error");
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

async function openMailbox(key) {
  if (state.inboxSelection !== key) {
    state.inboxSelection = key;
    state.inboxHistory = null;
    state.inboxPage = 1;
    updateMailboxList();
    updateInboxDetail();
  }
  if (window.matchMedia("(max-width: 700px)").matches) {
    document.querySelector("#inbox-detail")?.scrollIntoView({ block: "start" });
  }
  await refreshInbox();
}

function pageInbox(page) {
  if (page === state.inboxPage) return;
  state.inboxPage = page;
  return refreshInbox();
}

function inboxFeedback(message, tone = "info") {
  const feedback = document.querySelector("#inbox-feedback");
  if (!feedback) return;
  feedback.hidden = !message;
  feedback.className = `notice ${tone}`;
  feedback.textContent = message;
}

function updateSyncButton() {
  const button = document.querySelector("#inbox-sync-button");
  if (!button) return;
  button.disabled = state.inboxSyncing || !inboxAccounts().some(account => account.imapReady);
  button.replaceChildren(icon("refresh"), state.inboxSyncing ? t("正在收取…") : t("立即收取"));
  for (const action of document.querySelectorAll("[data-account-sync]")) action.disabled = state.inboxSyncing;
}

async function syncNow(accountId) {
  if (state.inboxSyncing) {
    await refreshInbox();
    return;
  }
  state.inboxSyncing = true;
  updateSyncButton();
  inboxFeedback("");
  try {
    const result = await api("/api/inbox/sync", { method: "POST", body: JSON.stringify(accountId ? { accountId } : {}) });
    const results = result.results || [];
    const failures = results.filter(item => item.error);
    const count = results.reduce((total, item) => total + (item.synced || 0), 0);
    if (failures.length) {
      const detail = count ? t("已收取 {count} 封，部分账号同步失败：", { count }) : t("收件失败：");
      inboxFeedback(detail + t(failures[0].error), "error");
    } else {
      inboxFeedback(count ? t("收取完成，新增 {count} 封邮件。", { count }) : t("收取完成，暂无新邮件。"), "success");
    }
  } catch (error) {
    inboxFeedback(t(error.message), "error");
  } finally {
    state.inboxSyncing = false;
    updateSyncButton();
  }
  await refreshInbox();
}

async function clearImap(accountId) {
  if (!window.confirm(t("清除后将停止收取此账号的邮件，已收邮件仍可查看。"))) return;
  try {
    await api(`/api/accounts/${accountId}/imap`, { method: "DELETE", body: "{}" });
    delete state.imapDrafts[accountId];
    delete state.imapHosts[accountId];
    await refreshInbox();
    inboxFeedback(t("已清除收件密码。"), "success");
  } catch (error) {
    inboxFeedback(t(error.message), "error");
  }
}

function inboxCopyButton(value, label, key, className = "") {
  let resetLabel;
  return el("button", {
    type: "button", className, "data-keep": key,
    onClick: async event => {
      const button = event.currentTarget;
      const copied = await copyText(value);
      const status = document.querySelector("#inbox-copy-status");
      if (status) status.textContent = copied ? t("已复制到剪贴板") : t("复制失败，可手动选择并复制");
      button.replaceChildren(icon(copied ? "check" : "info"), copied ? t("已复制") : t("复制失败"));
      window.clearTimeout(resetLabel);
      resetLabel = window.setTimeout(() => button.replaceChildren(icon("copy"), label), 1500);
    }
  }, [icon("copy"), label]);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const focused = document.activeElement;
    const area = el("textarea", { className: "clipboard-fallback", "aria-label": t("复制内容") });
    area.value = value;
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
      focused?.focus({ preventScroll: true });
    }
  }
}

function settingValue(name) {
  if (state.settingDrafts[name] !== undefined) return state.settingDrafts[name];
  const value = state.settings?.[name];
  return value === undefined || value === null ? "" : String(value);
}

function settingsPanel() {
  const settings = state.settings || {};
  const form = el("form", {
    className: "card stack settings-card",
    onSubmit: async event => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const payload = {
        batchLimit: Number(body.batchLimit),
        cooldownMinutes: Number(body.cooldownMinutes),
        targetDefault: Number(body.targetDefault),
        accountLimit: Number(body.accountLimit),
        retryMinutes: Number(body.retryMinutes)
      };
      try {
        state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
        state.settingDrafts = {};
        showNotice("设置已保存", "success");
        render();
      } catch (error) {
        state.settingDrafts = body;
        showNotice(error.message, "error");
        render();
      }
    }
  }, [
    panelHeading(t("生成规则")),
    el("div", { className: "settings-fields" }, [
      field(t("每批数量"), t("每批申请上限为 1–5 个，适用于运行中任务的下一批。"), settingInput("batchLimit", 1, 5)),
      field(t("成功后冷却（分钟）"), t("一批成功后，到下一次申请至少等待 1–1440 分钟。"), settingInput("cooldownMinutes", 1, 1440)),
      field(t("默认生成数量"), t("新建任务时填入的数量，可设为 1–700 个。"), settingInput("targetDefault", 1, 700)),
      field(t("每个账号最多邮箱"), t("每个账号的邮箱上限，可设为 1–700 个。超出时会提示还能生成多少个。"), settingInput("accountLimit", 1, 700)),
      field(t("失败后重试（分钟）"), t("生成失败后，等待 1–1440 分钟再重试。"), settingInput("retryMinutes", 1, 1440))
    ]),
    adminHint(settings.username || state.username),
    el("div", {}, el("button", { className: "primary", type: "submit" }, t("保存设置")))
  ]);
  return form;
}

function adminHint(name) {
  const text = t("管理员账号 {name} 在 .env 中配置。", { name });
  const marker = ".env";
  const index = text.indexOf(marker);
  if (index < 0) return el("p", { className: "muted field-hint" }, text);
  return el("p", { className: "muted field-hint" }, [
    text.slice(0, index),
    el("code", {}, marker),
    text.slice(index + marker.length)
  ]);
}

function settingInput(name, min, max) {
  return el("input", {
    name,
    type: "number",
    min: String(min),
    max: String(max),
    required: true,
    "data-keep": `setting-${name}`,
    value: settingValue(name),
    onInput: event => {
      state.settingDrafts[name] = event.currentTarget.value;
    }
  });
}

function generatePanel() {
  return el("div", { id: "generate-page", className: "stack" }, [
    el("div", { className: "grid" }, [
      campaignForm(),
      el("div", { className: "stack" }, [
        el("section", { id: "campaign-table", className: "card data-panel" }, [
          panelHeading(t("生成任务"), el("span", { id: "generation-refresh", className: "muted refresh-status", role: "status" }, generationRefreshLabel())),
          campaignTable()
        ]),
        el("section", { className: "card stack generation-log" }, [
          panelHeading(t("生成日志"), el("span", { id: "generation-log-count", className: "directory-count" }, logCount())),
          el("div", { id: "generation-log", className: "log-scroll", tabindex: "0", "aria-label": t("生成日志") }, generationLog())
        ])
      ])
    ])
  ]);
}

function inventoryPanel() {
  return el("div", { id: "inventory-page", className: "stack" }, [addressPanel()]);
}

function captureFocus() {
  const node = document.activeElement;
  const key = node?.getAttribute?.("data-keep");
  if (!key) return null;
  return { key, start: node.selectionStart, end: node.selectionEnd };
}

function restoreFocus(saved) {
  if (!saved) return;
  const node = document.querySelector(`[data-keep="${CSS.escape(saved.key)}"]`);
  if (!node) return;
  node.focus({ preventScroll: true });
  if (typeof saved.start === "number" && node.setSelectionRange) node.setSelectionRange(saved.start, saved.end);
}

function render() {
  if (!state.username) return;
  const focus = captureFocus();
  const panels = {
    overview: overviewPanel,
    accounts: accountPanel,
    campaigns: generatePanel,
    addresses: inventoryPanel,
    inbox: inboxPanel,
    settings: settingsPanel
  };
  shell((panels[state.tab] || overviewPanel)());
  restoreFocus(focus);
}

async function act(url, method, body) {
  try {
    await api(url, { method, body: JSON.stringify(body || {}) });
    state.notice = "";
    await refresh();
  } catch (error) {
    showNotice(error.message, "error");
    render();
  }
}

async function load() {
  const [accountData, overview] = await Promise.all([api("/api/accounts"), api("/api/overview")]);
  state.accounts = accountData.accounts;
  state.overview = overview;
  if (state.tab === "campaigns") Object.assign(state, await loadCampaigns());
  if (state.tab === "addresses") {
    const next = await loadAddresses(state.addressState);
    state.addressPage = next.addressPage;
    state.addresses = next.addresses;
  }
  if (state.tab === "settings" || state.tab === "campaigns") {
    state.settings = await api("/api/settings");
  }
  if (state.tab === "inbox") {
    Object.assign(state, await loadInbox(inboxRequest()));
  }
  render();
}

let refreshChain = Promise.resolve();

function queueRefresh(update) {
  const run = refreshChain.then(update);
  refreshChain = run.then(() => {}, () => {});
  return run;
}

function refresh() {
  return queueRefresh(load);
}

async function loadCampaigns(signal) {
  const data = await api("/api/campaigns", { signal });
  return { campaigns: data.campaigns, batches: data.batches };
}

async function loadAddresses(filter, signal) {
  const requestedPage = state.addressPage || 1;
  const requestedSize = addressPageSizes.includes(state.addressPageSize) ? state.addressPageSize : 50;
  const params = new URLSearchParams();
  if (filter) params.set("state", filter);
  params.set("page", String(requestedPage));
  params.set("pageSize", String(requestedSize));
  let addresses = await api(`/api/addresses?${params}`, { signal });
  const pageCount = Math.max(1, Math.ceil((addresses.total || 0) / (addresses.pageSize || requestedSize)));
  let addressPage = addresses.page || requestedPage;
  if (requestedPage > pageCount) {
    params.set("page", String(pageCount));
    addresses = await api(`/api/addresses?${params}`, { signal });
    addressPage = addresses.page || pageCount;
  }
  return { addresses, addressPage };
}

function updateTable(panel, table) {
  const body = panel.querySelector("tbody");
  const focus = body.contains(document.activeElement) ? captureFocus() : null;
  body.replaceWith(table.querySelector("tbody"));
  restoreFocus(focus);
}

function updateGenerationLog(page) {
  const log = page.querySelector("#generation-log");
  if (!log) return;
  const scroll = log.scrollTop;
  log.replaceChildren(generationLog());
  log.scrollTop = scroll;
  const count = page.querySelector("#generation-log-count");
  if (count) count.textContent = logCount();
}

function refreshGeneration() {
  return queueRefresh(async () => {
    const page = document.querySelector("#generate-page");
    if (state.tab !== "campaigns" || !page) return;
    const status = page.querySelector("#generation-refresh");
    try {
      const next = await loadCampaigns(AbortSignal.timeout(5000));
      if (state.tab !== "campaigns" || !page.isConnected) return;
      const campaignsChanged = JSON.stringify(state.campaigns) !== JSON.stringify(next.campaigns);
      const batchesChanged = JSON.stringify(state.batches) !== JSON.stringify(next.batches);
      Object.assign(state, next);
      if (campaignsChanged) updateTable(page.querySelector("#campaign-table"), campaignTable());
      if (campaignsChanged || batchesChanged) updateGenerationLog(page);
      if (status.textContent !== generationRefreshLabel()) status.textContent = generationRefreshLabel();
    } catch {
      if (status.textContent !== t("更新失败，正在重试")) status.textContent = t("更新失败，正在重试");
    }
  });
}

function refreshAddresses() {
  return queueRefresh(async () => {
    const page = document.querySelector("#address-panel");
    if (state.tab !== "addresses" || !page) return;
    const filter = state.addressState;
    const requestedPage = state.addressPage;
    const requestedSize = state.addressPageSize;
    try {
      const next = await loadAddresses(filter, AbortSignal.timeout(5000));
      if (state.tab !== "addresses" || state.addressState !== filter || state.addressPage !== requestedPage || state.addressPageSize !== requestedSize || !page.isConnected) return;
      const table = page.querySelector("#address-table");
      const changed = table.getAttribute("data-view") !== addressViewKey(next.addresses, filter)
        || JSON.stringify(state.addresses?.rows) !== JSON.stringify(next.addresses.rows);
      state.addressPage = next.addressPage;
      state.addresses = next.addresses;
      if (changed) {
        updateTable(table, addressTable());
        table.setAttribute("data-view", addressViewKey());
        page.querySelector("#address-pagination")?.replaceWith(addressPagination());
        page.querySelector("#address-total").textContent = addressTitle();
      }
      syncAddressFilter(page.querySelector("#address-state-filter"));
    } catch {
      // 下一轮轮询会再取库存。
    }
  });
}

let generationPollPending = false;
setInterval(async () => {
  if (!state.username || document.hidden || generationPollPending) return;
  if (state.tab !== "campaigns" && state.tab !== "addresses") return;
  generationPollPending = true;
  try {
    if (state.tab === "campaigns") await refreshGeneration();
    else await refreshAddresses();
  } finally {
    generationPollPending = false;
  }
}, generationRefreshMs);

function inboxRequest() {
  return { selection: state.inboxSelection, query: state.inboxQuery.trim(), page: state.inboxPage, filter: state.inboxFilter };
}

async function loadInbox({ selection, query, page, filter }, signal) {
  const search = query ? `?${new URLSearchParams({ q: query })}` : "";
  const inbox = await api(`/api/inbox${search}`, { signal });
  const choices = query ? visibleMailboxes(inbox.mailboxes, filter) : inbox.mailboxes;
  const selected = choices.find(item => mailboxKey(item) === selection)
    || choices.find(item => item.latestCode) || choices.find(item => item.matched) || choices[0];
  const inboxSelection = selected ? mailboxKey(selected) : "";
  let inboxHistory = null;
  if (selected?.messageCount) {
    const params = new URLSearchParams({
      email: selected.email, accountId: selected.accountId,
      page: inboxSelection === selection ? page : 1, pageSize: inboxPageSize
    });
    if (selected.searchMatches) params.set("q", query);
    inboxHistory = await api(`/api/inbox/messages?${params}`, { signal });
  }
  return { inbox, inboxSelection, inboxHistory, inboxPage: inboxHistory?.page || 1, inboxLoadedQuery: query };
}

function updateImapAccounts(previous) {
  const current = inboxAccounts();
  const settingsKey = ({ id, appleId, displayName, imapReady, imapHost }) => [id, appleId, displayName, imapReady, imapHost];
  const container = document.querySelector("#inbox-settings-accounts");
  if (JSON.stringify(previous.map(settingsKey)) !== JSON.stringify(current.map(settingsKey))) {
    const focus = container.contains(document.activeElement) ? captureFocus() : null;
    const content = imapAccountsContent();
    container.replaceChildren(...(Array.isArray(content) ? content : [content]));
    restoreFocus(focus);
    return;
  }
  current.forEach((account, index) => {
    const prior = previous[index];
    if (prior.imapError !== account.imapError || prior.imapSyncedAt !== account.imapSyncedAt) {
      container.querySelector(`#imap-status-${account.id}`).replaceChildren(...imapAccountStatus(account));
    }
  });
}

function refreshInbox() {
  return queueRefresh(async () => {
    const page = document.querySelector("#inbox-page");
    if (state.tab !== "inbox" || !page) return;
    const request = inboxRequest();
    const stillCurrent = () => {
      const current = inboxRequest();
      return state.tab === "inbox" && page.isConnected && current.query === request.query
        && current.selection === request.selection && current.page === request.page && current.filter === request.filter;
    };
    const connection = page.querySelector("#inbox-connection");
    let next;
    try {
      next = await loadInbox(request, AbortSignal.timeout(5000));
    } catch {
      if (!stillCurrent()) return;
      const status = connection.querySelector(".pill");
      status.className = "pill stop";
      status.textContent = t("页面更新失败");
      if (request.query !== state.inboxLoadedQuery) {
        page.querySelector("#mailbox-count").textContent = t("搜索更新失败");
      }
      state.inboxPage = state.inboxHistory?.page || 1;
      return;
    }
    if (!stillCurrent()) return;
    const previousAccounts = inboxAccounts();
    const previousMailbox = inboxMailboxes().find(item => mailboxKey(item) === request.selection);
    const nextMailbox = next.inbox.mailboxes.find(item => mailboxKey(item) === next.inboxSelection);
    const queryChanged = state.inboxLoadedQuery !== next.inboxLoadedQuery;
    const highlighted = page.querySelector("#mailbox-list .mailbox[aria-current=true]")?.getAttribute("data-keep") || "";
    const expectedKey = next.inboxSelection ? `inbox-mailbox-${next.inboxSelection}` : "";
    const listChanged = queryChanged || highlighted !== expectedKey || next.inboxSelection !== request.selection
      || JSON.stringify(inboxMailboxes()) !== JSON.stringify(next.inbox.mailboxes);
    const renderedEmail = page.querySelector("#inbox-detail h2")?.textContent || "";
    const detailChanged = queryChanged || renderedEmail !== (nextMailbox?.email || "")
      || JSON.stringify(previousMailbox) !== JSON.stringify(nextMailbox)
      || JSON.stringify(state.inboxHistory) !== JSON.stringify(next.inboxHistory);
    const accountsChanged = JSON.stringify(previousAccounts) !== JSON.stringify(next.inbox.accounts);
    Object.assign(state, next);
    if (listChanged) updateMailboxList();
    else page.querySelector("#mailbox-count").textContent = mailboxCount();
    if (detailChanged) updateInboxDetail();
    if (accountsChanged) {
      updateImapAccounts(previousAccounts);
      updateSyncButton();
    }
    if (accountsChanged || connection.querySelector(".pill").textContent === t("页面更新失败")) {
      connection.replaceChildren(...inboxConnection());
    }
  });
}

let inboxPollPending = false;
setInterval(async () => {
  if (!state.username || state.tab !== "inbox" || document.hidden || inboxPollPending) return;
  inboxPollPending = true;
  try {
    await refreshInbox();
  } finally {
    inboxPollPending = false;
  }
}, inboxRefreshMs);

subscribeLocale(() => {
  for (const dialog of document.querySelectorAll("dialog")) {
    if (dialog.open) dialog.close();
    dialog.remove();
  }
  if (state.username) render();
  else renderLogin();
});

async function boot() {
  try {
    state.username = (await api("/api/me")).username;
  } catch {
    renderLogin();
    return;
  }
  await refresh();
}

boot();
