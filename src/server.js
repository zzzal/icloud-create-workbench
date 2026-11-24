import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { ensureEnv, reportEnv } from "./env.js";
import { openDatabase } from "./db.js";
import { createApp } from "./http.js";
import { createIcloudClient } from "./icloud/client.js";
import { createInboxService } from "./mail/inbox.js";
import { createAccountService } from "./services/accounts.js";
import { createCampaignService } from "./services/campaigns.js";
import { createSettingsService } from "./services/settings.js";

export function buildApp(config = loadConfig()) {
  const db = openDatabase(config.databasePath);
  const client = createIcloudClient({
    clientBuildNumber: config.clientBuildNumber,
    clientMasteringNumber: config.clientMasteringNumber
  });
  const settings = createSettingsService({ db, config });
  const accounts = createAccountService({ db, config, client });
  const campaigns = createCampaignService({ db, config, accounts });
  const inbox = createInboxService({ db, config });
  const app = createApp({ config, accounts, campaigns, inbox, settings });
  return { app, config, campaigns, inbox, settings };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const prepared = ensureEnv();
    if (prepared.created || prepared.copied) reportEnv(prepared);
    process.loadEnvFile(prepared.file);
    const { app, config, campaigns, inbox } = buildApp();
    campaigns.start();
    inbox.start();
    app.listen(config.port, config.host, () => {
      console.log(`iCloud 邮箱工作台已启动：http://${config.host}:${config.port}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
