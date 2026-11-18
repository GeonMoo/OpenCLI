import { ArgumentError, CommandExecutionError, EmptyResultError, TimeoutError } from '@geonmoo/opencli/errors';
import { requireBoundedInteger } from '../_shared/search-adapter.js';

const BASE = 'https://www.kaggle.com';
const LIST_URL = BASE + '/api/i/competitions.CompetitionService/ListCompetitions';
const statuses = { active: 'ACTIVE', completed: 'COMPLETED', all: 'DEFAULT' };
const categories = {
  featured: [1, 'Featured'],
  research: [2, 'Research'],
  'getting-started': [5, 'Getting Started'],
  playground: [8, 'Playground'],
  community: [10, 'Community'],
};
const categoryNames = new Map(Object.values(categories));
const types = ['hackathons', 'simulations'];
const DEFAULT_TAGS = 'active/featured';

export const competitionArgs = [
  { name: 'tags', type: 'string', valueRequired: true, default: DEFAULT_TAGS, help: 'Combine one status (active, completed, all), one category (featured, research, getting-started, playground, community), and optional hackathons or simulations with / or comma' },
  { name: 'limit', type: 'int', default: 20, help: 'Maximum competitions (1–100)' },
];

function selectorFor(value = DEFAULT_TAGS) {
  const tags = [...new Set(value.toLowerCase().split(/[/,]/).map(tag => tag.trim()))];
  const statusTags = tags.filter(tag => Object.hasOwn(statuses, tag));
  const categoryTags = tags.filter(tag => Object.hasOwn(categories, tag));
  if (tags.some(tag => !Object.hasOwn(statuses, tag) && !Object.hasOwn(categories, tag) && !types.includes(tag))) {
    throw new ArgumentError('Unknown --tags value. See --help for supported Kaggle filters.');
  }
  if (statusTags.length > 1 || categoryTags.length > 1) {
    throw new ArgumentError('--tags takes at most one status and one category.');
  }
  const status = statusTags[0] ?? 'active';
  return {
    listOption: 'LIST_OPTION_' + statuses[status],
    sortOption: status === 'completed' ? 'SORT_OPTION_RECENTLY_CLOSED' : 'SORT_OPTION_NEWEST',
    hostSegmentIdFilter: categories[categoryTags[0]]?.[0] ?? 0,
    requireHackathons: tags.includes('hackathons'),
    requireSimulations: tags.includes('simulations'),
  };
}

function isoDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim() : '';
}

function prizeLabel(reward) {
  if (!reward?.id) return null;
  if (/^[A-Z]{3}$/.test(reward.id) && Number.isFinite(reward.quantity)) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: reward.id, minimumFractionDigits: 0,
    }).format(reward.quantity);
  }
  return ({ KNOWLEDGE: 'Knowledge', SWAG: 'Swag', KUDOS: 'Kudos' })[reward.id] ?? cleanText(reward.id);
}

function decodeCompetition(item) {
  const title = cleanText(item?.title);
  if (!title || typeof item.competitionName !== 'string' || !/^[\w-]+$/.test(item.competitionName)) {
    throw new CommandExecutionError('Kaggle returned a competition without a valid title or slug.');
  }
  return {
    competitionTitle: title,
    summary: cleanText(item.briefDescription) || null,
    segmentName: categoryNames.get(item.competitionHostSegmentId) ?? null,
    formatName: item.hackathon ? 'Hackathon' : item.onlyAllowKernelSubmissions ? 'Code Competition' : null,
    teamCount: item.totalTeams ?? 0,
    rewardLabel: prizeLabel(item.reward),
    opensAt: isoDate(item.dateEnabled),
    closesAt: isoDate(item.deadline),
    mergerAt: isoDate(item.teamMergerExplicitDeadline),
    entryAt: isoDate(item.prohibitNewEntrantsExplicitDeadline),
    competitionUrl: BASE + '/competitions/' + item.competitionName,
  };
}

export async function loadCompetitions(args, command) {
  const selector = selectorFor(args.tags);
  const limit = requireBoundedInteger(args.limit, 20, 1, 100, '--limit');
  const competitions = [];
  let pageToken;
  do {
    let data;
    try {
      const response = await fetch(LIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ selector, pageSize: limit - competitions.length, pageToken, readMask: 'competitions,totalResults' }),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      data = await response.json();
    } catch (error) {
      if (error.name === 'TimeoutError') throw new TimeoutError('Kaggle competitions request', 10);
      throw new CommandExecutionError('Kaggle competitions request failed: ' + error.message);
    }
    // Kaggle omits protobuf fields with default values, including an empty competition list.
    if (data && !Array.isArray(data) && typeof data === 'object'
      && (Object.keys(data).length === 0 || data.totalResults === 0)) break;
    if (!Array.isArray(data?.competitions)) {
      throw new CommandExecutionError('Kaggle returned an unexpected competition list.');
    }
    competitions.push(...data.competitions.slice(0, limit - competitions.length).map(decodeCompetition));
    if (data.nextPageToken && (data.nextPageToken === pageToken || !data.competitions.length)) {
      throw new CommandExecutionError('Kaggle competition pagination did not advance.');
    }
    pageToken = data.nextPageToken;
  } while (pageToken && competitions.length < limit);

  if (!competitions.length) throw new EmptyResultError(command, 'No Kaggle competitions match --tags.');
  return competitions;
}

export function timeLeft(deadline, now) {
  if (!deadline) return null;
  const remainingMinutes = (Date.parse(deadline) - now) / 60_000;
  if (remainingMinutes <= 0) return 'Closed';
  for (const [unit, size, threshold] of [
    ['year', 525_960, 11 * 43_830], ['month', 43_830, 26 * 1440], ['day', 1440, 22 * 60],
    ['hour', 60, 45], ['minute', 1, 1],
  ]) {
    if (remainingMinutes >= threshold) {
      const count = Math.max(1, Math.round(remainingMinutes / size));
      return `${count} ${unit}${count === 1 ? '' : 's'} to go`;
    }
  }
  return '<1 minute to go';
}
