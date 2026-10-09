import { cli, Strategy } from '@geonmoo/opencli/registry';
import { COMPANIES } from './companies.js';

cli({
  site: 'jobs', name: 'companies', access: 'read',
  description: 'List the 18 supported employers and official recruitment sites',
  domain: 'xiaomi.jobs.f.mioffice.cn', strategy: Strategy.PUBLIC, browser: false,
  args: [], columns: ['company', 'name', 'source', 'url'],
  func: async () => COMPANIES.map(c => ({ company: c.id, name: c.label, source: c.type, url: c.url })),
});
