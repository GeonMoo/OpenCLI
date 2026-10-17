# GitHub

**Mode**: 🌐 Public (search, trend, stars) / 🔐 Browser (login, whoami) · **Domain**: `github.com`, `api.github.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli github search "QUERY"` | Search GitHub, optionally selecting a category with `--type` |
| `opencli github trend` | List daily, weekly, or monthly trending repositories |
| `opencli github stars "USERNAME"` | List a user's starred repositories, newest stars first |
| `opencli github whoami` | Show the currently logged-in GitHub account |
| `opencli github login` | Open GitHub login and wait until the browser session is authenticated |

## Usage Examples

```bash
opencli github search "opencli stars:>10" -f json
opencli github search "repo:GeonMoo/OpenCLI bug" --type issues --limit 20 -f json
opencli github search "cli" --type packages -f json
opencli github trend --language python --since weekly --limit 10 -f json
opencli github stars "octocat" -f json

# Check current GitHub identity
opencli github whoami

# Open the login page if the current browser session is not authenticated
opencli github login

# JSON output for agents/scripts
opencli github whoami -f json
```

## Search, trend and stars

All three commands default to `--limit 10` and support the standard output formats, including `-f json` and `-f csv`.

`search --type` accepts `code`, `repositories` (default), `issues`, `pullrequests`, `discussions`, `users`, `commits`, `packages`, `wikis`, `topics`, and `marketplace`. Queries support GitHub qualifiers. Limits range from 1 to 100. Issues and pull requests are restricted to their respective category. Code search requires `GITHUB_TOKEN` or `GH_TOKEN`; browser login does not supply an API token.

Search returns `rank`, `type`, `title`, `description`, `repo`, `owner`, `stars`, `language`, `state`, `updatedAt`, and `url`. Fields that do not apply to a category are `null`. Repository titles contain the full `owner/repository` name. Empty searches raise an empty-result error; incomplete REST searches raise an error asking for a narrower query.

`trend` supports `--since daily|weekly|monthly`, `--language SLUG`, and `--limit 1-25`. Output is `rank`, `repo`, `description`, `language`, `stars`, `forks`, `starsSince`, and `url`. The existing `github-trending repos` command remains available with its original default of 25.

`stars` returns `rank`, `fullName`, `description`, `language`, `stars`, `forks`, `starredAt`, and `url`. It sorts by **the time the user starred the repository**, not the repository's update time or popularity. Larger limits fetch pages sequentially (at most 100 repositories per request), with a one-second pause between pages and no per-repository requests. This is a single retrieval, not a continuous watcher.

Public requests need no browser. Set `GITHUB_TOKEN` or `GH_TOKEN` to use an authenticated API quota or access resources permitted by the token. Rate-limit responses stop with a retry hint derived from `Retry-After` or `X-RateLimit-Reset`; the command does not retry in a tight loop. Pacing reduces request pressure but cannot guarantee quota availability when other tools share the same IP or token.

### Data sources

- **PUBLIC_API / stable**: search for repositories, code, issues, pull requests, users, commits and topics uses the [official REST search API](https://docs.github.com/en/rest/search/search). Stars uses the [official starring API](https://docs.github.com/en/rest/activity/starring#list-repositories-starred-by-a-user), `sort=created&direction=desc`, and the `application/vnd.github.star+json` media type to obtain timestamps.
- **DOM_STATE / visible-ui**: discussions, packages, wikis and marketplace read the public HTML search page's embedded search results. Live responses were checked for all four categories, including `type=registrypackages` for packages. Pages are requested sequentially with six-second pauses. A changed category or payload fails explicitly rather than silently returning repository matches.
- **DOM_STATE / visible-ui**: trend reuses the existing public `/trending` HTML parser. No browser cookie or undocumented network API is used.

## Browser prerequisites (login and whoami)

- Chrome running and **logged into** github.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `whoami` verifies the current browser cookie session and does not open the login page.
- `login` opens `https://github.com/login` in a foreground browser window and waits until OpenCLI can verify the account.
- OpenCLI never fills credentials, CAPTCHA, 2FA, or passkeys. The user completes authentication in the browser; OpenCLI only verifies the resulting session.
