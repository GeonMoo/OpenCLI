import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { requireBoundedInteger, requireSearchQuery } from '../_shared/search-adapter.js';
import { hfFetch } from './api.js';

const CLASSES = ['model', 'dataset', 'space'];

cli({
    site: 'hgface',
    name: 'search',
    access: 'read',
    description: 'Search Hugging Face models, datasets or Spaces by name or owner',
    domain: 'huggingface.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Name or owner to search for' },
        { name: 'class', type: 'string', default: 'model', choices: CLASSES, help: 'Search category: model, dataset or space' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (1-100)' },
    ],
    columns: ['rank', 'class', 'id', 'author', 'downloads', 'likes', 'pipelineTag', 'sdk', 'lastModified', 'url'],
    func: async (args) => {
        const query = requireSearchQuery(args.query, 'query');
        const category = String(args.class ?? 'model').toLowerCase();
        if (!CLASSES.includes(category)) throw new ArgumentError('--class must be model, dataset or space');
        const limit = requireBoundedInteger(args.limit, 10, 1, 100, '--limit');
        const params = new URLSearchParams({ search: query, limit: String(limit), full: 'true' });
        const data = await hfFetch(`https://huggingface.co/api/${category}s?${params}`);
        if (!Array.isArray(data)) throw new CommandExecutionError('Hugging Face search returned an unexpected response');
        if (!data.length) throw new EmptyResultError('hgface search', `No ${category}s matched "${query}"`);
        return data.slice(0, limit).map((item, index) => {
            if (typeof item?.id !== 'string' || !item.id.trim()) throw new CommandExecutionError('Hugging Face search result is missing its id');
            return {
                rank: index + 1,
                class: category,
                id: item.id,
                author: item.author ?? (item.id.includes('/') ? item.id.split('/')[0] : null),
                downloads: category === 'space' ? null : item.downloads ?? null,
                likes: item.likes ?? null,
                pipelineTag: category === 'model' ? item.pipeline_tag ?? null : null,
                sdk: category === 'space' ? item.sdk ?? null : null,
                lastModified: item.lastModified ?? null,
                url: `https://huggingface.co/${category === 'model' ? '' : `${category}s/`}${item.id}`,
            };
        });
    },
});
