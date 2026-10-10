# JumpServer OpenCLI Adapter

Prerequisites:

- Pass `--url <JumpServer URL>` to `login`/`connect`, or set `OPENCLI_JUMPSERVER_URL`, for example `http://127.0.0.1:8080`. The command opens the site automatically. `--url` takes precedence over the environment variable; without either, an existing JumpServer tab is reused.
- Open the same Chrome profile used by OpenCLI and log in to JumpServer.
- Run `opencli jumpserver connect <asset>` before `exec`, `view`, `upload`, or `download`.

Examples:

```bash
opencli jumpserver connect xxx --url http://127.0.0.1:8080 --keep-tab true
opencli jumpserver exec "python --version" --wait 10 --json
opencli jumpserver view --tail 10
opencli jumpserver upload 1.txt /tmp
opencli jumpserver download /tmp/1.txt .
```

`login` is an alias for `connect`. For a Windows SSH asset using its default `cmd.exe` shell:

```bash
opencli jumpserver login 192.168.0.68 --account mozhe --url http://192.168.0.68:8080 --keep-tab true
opencli jumpserver exec "whoami" --wait 10 --json
opencli jumpserver exec 'pwsh -NoProfile -NonInteractive -Command "Get-Date"' --wait 10 --json
opencli jumpserver view --tail 10
opencli jumpserver upload 1.txt /C:/Users/mozhe
opencli jumpserver download /C:/Users/mozhe/1.txt .
```

File transfers require a separate `sftp` protocol on both the platform and asset, with its SFTP home configured. Enabling SFTP in SSH settings alone is insufficient. Windows OpenSSH paths use `/C:/...`. Remote paths must be within the configured SFTP home; for example, `/E:/` is outside a home of `C:/Users/mozhe`.

Local upload paths can be absolute or relative to the current CLI working directory; they are converted to absolute paths before Chrome reads the file.

`exec` waits for a command to finish; bare `pwsh` starts an interactive shell and will time out. Use `pwsh -NoProfile -NonInteractive -Command "..."` for PowerShell commands. On timeout the adapter closes the asset terminal, so reconnect before the next command. The CLI enforces `--wait` without relying on background-page timers; commands are never automatically retried.

The adapter keeps terminal state in OpenCLI's persistent `site:jumpserver` browser tab. JumpServer cookies, CSRF values, connection tokens, and WebSocket handles stay in the page context and are not returned as rows.
