# Ke (贝壳找房)

**Mode**: 🔐 Browser · **Domain**: `ke.com`

## Prerequisites

- Chrome running and logged into `ke.com`.
- [Browser Bridge extension](/guide/browser-bridge) installed and connected.

## Commands

| Command | Description |
|---------|-------------|
| `opencli ke search <query>` | Search matching second-hand homes; defaults to result pages only |
| `opencli ke ershoufang` | Browse second-hand housing listings |
| `opencli ke zufang` | Browse rental listings |
| `opencli ke xiaoqu` | Browse neighborhood / community listings |
| `opencli ke chengjiao` | Browse recent transaction records |

## Search

### Default: list pages only

```bash
opencli ke search "华润中央公园三期" --city sh --district jiading -f csv -o "homes.csv"
```

Reads all matching result cards across all search pages, excluding recommendations. It collects property information, total/unit prices, and an estimated listing date without opening individual detail pages. Omit `--limit` to collect every matching home.

### Optional: detail pages

```bash
opencli ke search "华润中央公园三期" --city sh --district jiading --detail -f csv -o "homes-detail.csv"
```

Visits each matching home's detail page to collect labelled basic/transaction attributes and the explicit listing date. If that date is missing, it falls back to the result card's publication text. Detail collection makes more page requests and can take several minutes.

| Behavior | Default | With `--detail` |
|----------|---------|-----------------|
| Search pagination | All matching pages | All matching pages |
| Individual detail visits | None | One per collected home |
| Property information | Result-card information | Detail basic/transaction attributes |
| Listing date | Estimated from card publication text | Explicit date first, card estimate as fallback |
| Output columns | Same 12 columns | Same 12 columns |

### Search parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `<query>` | Required | Community name or property keyword |
| `--city` | `bj` | City code, such as `bj`, `sh`, `gz`, or `sz` |
| `--district` | No district filter | District URL slug; Shanghai `jiading` maps to `jiadingqu` |
| `--detail` | `false` | Enable individual detail-page collection |
| `--limit` | All results | Positive maximum number of homes to collect |
| `--timeout` | `600` | Overall command timeout, in seconds |
| `--captcha-timeout` | `300` | Maximum wait for each CAPTCHA, in seconds; `0` fails immediately |

For a shorter run:

```bash
opencli ke search "金地世家" --city sh --district jiading --limit 5 -f json
```

## CSV Export

Use `-f csv -o <file>` to write CSV directly. `--output <file>` is the long form of `-o`.

```powershell
opencli ke search "上实海上公元" --city sh --district jiading -f csv -o "test.csv" --keep-tab true --captcha-timeout 600 --timeout 1800
```

- CSV files use **UTF-8 with BOM**, so Excel can recognize Chinese text. Direct file writing also avoids PowerShell pipeline decoding.
- Relative paths resolve against the current working directory; absolute paths are supported. The parent directory must already exist.
- The destination is written after collection succeeds. An existing file is overwritten.
- Omit `-o` to keep the existing stdout/pipeline interface. Progress, CAPTCHA prompts, errors, and file-save messages go to stderr.
- `-o` also supports other selected formats, such as `-f json -o "homes.json"`; non-CSV files use UTF-8 without BOM.

### Output columns

| Column | Description |
|--------|-------------|
| `id` | Property ID, as a string |
| `title` | Property title |
| `community` | Community name, including the address suffix when shown |
| `layout` | Layout, such as `2室2厅`; detail mode may also include bathrooms |
| `area` | Building area, numeric, in ㎡ |
| `floor` | Floor information, such as `低楼层 (共21层)` |
| `direction` | Orientation, such as `南 北` |
| `totalPrice` | Total price, numeric, in 万元 |
| `unitPrice` | Unit price, numeric, in 元/㎡ |
| `listingDate` | Explicit or estimated listing date, with the precision described below |
| `propertyInfo` | JSON text containing property attributes and date-source metadata |
| `url` | Property detail URL; default mode records the link without visiting it |

### Listing-date precision

Card-based dates are estimates calculated using **Asia/Shanghai** time when the search page is read. They retain the precision of the publication text:

| Source text | Example observation date | `listingDate` |
|-------------|--------------------------|---------------|
| `6月前发布` | `2026-10-04` | `2026-04` |
| `11天前发布` | `2026-10-04` | `2026-09-23` |
| `1年前发布` | `2026-10-04` | `2025` |
| Detail attribute `挂牌时间: 2026年04月10日` | Any | `2026-04-10` |

`propertyInfo` preserves the source and observation date, for example:

```json
{
  "发布时间": "6月前发布",
  "挂牌日期来源": "列表推算",
  "采集日期": "2026-10-04"
}
```

An explicit detail date uses `挂牌日期来源: "详情页"`. Default mode also includes `房源信息` and `关注信息`; detail mode includes labelled attributes such as `挂牌时间`, `装修情况`, and `交易权属` when present.

## CAPTCHA and Timeouts

Search opens Chrome in the foreground. If a CAPTCHA appears, complete it in the current browser page; the command waits and then resumes without discarding collected rows. Use `--keep-tab true` to retain the tab after the command finishes.

`--captcha-timeout` applies to each challenge, and waiting counts toward the overall `--timeout`. For longer runs, set both values, for example `--captcha-timeout 600 --timeout 1800`. Setting `--captcha-timeout 0` returns an error immediately when a CAPTCHA appears.

Missing required property/price fields, unrecognizable publication text without an explicit detail date, login challenges, or invalid pagination stop the export with an error instead of silently returning an incomplete result.

## Other Examples

```bash
# Beijing second-hand housing
opencli ke ershoufang --city bj --district chaoyang --limit 10

# Rentals in Shanghai
opencli ke zufang --city sh --district pudong --max-price 8000 --limit 10

# Communities in Guangzhou
opencli ke xiaoqu --city gz --district tianhe --limit 10

# Recent transactions in Beijing Haidian
opencli ke chengjiao --city bj --district haidian --limit 10
```

For these commands, `district` uses the district slug from that city's Beike URL. The Shanghai `jiading` alias described above applies to `search`.
