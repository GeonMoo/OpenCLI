import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const LIEPIN_HOME_URL = 'https://c.liepin.com/';

export function extractCandidateStats() {
    const text = element => (element?.innerText || element?.textContent || '').trim();
    const parseVisibleCount = raw => {
        const normalized = String(raw ?? '').trim().replaceAll(',', '');
        const value = /^\d+$/.test(normalized) ? Number(normalized) : null;
        return Number.isSafeInteger(value) ? value : null;
    };
    const counters = {
        resumeViews: '/resume/viewed-log',
        applications: '/job/record/apply',
        favorites: '/job/record/favorite',
    };
    const resumeCardName = document.querySelector('a[data-nick="aside-edit-resume-btn"]')
        ?.parentElement?.querySelector('[class^="name--"]');
    const displayName = text(document.querySelector('#header-quick-menu-user-info .header-quick-menu-username')) || text(resumeCardName);
    const bodyText = text(document.body);
    const counterValues = {};
    const missingCounters = [];
    for (const [field, path] of Object.entries(counters)) {
        const link = [...document.querySelectorAll('a[href]')].find(element => {
            try {
                return new URL(element.getAttribute('href'), location.href).pathname === path;
            } catch {
                return false;
            }
        });
        const value = parseVisibleCount(text(link?.querySelector('h2')));
        if (value === null) missingCounters.push(field);
        counterValues[field] = value;
    }
    const unreadElement = document.querySelector('#im-c-entry .im-ui-basic-entry-unread-count');
    const unreadChats = unreadElement ? parseVisibleCount(text(unreadElement)) : null;
    return {
        displayName,
        loginPage: /\/login(?:\/|$)|\/passport(?:\/|$)/.test(location.pathname),
        hasLoginLink: !!document.querySelector('a[href*="/login"], a[href*="/passport"]')
            || /登录\s*[/／]?\s*注册/.test(text(document.querySelector('#framework-pc-header-container'))),
        blocked: /安全验证|访问过于频繁|滑动验证/.test(bodyText),
        counterValues,
        missingCounters,
        unreadBadgeValue: unreadChats,
        invalidUnread: !!unreadElement && unreadChats === null,
    };
}

function statsFromSnapshot(snapshot) {
    if (snapshot?.blocked) {
        throw new CommandExecutionError('Liepin is showing a security verification or rate limit; resolve it in Chrome before retrying');
    }
    if (!snapshot?.displayName) {
        if (snapshot?.loginPage || snapshot?.hasLoginLink) {
            throw new AuthRequiredError('liepin.com', '请先登录猎聘候选人账号');
        }
        throw new CommandExecutionError('Liepin candidate account marker is missing; the homepage layout may have changed');
    }
    if (!snapshot.counterValues || snapshot.missingCounters?.length) {
        throw new CommandExecutionError(`Liepin account counters are missing or invalid: ${(snapshot.missingCounters || []).join(', ') || 'unknown'}`);
    }
    if (snapshot.invalidUnread) {
        throw new CommandExecutionError('Liepin unread chat counter is not numeric; the homepage layout may have changed');
    }
    return {
        resumeViews: snapshot.counterValues.resumeViews,
        applications: snapshot.counterValues.applications,
        favorites: snapshot.counterValues.favorites,
        unreadChats: snapshot.unreadBadgeValue,
    };
}

async function readCandidateStats(page) {
    if (!page) throw new CommandExecutionError('Browser page required');
    await page.goto(LIEPIN_HOME_URL);
    let snapshot;
    for (let attempt = 0; attempt < 20; attempt++) {
        snapshot = await page.evaluate(extractCandidateStats);
        if (snapshot?.blocked || snapshot?.loginPage
            || (!snapshot?.displayName && snapshot?.hasLoginLink)
            || (snapshot?.displayName && snapshot.counterValues && !snapshot.missingCounters?.length)) {
            return statsFromSnapshot(snapshot);
        }
        if (attempt < 19) await page.wait(0.5);
    }
    if (snapshot?.displayName) return statsFromSnapshot(snapshot);
    throw new TimeoutError('Liepin account statistics', 10);
}

cli({
    site: 'liepin',
    name: 'stats',
    access: 'read',
    description: '猎聘求职账号首页统计（简历被查看、投递、收藏、未读聊天）',
    domain: 'c.liepin.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [],
    columns: ['resumeViews', 'applications', 'favorites', 'unreadChats'],
    func: async page => [await readCandidateStats(page)],
});

export const __test__ = {
    LIEPIN_HOME_URL,
    statsFromSnapshot,
    readCandidateStats,
};
