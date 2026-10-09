import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { BASE, checkPage } from './utils.js';

// Strategy: DOM_STATE / visible-ui. Fresh SSR user state, never cached localStorage tokens.
export async function probeIdentity(page) {
  await checkPage(page);
  const result = await page.evaluate(() => {
    const response = window.__NEXT_DATA__?.props?.pageProps?.dehydratedState?.queries
      ?.find(q => q.queryKey?.[0] === '/next/web/getUserInfo')?.state?.data;
    if (!response) return { kind: 'missing' };
    if (response.state !== 'ok' || !response.data?.userId) return { kind: 'anonymous' };
    return { kind: 'identity', accountId: String(response.data.userId), displayName: response.data.nickname ?? null, vip: response.data.isVip === true };
  });
  if (result?.kind === 'anonymous') throw new AuthRequiredError('tianyancha.com');
  if (result?.kind !== 'identity') throw new CommandExecutionError('Tianyancha user state is missing; inspect the retained tab');
  return { id: result.accountId, name: result.displayName, isVip: result.vip };
}

registerSiteAuthCommands({
  site: 'tianyancha',
  domain: 'tianyancha.com',
  loginUrl: `${BASE}/`,
  columns: ['id', 'name', 'isVip'],
  verify: async page => {
    await page.goto(`${BASE}/`);
    await page.wait(1);
    return probeIdentity(page);
  },
  poll: async page => {
    const response = await page.evaluate(() => {
      const user = document.querySelector('.tyc-nav-user');
      return user?.textContent?.trim() && !/登录|注册/.test(user.textContent);
    });
    if (!response) throw new AuthRequiredError('tianyancha.com', 'Finish login in the Tianyancha browser tab');
    await page.goto(`${BASE}/`);
    await page.wait(1);
    return probeIdentity(page);
  },
});
