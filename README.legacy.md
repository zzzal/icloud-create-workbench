# iCloud 邮箱工作台

本地工作台，用来管理已经开通「隐藏邮件地址」的 iCloud+ 账号。它在浏览器里导入登录凭据，按批次生成iCloud邮箱，查看库存，并用 iCloud IMAP 收取验证码。

校验会话、生成地址、保留地址和列出地址都在 Node.js 里完成。邮件仍转发到原来的 iCloud 邮箱。服务只监听本机，默认地址是 `http://127.0.0.1:4173`。

## 功能

左侧依次是这六个页面：

- **概览**：账号、库存和任务的数量。
- **导入凭据**：粘贴 iCloud+ 首页的 cURL，校验通过后保存。已有账号可以更新凭据。
- **生成邮箱**：按本次数量创建任务。页面上有任务表和生成日志，每条日志可以打开固定大小的明细，查看这次生成的邮箱和各自的生成时间。
- **邮箱库存**：按平台标签筛选，分页查看，并导出 CSV。状态只有未使用和已使用，收到验证码后变为已使用。
- **接收邮件**：用 App 专用密码连接 IMAP，按iCloud邮箱归类。随机获取只发放还没有验证码、也没有被取走的地址；取走后状态仍显示未使用，直到验证码到达。
- **设置**：每批数量、成功后的冷却、默认生成数量、每个账号的邮箱上限、失败后的重试间隔。保存后立即生效。

界面里的日期是 `yyyy/mm/dd HH:mm:ss`。当天收到的邮件只显示时间。

## 环境

- Node.js 24 或更高版本
- 一个已经开通「隐藏邮件地址」并完成双重认证的 Apple ID
- 接收邮件时，还需要该 Apple ID 的 App 专用密码

## 启动

在本目录执行对应系统的脚本。第一次启动会生成 `.env`，并把管理员密码打印一次。已经存在的 `.env` 不会被覆盖。

```bash
# macOS、Linux
./start.sh

# Windows
start.bat
```

也可以手动执行：

```bash
npm install
npm start
```

启动后打开 `http://127.0.0.1:4173`，使用终端里打印的管理员账号登录。

如果本目录里还有旧的 `.env.icloud`、但没有 `.env`，启动时会把它复制为 `.env`，原文件保留。

如果访问 Apple 需要代理，启动前设置 Node.js 的 `NODE_USE_ENV_PROXY=1` 和 `HTTPS_PROXY`。

### Docker

Docker 只把端口映射到本机 `127.0.0.1:4173`。第一次启动同样会先生成 `.env`，数据库放在 `./data`。

```bash
# macOS、Linux
./docker-up.sh

# Windows
docker-up.bat
```

容器内监听 `0.0.0.0`，这样宿主机才能连上映射端口。本地脚本仍使用 `.env` 里的 `127.0.0.1`。

## 导入凭据

1. 使用已经开通「隐藏邮件地址」的 Apple ID，完成双重认证并登录。
2. 打开开发者工具，进入「网络 / Network」，勾选「保留日志 / Preserve log」。
3. 保持登录状态刷新 `https://www.icloud.com/icloudplus/`。中国区使用 `https://www.icloud.com.cn/icloudplus/`。
4. 选中文档请求 `www.icloud.com/icloudplus/`，状态是 200 或 304。
5. 右键该请求，选择「复制」→「复制为 cURL」。
6. 粘贴到「导入凭据」。校验通过后，凭据会保存到对应的 Apple ID。

## 生成邮箱

新建任务时填写四个值：

| 字段 | 含义 |
| --- | --- |
| 凭据 | 要使用的 iCloud+ 账号 |
| 生成数量 | 这一次任务要生成的个数。默认填入 100，可改为 1–700，和已有库存分开计算 |
| 每批数量 | 每一批申请 1–5 个，然后进入冷却 |
| 标签前缀 | 生成 `前缀-0001` 这种标签。只能使用字母、数字、下划线和连字符，最长 24 个字符。留空时使用 Apple ID |

数量超过该账号剩余额度时，工作台会提示还能生成多少，并填入这个数，不会创建任务。任务进行中达到上限时，任务停止，已生成的数量保留。

同一账号同时只能有一个运行或暂停的任务。成功一批后按冷却时间等待，失败后按重试间隔等待。调度大约每 5 秒检查一次到期任务。

生成日志保留当前任务状态和最近 100 批结果。失败的一批用红色标出。

## 配置

仓库里的模板是 `.env.example`。启动时如果没有 `.env`，会按这个结构自动生成，并填入管理员密码和密钥。需要时再改这些值：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址。保持本机，不要直接暴露到公网 |
| `PORT` | `4173` | 端口 |
| `ADMIN_USERNAME` | `admin` | 工作台登录名 |
| `ADMIN_PASSWORD` | 启动时生成 | 至少 10 位 |
| `SESSION_SECRET` | 启动时生成 | 登录会话签名 |
| `COOKIE_SECURE` | `false` | 只在 HTTPS 上设为 `true` |
| `DATA_ENCRYPTION_KEY` | 启动时生成 | 32 字节密钥的 base64。丢失后无法解密已保存的凭据 |
| `DATABASE_PATH` | `./data/workbench.db` | SQLite 数据库 |
| `GENERATION_BATCH_LIMIT` | `5` | 每批上限，1–5 |
| `GENERATION_COOLDOWN_MINUTES` | `60` | 一批成功后的等待时间 |
| `GENERATION_TARGET_DEFAULT` | `100` | 新建任务时填入的数量 |
| `GENERATION_ACCOUNT_LIMIT` | `700` | 每个账号的邮箱上限 |
| `GENERATION_RETRY_MINUTES` | `5` | 失败后的重试间隔 |
| `ICLOUD_CLIENT_BUILD` | `2642Build23` | 请求使用的客户端版本号 |
| `ICLOUD_CLIENT_MASTERING` | `2642Build23` | 请求使用的客户端版本号 |

页面上的「设置」会覆盖批次、冷却、默认数量、账号上限和重试间隔，并写入数据库。管理员账号仍在 `.env` 里。

## 目录

```text
public/                 页面
src/server.js           启动入口
src/http.js             登录和接口
src/db.js               SQLite 结构
src/icloud/             会话、生成、保留和列表
src/mail/               IMAP、验证码和平台标签
src/services/           账号、任务、库存和设置
test/                   不访问 Apple 的测试
.env.example           配置模板，不含密钥
package-lock.json       依赖锁定，Docker 构建使用
start.sh                macOS 和 Linux 启动
start.bat               Windows 启动
docker-up.sh            macOS 和 Linux 的 Docker 启动
docker-up.bat           Windows 的 Docker 启动
Dockerfile              容器镜像
docker-compose.yml      本机端口和数据目录
.dockerignore           镜像里不放入密钥和数据库
scripts/init-env.js     只生成本地 .env
```

更细的首页请求观察记在 [docs/icloud-hme-request-flow.md](docs/icloud-hme-request-flow.md)。

## 测试

```bash
npm test
```

测试使用假的 iCloud 客户端，不会请求 Apple，也不会读取本目录的 `.env`。

## 上传到 GitHub 之前

这些内容已经在 `.gitignore` 里，提交前仍要确认它们没有被加进去：

- `.env`：管理员密码、会话密钥和数据加密密钥
- `data/`：账号、Cookie、iCloud邮箱、验证码和邮件
- 任何 cURL、Cookie、App 专用密码或导出的 CSV

接口响应不返回 Cookie 和邮箱密码。换一台机器时需要新的 `.env`；旧数据库必须配原来的 `DATA_ENCRYPTION_KEY` 才能解密。
