# StreamPulse

把 **115 网盘**媒体映射成本地 STRM 文件，供 Emby / Jellyfin 原生播放。单二进制、SQLite、无外部运行时依赖，面向 Docker 与飞牛 fnOS 原生应用包（fpk）。

> 115 的列目录、取直链、删除使用 Go 库 `github.com/SheltonZhu/115driver`；扫码登录为自研实现（支持设备切换）。
> 代码为独立实现，只借鉴参考项目的协议与思路，不复制其源码（115-Station 无 LICENSE、LitePan 禁商用、QMediaSync 为 GPL-3.0）。

## 功能总览

| 模块 | 说明 |
|---|---|
| 115 认证 | 弹窗扫码（网页 / Android / iOS / iPad / TV / 支付宝 / 微信小程序设备切换），登录响应直接读取昵称、头像、会员；容量进度条；开放平台 DeviceCode + PKCE 可选通道（弹窗填 AppID）；只保留一个 115 账号 |
| 节流 | 调用中轴统一收口：读 1s / 写 3s / **播放取直链独立 200ms 通道**（不被后台任务饿死）；429 风控全局熔断 60s 自动恢复；设置页可调 |
| 扫描 | 快速（每页 1000）/ 标准（每页 200）双模式；BFS 目录树；按扩展名与最小体积过滤；目录改名自动迁移本地文件 |
| STRM | pickcode 直链格式；原子写；`xxx.mkv` → `xxx.strm` 命名约定，与 nfo/海报同基名配对 |
| 增量 | 115 生活事件轮询（默认 30s）：**两阶段消费**（中断不丢事件）、**直推**（带 pickcode 事件零请求写 STRM）、事件抑制（整理/删除自产事件自动跳过）、目录已删永久跳过、游标断点、单轮目录上限；全量成功后自动推游标 |
| 可观测 | 增量轮次账单（最近 50 轮）、任务队列（手动操作 202 入队 + 去重合并）、礼让锁（增量与手动任务互相让路）、115 通道状态（间隔/熔断） |
| 播放 | 独立端口 2048，`/d/{pickcode}` 302，直链缓存 50 分钟 + **singleflight 防击穿 + HEAD 失效校验**；可选本机中转 |
| **Emby 反代** | 可选端口（`EMBY_PROXY_PORT`）：拦截 PlaybackInfo 强制 DirectPlay、剥离 TranscodingUrl（客户端秒开直链、不走 NAS 转码）；拦截视频流解析 115 直链 302；**失败自动回源，播放永不 500** |
| Emby | 刷库（全量 + 增量后按库定向刷新）、Webhook 兼容解析（Emby / Jellyfin）、webhook 状态自检 |
| **刮削** | TMDB 基础刮削：每库开关，写 `movie.nfo` / `tvshow.nfo` / `poster.jpg` / `fanart.jpg` / 季海报到本地媒体目录；同步后自动触发 + 手动触发 |
| 深度删除 | Emby `library.deleted` → 类型白名单 + 库内路径 + 台账命中三重校验；本地删除 + 空目录回收；网盘删除默认关闭（开启后进 115 回收站）；**删除记录区**（fids 是回收站还原凭据 + 近 30 天统计） |
| **迁移** | **接管**：从 p115strmhelper / QMediaSync / OpenList 等工具换过来时，路径与文件名不动、只换直链（预演 + 执行，保留 Emby 条目与观看记录）；**地址批量替换**：换域名/IP 后一键改写全部 STRM |
| 备份 | 一键导出 zip（数据库快照 + 密钥）；上传恢复（校验后重启应用，先打 prerestore 备份） |
| 部署 | Dockerfile（多架构）；fnOS fpk 模板（原生二进制 + manifest + cmd 生命周期脚本）；前端 Vue 3 单文件嵌入 |

## 快速开始

```bash
# 本地运行（需要 Go 1.26+，前端已预构建嵌入）
export DATA_DIR=./data CONFIG_DIR=./config MEDIA_DIR=./media LOG_DIR=./logs
go run ./cmd/server
```

首次打开 `http://127.0.0.1:1024` 创建管理员（至少 8 位密码），然后按**上手清单**走：

1. 「账号」扫码登录 115（开放平台为可选通道，先在「设置」填 AppID）；
2. 「设置」填**播放地址**（如 `http://NAS_IP:2048`，会写进 STRM），需要刮削就填 TMDB API Key；
3. 「媒体库」添加库：远端 CID（`0` 为根）、本地目录、勾选刮削开关；
4. 「同步」跑一次全量。之后手机/网页上传、离线完成等变更会在一个轮询周期内自动同步。

> 生活事件增量的首轮只记录游标（基线），**请先跑一次全量扫描**。

### Docker Compose（拉取 GHCR 镜像）

```bash
# GHCR 包默认私有，先登录（PAT 需 read:packages）
echo "$CR_PAT" | docker login ghcr.io -u DaisyYijin --password-stdin

docker compose pull
docker compose up -d
docker compose logs -f streampulse
```

镜像：`ghcr.io/daisyyijin/streampulse:latest`，由 GitHub Actions 在 `main` 分支构建。
媒体目录固定为 compose 同级目录的 `./media`（容器内 `/media`），**Emby 必须挂载同一个宿主机目录**，否则找不到 STRM。

### 本地构建

```bash
docker build -t streampulse .
docker run -d --name streampulse \
  -p 1024:1024 -p 2048:2048 \
  -v ./data:/data -v ./config:/config -v ./media:/media -v ./logs:/logs \
  streampulse
```

### 开启 Emby 反代（可选）

```bash
docker run ... -p 1025:1025 -e EMBY_PROXY_PORT=1025 ...
```

把 Emby 客户端（Infuse / Emby Web / Fileball 等）的服务器地址指向 `http://NAS_IP:1025`，账号密码不变：

- strm 源自动强制直连，不走 NAS 转码（Infuse 秒开）；
- 反代故障自动回源 Emby，播放不中断；
- 管理后台仍走 1024 端口。

## 从其它工具迁移

1. **接管**：「迁移」页 → 预演（自动识别 p115strmhelper / QMediaSync / OpenList 等格式）→ 执行。路径与文件名不动、只换直链，Emby 条目与观看记录保留。需要先在设置页填好播放地址。
2. Emby 媒体库位置不变的话，无需任何其它操作。

## 设置项（管理页「设置」）

| 项 | 说明 |
|---|---|
| 播放地址 | 写进 STRM 的地址，如 `http://192.168.1.10:2048`；必须是播放器能访问到的 NAS 地址。修改后需重新扫描 |
| Emby 地址 / API Key | 刷库、媒体库状态探测 |
| Emby Webhook Token | 校验 Emby 回调；留空不校验 |
| 删除联动同时删网盘 | 默认关闭；开启后进 115 回收站（可在「深删记录」里凭 fids 还原） |
| TMDB API Key / 语言 | 基础刮削用；[themoviedb.org](https://www.themoviedb.org/settings/api) 免费申请 |
| 115 开放平台 AppID | 仅使用开放平台扫码时需要 |
| API 等待时间 | 115 读接口最小间隔（1–60 秒） |
| 管理员用户名 / 新密码 | 至少 8 位 |

密钥类字段留空表示不修改；清空请勾选对应 clear 选项。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `1024` | 管理后台 / API |
| `STREAM_PORT` | `2048` | 播放解析端口，不能与 `PORT` 相同 |
| `EMBY_PROXY_PORT` | 关闭 | Emby 反代端口（PlaybackInfo 直连改写） |
| `DATA_DIR` | `/data` | SQLite 数据库 |
| `CONFIG_DIR` | `/config` | 密钥、配置 |
| `MEDIA_DIR` | `/media` | STRM 输出根 |
| `LOG_DIR` | `/logs` | 日志（按天 + 大小切分，默认保留 14 天） |
| `PLAY_MODE` | `redirect` | `redirect` 302 / `proxy` 本机中转 |
| `P115_READ_INTERVAL_MS` | `1000` | 读接口最小间隔（设置页可覆盖） |
| `P115_WRITE_INTERVAL_MS` | `3000` | 写接口最小间隔 |
| `INCR_ENABLED` | `true` | 生活事件增量开关 |
| `INCR_INTERVAL_MS` | `30000` | 生活事件轮询间隔 |

## 增量同步排查（为什么没同步？）

「同步」页能看到增量通道全貌：

- **状态条**：开关、间隔、游标、待处理事件积压、锁占用（被谁占多久）、115 通道（间隔/熔断状态）；
- **轮次历史**：最近 50 轮"有事"的账单——拉取/直推/目录扫描/失败原因；空转只计数；
- 常见情况：
  - 首次只建基线 → 先跑一次全量；
  - 锁被占 → 手动扫描/全量在跑，增量自动让路，跑完自动恢复（事件不丢）；
  - 熔断中 → 115 风控（429），60 秒自动恢复，期间请求排队；
  - 115 生活未开启 → 在 115 App 里开启「115 生活」记录。

## 备份与恢复

- 导出：「设置」→ 导出备份（zip：数据库快照 + jwt.key）。建议同时备份 `data/` 与 `config/` 目录；
- 恢复：「设置」→ 上传备份包 → **重启应用**。恢复前自动把现库留档为 `.prerestore`；
- 忘记管理员密码：`docker compose run --rm streampulse --reset-admin` 后重启，重新进入「创建管理员」页面（媒体库与设置保留）。

安全说明：115 Cookie / Token 以明文存 SQLite（`data/streampulse.db`）。程序会把 `data/` 收紧到 `0700`、数据库与 `config/jwt.key` 收紧到 `0600`；备份时请一起备份 `data/` 与 `config/`。

## 飞牛 fnOS 打包

```bash
./scripts/build-fnos.sh 0.2.0
```

脚本交叉编译 `linux/amd64` 与 `linux/arm64`，生成 `dist/fnos/streampulse-{amd64,arm64}/`，安装飞牛开发者工具后执行 `fnpack build` 生成 `.fpk`。fpk 以**原生二进制**形态运行（`cmd/main` 管理进程）。

> 管理端口 1024 属于特权端口：fpk 若以非 root 运行需 `CAP_NET_BIND_SERVICE`。

## 测试

```bash
go test ./...
go vet ./...
```

覆盖：存储 CRUD 与迁移、115 分页/取链/扫码/开放平台/祖先链/风控熔断、节流、礼让锁、任务队列、扫描（目录改名/孤儿/直推）、STRM 原子写与 rebase、302 缓存/singleflight/HEAD 校验、emby302 反代改写、Emby 定向刷新、增量两阶段消费、事件抑制、深删记录、刮削（解析/幂等/TMDB mock）、adopt 解析与分桶、备份导出恢复。全部为纯函数/httptest 单测，无需真实账号。

## 目录

```
cmd/server          入口（含 --reset-admin / 备份恢复 / 每日维护）
internal/config     环境变量配置
internal/logx       滚动日志
internal/store      SQLite 台账 + 版本化迁移 + 任务队列 + 事件抑制/PathCache
internal/apperr     统一错误契约
internal/safego     后台 goroutine panic 兜底
internal/eventbus   轻量事件总线（同步 → 刮削 → 刷库联动）
internal/ratelimit  串行间隔限流器
internal/synclock   礼让锁（增量/手动任务互相让路）
internal/pan115     115 客户端（双通道、调用中轴、熔断、扫码/开放平台/生活事件/祖先链）
internal/p115svc    账号 → 客户端、扫描编排（礼让锁宿主）
internal/scan       扫描、改名迁移、孤儿、目录行同步
internal/strm       STRM 原子写、命名、地址批量替换
internal/stream     播放端口（302 / 中转 / singleflight / HEAD 校验）
internal/embyproxy  Emby 反代（PlaybackInfo 直连改写 / 视频流 302 / 失败回源）
internal/emby       Emby 客户端（全量 + 按库定向刷新）
internal/incr       生活事件增量（两阶段消费 / 直推 / 轮次账本 / 推游标）
internal/deepdel    深度删除 + 记录区（回收站还原凭据）
internal/scrape     TMDB 基础刮削
internal/adopt      STRM 接管（竞品迁移）
internal/backup     备份导出 / 暂存恢复
internal/api        管理 API + 任务 worker + 内嵌 Vue 3 SPA
web/                Vue 3 + Vite 前端源码（singlefile 构建）
deploy/fnos         飞牛 fpk 模板
```

前端构建：`cd web && npm install && npm run build`（产物提交在 `internal/api/web/dist`，Go 构建不需要 Node）。

## 许可证

尚未选定。参考项目许可：115-Station 无 LICENSE（保留所有权利）、LitePan PolyForm Noncommercial、QMediaSync GPL-3.0。本项目未复制其代码。
