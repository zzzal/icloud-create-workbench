# iCloud Hide My Email Workbench

Create and manage Hide My Email addresses with iCloud+.

[简体中文](README.md)

## Quick start

Requires Node.js 24 or later. Run these commands from the project directory.

```bash
npm ci
npm start
```

On first launch, the workbench creates a `.env` file and prints the username (`admin`) and a randomly generated password in the terminal. Use those credentials to sign in. Later launches reuse the existing configuration. [Open the workbench](http://127.0.0.1:4173)

You can also use one of the startup scripts.

| Startup method | macOS / Linux | Windows |
| --- | --- | --- |
| Local | `./start.sh` | `start.bat` |
| Docker Compose | `./docker-up.sh` | `docker-up.bat` |

The Docker scripts require Node.js and Docker Compose on your machine. The workbench is still available at `127.0.0.1:4173`, and data is saved in the project's `./data/` directory.

## Import an account

1. Sign in to your Apple Account and open the iCloud+ homepage for your account's region. [Global](https://www.icloud.com/icloudplus/) · [Mainland China](https://www.icloud.com.cn/icloudplus/)
2. Open the **Network** panel in your browser's developer tools. Turn on **Keep log** (also called **Preserve log**), then reload the homepage.
3. Find the `/icloudplus/` document request, right-click it, and select **Copy as cURL**.
4. In the workbench, open **Import credentials**, paste what you copied, and click **Check and save**. You can let the workbench detect the region or choose it yourself. To replace credentials for an existing account, click **Update credentials** in the account list.

## Manage email addresses

- To import existing addresses, go to **Import credentials → Imported accounts** and click **Sync** next to the account.
- To create addresses, open **Generate**, choose an account, and enter the total number of addresses and the batch size. The label prefix is optional.
- On the **Generate** page, you can also follow a task's progress, review each batch, and pause, resume, or stop a task. Each account can have only one running or paused task at a time.
- In **Inventory**, you can filter addresses by usage status or platform tag and export them as CSV.
- In **Settings**, you can change the batch size, cooldown, retry interval, default task size, and per-account address limit.

## Receive emails and verification codes

Apple forwards messages sent to your Hide My Email addresses to the mailbox you specify. Make sure that destination is the iCloud mailbox you plan to use with the workbench.

1. Make sure two-factor authentication is enabled on your Apple Account. Then go to **Sign-In and Security → App-Specific Passwords** and generate a password for mail access. [Apple Support](https://support.apple.com/en-ie/102654)
2. In the workbench, go to **Inbox → Mail settings** and enter the app-specific password for that account. The default IMAP server is `imap.mail.me.com:993` and uses TLS.
3. Fetch messages from the configured mailbox. The workbench automatically detects verification codes in incoming mail.

## Terms of use

Follow the iCloud terms for your account's region and the applicable local laws. [Apple iCloud Terms and Conditions](https://www.apple.com/legal/internet-services/icloud/) · [iCloud Terms and Conditions for Mainland China (GCBD)](https://www.apple.com/legal/internet-services/icloud/en/gcbd-terms.html)
