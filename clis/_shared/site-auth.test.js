import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, TimeoutError } from '@geonmoo/opencli/errors';
import { getRegistry } from '@geonmoo/opencli/registry';
import { registerSiteAuthCommands } from './site-auth.js';

function pageMock() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
  };
}

describe('site auth command helper', () => {
  it('registers whoami and foreground login commands', () => {
    registerSiteAuthCommands({
      site: 'auth-helper-registration',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      verify: async () => ({ username: 'alice' }),
    });

    expect(getRegistry().get('auth-helper-registration/whoami')).toMatchObject({
      access: 'read',
      browser: true,
      navigateBefore: false,
      columns: ['logged_in', 'site', 'username'],
    });
    expect(getRegistry().get('auth-helper-registration/login')).toMatchObject({
      access: 'write',
      browser: true,
      navigateBefore: false,
      defaultWindowMode: 'foreground',
      siteSession: 'persistent',
      columns: ['status', 'logged_in', 'site', 'username'],
    });
  });

  it('whoami returns normalized identity without opening login', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-whoami',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      verify: async () => ({ username: 'alice' }),
    });
    const cmd = getRegistry().get('auth-helper-whoami/whoami');
    const page = pageMock();

    await expect(cmd.func(page, {})).resolves.toEqual({
      logged_in: true,
      site: 'auth-helper-whoami',
      username: 'alice',
    });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('login opens the login URL and polls until authenticated', async () => {
    const poll = vi.fn()
      .mockRejectedValueOnce(new AuthRequiredError('example.com', 'not yet'))
      .mockResolvedValueOnce({ username: 'alice' });
    registerSiteAuthCommands({
      site: 'auth-helper-login',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      verify: async () => { throw new AuthRequiredError('example.com', 'missing'); },
      poll,
    });
    const cmd = getRegistry().get('auth-helper-login/login');
    const page = pageMock();

    await expect(cmd.func(page, { timeout: 1 })).resolves.toEqual({
      status: 'login_complete',
      logged_in: true,
      site: 'auth-helper-login',
      username: 'alice',
    });
    expect(page.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(page.wait).toHaveBeenCalled();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('login times out when auth never completes', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-timeout',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      verify: async () => { throw new AuthRequiredError('example.com', 'missing'); },
      poll: async () => { throw new AuthRequiredError('example.com', 'still missing'); },
    });
    const cmd = getRegistry().get('auth-helper-timeout/login');
    const page = pageMock();

    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(1000);
    await expect(cmd.func(page, { timeout: 1 })).rejects.toBeInstanceOf(TimeoutError);
    clock.mockRestore();
    expect(page.goto).toHaveBeenCalledWith('https://example.com/login');
  });

  it('rejects invalid timeouts before probing or navigating', async () => {
    const verify = vi.fn(async () => ({ username: 'alice' }));
    registerSiteAuthCommands({
      site: 'auth-helper-invalid-timeout', domain: 'example.com',
      loginUrl: 'https://example.com/login', verify,
    });
    const cmd = getRegistry().get('auth-helper-invalid-timeout/login');
    const page = pageMock();
    for (const timeout of [0, -1, 1.5, NaN, Infinity, 'invalid', Number.MAX_SAFE_INTEGER + 1]) {
      await expect(cmd.func(page, { timeout })).rejects.toBeInstanceOf(ArgumentError);
    }
    expect(verify).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });
});
