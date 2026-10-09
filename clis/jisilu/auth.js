import { AuthRequiredError } from '@geonmoo/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

export function readIdentity() {
  const anchor = document.querySelector('.header_navbar_bg a[href^="/people/"] .name');
  if (!anchor) return null;
  const username = anchor.textContent.trim();
  const url = anchor.closest('a').href;
  return username ? { username, profileUrl: url } : null;
}

async function currentIdentity(page) {
  const identity = await page.evaluate(readIdentity);
  if (!identity) throw new AuthRequiredError('www.jisilu.cn', '请先运行 opencli jisilu login 登录集思录');
  return identity;
}

registerSiteAuthCommands({
  site: 'jisilu', domain: 'www.jisilu.cn', loginUrl: 'https://www.jisilu.cn/account/login/',
  columns: ['username', 'profileUrl'],
  quickCheck: async page => !!await page.evaluate(readIdentity),
  verify: async page => {
    await page.goto('https://www.jisilu.cn/web/data/cb/list');
    await page.wait(1);
    return currentIdentity(page);
  },
  poll: currentIdentity,
});