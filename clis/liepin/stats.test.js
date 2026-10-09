import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@geonmoo/opencli/errors';
import { extractCandidateStats, __test__ } from './stats.js';

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/homepage.html'), 'utf8');

describe('liepin candidate stats', () => {
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

    function load(html = fixture) {
        const dom = new JSDOM(html, { url: 'https://c.liepin.com/' });
        globalThis.document = dom.window.document;
        globalThis.location = dom.window.location;
    }

    it('extracts the observed homepage counters and preserves a real zero', () => {
        load();
        const browserExtractor = new Function('document', 'location', `return (${extractCandidateStats.toString()})()`);
        expect(__test__.statsFromSnapshot(browserExtractor(globalThis.document, globalThis.location))).toEqual({
            resumeViews: 52,
            applications: 0,
            favorites: 166,
            unreadChats: 7,
        });
    });

    it('returns null only when the optional unread badge is not observable', () => {
        load(fixture.replace('<aside id="im-c-entry"><span class="im-ui-basic-entry-unread-count">7</span></aside>', ''));
        expect(__test__.statsFromSnapshot(extractCandidateStats()).unreadChats).toBeNull();
    });

    it('reads counters through the authenticated resume card when the header widget is absent', () => {
        load(fixture.replace(/<header>[\s\S]*?<\/header>/, ''));
        expect(__test__.statsFromSnapshot(extractCandidateStats())).toMatchObject({ applications: 0, favorites: 166 });
    });

    it('waits for account counters rendered after the initial SPA shell', async () => {
        load();
        const page = {
            goto: vi.fn(), wait: vi.fn(),
            evaluate: vi.fn().mockResolvedValueOnce({ displayName: '', missingCounters: ['resumeViews'] })
                .mockResolvedValue(extractCandidateStats()),
        };
        await expect(__test__.readCandidateStats(page)).resolves.toMatchObject({ applications: 0, favorites: 166 });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('rejects missing required counters, nonnumeric visible counters, and unauthenticated pages', () => {
        load(fixture.replace('<h2>52</h2>', '<h2>--</h2>'));
        expect(() => __test__.statsFromSnapshot(extractCandidateStats())).toThrow(CommandExecutionError);

        load(fixture.replace('<span class="im-ui-basic-entry-unread-count">7</span>', '<span class="im-ui-basic-entry-unread-count">99+</span>'));
        expect(() => __test__.statsFromSnapshot(extractCandidateStats())).toThrow(CommandExecutionError);

        expect(() => __test__.statsFromSnapshot({ loginPage: true })).toThrow(AuthRequiredError);
    });
});
