# 猎聘

通过 Chrome 中猎聘页面的可见岗位卡片读取数据。参照 BOSS 搜索命令，支持关键词、城市、分页和 CSV 导出；不带关键词时返回个性化“为你推荐”职位。

```bash
opencli liepin search Python --city 上海 --limit 80 -f csv -o "test-liepin.csv"
opencli liepin search 数据工程师 --city 020 --page 2 --limit 40 -f json
opencli liepin search --limit 80 -f csv -o "recommended-liepin.csv"
```

需要 Chrome 和已连接的 OpenCLI 扩展；出现登录墙时，先在 Chrome 登录猎聘。

`query` 可省略，省略时读取 `https://c.liepin.com/` 的个性化推荐，使用账号已有的求职偏好。`--city` 只用于关键词搜索，默认全国，支持北京、上海、天津、重庆、广州、深圳、苏州、南京、杭州、大连、成都、武汉、西安，也支持猎聘数字城市代码。

`--page` 为起始页码，默认为 1；`--limit` 为所需职位总数，默认为 40，两者均须为正整数。超过一页时自动继续加载，直至收集足够的不重复职位或列表明确结束。搜索页通过分页按钮翻页；推荐页通过滚动加载，每 40 条去重后的推荐视为一页。结果不足时返回已有职位；没有职位或起始页不存在时报空结果，加载停滞时报超时。

搜索结果包含网页展示的推广职位。输出字段为 `name`、`salary`、`company`、`area`、`experience`、`degree`、`recruiter`、`recruiterActive`、`jobId`、`url`。薪资保留网页单位和发薪月数；未展示的可选字段为 null。`jobId` 取详情 URL 中的数字，保留 `/job/` 和 `/a/` 两种链接的原路径，去除追踪参数，跨页按链接去重。

Strategy: UI_SELECTOR；Contract: visible-ui。搜索选择器锚点为 `.jobCardPcContainer`、`data-nick="job-detail-job-info"`、`.jobTitleBox`、`.companyName`；推荐卡片为 `.job-card-pc-container`，加载标志为 `.job-list-bottom-text`。普通 HTTP 搜索 HTML 只有页面骨架，浏览器渲染后的 DOM 包含真实职位。翻页等待同时核对活动页码及岗位链接中的 `curPage`，避免读取上一页。无结果、登录墙、验证页、字段缺失和加载超时分别抛出 typed error。
