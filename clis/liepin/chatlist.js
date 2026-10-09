import { cli, Strategy } from '@geonmoo/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { assertList, chatRequest, decodePayload, opaqueId, positiveInteger, prepareChat, timestamp } from './chat-utils.js';

export function contactToRow(contact) {
    if (!contact || typeof contact.name !== 'string' || !contact.name.trim()) {
        throw new CommandExecutionError('Liepin contact is missing a name');
    }
    const unread = contact.unReadCnt;
    if (unread != null && (!Number.isSafeInteger(unread) || unread < 0)) {
        throw new CommandExecutionError('Liepin contact has an invalid unread count');
    }
    return {
        name: contact.name.trim(), company: contact.company || null, title: contact.title || null,
        lastMessage: contact.latestMsgIsRevoke ? '[已撤回]' : decodePayload(contact.lastPayload).text,
        lastTime: timestamp(contact.latestMsgTime), unreadCount: unread ?? null,
        uid: opaqueId(contact.oppositeImId, 'contact UID'),
        userId: contact.oppositeUserId || null, userType: contact.oppositeImUserType ?? null,
    };
}

cli({
    site: 'liepin', name: 'chatlist', access: 'read', description: '猎聘求职端查看聊天列表',
    domain: 'liepin.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    defaultWindowMode: 'background', siteSession: 'persistent',
    args: [
        { name: 'page', type: 'int', default: 1, help: 'Page number (starts at 1; follows actual cursors)' },
        { name: 'limit', type: 'int', default: 20, help: 'Contacts per page (1-100)' },
    ],
    columns: ['name', 'company', 'title', 'lastMessage', 'lastTime', 'unreadCount', 'uid', 'userId', 'userType'],
    func: async (page, args) => {
        const requestedPage = positiveInteger(args.page, 1, 'page');
        const limit = positiveInteger(args.limit, 20, 'limit', 100);
        const context = await prepareChat(page);
        let cursor = '';
        for (let current = 1; current <= requestedPage; current++) {
            const data = await chatRequest(page, context, 'contact.get-contact-list', { curPage: current - 1, sortValue: cursor, pageSize: limit });
            const list = assertList(data);
            if (!list.length) throw new EmptyResultError('liepin chatlist', `No contacts on page ${requestedPage}`);
            if (cursor && list.at(-1).sortValue === cursor) throw new CommandExecutionError('Liepin contact pagination did not advance');
            if (current === requestedPage) {
                return [...new Map(list.map(contact => [opaqueId(contact.oppositeImId, 'contact UID'), contact])).values()]
                    .slice(0, limit).map(contactToRow);
            }
            if (!data.hasMore) throw new EmptyResultError('liepin chatlist', `Page ${requestedPage} does not exist`);
            const next = opaqueId(list.at(-1).sortValue, 'contact pagination cursor');
            cursor = next;
        }
    },
});
