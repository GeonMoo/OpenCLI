import { AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
// Keep the helper within the adapter so `opencli adapter eject liepin` remains runnable.
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

const LIEPIN_HOME_URL = 'https://c.liepin.com/';
const LIEPIN_LOGIN_URL = 'https://www.liepin.com/login?backUrl=https%3A%2F%2Fc.liepin.com%2F';

export function extractLiepinIdentity() {
    const text = element => (element?.innerText || element?.textContent || '').trim();
    const userMenu = document.querySelector('#header-quick-menu-user-info');
    const resumeCardName = document.querySelector('a[data-nick="aside-edit-resume-btn"]')
        ?.parentElement?.querySelector('[class^="name--"]');
    const displayName = text(userMenu?.querySelector('.header-quick-menu-username')) || text(resumeCardName);
    const bodyText = text(document.body);
    return {
        accountLabel: displayName,
        hasUserMenu: !!userMenu || !!resumeCardName,
        loginPage: /\/login(?:\/|$)|\/passport(?:\/|$)/.test(location.pathname),
        hasLoginLink: !!document.querySelector('a[href*="/login"], a[href*="/passport"]')
            || /登录\s*[/／]?\s*注册/.test(text(document.querySelector('#framework-pc-header-container'))),
        blocked: /安全验证|访问过于频繁|滑动验证/.test(bodyText),
    };
}

function identityFromSnapshot(snapshot) {
    if (snapshot?.blocked) {
        throw new CommandExecutionError('Liepin is showing a security verification or rate limit; resolve it in Chrome before retrying');
    }
    if (snapshot?.hasUserMenu && snapshot.accountLabel) {
        return { id: null, displayName: snapshot.accountLabel, userType: 'candidate' };
    }
    if (snapshot?.loginPage || snapshot?.hasLoginLink) {
        throw new AuthRequiredError('liepin.com', '请先登录猎聘候选人账号');
    }
    throw new CommandExecutionError('Liepin candidate account marker is missing; the homepage layout may have changed');
}

async function probeLiepinIdentity(page) {
    if (!page) throw new CommandExecutionError('Browser page required');
    let snapshot;
    for (let attempt = 0; attempt < 20; attempt++) {
        snapshot = await page.evaluate(extractLiepinIdentity);
        if (snapshot?.blocked || (snapshot?.hasUserMenu && snapshot.accountLabel)
            || snapshot?.loginPage || snapshot?.hasLoginLink) return identityFromSnapshot(snapshot);
        if (attempt < 19) await page.wait(0.5);
    }
    if (snapshot?.hasUserMenu) return identityFromSnapshot(snapshot);
    throw new TimeoutError('Liepin candidate account', 10);
}

async function verifyLiepinIdentity(page) {
    if (!page) throw new CommandExecutionError('Browser page required');
    await page.goto(LIEPIN_HOME_URL);
    return probeLiepinIdentity(page);
}

registerSiteAuthCommands({
    site: 'liepin',
    domain: 'liepin.com',
    loginUrl: LIEPIN_LOGIN_URL,
    columns: ['id', 'displayName', 'userType'],
    whoamiDescription: 'Show the current logged-in Liepin candidate account',
    loginDescription: 'Open Liepin candidate login and wait until the browser session is authenticated',
    verify: verifyLiepinIdentity,
    poll: probeLiepinIdentity,
});

export const __test__ = {
    LIEPIN_HOME_URL,
    LIEPIN_LOGIN_URL,
    identityFromSnapshot,
    probeLiepinIdentity,
    verifyLiepinIdentity,
};
