# Google

**Mode**: 🌐 / 🔐 Mixed · **Domains**: `google.com`, `suggestqueries.google.com`, `news.google.com`, `trends.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli google images <keyword>` | Search Google Images and extract visible photo/image results |
| `opencli google news [keyword]` | Get Google News headlines (top stories or search) |
| `opencli google search <keyword>` | Search Google and extract results from the page |
| `opencli google suggest <keyword>` | Get Google search suggestions |
| `opencli google trends` | Get Google Trends daily trending searches |

## What works today

- Public API commands work without a browser:
  - `news` — RSS feed, supports top stories and keyword search
  - `suggest` — JSON API, no auth needed
  - `trends` — RSS feed, supports different regions
- `google search` uses browser mode to extract results from google.com.
- `google images` uses browser mode to extract visible Google Images results. By default it opens image previews and decodes Google's `imgurl` value so `imageUrl` is the original file URL when Google exposes it. Use `--resolve false` to skip preview clicks and return faster thumbnail-only rows.

## Current limitations

- `google search` may trigger CAPTCHA in Standalone browser mode. Extension mode (with an established Chrome session) is more reliable.
- `google images` uses the same browser-backed Google session as `search`, so it can hit the same CAPTCHA or consent-page limitations.
- Google frequently changes its DOM structure. If `search` stops returning results, selectors may need updating.
- Image result pages are especially dynamic; some rows may still expose only thumbnail URLs if Google does not load an `imgurl` value after the preview opens.
- Snippet extraction may return empty for some results depending on Google's layout.

## Usage Examples

```bash
# Search Google Images / photos
opencli google images "golden gate bridge at sunset" --limit 10

# Faster thumbnail-only image search
opencli google images "golden gate bridge at sunset" --limit 10 --resolve false

# Get top news headlines
opencli google news --limit 5

# Search news for a topic
opencli google news "artificial intelligence" --limit 10 --lang en --region US

# Search Google
opencli google search "typescript tutorial" --limit 10

# Search a date range and save the results to a file
opencli google news "artificial intelligence" --date-between 2025-01-01 2025-01-03 --limit 1000 --order time desc -f json -o news.json

# Collect the available results for today in the system's local timezone
opencli google search "artificial intelligence" --limit None --order time asc -f csv -o search-today.csv

# Search on either side of a date or reverse Google's relevance ranking
opencli google search "typescript" --date-before 2025-01-01 --order relevance asc
opencli google news "typescript" --date-after 2025-12-31 --order relevance desc

# Get search suggestions
opencli google suggest python

# Output as JSON
opencli google search "machine learning" -f json

# Get trending searches in Japan
opencli google trends --region JP --limit 10
```

## Prerequisites

- `suggest`, `news`, `trends` do not require Chrome.
- `search` and `images` require:
  - Chrome running (or Standalone mode will auto-launch)
  - For best results, use the [Browser Bridge extension](/guide/browser-bridge) with an established Google session

## Notes

- For `news` and `search`, use `YYYY-MM-DD` dates. `--date-before` and `--date-after` exclude the specified day and can be combined. `--date-between START END` includes both days and can also query a single day by repeating its date.
- `--limit` defaults to 10. A larger number is a maximum, and `None` collects all available results for today, or for the date range you specify. Use `-o PATH` to write large results to a file.
- `--order relevance desc` uses Google's returned order. `relevance asc` reverses that ranking. `news` keeps the initial feed's order first and appends unique results from more narrowly dated feeds in their returned order. Google exposes relevance ranks without numeric scores.
- `--order time asc` starts with the oldest results and `--order time desc` starts with the newest. `news` uses RSS publication dates. An undated `news` query sorts the first feed when it already contains enough results. RSS dates describe the articles as reported by Google News and cannot establish which version of an article was available at a historical cutoff. `search` uses dates shown on Google's result cards, estimates relative dates, and places results with unavailable or unrecognized dates at the end. Google's web date filters can use a page's last update date.
- Bulk queries are limited by Google's accessible results. `news` splits full keyword feeds by day and warns when a feed remains full. Without a keyword it date-filters the curated top-stories feed. `search` stops at the last available results page. Use `--timeout` to allow more time for a multi-page web search.
- `suggest` defaults to `--lang zh-CN`; other commands default to `--lang en`.
- `news` supports `--lang` and `--region` parameters for localized results.
- `trends` traffic values are raw strings (e.g. "500K+", "1,000,000+"), not numeric.
- `search` output includes three result types: `result` (standard), `snippet` (featured answer box), and `paa` (People Also Ask).
- `images` output includes `rank`, `title`, `imageUrl`, `thumbnailUrl`, `sourceUrl`, `source`, `width`, and `height`. With default preview resolution, `imageUrl` is the original image URL when Google provides one; otherwise it falls back to the visible thumbnail URL.
- `images --resolve false` skips preview clicks, so it is faster but more likely to return thumbnail URLs in `imageUrl`.
