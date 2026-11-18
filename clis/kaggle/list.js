import { cli, Strategy } from '@geonmoo/opencli/registry';
import { competitionArgs, loadCompetitions, timeLeft } from './utils.js';

cli({
  site: 'kaggle',
  name: 'list',
  description: 'List Kaggle competitions by status and category',
  example: 'opencli kaggle list --tags active/featured',
  domain: 'www.kaggle.com',
  access: 'read',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: competitionArgs,
  columns: ['title', 'description', 'category', 'teams', 'timeLeft', 'prize', 'deadline', 'url'],
  func: async (args) => {
    const competitions = await loadCompetitions(args, 'kaggle/list');
    const now = Date.now();
    return competitions.map(item => ({
      title: item.competitionTitle,
      description: item.summary,
      category: [item.segmentName, item.formatName].filter(Boolean).join(' · ') || null,
      teams: item.teamCount,
      timeLeft: timeLeft(item.closesAt, now),
      prize: item.rewardLabel,
      deadline: item.closesAt,
      url: item.competitionUrl,
    }));
  },
});
