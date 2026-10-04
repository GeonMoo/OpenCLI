# JumpServer OpenCLI Adapter

Prerequisites:

- Set `OPENCLI_JUMPSERVER_URL` to the JumpServer origin, for example `http://127.0.0.1:8080`.
- Open the same Chrome profile used by OpenCLI and log in to JumpServer.
- Run `opencli jumpserver connect <asset>` before `exec`, `view`, `upload`, or `download`.

Examples:

```bash
opencli jumpserver connect xxx
opencli jumpserver exec "python --version" --wait 10 --json
opencli jumpserver view --tail 10
opencli jumpserver upload 1.txt /tmp
opencli jumpserver download /tmp/1.txt .
```

The adapter keeps terminal state in OpenCLI's persistent `site:jumpserver` browser tab. JumpServer cookies, CSRF values, connection tokens, and WebSocket handles stay in the page context and are not returned as rows.
