# 进阶使用

## 二级分类 YAML

```yaml
categories:
  - name: 动作
    mediaType: movie
    genres: [Action, Adventure]
  - name: 科幻
    mediaType: movie
    genres: [Science Fiction]
  - name: 国产剧
    mediaType: tv
    countries: [CN]
  - name: 美剧
    mediaType: tv
    countries: [US]
```

- `name`：分类目录名，目录自动创建。
- `mediaType`：`movie` 或 `tv`。
- `genres` / `countries` / `languages` / `keywords`：可组合。
- 同一分类内不同字段是 AND，数组内多个值是 OR。
- 从上到下匹配，未命中进入“其他”。

## 洗版 YAML

```yaml
washing:
  mode: weighted
  min_gap: 5
  min_coverage: 0.5
  tie: keep
  weights:
    resolution: 30
    source: 20
    hdr: 5
    codec: 5
    size: 5
  must: []
  exclude: []
```

`mode` 可选：`off`、`better`、`always`、`max_size`、`min_size`、`weighted`。

画质比较：分辨率 → 片源 → HDR → 编码。

## 重命名模板

```text
电影文件夹：{title} ({year})
电影文件：{title} ({year}){quality}
剧集文件夹：{title} ({year})/Season {season}
剧集文件：{title} - S{season}E{episode}{quality}
```

变量：`{title}` `{year}` `{season}` `{episode}` `{quality}` `{ext}` `{category}`，以及 `{resource_pix}` `{resource_type}` `{resource_effect}` `{video_encode}` `{audio_encode}` `{resource_team}` `{first_letter}`。用 `<...>` 包住的块只在其中变量都非空时输出。

整理顺序：创建目标文件夹 → 重命名文件 → 移动到媒体库。目标文件夹本身由文件夹模板生成。

## 115 分享导入

来源页 → “115 分享导入”：

1. 选择 115 账号；
2. 粘贴分享链接和提取码；
3. 填写转存目录，例如 `/Inbox`；
4. 转存完成后到整理页扫描。

## 封面

媒体库卡片 → “封面”，会从输出目录的海报图片生成一张 1200×1800 封面；没有海报时生成文字封面。

## 115 事件级增量

来源为 115 时，媒体库可开启“115 生活事件增量”。Scheduler 会解析事件所属目录，只扫描受影响目录，而不是整库扫描；建议先全量同步一次。


## Emby 联动

设置 → Emby 与通知：添加 Emby 地址、API Key，先点“测试连接”；可读取 Emby 媒体库并加入刷新，也可以填写 Emby 可见目录后一键创建媒体库。任务成功后会自动调用 Emby 刷新接口。

## 通知

支持 Telegram 机器人和企业微信机器人。先点“发送测试消息”，确认渠道可用。

## 115 多 Cookie

来源编辑页的 Cookie 输入框支持多个 Cookie，用空行分隔。当前 Cookie 登录失效时会自动尝试下一个。


## Telegram 命令机器人

在设置 → Emby 与通知中填写 Bot Token、Chat ID 并开启“Telegram 命令机器人”。

可用命令：

```text
/status                  运行状态
/libraries               媒体库列表
/run <名称或ID>          增量同步
/full <名称或ID>         全量同步
/runs                    最近任务
/cancel <任务ID或库名>   取消任务
/login <来源名称>        扫码更新 115/123
/help                    帮助
```

机器人只响应配置的 Chat ID；企业微信目前只支持通知，不支持命令回调。


## 影巢搜索

设置 → Emby 与通知 → 影巢搜索：

```text
影巢地址：https://hdhive.com
影巢 API Key（X-API-Key）
OpenAPI 用户 Token（Bearer Token）
```

TMDb Key 使用整理设置里的配置。侧边栏“影巢搜索”输入片名后，会先解析 TMDb 条目，再查询影巢资源。

只做搜索，不会自动解锁、不会消耗积分。

不太灵、观影使用镜像内置 Chromium；遇到验证码/人机验证时，页面会返回截图，在搜索页填写后提交即可继续：

- 不太灵：浏览器内请求其搜索 API，返回磁力。
- 观影：需要填写站点地址；若站点要求登录，填写浏览器 Cookie。页面有验证码时由用户在搜索页填写截图中的验证码。
- SeedHub：默认使用 `https://www.seedhub.cc`，返回详情链接。
- 癫影：邀请制站点，需登录 Cookie 和页面适配，当前标记为“需适配”。

Chromium 会让镜像变大；如果不需要这两个来源，不影响影巢搜索。


## 豆瓣订阅

侧边栏“订阅”：

- 豆瓣用户 ID：优先读取公开想看主页，不需要密码。
- RSSHub：填了优先使用。
- Cookie：私密想看才需要。

目前完成“想看 → 订阅列表”；资源搜索、影巢解锁、115 转存、自动整理和 STRM 在后续阶段接入。


## CloudDrive2 Webhook

设置 → Emby 与通知 → CloudDrive2 实时事件：

1. 生成一段 Webhook Token。
2. 把 Webhook 地址填到 CloudDrive2 的文件变更通知。
3. 媒体库的“来源路径”要和 CD2 推送的虚拟路径一致。

收到事件后，只扫描事件所在目录。

## 115 WebSocket

开启媒体库“115 生活事件增量”后，StreamPulse 会尝试连接 115 WebSocket；收到消息时立即触发一次事件轮询。115 WebSocket 事件类型很少，连接失败时仍使用定时轮询。


## 附属文件清理

开启媒体库“清理失效条目”后，StreamPulse 会同时清理自己记录过的字幕、NFO、图片；只删除 manifest 中记录过的文件，不会删除用户自己放进输出目录的附属文件。
