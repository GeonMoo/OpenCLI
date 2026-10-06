# jobs

从 18 家公司官方招聘网站检索岗位，无需 Python 或原 scraper 目录。飞书招聘、Tesla 和 B 站需要 OpenCLI 浏览器桥接；其他公司使用官方站点的匿名 HTTP 接口。

```bash
# 小米的数据开发岗位
opencli jobs search "数据开发" --pages 1 --company xiaomi

# 全部 18 家公司，每家公司最多抓取一页
opencli jobs search "数据开发" --pages 1

# 公司清单、公司名称与官方招聘地址
opencli jobs companies

# 多家公司、JSON 输出
opencli jobs search "数据开发" --company xiaomi,tencent,baidu -f json

# 在标题、职责和要求中匹配关键词；补充职位详情
opencli jobs search "数据开发" --company xiaomi --match text --details

# 任一公司失败时使整条命令失败
opencli jobs search "数据开发" --pages 1 --strict
```

## 参数和结果

- `query`：必填关键词。默认按岗位名称包含完整关键词进行二次过滤，忽略大小写；原网站可能在职责中匹配或拆词检索。`--match text` 会额外匹配职责与要求。
- `--pages`：每家公司的列表页数上限，默认 1。飞书和多数 HTTP 站点每页 10 条；Tesla 保留网站自身的页容量。过滤发生在抓取之后，因此返回的匹配岗位可能少于页容量。
- `--company`：可逗号分隔；不填检索全部 18 家。支持公司 ID、中文名称及原 scraper 的 `Xiaomi`、`Li Auto`、`Ele.me`、`Pony.ai` 等名称，不区分大小写。
- `--details`：默认关闭；开启后补充飞书、Tesla、腾讯、百度、理想、阿里招聘体系的详情字段。列表没有的字段为 `null`。
- `--timeout`：整条命令的时间上限，默认 600 秒；`--request-timeout` 为单次请求或页面等待上限，默认 30 秒。
- `--strict`：默认关闭。跨公司搜索遇到失败会保留其他公司结果，在 stderr 输出逐家公司结果和失败原因；开启后任一公司失败将以 `COMMAND_EXEC` 结束。单公司失败始终抛出原有 typed error。全部公司正常完成但没有匹配岗位时返回 `EMPTY_RESULT`（退出码 66）。

输出列按顺序为 `rank / company / id / title / location / description / requirements / url`。岗位 ID 保留为字符串；JSON、CSV、Markdown 格式使用 OpenCLI 通用 `-f` 参数。

| 公司 ID | 公司 |
| --- | --- |
| xiaomi | 小米 |
| liauto | 理想汽车 |
| xpeng | 小鹏汽车 |
| nio | 蔚来 |
| momenta | Momenta |
| ponyai | 小马智行 |
| tesla | 特斯拉 |
| bytedance | 字节跳动 |
| dewu | 得物 |
| xiaohongshu | 小红书 |
| eleme | 饿了么 |
| taotian | 淘天 |
| tencent | 腾讯 |
| pdd | 拼多多 |
| minimax | MiniMax |
| baidu | 百度 |
| bilibili | 哔哩哔哩 |
| huawei | 华为 |

## 来源策略与验证

实现依据用户提供的 `E:\Desktop\job-hunter-skill\scripts\scrapers`，原文件仅作为开发参考，不是运行依赖。

| 来源 | Strategy / 契约 | 证据和处理 |
| --- | --- | --- |
| 小米等 8 家飞书站点 | UI_SELECTOR / visible-ui | 小米 HTTP 200 只有页面壳；浏览器 `keywords=数据开发` 返回可见职位。按详情链接、卡片标题、地点、职责提取；用 `current` 翻页，保留完整关键词。 |
| 腾讯、百度、华为、理想、小红书 | PUBLIC_API / internal-unstable | 无需登录的官方网页 JSON 接口；实测响应包含岗位 ID、标题和地点。检查 HTTP、业务状态、列表结构和分页重复；华为必须包含原 scraper 的 Origin/Referer。 |
| 饿了么、淘天 | COOKIE_API / internal-unstable | Node 请求当前公司的官网以获取其自身 XSRF cookie，再调用该公司的 `/position/search`；不混用阿里不同租户域名。cookie/token 不进入输出。 |
| B 站 | INTERCEPT / internal-unstable | 可见卡片没有 href/岗位 ID，DOM 无法可靠输出详情链接；正常点击搜索按钮后捕获 `/api/srs/position/positionList`，复用页面已经获得的响应。直接匿名请求未通过，未重建签名。 |
| Tesla / Moka | UI_SELECTOR / visible-ui | 根据 `#/job/` 链接、卡片标题提取。先等初始列表，再选真实可见的列表输入框并点击“搜索职位”；捕获完成信号后读取 DOM，避免隐藏导航输入框或旧列表。 |
| 拼多多 | PUBLIC_API / internal-unstable | 原 scraper 的公开 latest/hot 列表只有一页，使用本地标题过滤；不代表完整职位目录。即使 `--pages` 上限大于 1，也只请求该列表一次并正常结束。 |

这些网页接口没有公开版本保证。现场抓取受岗位更新和网络延迟影响；stderr 中的 `0 matching jobs` 表示已成功检索该范围后无名称匹配，`FAILED` 表示未完成。

真实小米卡片和 Tesla 卡片的最小 DOM 子树保存在 `clis/jobs/__fixtures__/`，不含脚本、iframe、cookie 或 token。测试覆盖字符串 ID、地点与部门分离、隐藏输入框、输入事件、分页、空结果和错误分类。

2026-10-04 现场验证：小米单公司查询返回 3 条；全部公司以 `--strict` 验证，18 家成功、0 家失败，返回 38 条，来自 12 家公司。其余 6 家在本次检索范围内没有岗位名称匹配。29 项测试、构建、类型检查和两项适配器静态规范检查通过；故意恢复错误字段提取时，真实 DOM 测试正确失败。
