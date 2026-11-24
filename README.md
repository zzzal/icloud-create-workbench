借助 iCloud+ 生成邮箱并统一管理。

[English](README.en.md)

## 快速开始

需要 Node.js 24 或更新版本。

在项目目录运行以下命令。

```bash
npm ci
npm start
```

首次启动会生成 `.env`，并在终端打印用户名 `admin` 和随机密码。用这组凭据登录工作台。之后重启会沿用已有配置。 [打开工作台](http://127.0.0.1:4173)

也可以直接运行启动脚本。

| 启动方式 | macOS / Linux | Windows |
| --- | --- | --- |
| 本地脚本 | `./start.sh` | `start.bat` |
| Docker Compose | `./docker-up.sh` | `docker-up.bat` |

用 Docker 脚本启动时，本机需要安装 Node.js 和 Docker Compose。访问地址还是 `127.0.0.1:4173`，数据保存在项目目录的 `./data/`。

## 导入账号

1. 登录 Apple 账户，打开账号所在地区的 iCloud+ 首页。 [全球区](https://www.icloud.com/icloudplus/) · [中国大陆](https://www.icloud.com.cn/icloudplus/)
2. 在浏览器开发者工具里打开 **网络（Network）**，勾选 **保留日志（Keep log）**，再刷新首页。
3. 找到 `/icloudplus/` 的文档请求，右键选择 **复制为 cURL**。
4. 回到工作台，在 **导入凭据** 里粘贴复制的内容，点 **校验并保存**。地区可以自动识别，也可以手动选。想替换已有账号的登录凭据，就在账号列表里点 **更新凭据**。

## 管理邮箱

- 已有地址可以从 **导入凭据 → 已导入账号** 同步进来。在对应账号一行点 **同步** 即可。
- 要创建新地址，打开 **生成邮箱**，选好账号并填写总数量和每批数量。标签前缀可以留空。
- 在 **生成邮箱** 也能查看任务进度和每批结果，或暂停、继续、停止任务。同一账号同时只能有一个运行中或暂停的任务。
- **邮箱库存** 可以按使用状态或平台标签筛选，也可以导出 CSV。
- 在 **设置** 里可以调整批次大小、冷却时间、失败后的重试间隔、任务默认数量和账号库存上限。

## 接收邮件和验证码

Apple 会把发给隐藏地址的邮件转发到你指定的邮箱。先确认转发目标是你准备在工作台收信的 iCloud 邮箱。

1. 确认 Apple 账户已开启双重认证，再到 **登录和安全 → App 专用密码** 生成收信用的密码。 [Apple 支持](https://support.apple.com/zh-cn/102654)
2. 在工作台打开 **接收邮件 → 收件设置**，给对应账号填入刚生成的密码。默认使用 `imap.mail.me.com:993`，通过 TLS 连接。
3. 从指定邮箱收取验证码，支持验证码自动识别功能。

## 使用须知

请遵守账号所在地区的 iCloud 条款和当地法律。 [Apple iCloud 条款](https://www.apple.com/legal/internet-services/icloud/) · [中国大陆 iCloud 条款（云上贵州）](https://www.apple.com.cn/legal/internet-services/icloud/cn_si/gcbd-terms.html)

