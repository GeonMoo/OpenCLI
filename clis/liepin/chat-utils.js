import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

// Origin, type 0, client ID and form fields observed in Liepin's candidate IM client.
// ponytail: Refresh these client headers if Liepin changes its IM protocol.
const CANDIDATE_CHAT = {
    home: 'https://c.liepin.com/', apiBase: 'https://api-c.liepin.com', channel: 'c', imUserType: '0', clientId: '11156', version: '1.0.0',
};

export function positiveInteger(value, fallback, label, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value ?? fallback);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new ArgumentError(`liepin ${label} must be a positive safe integer${maximum === Number.MAX_SAFE_INTEGER ? '' : ` <= ${maximum}`}`);
    }
    return parsed;
}

export async function prepareChat(page) {
    if (!page) throw new CommandExecutionError('Browser page required');
    const context = CANDIDATE_CHAT;
    await page.goto(context.home);
    for (let attempt = 0; attempt < 20; attempt++) {
        const state = await page.evaluate(type => {
            const body = document.body?.innerText || document.body?.textContent || '';
            const cookie = document.cookie.split(';').map(item => item.trim())
                .find(item => item.startsWith(`imId_${type}=`));
            return {
                ready: !!cookie?.slice(cookie.indexOf('=') + 1),
                needsAuth: /^\/(?:login|passport)(?:\/|$)/.test(location.pathname),
                blocked: /安全验证|访问过于频繁|滑动验证/.test(body),
            };
        }, context.imUserType);
        if (state?.blocked) throw new CommandExecutionError('Liepin is showing a security verification or rate limit; resolve it in Chrome before retrying');
        if (state?.needsAuth) throw new AuthRequiredError('liepin.com', '请先在 Chrome 登录猎聘求职账号');
        if (state?.ready) return context;
        if (attempt < 19) await page.wait(0.5);
    }
    throw new AuthRequiredError('liepin.com', '猎聘求职端 IM 会话不可用；请在 Chrome 登录求职账号后重试');
}

const READ_ENDPOINTS = new Set(['contact.get-contact-list', 'chat.chat-list', 'chat.unread-count']);

export async function chatRequest(page, context, endpoint, params = {}) {
    if (!READ_ENDPOINTS.has(endpoint)) throw new ArgumentError('Unsupported Liepin read endpoint');
    const result = await page.evaluate(async (configuration, suffix, parameters) => {
        const cookie = name => {
            const raw = document.cookie.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
            return raw ? decodeURIComponent(raw.slice(name.length + 1)) : '';
        };
        const imId = cookie(`imId_${configuration.imUserType}`);
        if (!imId) return { needsAuth: true };
        const body = new URLSearchParams({
            ...parameters, imUserType: configuration.imUserType,
            imId, imApp: cookie(`imApp_${configuration.imUserType}`) || '1',
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(`${configuration.apiBase}/api/com.liepin.im.${configuration.channel}.${suffix}`, {
                method: 'POST', credentials: 'include', signal: controller.signal,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest', 'X-Client-Type': 'web',
                    'X-Fscp-Version': '1.1', 'X-Fscp-Fe-Version': configuration.version,
                    'X-Fscp-Std-Info': JSON.stringify({ client_id: configuration.clientId }),
                    'X-Fscp-Trace-Id': crypto.randomUUID(),
                    'X-Fscp-Bi-Stat': JSON.stringify({ location: location.href }),
                }, body,
            });
            if (!response.ok) return { status: response.status };
            return { status: response.status, data: await response.json() };
        } catch (error) {
            return { timedOut: controller.signal.aborted, failed: true };
        } finally {
            clearTimeout(timer);
        }
    }, context, endpoint, params);
    if (result?.needsAuth || result?.status === 401 || result?.status === 403) {
        throw new AuthRequiredError('liepin.com', '猎聘会话已过期，请在 Chrome 登录后重试');
    }
    if (result?.timedOut) throw new TimeoutError('Liepin chat request', 30);
    if (result?.failed || result?.status !== 200 || !result.data || typeof result.data !== 'object') {
        throw new CommandExecutionError('Liepin chat request failed or returned an invalid response');
    }
    const envelope = result.data;
    if (envelope.flag !== 1) {
        if (String(envelope.code) === '103160306' || /未登录|登录.*(?:失效|过期)|请.*登录|login expired|not logged/i.test(envelope.msg || '')) {
            throw new AuthRequiredError('liepin.com', '猎聘会话已过期，请在 Chrome 登录后重试');
        }
        // Do not include server payloads/credentials in error output.
        throw new CommandExecutionError(`Liepin chat API failed${envelope.code == null ? '' : ` (code ${envelope.code})`}`);
    }
    if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
        throw new CommandExecutionError('Liepin chat API returned an invalid data object');
    }
    return envelope.data;
}

export function timestamp(value) {
    if (value === undefined || value === null || value === '') return null;
    const milliseconds = Number(value);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || Number.isNaN(new Date(milliseconds).getTime())) {
        throw new CommandExecutionError('Liepin returned an invalid message timestamp');
    }
    return new Date(milliseconds).toISOString();
}

export function decodePayload(value) {
    if (value === undefined || value === null || value === '') return { type: null, text: null };
    let parsed;
    try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
    catch { throw new CommandExecutionError('Liepin returned malformed message payload JSON'); }
    if (!parsed || !Array.isArray(parsed.bodies) || !parsed.bodies.length) {
        throw new CommandExecutionError('Liepin message payload is missing bodies');
    }
    const bodies = parsed.bodies;
    const types = [...new Set(bodies.map(body => body.type).filter(Boolean))];
    const text = bodies.map(body => body.type === 'img' ? body.url : body.msg ?? body.url ?? body.filename ?? null)
        .filter(value => value !== null && value !== undefined).map(String).join('\n');
    return { type: types.join(', ') || null, text: text || null };
}

export function assertList(data) {
    if (!data || !Array.isArray(data.list) || typeof data.hasMore !== 'boolean') {
        throw new CommandExecutionError('Liepin chat response is missing list or pagination metadata');
    }
    return data.list;
}

export function opaqueId(value, label) {
    // 64-bit IDs must remain strings; accepting unsafe JSON numbers loses precision.
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new CommandExecutionError(`Liepin returned an invalid ${label}`);
    }
    return value;
}
