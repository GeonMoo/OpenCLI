import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { assertList, chatRequest, decodePayload, opaqueId, positiveInteger, prepareChat, timestamp } from './chat-utils.js';

export function messageToRow(message) {
    const payload = decodePayload(message.payload);
    const direction = String(message.direction);
    if (!['0', '1'].includes(direction)) throw new CommandExecutionError('Liepin message has an invalid direction');
    return {
        from: direction === '0' ? 'self' : 'other', type: payload.type || message.msgType || null,
        text: message.revokeFlag ? '[已撤回]' : payload.text, time: timestamp(message.msgTime),
        msgId: opaqueId(message.msgId, 'message ID'),
    };
}

cli({
    site: 'liepin', name: 'chatmsg', access: 'read', description: '猎聘求职端查看聊天消息历史（不标记已读）',
    domain: 'liepin.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    defaultWindowMode: 'background', siteSession: 'persistent',
    args: [
        { name: 'uid', positional: true, required: true, help: 'Contact uid from liepin chatlist (oppositeImId)' },
        { name: 'page', type: 'int', default: 1, help: 'History page (1 is the newest page)' },
        { name: 'limit', type: 'int', default: 20, help: 'Messages per page (1-100)' },
    ],
    columns: ['from', 'type', 'text', 'time', 'msgId'],
    func: async (page, args) => {
        const uid = String(args.uid ?? '').trim();
        if (!/^[A-Za-z0-9_-]+$/.test(uid)) throw new ArgumentError('liepin uid must be the uid returned by chatlist');
        const requestedPage = positiveInteger(args.page, 1, 'page');
        const limit = positiveInteger(args.limit, 20, 'limit', 100);
        const context = await prepareChat(page);
        let cursor = '';
        for (let current = 1; current <= requestedPage; current++) {
            const data = await chatRequest(page, context, 'chat.chat-list', { maxMessageId: cursor, oppositeImId: uid, pageSize: limit });
            const list = assertList(data);
            if (!list.length) throw new EmptyResultError('liepin chatmsg', `No messages on page ${requestedPage}`);
            if (cursor && list.at(-1).msgId === cursor) throw new CommandExecutionError('Liepin message pagination did not advance');
            if (current === requestedPage) {
                const unique = [...new Map(list.map(message => [opaqueId(message.msgId, 'message ID'), message])).values()];
                // The service returns newest first; display each requested page chronologically.
                return unique.slice(0, limit).reverse().map(messageToRow);
            }
            // Liepin's own IM client uses batch length here: the history service can
            // report hasMore=false for a full batch even when older messages exist.
            if (list.length < limit) throw new EmptyResultError('liepin chatmsg', `Page ${requestedPage} does not exist`);
            const next = opaqueId(list.at(-1).msgId, 'message pagination cursor');
            cursor = next;
        }
    },
});
