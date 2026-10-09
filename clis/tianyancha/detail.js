import { cli, Strategy } from '@geonmoo/opencli/registry';
import { CommandExecutionError } from '@geonmoo/opencli/errors';
import { BASE, BASE_INFO_KEY, calendarDate, cleanText, readState, resolveCompany } from './utils.js';

cli({
  site: 'tianyancha', name: 'detail', access: 'read',
  description: '查询公司工商明细；支持公司 ID、详情 URL 或名称（简称取首个匹配）',
  example: 'opencli tianyancha detail 2343820668',
  domain: 'tianyancha.com', strategy: Strategy.UI, browser: true, navigateBefore: false,
  args: [{ name: 'company', positional: true, required: true, help: '公司 ID、天眼查详情 URL 或名称' }],
  columns: ['id', 'name', 'legalPerson', 'status', 'creditCode', 'registeredCapital', 'establishmentDate', 'industry', 'address', 'businessScope', 'extras', 'url'],
  func: async (page, args) => {
    const id = await resolveCompany(page, args.company);
    const data = await readState(page, `${BASE}/company/${id}`, BASE_INFO_KEY);
    if (String(data?.id) !== id || !data?.name) throw new CommandExecutionError('Company detail identity does not match the requested ID');
    return [{
      id, name: cleanText(data.name), legalPerson: cleanText(data.legalPersonName), status: cleanText(data.regStatus),
      creditCode: cleanText(data.creditCode), registeredCapital: cleanText(data.regCapital),
      establishmentDate: calendarDate(data.estiblishTime), industry: cleanText(data.industry2017),
      address: cleanText(data.regLocation), businessScope: cleanText(data.businessScope),
      extras: { paidCapital: cleanText(data.actualCapital), companyType: cleanText(data.companyOrgType),
        phone: cleanText(data.phoneNumber), email: cleanText(data.email), websites: data.websiteList ?? null,
        registrationNumber: data.regNumber ?? null, organizationCode: data.orgNumber ?? null, registrationAuthority: data.regInstitute ?? null, approvedDate: calendarDate(data.approvedTime), staffRange: data.staffNumRange ?? null, historyNames: data.historyNames ?? null },
      url: `${BASE}/company/${id}`,
    }];
  },
});
