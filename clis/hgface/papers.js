import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { requireBoundedInteger } from '../_shared/search-adapter.js';
import { hfFetch } from './api.js';

cli({
    site: 'hgface',
    name: 'papers',
    access: 'read',
    description: 'List Hugging Face daily papers or papers for a specific day or month',
    domain: 'huggingface.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'date', positional: true, required: false, help: 'YYYY-MM-DD or YYYY-MM; omit for the latest daily papers' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of papers (1-100)' },
    ],
    columns: ['rank', 'id', 'title', 'upvotes', 'authors', 'publishedAt', 'summary', 'url'],
    func: async (args) => {
        const date = args.date == null ? null : String(args.date).trim();
        const params = new URLSearchParams();
        if (date !== null) {
            const day = /^\d{4}-\d{2}-\d{2}$/.test(date);
            const month = /^\d{4}-\d{2}$/.test(date);
            const iso = month ? `${date}-01` : date;
            const parsed = new Date(`${iso}T00:00:00Z`);
            if ((!day && !month) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
                throw new ArgumentError('date must be a valid YYYY-MM-DD or YYYY-MM');
            }
            params.set(month ? 'month' : 'date', date);
        }
        const limit = requireBoundedInteger(args.limit, 10, 1, 100, '--limit');
        params.set('limit', String(limit));
        const data = await hfFetch(`https://huggingface.co/api/daily_papers?${params}`);
        if (!Array.isArray(data)) throw new CommandExecutionError('Hugging Face papers returned an unexpected response');
        if (!data.length) throw new EmptyResultError('hgface papers', `No papers for ${date ?? 'the latest daily listing'}`);
        return data.slice(0, limit).map((entry, index) => {
            const paper = entry?.paper;
            if (typeof paper?.id !== 'string' || !paper.id || typeof paper.title !== 'string' || !paper.title.trim()) {
                throw new CommandExecutionError('Hugging Face paper is missing its id or title');
            }
            return {
                rank: index + 1,
                id: paper.id,
                title: paper.title,
                upvotes: paper.upvotes ?? null,
                authors: Array.isArray(paper.authors) ? paper.authors.map(author => author.name).filter(Boolean).join(', ') : null,
                publishedAt: paper.publishedAt ?? null,
                summary: paper.summary ?? entry.summary ?? null,
                url: `https://huggingface.co/papers/${paper.id}`,
            };
        });
    },
});
