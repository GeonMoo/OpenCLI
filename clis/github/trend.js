import { cli } from '@geonmoo/opencli/registry';
import { trendingCommand } from '../github-trending/repos.js';

cli({
    ...trendingCommand,
    site: 'github',
    name: 'trend',
    args: trendingCommand.args.map(arg => arg.name === 'limit' ? { ...arg, default: 10 } : arg),
});
