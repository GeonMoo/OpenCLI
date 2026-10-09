import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@geonmoo/opencli/errors';

const CAPTCHA_TEXT_PATTERNS = [
    '请拖动下方滑块完成验证',
    '请按住滑块',
    '验证码',
    '安全验证',
    '访问验证',
    '滑动验证',
];

const LOGIN_TEXT_PATTERNS = [
    '请登录',
    '登录后',
    '账号登录',
    '手机登录',
    '立即登录',
    '扫码登录',
];

function cleanText(value) {
    return typeof value === 'string'
        ? value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
}

export async function readPageState(page) {
    const result = await page.evaluate(`
    (() => {
      try {
        return {
          href: window.location.href || '',
          title: document.title || '',
          body_text: document.body ? (document.body.innerText || '').substring(0, 2000) : '',
        };
      } catch(e) {
        return { href: '', title: '', body_text: '' };
      }
    })()
  `);
    if (!result) {
        return { href: '', title: '', body_text: '' };
    }
    return {
        href: cleanText(result.href),
        title: cleanText(result.title),
        body_text: cleanText(result.body_text),
    };
}

function isCaptchaPage({ href, title, body_text }) {
    return href.includes('hip.ke.com/captcha') || href.includes('/captcha')
        || CAPTCHA_TEXT_PATTERNS.some(p => title.includes(p) || body_text.includes(p));
}

function isLoginPage({ href, title }) {
    return href.includes('clogin.ke.com/') || /\/login(?:[/?#]|$)/.test(href)
        || LOGIN_TEXT_PATTERNS.some(p => title.includes(p));
}

export function assertNotBlocked(state) {
    if (isLoginPage(state)) {
        throw new AuthRequiredError('ke.com', '未登录或登录已过期，请先在浏览器中登录贝壳找房');
    }
    if (isCaptchaPage(state)) {
        throw new AuthRequiredError('ke.com', '触发了验证码，请先在浏览器中完成验证');
    }
}

export async function gotoKe(page, url, { captchaTimeout = 0 } = {}) {
    if (!Number.isSafeInteger(captchaTimeout) || captchaTimeout < 0) {
        throw new ArgumentError('captcha-timeout 必须是非负整数秒数');
    }
    await page.goto(url, { settleMs: 2500 });
    await page.wait(2);
    let state = await readPageState(page);
    if (isLoginPage(state) || !isCaptchaPage(state) || captchaTimeout === 0) {
        assertNotBlocked(state);
        return state;
    }

    const deadline = Date.now() + captchaTimeout * 1000;
    const target = new URL(url);
    let restoredTarget = false;
    process.stderr.write(`贝壳触发验证码，请在浏览器当前页面完成验证；最多等待 ${captchaTimeout} 秒，完成后自动继续。\n`);
    while (Date.now() < deadline) {
        if (isLoginPage(state)) assertNotBlocked(state);
        const captcha = isCaptchaPage(state);
        if (!captcha) {
            assertNotBlocked(state);
            let current;
            try { current = new URL(state.href); } catch { /* navigation may temporarily have no URL */ }
            if (current?.origin === target.origin && state.title && state.body_text) {
                if (current.pathname === target.pathname && current.search === target.search) {
                    process.stderr.write('贝壳验证已完成，继续采集。\n');
                    return state;
                }
                if (!restoredTarget) {
                    restoredTarget = true;
                    await page.goto(url, { settleMs: 2500 });
                    await page.wait(2);
                    state = await readPageState(page);
                    continue;
                }
            }
        } else if (!restoredTarget && [state.title, state.body_text]
            .some(value => /^(?:验证成功|验证通过)(?:[，,！!。.\s]|$)/.test(value))) {
            // Some challenge pages show success without redirecting themselves.
            restoredTarget = true;
            await page.goto(url, { settleMs: 2500 });
            await page.wait(2);
            state = await readPageState(page);
            continue;
        }
        const remainingSeconds = (deadline - Date.now()) / 1000;
        if (remainingSeconds <= 0) break;
        await page.sleep(Math.min(2, remainingSeconds));
        state = await readPageState(page);
    }
    throw new TimeoutError('贝壳验证码验证', captchaTimeout, '请完成浏览器中的验证后重试，或调高 --captcha-timeout / --timeout');
}

/**
 * Fetch a ke.com JSON API from inside the browser context (credentials included).
 */
export async function fetchKeJson(page, url) {
    const result = await page.evaluate(`(async () => {
    const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
    if (!res.ok) return { __keErr: res.status };
    try {
      return await res.json();
    } catch {
      return { __keErr: 'parse' };
    }
  })()`);
    const r = result;
    if (r?.__keErr !== undefined) {
        const code = r.__keErr;
        if (code === 401 || code === 403) {
            throw new AuthRequiredError('ke.com', '未登录或登录已过期，请先在浏览器中登录贝壳找房');
        }
        if (code === 'parse') {
            throw new CommandExecutionError('响应不是有效 JSON', '可能触发了风控，请检查登录状态或稍后重试');
        }
        throw new CommandExecutionError(`HTTP ${code}`, '请检查网络连接或登录状态');
    }
    return result;
}

/**
 * Build a ke.com city URL prefix. Default city is 'bj' (Beijing).
 */
export function cityUrl(city) {
    return `https://${city}.ke.com`;
}
