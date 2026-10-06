import { ArgumentError } from '@jackwener/opencli/errors';

// Company inventory and recruitment URLs from job-hunter/scripts/scrapers/manager.py.
export const COMPANIES = [
  ['xiaomi', '小米', 'feishu', 'https://xiaomi.jobs.f.mioffice.cn/index/'],
  ['liauto', '理想汽车', 'liauto', 'https://www.lixiang.com/job/list.html?fromJob=1'],
  ['xpeng', '小鹏汽车', 'feishu', 'https://xiaopeng.jobs.feishu.cn/index/position/list'],
  ['nio', '蔚来', 'feishu', 'https://nio.jobs.feishu.cn/index/position'],
  ['momenta', 'Momenta', 'feishu', 'https://momenta.jobs.feishu.cn/talent'],
  ['ponyai', '小马智行', 'feishu', 'https://ponyai.jobs.feishu.cn/ponyai/'],
  ['tesla', '特斯拉', 'mokahr', 'https://app.mokahr.com/social-recruitment/tesla/46129#/jobs'],
  ['bytedance', '字节跳动', 'feishu', 'https://jobs.bytedance.com/experienced/position'],
  ['dewu', '得物', 'feishu', 'https://careers.dewu.com/index/position/list'],
  ['xiaohongshu', '小红书', 'xiaohongshu', 'https://job.xiaohongshu.com/social/position'],
  ['eleme', '饿了么', 'alibaba_talent', 'https://talent.ele.me/off-campus/position-list'],
  ['taotian', '淘天', 'alibaba_talent', 'https://talent.taotian.com/off-campus/position-list'],
  ['tencent', '腾讯', 'tencent', 'https://careers.tencent.com/search.html'],
  ['pdd', '拼多多', 'pdd', 'https://careers.pddglobalhr.com/jobs'],
  ['minimax', 'MiniMax', 'feishu', 'https://vrfi1sk8a0.jobs.feishu.cn/index/'],
  ['baidu', '百度', 'baidu', 'https://talent.baidu.com/jobs/social-list'],
  ['bilibili', '哔哩哔哩', 'bilibili', 'https://jobs.bilibili.com/social/positions?isTrusted=true'],
  ['huawei', '华为', 'huawei', 'https://career.huawei.com/cn/social-recruitment-job-list'],
].map(([id, label, type, url]) => ({ id, label, type, url }));

const ALIASES = { 'li auto': 'liauto', 'li-auto': 'liauto', xiaopeng: 'xpeng', 'pony.ai': 'ponyai', 'ele.me': 'eleme', b站: 'bilibili' };

export function selectCompanies(value) {
  if (value === undefined || value === null || value === 'all') return COMPANIES;
  const names = String(value).split(',').map(s => s.trim().toLowerCase());
  const selected = names.map(name => {
    const company = COMPANIES.find(c => c.id === (ALIASES[name] ?? name) || c.label.toLowerCase() === name);
    if (!company) throw new ArgumentError(`Unknown company "${name}". Use opencli jobs companies for supported names.`);
    return company;
  });
  return [...new Set(selected)];
}
