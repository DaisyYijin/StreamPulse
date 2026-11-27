# StreamPulse

把 **115 网盘**媒体映射成本地 STRM 文件，供 Emby / Jellyfin 原生播放。单二进制、SQLite、无外部运行时依赖，面向 Docker 与飞牛 fnOS 原生应用包（fpk）。

> 当前为 **P0 骨架**：核心同步与播放闭环已经可运行；整理、刮削、深度删除、转码代理等在后续阶段。
> 代码为独立实现，只借鉴参考项目的协议与思路，不复制其源码（115-Station 无 LICENSE、LitePan 禁商用、QMediaSync 为 GPL-3.0）。

## 已实现（P0）

| 模块 | 说明 |
|---|---|
| 115 认证 | 扫码 Cookie（token → 轮询 → sso 换 Cookie）与开放平台 DeviceCode + PKCE 双通道 |
| 节流 | 读写分离：读默认 1s、写默认 3s，串行排队，可环境变量调整 |
| 扫描 | 快速（每页 1000）/ 标准（每页 200）双模式；BFS 目录树；按扩展名与最小体积过滤 |
| 台账 | 以 `fid` 为自然键，路径为派生列；目录表以 `cid` 为键 |
| 目录改名 | `cid` 稳定、`rel_path` 变化 → 本地目录整体 rename；失败逐文件迁移 |
| STRM | pickcode 直链格式；`pick_code` / `pick_code_name`；原子写（.part + rename） |
| 附属文件 | 按后缀同步，5 路并行，原子落盘 |
| 孤儿 | 本次未见的文件只标 `orphan`，不删本地 |
| 调度 | 自研 5 段 Cron（`*`、`*/n`、`a-b`、列表），进程内去重 |
| 播放 | 独立端口 2048，`/d/{pickcode}` 302，50 分钟直链缓存；可选本机中转（Range 透传 + 401/403 换链） |
| Emby | 刷库；Emby / Jellyfin Webhook 兼容解析 |
| 管理 | PBKDF2 登录、HMAC token/Cookie、媒体库 CRUD、扫描、目录行同步、任务、二维码 PNG |
| 增量 | 115 生活事件轮询（默认 30s）：游标断点、事件去重、失败重试、单轮目录上限；首轮只建基线 |
| 深度删除 | Emby `library.deleted` → 类型白名单 + 库内路径 + 台账命中三重校验；本地 STRM/附属文件删除、空目录回收；网盘删除默认关闭（开启后进 115 回收站） |
| 部署 | Dockerfile；fnOS fpk 模板（原生二进制 + manifest + cmd 生命周期脚本） |

## 尚未实现（路线图）

- **P2**：三级匹配 + 模板引擎、YAML 分类、洗版打分、TMDB 刮削。
- **P3**：emby302 网盘转码代理、订阅/搜索、备份、多账号。
- 通知渠道（站内通知已有任务记录；外部推送未接）。
- 事件抑制：整理/扫描自身产生的 115 事件尚未打标抑制，可能出现一次多余的目录同步。
- Vue 3 前端：当前是内嵌极简管理页；Vue 工程在接入构建链后替换。
- 115 真实联调：扫码与开放平台的端点已按公开协议实现，需真实账号验证；开放平台需要自备 AppID。

## 快速开始

```bash
# 本地运行（需要 Go 1.26+）
export AUTH_PASSWORD='your-password'
export DATA_DIR=./data CONFIG_DIR=./config MEDIA_DIR=./media LOG_DIR=./logs
go run ./cmd/server
```

打开 `http://127.0.0.1:1024`，登录后：

1. 「扫码登录 115」用 115 App 扫码；开放平台为可选通道，先在「设置」里填 AppID；
2. 添加媒体库：远端 CID（`0` 为根）、本地目录、播放域名（如 `http://NAS_IP:2048`）；
3. 点「扫描」跑一次全量，STRM 会写入本地目录；Emby 配置好地址与 Key 后会自动刷库。

> 生活事件增量的首轮只记录游标（基线），不会补历史文件；**请先跑一次全量扫描**。之后手机/网页上传、离线完成等变更会在一个轮询周期内同步。

### Docker Compose（拉取 GHCR 镜像）

```bash
cp .env.example .env
# 编辑 .env：至少设置 AUTH_PASSWORD、PUBLIC_BASE、MEDIA_DIR

# GHCR 包默认私有，先登录（PAT 需 read:packages）
echo "$CR_PAT" | docker login ghcr.io -u DaisyYijin --password-stdin

docker compose pull
docker compose up -d
docker compose logs -f streampulse
```

镜像：`ghcr.io/daisyijin/streampulse:latest`，由 GitHub Actions 在 `main` 分支构建。
不想每次登录的话，可在 GitHub → Packages → streampulse → Package settings 把可见性改为 Public。

媒体目录注意：`MEDIA_DIR` 必须与 Emby 容器挂载的是**同一个宿主机路径**，否则 Emby 找不到 STRM。

### 本地构建

```bash
docker build -t streampulse .
docker run -d --name streampulse \
  -p 1024:1024 -p 2048:2048 \
  -e AUTH_PASSWORD='your-password' \
  -v ./data:/data -v ./config:/config -v /path/to/media:/media -v ./logs:/logs \
  streampulse
```

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `1024` | 管理后台 / API |
| `STREAM_PORT` | `2048` | 播放解析端口，不能与 `PORT` 相同 |
| `DATA_DIR` | `/data` | SQLite 数据库 |
| `CONFIG_DIR` | `/config` | 密钥、配置 |
| `MEDIA_DIR` | `/media` | STRM 输出根 |
| `LOG_DIR` | `/logs` | 日志 |
| `AUTH_USER` / `AUTH_PASSWORD` | `admin` / 随机 | 管理员；未设置密码时会生成并打印到日志 |
| `PUBLIC_BASE` | `http://127.0.0.1:2048` | 写进 STRM 的默认播放域名 |
| `PLAY_MODE` | `redirect` | `redirect` 302 / `proxy` 本机中转 |
| `P115_READ_INTERVAL_MS` | `1000` | 读接口最小间隔 |
| `P115_WRITE_INTERVAL_MS` | `3000` | 写接口最小间隔 |
| `INCR_ENABLED` | `true` | 是否启用生活事件增量 |
| `INCR_INTERVAL_MS` | `30000` | 生活事件轮询间隔 |

### 项目内设置（不占用环境变量）

登录后在管理页「设置」卡片填写，保存在 SQLite，保存即生效：

| 项 | 说明 |
|---|---|
| Emby 地址 / API Key | 刷库、媒体库状态探测 |
| Emby Webhook Token | 校验 Emby 回调；留空不校验 |
| 删除联动同时删网盘 | 默认关闭；开启后进 115 回收站（可还原） |
| 115 开放平台 AppID / AppSecret | 仅使用开放平台扫码时需要；不填只用扫码 Cookie |

密钥类字段留空表示不修改；要清空请调用 API 时带 `clearEmbyApiKey` 等标志。

## 飞牛 fnOS 打包

```bash
./scripts/build-fnos.sh 0.1.0
```

脚本会交叉编译 `linux/amd64` 与 `linux/arm64`，生成 `dist/fnos/streampulse-{amd64,arm64}/`，并复制 `manifest`、`cmd/`、`wizard/`、`config.yml`。安装飞牛开发者工具后，在对应目录执行 `fnpack build` 生成 `.fpk`。

fpk 采用**原生二进制**形态（与 QMediaSync 的飞牛包一致），不是 Docker 封装：`cmd/main` 直接执行 `./streampulse` 并管理 pid。

> 注意：管理端口默认 **1024** 属于 Linux 特权端口（<1024）。Docker 容器内以 root 运行没问题；fpk 若以非 root 用户启动，需要 `CAP_NET_BIND_SERVICE` 或把 `net.ipv4.ip_unprivileged_port_start` 调到 1024 以下，否则监听失败。

## 测试

```bash
go test ./...
go vet ./...
```

覆盖：存储 CRUD、115 分页/取链/扫码/开放平台、节流、扫描（含目录改名与孤儿）、STRM 原子写、302/中转、Emby、API 登录与鉴权。

## 目录

```
cmd/server          入口
internal/config     环境变量配置
internal/logx       滚动日志
internal/store      SQLite 台账
internal/pan115     115 客户端（双通道、节流）
internal/scan       扫描、改名迁移、孤儿
internal/strm       STRM 原子写与命名
internal/stream     播放端口（302 / 中转）
internal/emby       Emby 客户端与 Webhook
internal/api        管理 API + 内嵌页面
internal/scheduler  5 段 Cron
internal/p115svc    账号 → 客户端、扫描编排
deploy/fnos         飞牛 fpk 模板
docs/ARCHITECTURE.md
```

## 许可证

尚未选定。参考项目许可：115-Station 无 LICENSE（保留所有权利）、LitePan PolyForm Noncommercial、QMediaSync GPL-3.0。本项目未复制其代码。
