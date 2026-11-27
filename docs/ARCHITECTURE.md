# 架构说明（P0）

## 1. 进程与端口

```
浏览器 ──> :6060 管理/API（内嵌页面）
播放器 ──> :6086 /d/{pickcode} ──302──> 115 CDN
                     └─ proxy 模式 ──> 本机转发 ──> 115 CDN
```

两个 `http.Server` 共用一个进程；`PORT` 与 `STREAM_PORT` 必须不同。

## 2. 模块

| 包 | 职责 |
|---|---|
| `config` | 环境变量 → 配置；默认值面向容器/fnOS |
| `logx` | stdout + 10MB×3 滚动文件 |
| `store` | SQLite（modernc，纯 Go，WAL）；所有表结构内嵌 |
| `pan115` | 扫码 Cookie、开放平台 DeviceCode+PKCE、列目录、取直链、节流 |
| `p115svc` | 账号 → 客户端缓存；扫描串行锁；主号取链 |
| `scan` | BFS 目录树、视频串行写 STRM、附属文件并行、改名迁移、孤儿标记 |
| `strm` | 原子写与命名规则 |
| `stream` | 播放端口、50 分钟直链缓存、可选 Range 中转 |
| `emby` | 刷库、Webhook 解析 |
| `api` | 登录、媒体库 CRUD、任务、二维码、内嵌页面 |
| `scheduler` | 自研 5 段 Cron |
| `p115svc` | 把上述能力编排给 API 与调度器 |

## 3. 数据模型

```
accounts(id, role, auth_type, cookie, access_token, refresh_token, expires_at, app_id, uid)
libraries(id, account_id, remote_cid, local_dir, base_url, strm_format, keep_ext,
          video_exts, meta_exts, min_size, scan_mode, cron, last_scan_at)
dirs(library_id, cid, parent_cid, name, rel_path)          -- cid 为自然键
synced_files(library_id, fid, pickcode, cid, name, rel_path, strm_path, size, sha1, status)
sync_events(account_id, event_id, kind, payload, status)    -- P1 预留
tasks(id, kind, library_id, status, message)
```

**原则：`fid` / `cid` 是身份，`rel_path` 只是派生值。** 改名不需要重建台账。

## 4. 目录改名算法

1. 本次扫描构建 `cid → (parent_cid, name, rel_path)`。
2. 与 `dirs` 表按 `cid` 比对：`cid` 存在且 `rel_path` 变化 → 改名/移动。
3. 浅层优先执行；父目录已迁移时跳过子目录，避免重复 rename。
4. `os.Rename(旧, 新)`；失败则 walk 逐文件 move，最后删空目录。
5. 更新 `dirs`；STRM 内容不变（pickcode 未变），因此不重写。
6. 本次未出现的 `fid` → `status=orphan`，**不删本地文件**。

115 生活事件不推送文件夹改名，因此后续 P1 会增加：事件触发 + 周期目录树 diff + 手动「目录行同步」三层兜底。

## 5. 扫描节流与并发

- `ratelimit.Limiter`：读/写两个串行队列，默认 1s / 3s。
- 视频遍历串行（每个视频一次或零次 115 请求），附属文件 5 路并行。
- `p115svc.scanMu` 保证同一进程内扫描不并发，避免多库同时打爆 115。
- 快速/标准模式通过每页条数（1000 / 200）体现；两者都走 BFS，后续可接 115 整树端点。

## 6. 播放链路

`stream.Server`：

1. 解析 `/d/{id}`：剥离附加账号前缀 `uid~` 与视频扩展名；
2. 缓存键 `pickcode|UA`，TTL 50 分钟；
3. `redirect`：`302 Location: 直链`，`Cache-Control: no-store`；
4. `proxy`：透传 `Range`，上游 401/403 时清缓存并重试一次。

P0 的播放端点与 115-Station 一样属于“pickcode 即弱凭据”，公网部署必须自行加访问控制。

## 7. 安全

- PBKDF2-HMAC-SHA256（120k 次）存管理员密码；
- HMAC-SHA256 自签 token，8 天；HttpOnly Cookie 或 `Authorization: Bearer`；
- CSP、`X-Frame-Options: DENY`、`nosniff`；
- 115 凭据只存本地 SQLite；日志不输出 Cookie/Token；
- Emby Webhook 可选 token（`emby_webhook_token`）。

## 8. 与参考项目的边界

| 参考 | 借鉴内容 | 未复制 |
|---|---|---|
| 115-Station | 生活事件增量思路、目录行同步语义、pickcode 格式、深度删除校验清单 | 无 LICENSE，代码不可复制 |
| LitePan | 多网盘驱动抽象、Range 代理与预取思路、STRM token 设计 | PolyForm NC，禁止商用 |
| QMediaSync | emby302 转码代理形态、飞牛 fpk 目录结构、模板变量语义 | GPL-3.0，未复制代码 |

本项目为独立实现；协议端点依据公开文档与行为观察，具体见 `internal/pan115` 注释。

## 9. 生活事件增量（P1）

```
每 30s ─> GET proapi/android/behavior/detail（405 切 webapi/behavior/detail）
        ─> 过滤浏览/标星类事件（3/4/7/8/9/10/19）
        ─> 事件 id <= 游标即停（新→旧）
        ─> 按 file_id 去重，写 sync_events（UNIQUE 保幂等）
        ─> cid 命中 dirs 表 → 对该目录执行 ScanOneDir
        ─> 全部成功且目标目录 <= 10 个才推进游标
```

- **首轮 baseline**：只记录最新事件 id，不处理历史，避免扫描风暴；因此使用前必须先跑一次全量。
- **失败重试**：扫描失败或目标目录超限时不推进游标；已记录事件仍会重新进入目标集合。
- **已知缺口**：自身扫描/整理产生的 115 事件尚未抑制，可能引发一次多余目录同步（幂等，无副作用）。

## 10. 深度删除（P1）

Emby `library.deleted` → `deepdel.Handle`：

1. **类型白名单**：只接受 Movie / Episode / Season / Series。
2. **路径校验**：必须落在某个媒体库 `LocalDir` 内，且不等于库根；嵌套库取最长匹配。
3. **台账命中**：只处理 `synced_files.strm_path` 精确等于 Path（或位于 Path 目录下）的行；未命中直接拒绝。
4. 删除 STRM + 同名 sidecar（nfo/srt/ass/ssa/vtt/jpg/png/webp），同步删台账行。
5. 从文件父目录向上删空目录，**库根永不删除**。
6. **网盘删除**：仅当 `EMBY_DELETE_REMOTE=true`；走 `/rb/delete` 进 115 回收站，可还原。
7. 任一步拒绝都会返回 `Rejected`，不做部分删除（本地删除按文件粒度继续并记录 warning）。

## 11. 后续设计要点

- **整理**：识别（三级校验）与执行（批量 move/delete）分离；模板引擎与 YAML 分类独立于同步链路。
- **转码代理**：独立子服务，避免污染 302 热路径；配置 path-map 与清晰度档位。
- **事件抑制**：为自身写操作打时间窗/目录标记，消费时跳过。
