import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@geonmoo/opencli/errors';
import { chatRequest, decodePayload, prepareChat, timestamp } from './chat-utils.js';
import { contactToRow } from './chatlist.js';
import { messageToRow } from './chatmsg.js';

const chatlist = getRegistry().get('liepin/chatlist');
const chatmsg = getRegistry().get('liepin/chatmsg');
const context = { apiBase: 'https://api-c.liepin.com', channel: 'c', imUserType: '0', clientId: '11156', version: '1.0.0' };
// Synthetic values using the response shape observed on Liepin; no private chats are stored.
const payload = msg => JSON.stringify({ bodies: [{ type: 'txt', msg }], push: '1' });
const contact = (id = 'contact1', overrides = {}) => ({
    name: '陈女士', company: '示例公司', title: '招聘顾问',
    lastPayload: payload('测试消息'), latestMsgTime: 1791443463000, unReadCnt: 0,
    oppositeImId: id, oppositeUserId: 'user1', oppositeImUserType: '2',
    sortValue: '1383827169323388932', ...overrides,
});
const message = (id = '1383827169323388932', overrides = {}) => ({
    msgId: id, direction: '1', msgType: 'txt', payload: payload('测试消息'),
    msgTime: 1791443463000, revokeFlag: false, ...overrides,
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function browserPage(responses) {
    const dom = new JSDOM('<body></body>', { url: 'https://c.liepin.com/' });
    dom.window.document.cookie = 'imId_0=synthetic-session';
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('location', dom.window.location);
    const fetch = vi.fn();
    for (const response of responses) {
        fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ flag: 1, data: response }) });
    }
    vi.stubGlobal('fetch', fetch);
    return {
        goto: vi.fn(),
        evaluate: vi.fn(async (fn, ...args) => fn(...args)), wait: vi.fn(), fetch,
    };
}

describe('Liepin chat read commands', () => {
    it('registers read access and maps the live contact shape without losing zero or opaque IDs', async () => {
        expect(chatlist).toMatchObject({ access: 'read', strategy: Strategy.COOKIE, browser: true });
        expect(chatmsg).toMatchObject({ access: 'read', strategy: Strategy.COOKIE, browser: true });
        const page = browserPage([{ list: [contact(), contact()], hasMore: false }]);
        const rows = await chatlist.func(page, {});
        expect(rows).toEqual([{
            name: '陈女士', company: '示例公司', title: '招聘顾问', lastMessage: '测试消息',
            lastTime: '2026-10-08T07:11:03.000Z', unreadCount: 0,
            uid: 'contact1', userId: 'user1', userType: '2',
        }]);
        expect(Object.keys(rows[0])).toEqual(chatlist.columns);
        const [url, options] = page.fetch.mock.calls[0];
        expect(url).toBe('https://api-c.liepin.com/api/com.liepin.im.c.contact.get-contact-list');
        expect(Object.fromEntries(options.body)).toMatchObject({ curPage: '0', sortValue: '', pageSize: '20', imUserType: '0', imId: 'synthetic-session' });
        expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
        expect(options.headers).not.toHaveProperty('X-XSRF-TOKEN');
    });

    it('uses contact cursors and actual zero-based page numbers for page 2', async () => {
        const page = browserPage([
            { list: [contact()], hasMore: true },
            { list: [contact('contact2', { sortValue: '1383827169323388931' })], hasMore: false },
        ]);
        expect(await chatlist.func(page, { page: 2, limit: 1 })).toMatchObject([{ uid: 'contact2' }]);
        expect(Object.fromEntries(page.fetch.mock.calls[1][1].body)).toMatchObject({ curPage: '1', sortValue: '1383827169323388932', pageSize: '1' });
    });

    it('reads history chronologically and paginates with the oldest opaque msgId', async () => {
        const page = browserPage([
            { list: [message('1383827169323388932'), message('1383827169323388931')], hasMore: true },
            { list: [message('1383827169323388930'), message('1383827169323388929', { direction: '0' })], hasMore: false },
        ]);
        const rows = await chatmsg.func(page, { uid: 'contact1', page: 2, limit: 2 });
        expect(rows.map(row => row.msgId)).toEqual(['1383827169323388929', '1383827169323388930']);
        expect(rows.map(row => row.from)).toEqual(['self', 'other']);
        expect(Object.keys(rows[0])).toEqual(chatmsg.columns);
        expect(Object.fromEntries(page.fetch.mock.calls[0][1].body)).toMatchObject({ maxMessageId: '', oppositeImId: 'contact1', pageSize: '2' });
        expect(Object.fromEntries(page.fetch.mock.calls[1][1].body)).toMatchObject({ maxMessageId: '1383827169323388931' });
        for (const [url] of page.fetch.mock.calls) expect(url).toMatch(/\/com\.liepin\.im\.c\.chat\.chat-list$/);
    });

    it('continues a full history batch even when the server hasMore flag is false, like the site client', async () => {
        const page = browserPage([
            { list: [message('1383827169323388932')], hasMore: false },
            { list: [message('1383827169323388931')], hasMore: false },
        ]);
        expect(await chatmsg.func(page, { uid: 'contact1', limit: 1, page: 2 })).toMatchObject([{ msgId: '1383827169323388931' }]);
    });

    it('rejects invalid parameters before any browser navigation or request', async () => {
        const page = browserPage([]);
        for (const command of [chatlist, chatmsg]) {
            for (const limit of [0, -1, 1.5, 101, 'bad']) {
                await expect(command.func(page, { uid: 'contact1', limit })).rejects.toBeInstanceOf(ArgumentError);
            }
            for (const pageNumber of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
                await expect(command.func(page, { uid: 'contact1', page: pageNumber })).rejects.toBeInstanceOf(ArgumentError);
            }
        }
        for (const uid of ['', 'id with spaces', 'https://example.com']) {
            await expect(chatmsg.func(page, { uid })).rejects.toBeInstanceOf(ArgumentError);
        }
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.fetch).not.toHaveBeenCalled();
    });

    it('distinguishes empty pages, invalid schemas and stalled pagination', async () => {
        await expect(chatlist.func(browserPage([{ list: [], hasMore: false }]), {})).rejects.toBeInstanceOf(EmptyResultError);
        await expect(chatmsg.func(browserPage([{ list: [], hasMore: false }]), { uid: 'contact1' })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(chatlist.func(browserPage([{ list: [contact()], hasMore: false }]), { page: 2 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(chatmsg.func(browserPage([{ list: [message()], hasMore: false }]), { uid: 'contact1', page: 2 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(chatlist.func(browserPage([{ list: [contact()] }]), {})).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(chatlist.func(browserPage([
            { list: [contact()], hasMore: true }, { list: [contact()], hasMore: true },
        ]), { page: 2 })).rejects.toThrow('did not advance');
        await expect(chatmsg.func(browserPage([
            { list: [message()], hasMore: true }, { list: [message()], hasMore: true },
        ]), { uid: 'contact1', page: 2, limit: 1 })).rejects.toThrow('did not advance');
    });

    it('handles image, multipart and revoked payloads and rejects malformed data', () => {
        expect(decodePayload(JSON.stringify({ bodies: [{ type: 'img', url: 'https://example.com/image.png' }] })))
            .toEqual({ type: 'img', text: 'https://example.com/image.png' });
        expect(decodePayload({ bodies: [{ type: 'txt', msg: 'one' }, { type: 'txt', msg: 'two' }] }).text).toBe('one\ntwo');
        expect(contactToRow(contact('contact1', { latestMsgIsRevoke: true })).lastMessage).toBe('[已撤回]');
        expect(messageToRow(message('id1', { revokeFlag: true })).text).toBe('[已撤回]');
        expect(() => decodePayload('{bad')).toThrow(CommandExecutionError);
        expect(() => decodePayload({})).toThrow(CommandExecutionError);
        expect(() => contactToRow(contact('', {}))).toThrow(CommandExecutionError);
        expect(() => contactToRow(contact('contact1', { unReadCnt: -1 }))).toThrow(CommandExecutionError);
        expect(() => messageToRow(message(1383827169323388932))).toThrow(CommandExecutionError);
        expect(() => messageToRow(message('id1', { direction: 'unexpected' }))).toThrow(CommandExecutionError);
        expect(() => timestamp('invalid')).toThrow(CommandExecutionError);
        expect(timestamp(null)).toBeNull();
    });

    it('rejects missing auth and security checks without sending chat requests', async () => {
        const page = browserPage([]);
        document.cookie = 'imId_0=; Max-Age=0';
        document.cookie = 'imId_2=unrelated-session';
        await expect(prepareChat(page)).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledWith('https://c.liepin.com/');
        document.body.textContent = '安全验证';
        await expect(prepareChat(page)).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.fetch).not.toHaveBeenCalled();
    });

    it('classifies transport errors and excludes write endpoints', async () => {
        const page = browserPage([]);
        page.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
        await expect(chatRequest(page, context, 'chat.chat-list')).rejects.toBeInstanceOf(AuthRequiredError);
        page.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
        await expect(chatRequest(page, context, 'chat.chat-list')).rejects.toBeInstanceOf(CommandExecutionError);
        page.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ flag: 0, code: '103160306' }) });
        await expect(chatRequest(page, context, 'chat.chat-list')).rejects.toBeInstanceOf(AuthRequiredError);
        page.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ flag: 0, code: 'unexpected' }) });
        await expect(chatRequest(page, context, 'chat.chat-list')).rejects.toBeInstanceOf(CommandExecutionError);
        page.fetch.mockRejectedValueOnce(new Error('private data must not leak'));
        await expect(chatRequest(page, context, 'chat.chat-list')).rejects.toThrow('invalid response');
        page.evaluate.mockResolvedValueOnce({ timedOut: true });
        await expect(chatRequest(page, context, 'chat.chat-list')).rejects.toBeInstanceOf(TimeoutError);
        const calls = page.fetch.mock.calls.length;
        for (const endpoint of ['chat.readed-msg', 'chat.send-common-msg', 'contact.remove-contact']) {
            await expect(chatRequest(page, context, endpoint)).rejects.toBeInstanceOf(ArgumentError);
        }
        expect(page.fetch).toHaveBeenCalledTimes(calls);
    });
});
