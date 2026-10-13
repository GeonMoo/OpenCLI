# TradingView

读取 TradingView 中文站的日历、新闻流、交易观点和脚本列表。需要 Chrome 和 OpenCLI 扩展，无需登录。

```bash
opencli tradingview calendar --class economic
opencli tradingview calendar --date 2026-10-14
opencli tradingview calendar --class earnings --date 2026-10-14
opencli tradingview calendar --class earnings --limit 20 -f json
opencli tradingview calendar --class dividend
opencli tradingview calendar --class ipo
opencli tradingview news --limit 10
opencli tradingview ideas
opencli tradingview scripts
opencli tradingview scripts --class marketplace
opencli tradingview scripts --class editorpicks
opencli tradingview script --class editorpicks
```

| 命令 | `--class` | 默认值 |
| --- | --- | --- |
| `calendar` | `economic`、`earnings`、`dividend`、`ipo` | `economic` |
| `scripts`（别名 `script`） | `all`、`marketplace`、`editorpicks` | `all` |

全部命令支持 `--limit 1-100`，默认 10；保持页面顺序，最多返回当前已渲染的条目。新闻、观点和脚本不自动翻页或滚动加载。新闻为中文新闻流；观点和脚本的 `description` 是列表卡片上的摘要。

`calendar` 默认查询本机本地日期的今天；四类日历均支持 `--date YYYY-MM-DD`，可跨周、跨月切换。日历会在前台打开页面，定位并等待所选日期加载，只返回当天事件，再应用 `--limit`。无事件时返回 `EMPTY_RESULT`（退出码 66），不会用相邻日期的数据填充。

浏览器短暂拒绝首次导航时，命令会自动重试一次，无需开启 trace；持续的导航错误仍会正常上报。

`scripts --class marketplace` 返回付费脚本合集及作者空间链接，`price` 保留页面显示的币种和收费周期。普通脚本的 `price` 为 `null`；付费合集未展示的点赞数、评论数和发布时间也为 `null`。

日历按指定日期加载对应的一周，保留页面的其他筛选设置；`details` 保留页面显示的指标、日期和单位（字符串），缺失值为 `null`。`dayStart` 是该日分组起点的 UTC ISO 时间，保留页面时区边界，例如北京时间 10 月 12 日对应 `2026-10-11T16:00:00.000Z`；`eventTime` 只在页面提供确切时间时返回，否则为 `null`。`market` 保留站点市场/国家代号。

| 日历类别 | `details` 字段（按页面列顺序） |
| --- | --- |
| `economic` | `actual`、`forecast`、`previous` |
| `earnings` | `epsEstimate`、`epsActual`、`epsSurprise`、`revenueEstimate`、`revenueActual`、`revenueSurprise`、`marketCap` |
| `dividend` | `amount`、`exDate`、`paymentDate`、`yield` |
| `ipo` | `exchange`、`status`、`offerPrice`、`shares`、`dealAmount`、`marketCap` |

## 数据策略

Strategy: `DOM_STATE` / `visible-ui`（注册为 `Strategy.UI`）。

- 财经日历使用 `[data-name="economic-calendar-item"]`，事件带 `data-symbol`、`data-country` 和 `time[datetime]`。
- 其他日历使用 `earnings-calendar-item`、`dividends-calendar-item`、`ipo-calendar-item`，按 `[data-timestamp]` 继承日期，以 `withValue-*` 单元格对应各类别列；列数变化时报告结构错误。
- 日期使用页面支持的 `?timestamp=<毫秒时间戳>` 参数，按 `scrollToLocator-*` 的日期分组定位。忽略日内时间线标记，并等待该分组下的事件或 `emptyDayRow-*` 空状态。
- 观点和脚本使用 `article` 内的 `[data-qa-id="ui-lib-card-link-title"]`、作者链接和 `time[datetime]`。
- 付费空间使用 `article header h2`、作者 `/u/` 链接、价格和合集描述，合集链接为 `/scripts/marketplace/<author>/`。
- 新闻使用 `[data-qa-id="news-headline-card"]`、`news-headline-title`、`relative-time[event-time]` 和外层新闻链接。
- 实测中文站公开页面可访问，Node 获取脚本页返回 HTTP 200 / HTML，含卡片；日历与新闻需要页面加载数据。没有已确认的官方数据 API 契约，沿用可见页面结构。
- 不读取登录凭据；无数据、超时、结构变化分别通过 typed error 报告。
