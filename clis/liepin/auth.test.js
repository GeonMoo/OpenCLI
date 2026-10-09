import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@geonmoo/opencli/errors';
import { extractLiepinIdentity, __test__ } from './auth.js';

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/homepage.html'), 'utf8');

describe('liepin auth', () => {
    let originalDocument;
    let originalLocation;

    beforeEach(() => {
        originalDocument = globalThis.document;
        originalLocation = globalThis.location;
    });

    afterEach(() => {
        globalThis.document = originalDocument;
        globalThis.location = originalLocation;
    });

    function load(html = fixture, url = 'https://c.liepin.com/') {
        const dom = new JSDOM(html, { url });
        globalThis.document = dom.window.document;
        globalThis.location = dom.window.location;
    }

    it('extracts the visible candidate account marker from the sanitized homepage fixture', () => {
        load();
        expect(extractLiepinIdentity()).toMatchObject({
            accountLabel: '测试用户',
            hasUserMenu: true,
            loginPage: false,
            blocked: false,
        });
    });

    it('uses the observed authenticated resume card when the header account widget is absent', () => {
        load(fixture.replace(/<header>[\s\S]*?<\/header>/, ''));
        expect(__test__.identityFromSnapshot(extractLiepinIdentity())).toMatchObject({ displayName: '测试用户' });
    });

    it('returns a candidate identity with no invented account id', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ accountLabel: '测试用户', hasUserMenu: true }),
        };
        await expect(__test__.verifyLiepinIdentity(page)).resolves.toEqual({
            id: null,
            displayName: '测试用户',
            userType: 'candidate',
        });
        expect(page.goto).toHaveBeenCalledWith('https://c.liepin.com/');
    });

    it('waits through the initial empty SPA shell before classifying the account', async () => {
        const page = {
            goto: vi.fn(), wait: vi.fn(),
            evaluate: vi.fn().mockResolvedValueOnce({ hasUserMenu: false, accountLabel: '' })
                .mockResolvedValue({ hasUserMenu: true, accountLabel: '测试用户' }),
        };
        await expect(__test__.verifyLiepinIdentity(page)).resolves.toMatchObject({ displayName: '测试用户' });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('uses the candidate login URL discovered in the first-party homepage bundle', () => {
        expect(__test__.LIEPIN_LOGIN_URL).toBe('https://www.liepin.com/login?backUrl=https%3A%2F%2Fc.liepin.com%2F');
    });

    it('classifies login, security, and schema failures with typed errors', () => {
        expect(() => __test__.identityFromSnapshot({ loginPage: true })).toThrow(AuthRequiredError);
        expect(() => __test__.identityFromSnapshot({ blocked: true })).toThrow(CommandExecutionError);
        expect(() => __test__.identityFromSnapshot({ hasUserMenu: true, accountLabel: '' })).toThrow(CommandExecutionError);
    });

    it('trusts the visible account marker over incidental cross-role login links', () => {
        expect(__test__.identityFromSnapshot({
            accountLabel: '测试用户',
            hasUserMenu: true,
            hasLoginLink: true,
        })).toMatchObject({ displayName: '测试用户', userType: 'candidate' });
    });
});
