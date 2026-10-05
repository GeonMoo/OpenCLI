# 金十数据 (Jinshi)

读取 [金十首页](https://www.jin10.com/) 已加载的全部最新快讯，保持页面顺序，不截断正文，也不自动加载历史页。需要 Chrome 和 OpenCLI 浏览器扩展，无需登录。

```bash
opencli jinshi news
opencli jinshi news -f json
opencli jinshi news -f csv -o "test.csv"
```

输出字段：`timestamp`、`title`、`content`、`url`。时间使用北京时间 ISO 8601（`+08:00`），支持跨日条目；无独立标题的简讯使用完整正文作为标题。正文保留换行和页面显示的来源。

CSV 文件使用 UTF-8 BOM，支持 Excel 中文显示及包含逗号、引号、换行的正文。

数据策略为 `DOM_STATE` / `visible-ui`：新闻容器 `#jin_flash_list .jin-flash-item-container`、标题 `.right-common-title`、正文 `.flash-text`（数据表格使用 `.right-content`），条目 ID 含完整发布时间。页面通过 WebSocket 加载快讯；侦察时 HTTP fallback `/get_flash_list` 返回 502。加载超时或字段缺失时抛出 typed error。
