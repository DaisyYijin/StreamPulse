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

变量：`{title}` `{year}` `{season}` `{episode}` `{quality}` `{ext}` `{category}`。

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

设置 → Emby 与通知：添加 Emby 地址、API Key、媒体库 ID，开启“同步后刷新 Emby”。任务成功后会自动调用 Emby 刷新接口。

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
