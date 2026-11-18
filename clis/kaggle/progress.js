import { styleText } from 'node:util';
import { cli, Strategy } from '@geonmoo/opencli/registry';
import { competitionArgs, loadCompetitions } from './utils.js';

const GUTTER = '  ';
const BLUE_GRAY = 109;

function day(date) {
  return date.slice(0, 10);
}

export function renderTimeline(competitions, now, { columns = 80, colorDepth = 1 } = {}) {
  const inlineDates = columns >= 72;
  const width = Math.min(58, Math.max(20, columns - GUTTER.length - (inlineDates ? 25 : 0)));
  const bold = text => colorDepth >= 4 ? styleText('bold', text, { validateStream: false }) : text;
  const accent = text => colorDepth >= 8 ? `\x1b[38;5;${BLUE_GRAY}m${text}\x1b[39m` : text;
  const dated = competitions.filter(item => item.opensAt && item.closesAt && item.opensAt <= item.closesAt);
  const first = Math.min(...dated.map(item => Date.parse(item.opensAt)));
  const last = Math.max(...dated.map(item => Date.parse(item.closesAt)));
  const position = time => Math.round((time - first) / (last - first || 1) * (width - 1));
  const today = now >= first && now <= last ? position(now) : -1;
  const lines = [];
  const print = text => lines.push(GUTTER + text);
  if (dated.length) {
    const start = day(new Date(first).toISOString());
    const end = day(new Date(last).toISOString());
    print(bold('Competition timeline · UTC'));
    print(start === end ? start : start + '─'.repeat(width - start.length - end.length) + end);
    if (today >= 0) print(' '.repeat(today) + '│');
    print('● Start / Close   ━ Elapsed   · Remaining');
    print(`│ Now ${day(new Date(now).toISOString())}    ○ Merger / Entry`);
  }

  for (const item of competitions) {
    const { competitionTitle, opensAt, closesAt, mergerAt, entryAt } = item;
    if (lines.length) lines.push('', '');
    print(bold(competitionTitle));
    if (!dated.includes(item)) {
      print(`Start ${opensAt ? day(opensAt) : 'unavailable'}   Close ${closesAt ? day(closesAt) : 'unavailable'}`);
      continue;
    }
    const start = position(Date.parse(opensAt));
    const closeTime = Date.parse(closesAt);
    const end = position(closeTime);
    const bar = Array(width).fill(' ');
    for (let i = start + 1; i < end; i++) bar[i] = i < today || closeTime <= now ? '━' : '·';
    const milestones = mergerAt && mergerAt === entryAt
      ? [['Merger & Entry', mergerAt]]
      : [['Merger', mergerAt], ['Entry', entryAt]];
    const labels = [];
    for (const [name, date] of milestones) {
      if (!date || date < opensAt || date > closesAt) continue;
      const marker = position(Date.parse(date));
      if (marker > start && marker < end) bar[marker] = '○';
      labels.push(`${name} ${day(date)}`);
    }
    if (today !== -1 && bar[today] !== '○') bar[today] = '│';
    bar[start] = '●';
    bar[end] = '●';
    const track = bar.join('');
    const cursor = track.indexOf('│');
    const styledTrack = cursor < 0 ? accent(track)
      : accent(track.slice(0, cursor)) + '│' + accent(track.slice(cursor + 1));
    const dates = `${day(opensAt)} → ${bold(day(closesAt))}`;
    print(inlineDates ? `${styledTrack}  ${dates}` : styledTrack);
    if (!inlineDates) print(GUTTER + dates);
    for (const label of labels) print(GUTTER + `${accent('○')} ${label}`);
  }
  return lines.join('\n');
}

cli({
  site: 'kaggle',
  name: 'progress',
  description: 'Compare Kaggle competition dates on a shared UTC timeline',
  example: 'opencli kaggle progress --tags active/featured',
  domain: 'www.kaggle.com',
  access: 'read',
  strategy: Strategy.PUBLIC,
  browser: false,
  terminalFormat: 'plain',
  args: competitionArgs,
  columns: ['text'],
  func: async (args, _debug, terminal) => {
    const competitions = await loadCompetitions(args, 'kaggle/progress');
    return [{ text: renderTimeline(competitions, Date.now(), terminal) }];
  },
});
