# 天眼查

使用 Chrome 中现有的天眼查登录态。`login` 打开网页并等待交互式登录；已登录时直接返回账号。`whoami` 从新加载首页的用户状态验证身份，不输出手机号或令牌。

```sh
opencli tianyancha login
opencli tianyancha whoami
opencli tianyancha search "宁德时代" --class company
opencli tianyancha search "宁德时代" --class boss
opencli tianyancha search "宁德时代" --class relation
opencli tianyancha search "宁德时代" --class relation --target "曾毓群"
opencli tianyancha detail 2343820668
opencli tianyancha detail "https://www.tianyancha.com/company/2343820668"
opencli tianyancha detail "宁德时代"
```

所有查询支持 `-f json`、`-f csv` 等通用输出格式。搜索默认 `--class company --limit 20`，`--limit` 范围 1–100，只返回当前页面加载的数据，不自动翻页。名称解析优先完整名称匹配，否则取网站排序的首个公司；需要精确指定主体时使用公司 ID 或详情 URL。

`boss` 同时读取姓名匹配和公司关联老板结果，保留天眼查的职位和任职企业数量；相同姓名可能对应不同主体，应核对详情 URL。

`relation` 不带 `--target` 时返回公司详情页已加载的股东、任职人员、对外投资和分支机构。`sourceId/sourceName` 是所查公司，`id/name/type` 是关联主体，`relation` 是该主体相对公司的角色。此列表不是全量股权穿透或完整关系网。

带 `--target` 时选择关系页上的第二主体并触发“开始分析”，返回网站关联路径中的去重边；此时 `sourceId/sourceName → id/name` 严格遵循响应的箭头方向。目标支持完整公司或人名；简称取网站首个匹配，同名人物请在保留的浏览器页核对。查询起点为公司。

关系查询起点也接受公司 ID 或详情 URL。两主体查询通常需要多次页面加载，`browser verify` 固定的 30 秒子进程时限可能先于查询结束；排查时直接运行上面的查询命令，保留前台标签页与 trace。

`holdingPct: 22.04` 表示 22.04%；缺失信息为 `null`。注册/实缴资本保留网站原文及币种、单位；成立和核准日期使用中国时区的 `YYYY-MM-DD`，避免午夜时间戳偏移一天。详情包含工商信息、联系方式及 `extras` 中的登记机关等补充信息。

开发验证使用：

```sh
opencli tianyancha search "宁德时代" --class relation --target "曾毓群" --trace on --keep-tab true --window foreground -f json
opencli browser tyc-verify verify tianyancha/search --trace on
```

Strategy: `DOM_STATE` / `visible-ui`（搜索、详情、账号）和 `UI_SELECTOR` / `visible-ui`（直接关系表）。2026-10-09 实测 `__NEXT_DATA__.props.pageProps.listRes.data.companyList`、`dehydratedState.queries` 的 `/cloud-tempest/searchHuman`、`/biz-service/cloud-other-information/companyinfo/baseinfo/web`、`/next/web/getUserInfo` 与页面显示一致。匿名 Node HTML 返回 200，但不包含目标公司的搜索数据；鉴权来自浏览器现有会话。

两主体 Strategy: `INTERCEPT` / `internal-unstable`。页面触发 `/tyc-enterprise-graph/relation/` 响应为 200/JSON，`data.paths[].path` 包含节点及带方向的关系。未发现可复用的官方 cookie API；SVG 文本不提供节点 ID 与拓扑，所以截取 UI 自己获得的响应，不重放私有签名请求。实测曾毓群指向宁德时代，关系为“法定代表人，董事长,董事,总经理”。页面或内部响应改版可能需要维护。

验证码、登录要求、VIP 权限和无结果会明确报错。登录及验证由用户在天眼查页面完成；适配器复用当前账号权限。
