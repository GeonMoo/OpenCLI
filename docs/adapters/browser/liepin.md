# 猎聘

复用 Chrome 中已登录的猎聘会话，支持职位搜索与详情、求职账号与统计，以及聊天列表和消息历史。需要 Chrome 和已连接的 OpenCLI 扩展。

## 命令

| 命令 | 权限 | 数据范围 |
| --- | --- | --- |
| `search [query]` | read | 关键词搜索或个性化推荐 |
| `detail <jobId>` | read | `/job/` 或 `/a/` 职位详情 |
| `whoami` | read | 当前求职账号 |
| `stats` | read | 求职账号首页计数 |
| `login --timeout 300` | write | 打开求职端登录页并等待认证 |
| `chatlist` | read | 求职端会话列表 |
| `chatmsg <uid>` | read | 指定会话消息历史，不标记已读 |

## 搜索

参照 BOSS 搜索命令，支持关键词、城市、分页和 CSV 导出；不带关键词时返回个性化“为你推荐”职位。

```bash
opencli liepin search Python --city 上海 --limit 80 -f csv -o "test-liepin.csv"
opencli liepin search 数据工程师 --city 020 --page 2 --limit 40 -f json
opencli liepin search --limit 80 -f csv -o "recommended-liepin.csv"
```

出现登录墙时，可执行 `opencli liepin login`，在打开的 Chrome 页面完成登录。

`query` 可省略，省略时读取 `https://c.liepin.com/` 的个性化推荐，使用账号已有的求职偏好。`--city` 只用于关键词搜索，默认全国，支持北京、上海、天津、重庆、广州、深圳、苏州、南京、杭州、大连、成都、武汉、西安，也支持猎聘数字城市代码。

`--page` 为起始页码，默认为 1；`--limit` 为所需职位总数，默认为 40，两者均须为正整数。超过一页时自动继续加载，直至收集足够的不重复职位或列表明确结束。搜索页通过分页按钮翻页；推荐页通过滚动加载，每 40 条去重后的推荐视为一页。结果不足时返回已有职位；没有职位或起始页不存在时报空结果，加载停滞时报超时。

搜索结果包含网页展示的推广职位。输出字段为 `name`、`salary`、`company`、`area`、`experience`、`degree`、`recruiter`、`recruiterActive`、`jobId`、`url`。薪资保留网页单位和发薪月数；未展示的可选字段为 null。`jobId` 取详情 URL 中的数字，保留 `/job/` 和 `/a/` 两种链接的原路径，去除追踪参数，跨页按链接去重。

Strategy: UI_SELECTOR；Contract: visible-ui。搜索选择器锚点为 `.jobCardPcContainer`、`data-nick="job-detail-job-info"`、`.jobTitleBox`、`.companyName`；推荐卡片为 `.job-card-pc-container`，加载标志为 `.job-list-bottom-text`。普通 HTTP 搜索 HTML 只有页面骨架，浏览器渲染后的 DOM 包含真实职位。翻页等待同时核对活动页码及岗位链接中的 `curPage`，避免读取上一页。无结果、登录墙、验证页、字段缺失和加载超时分别抛出 typed error。

## 职位详情

```bash
opencli liepin detail 1983933935 -f json
opencli liepin detail 80151359 --type a -f json
opencli liepin detail https://www.liepin.com/a/80151359.shtml -f json
```

数字 `jobId` 默认使用 `/job/`；`--type a` 使用 `/a/`。推荐直接传入搜索结果中的完整 `url`，以保留职位路径类型。完整 URL 必须为猎聘的 HTTPS 规范详情链接，不含追踪参数或片段。

详情保留搜索字段，并增加 `description` 和 `extras`。`extras` 包含 `address`、`skills`、`welfare`、`recruiterTitle`、`recruiterCompany`、`companyIndustry`、`companyScale`；未展示的可选信息返回 null。详情等待页面身份与请求的职位 ID、路径类型一致；职位下线或重定向到推荐首页报空结果，字段缺失和验证页报执行错误。

Strategy: DOM_STATE / UI_SELECTOR；Contract: visible-ui。读取页面的 `JobPosting` JSON-LD 和 `.job-apply-container`、`.job-intro-container`、`.recruiter-container`、`.company-info-container`，不依赖详情内部接口。已实测 `/job/` 和 `/a/` 两种页面。

## 账号、登录和统计

```bash
opencli liepin whoami -f json
opencli liepin login --timeout 300 -f json
opencli liepin stats -f json
```

这些命令面向 `c.liepin.com` 求职端。`whoami` 返回 `logged_in`、`site`、`id`、`displayName`、`userType`；`userType` 为 `candidate`，页面没有提供稳定账号 ID，因此 `id` 为 null。登录会先检查当前账号；已认证返回 `already_logged_in`，否则打开登录页，等待用户完成认证后返回 `login_complete`。`--timeout` 为正整数秒数，默认 300；超时报错。

`stats` 返回首页的 `resumeViews`（简历被查看）、`applications`（已投递）、`favorites`（已收藏）和 `unreadChats`（未读消息徽标）。这是账号首页展示的计数，不能用于推断各职位浏览、沟通或招聘转化数据。零保留为 0，页面未展示未读徽标时返回 null；其他计数缺失时报错。

Strategy: UI_SELECTOR；Contract: visible-ui。身份来自页头用户菜单或简历卡片姓名；统计来自三个记录入口的 `h2` 和 IM 未读徽标。已验证真实求职账号，以及已登录时的登录检查；未退出现有账号进行重新登录实测。

## 聊天列表和历史

```bash
opencli liepin chatlist --page 1 --limit 20 -f json
opencli liepin chatmsg <uid> --page 1 --limit 20 -f json
```

`uid` 取 `chatlist` 输出的同名字段，它对应会话的 `oppositeImId`，不要替换为 `userId`。两条命令只使用 `c.liepin.com` 的求职端会话。

`--page` 从 1 开始，`--limit` 默认为 20，范围为 1–100。列表返回姓名、公司、职务、末条消息、时间、未读数、会话 UID 和用户信息。历史返回 `from`（`self` / `other`）、`type`、`text`、ISO 时间和字符串 `msgId`；第 1 页取最新一批，每页内部按时间顺序显示，第 2 页继续取更早的一批。图片消息输出图片链接，已撤回消息显示 `[已撤回]`。不存在的页报空结果，分页游标停滞时报执行错误。

Strategy: PAGE_FETCH；Contract: internal-unstable。在求职端浏览器上下文中，复用该页面已有的 IM Cookie 和第一方客户端请求头，通过 `api-c.liepin.com` 的 `im.c` 读取 `contact.get-contact-list` 和 `chat.chat-list`。

未找到可用于这些会话数据的公开接口；浏览器上下文保留跨子域 Cookie 和客户端上下文，避免在 CLI 导出会话凭据。聊天 UI 存在虚拟列表，打开会话也可能标记已读，因此选用第一方客户端的只读历史请求。列表沿 `sortValue` 翻页，历史沿最旧的字符串 `msgId` 翻页；历史接口的 `hasMore` 可能不可靠，按第一方客户端的批次长度判定是否继续。求职端请求返回 200 和非空数据。2026-10-09 补测覆盖列表连续三页、两个会话的消息历史和不存在的下一页；分页无重复、页内时间顺序正确，读取前后未读数一致。内部接口或请求头变更时可能需要更新适配器。

## 待办（尚未实现）

- [ ] 企业招聘端聊天：第一方代码中的候选入口为 `lpt.liepin.com`、`api-lpt.liepin.com` / `im.b`。取得已认证企业账号后，实测列表、消息分页和未读数，再添加实现。
- [ ] 猎头端聊天：候选入口为 `h.liepin.com`、`api-h.liepin.com` / `im.h`。补测时当前账号进入 `/certification/usercertunify`，尚未完成实名认证也可能生成 IM Cookie；需先验证业务访问资格，再验证聊天成功路径。
- [ ] 求职端重新登录：在用户能完成扫码或验证码认证时，实测 `login_complete` 和等待超时；当前保留现有登录会话，已实测 `already_logged_in`。

在源码工作区验证本次实现可使用 `npm run dev -- liepin --help`；系统安装的 `opencli` 应指向包含这些命令的版本。
