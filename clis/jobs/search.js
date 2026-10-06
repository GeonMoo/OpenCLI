import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { selectCompanies } from './companies.js';
import { searchFeishu } from './feishu.js';
import { searchApi } from './providers.js';
import { searchExtra } from './browser-extra.js';

export function parseSearchArgs(args) {
  const query = String(args.query ?? '').trim();
  if (!query) throw new ArgumentError('query must not be blank');
  const pages = Number(args.pages ?? 1), timeout = Number(args['request-timeout'] ?? 30);
  const totalTimeout = Number(args.timeout ?? 600);
  if (!Number.isInteger(pages) || pages < 1) throw new ArgumentError('pages must be a positive integer');
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) throw new ArgumentError('request-timeout must be an integer between 1 and 120 seconds');
  if (!Number.isInteger(totalTimeout) || totalTimeout < 1 || totalTimeout > 3600) throw new ArgumentError('timeout must be an integer between 1 and 3600 seconds');
  const match = args.match ?? 'title';
  if (!['title', 'text'].includes(match)) throw new ArgumentError('match must be title or text');
  return { query, pages, timeout, match, companies: selectCompanies(args.company) };
}

export async function searchJobs(page, args, handlers = { feishu: searchFeishu, api: searchApi, extra: searchExtra }) {
  const options = parseSearchArgs(args);
  const rows = [], failures = [], seen = new Set();
  for (const company of options.companies) {
    try {
      let jobs;
      if (company.type === 'feishu') jobs = await handlers.feishu(page, company, options.query, options.pages, options.timeout, args.details ?? false);
      else if (['mokahr', 'bilibili'].includes(company.type)) jobs = await handlers.extra(page, company, options.query, options.pages, options.timeout, args.details ?? false);
      else jobs = await handlers.api(company, options.query, options.pages, options.timeout, args.details ?? false);
      const companyRows = [];
      for (const job of jobs) {
        if (!job.jobId || !job.jobTitle || !job.jobUrl) throw new CommandExecutionError(`${company.id}: invalid job record`);
        const haystack = options.match === 'title' ? job.jobTitle : [job.jobTitle, job.jobDescription, job.jobRequirements].join('\n');
        if (!String(haystack ?? '').toLowerCase().includes(options.query.toLowerCase())) continue;
        const key = `${company.id}:${job.jobId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        companyRows.push({ rank: rows.length + companyRows.length + 1, company: company.id, id: String(job.jobId), title: job.jobTitle,
          location: job.jobLocation || null, description: job.jobDescription || null, requirements: job.jobRequirements || null, url: job.jobUrl });
      }
      rows.push(...companyRows);
      console.error(`[jobs] ${company.id}: ${companyRows.length} matching jobs`);
    } catch (error) {
      console.error(`[jobs] ${company.id}: FAILED (${error.code ?? 'COMMAND_EXEC'}) ${error.message}`);
      if (options.companies.length === 1) throw error;
      failures.push(`${company.id}: ${error.message}`);
    }
  }
  console.error(`[jobs] Searched ${options.companies.length} companies; ${options.companies.length - failures.length} succeeded, ${failures.length} failed; ${rows.length} jobs.`);
  if (failures.length && (args.strict || !rows.length)) throw new CommandExecutionError(`Job search incomplete: ${failures.join('; ')}`);
  if (!rows.length) throw new EmptyResultError('jobs search', `No ${options.match} matches for "${options.query}" in the requested pages`);
  return rows;
}

cli({
  site: 'jobs', name: 'search', access: 'read',
  description: 'Search official recruitment sites of 18 employers; default matches job titles',
  domain: 'xiaomi.jobs.f.mioffice.cn', strategy: Strategy.UI, browser: true,
  validateArgs: parseSearchArgs,
  args: [
    { name: 'query', type: 'string', positional: true, required: true, help: 'Job keyword, e.g. 数据开发' },
    { name: 'pages', type: 'int', default: 1, help: 'Maximum listing pages per company (positive integer)' },
    { name: 'company', type: 'string', help: 'Company ID or comma-separated IDs; omitted searches all 18 (see jobs companies)' },
    { name: 'match', type: 'string', default: 'title', help: 'title (default) or text (title, description and requirements)' },
    { name: 'details', type: 'bool', default: false, help: 'Also fetch job details for full descriptions and requirements' },
    { name: 'strict', type: 'bool', default: false, help: 'Fail if any company fails; default keeps partial results with stderr warnings' },
    { name: 'timeout', type: 'int', default: 600, help: 'Overall command timeout in seconds (1-3600)' },
    { name: 'request-timeout', type: 'int', default: 30, help: 'Timeout per request/page in seconds (1-120)' },
  ],
  columns: ['rank', 'company', 'id', 'title', 'location', 'description', 'requirements', 'url'],
  func: async (page, args) => searchJobs(page, args),
});
