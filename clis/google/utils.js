/**
 * Google adapter utilities.
 * Shared Google adapter helpers.
 */

function isNavigationRejected(error) {
    return /Navigation rejected/i.test(String(error?.message || error));
}

export async function navigateGoogleSearch(page, url) {
    try {
        await page.goto(url);
        return;
    } catch (error) {
        if (!isNavigationRejected(error)) throw error;
    }

    if (typeof page.closeWindow === 'function') {
        await page.closeWindow().catch(() => {});
    }

    try {
        await page.goto(url);
    } catch (error) {
        if (!isNavigationRejected(error)) throw error;
        if (typeof page.newTab === 'function' && typeof page.setActivePage === 'function') {
            const pageId = await page.newTab(url);
            if (pageId) {
                await page.setActivePage(pageId);
                return;
            }
        }
        throw error;
    }
}

/**
 * Parse RSS XML by splitting into <item> blocks, then extracting fields per block.
 * Handles both plain text and CDATA-wrapped content.
 */
export function parseRssItems(xml, fields) {
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    return items.map(block => {
        const record = {};
        for (const field of fields) {
            // Escape regex special characters in field name (e.g. ht:approx_traffic is safe, but defensive)
            const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Handle tags with attributes (e.g. <source url="...">text</source>) and CDATA wrapping
            // (?:\s[^>]*)? ensures we don't match prefix tags (e.g. <sourceUrl> when looking for <source>)
            const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${escaped}>`));
            record[field] = match ? match[1].trim() : '';
        }
        return record;
    });
}
