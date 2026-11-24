import express from "express";
import path from "node:path";
import { safeEqual } from "./crypto.js";
import { clearSessionCookie, createSessionToken, readCookie, readSessionToken, sessionCookie } from "./session.js";

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendError(res, error) {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  const body = {
    error: status >= 500 ? "服务器内部错误" : error.message,
    cooldownUntil: error.cooldownUntil || null,
    accountExpired: Boolean(error.accountExpired)
  };
  if (Number.isInteger(error.remaining)) body.remaining = error.remaining;
  if (Number.isInteger(error.accountLimit)) body.accountLimit = error.accountLimit;
  if (Number.isInteger(error.currentTotal)) body.currentTotal = error.currentTotal;
  res.status(status).json(body);
}

export function createApp({ config, accounts, campaigns, inbox = null, settings = null }) {
  const app = express();
  const failures = new Map();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use(express.json({ limit: "512kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/login", (req, res) => {
    const ip = req.ip || "local";
    const now = Date.now();
    const recent = (failures.get(ip) || []).filter(time => now - time < 10 * 60_000);
    if (recent.length >= 8) {
      failures.set(ip, recent);
      res.status(429).json({ error: "登录失败次数过多，请稍后再试" });
      return;
    }
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");
    if (!safeEqual(username, config.adminUsername) || !safeEqual(password, config.adminPassword)) {
      recent.push(now);
      failures.set(ip, recent);
      res.status(401).json({ error: "用户名或密码错误" });
      return;
    }
    failures.delete(ip);
    const token = createSessionToken(config.adminUsername, config.sessionSecret);
    res.setHeader("Set-Cookie", sessionCookie(token, config));
    res.json({ username: config.adminUsername });
  });

  app.use("/api", (req, res, next) => {
    if (req.path === "/login") return next();
    const payload = readSessionToken(readCookie(req.headers.cookie), config.sessionSecret);
    if (!payload) {
      res.status(401).json({ error: "未登录" });
      return;
    }
    next();
  });

  app.post("/api/logout", (_req, res) => {
    res.setHeader("Set-Cookie", clearSessionCookie(config));
    res.json({ ok: true });
  });

  app.get("/api/me", (_req, res) => {
    res.json({ username: config.adminUsername });
  });

  app.get("/api/overview", asyncRoute(async (_req, res) => {
    res.json(accounts.summary());
  }));

  app.get("/api/settings", (_req, res) => {
    res.json(settings ? settings.get() : {
      username: config.adminUsername,
      batchLimit: config.batchLimit,
      cooldownMinutes: config.cooldownMinutes,
      targetDefault: config.targetDefault,
      accountLimit: config.accountLimit ?? 700,
      retryMinutes: config.retryMinutes
    });
  });

  app.put("/api/settings", asyncRoute(async (req, res) => {
    if (!settings) {
      res.status(404).json({ error: "设置不可用" });
      return;
    }
    res.json(settings.save(req.body || {}));
  }));

  app.get("/api/accounts", asyncRoute(async (_req, res) => {
    res.json({ accounts: accounts.listAccounts() });
  }));

  app.post("/api/accounts", asyncRoute(async (req, res) => {
    res.status(201).json({ account: await accounts.importAccount(req.body?.cookie, req.body?.region || "auto") });
  }));

  app.post("/api/accounts/:id/cookie", asyncRoute(async (req, res) => {
    res.json({ account: await accounts.updateCookie(Number(req.params.id), req.body?.cookie, req.body?.region || "auto") });
  }));

  app.post("/api/accounts/:id/check", asyncRoute(async (req, res) => {
    res.json(await accounts.checkCookie(Number(req.params.id)));
  }));

  app.post("/api/accounts/:id/sync", asyncRoute(async (req, res) => {
    res.json(await accounts.syncAddresses(Number(req.params.id)));
  }));

  app.post("/api/accounts/:id/generate", asyncRoute(async (req, res) => {
    res.json(await accounts.generate(Number(req.params.id), Number(req.body?.count), req.body?.labelPrefix));
  }));

  app.delete("/api/accounts/:id", asyncRoute(async (req, res) => {
    res.json(accounts.removeAccount(Number(req.params.id)));
  }));

  app.get("/api/addresses", asyncRoute(async (req, res) => {
    res.json(accounts.listAddresses({
      accountId: req.query.accountId,
      state: req.query.state,
      page: req.query.page,
      pageSize: req.query.pageSize
    }));
  }));

  app.get("/api/addresses.csv", asyncRoute(async (req, res) => {
    const lines = ["email,label,state,platforms,appleId,createdAt"];
    let page = 1;
    for (;;) {
      const data = accounts.listAddresses({
        accountId: req.query.accountId,
        state: req.query.state,
        page,
        pageSize: 200
      });
      for (const row of data.rows) {
        lines.push([row.email, row.label, row.state, row.platforms.join("|"), row.appleId, row.createdAt].map(csvCell).join(","));
      }
      if (page * 200 >= data.total || data.rows.length === 0) break;
      page += 1;
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(lines.join("\n"));
  }));

  app.patch("/api/addresses/:id", asyncRoute(async (req, res) => {
    res.json(accounts.setAddressState(Number(req.params.id), req.body?.state));
  }));

  app.get("/api/campaigns", asyncRoute(async (_req, res) => {
    res.json({ campaigns: campaigns.listCampaigns(), batches: accounts.listBatches(100) });
  }));

  app.get("/api/generation-details", asyncRoute(async (req, res) => {
    res.json(accounts.generationDetails(req.query.kind, req.query.id));
  }));

  app.post("/api/campaigns", asyncRoute(async (req, res) => {
    res.status(201).json({ campaign: campaigns.createCampaign(req.body || {}) });
  }));

  app.post("/api/campaigns/:id/pause", asyncRoute(async (req, res) => {
    res.json(campaigns.pauseCampaign(Number(req.params.id)));
  }));

  app.post("/api/campaigns/:id/stop", asyncRoute(async (req, res) => {
    res.json(campaigns.stopCampaign(Number(req.params.id)));
  }));

  app.post("/api/campaigns/:id/resume", asyncRoute(async (req, res) => {
    res.json(campaigns.resumeCampaign(Number(req.params.id)));
  }));

  app.delete("/api/campaigns/:id", asyncRoute(async (req, res) => {
    res.json(campaigns.deleteCampaign(Number(req.params.id)));
  }));

  if (inbox) {
    app.get("/api/inbox", asyncRoute(async (req, res) => {
      res.json(inbox.list(req.query.q));
    }));

    app.get("/api/inbox/messages", asyncRoute(async (req, res) => {
      const { email, accountId, q, page, pageSize } = req.query;
      res.json(inbox.messagesFor(email, accountId, { q, page, pageSize }));
    }));

    app.get("/api/inbox/messages/:id/html", asyncRoute(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(inbox.messageHtml(Number(req.params.id)));
    }));

    app.post("/api/inbox/random", asyncRoute(async (_req, res) => {
      res.json(inbox.claimRandom());
    }));

    app.post("/api/inbox/sync", asyncRoute(async (req, res) => {
      const accountId = req.body?.accountId ? Number(req.body.accountId) : null;
      res.json({ results: await inbox.syncAll(accountId) });
    }));

    app.post("/api/accounts/:id/imap", asyncRoute(async (req, res) => {
      res.json({ account: inbox.savePassword(Number(req.params.id), req.body || {}) });
    }));

    app.delete("/api/accounts/:id/imap", asyncRoute(async (req, res) => {
      res.json(inbox.clearPassword(Number(req.params.id)));
    }));
  }

  app.use("/api", (error, _req, res, _next) => {
    sendError(res, error);
  });

  app.use(express.static(path.resolve(process.cwd(), "public")));
  return app;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
