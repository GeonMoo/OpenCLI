import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';

const DETAIL_PATH = /^\/(job|a)\/(\d+)\.shtml$/;

function cleanText(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeList(value) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return [...new Set(values.flatMap(item => cleanText(item).split(/[,，]\s*/)).filter(Boolean))].join(', ') || null;
}

export function resolveDetailTarget(value, type = 'job') {
    const input = cleanText(value);
    if (!input) throw new ArgumentError('liepin jobId is required');
    if (!['job', 'a'].includes(type)) throw new ArgumentError('liepin type must be job or a');
    if (/^\d+$/.test(input)) {
        return { targetId: input, pathKind: type, targetUrl: `https://www.liepin.com/${type}/${input}.shtml` };
    }
    let parsed;
    try {
        parsed = new URL(input);
    } catch {
        throw new ArgumentError('liepin jobId must be numeric or a canonical Liepin detail URL');
    }
    const match = parsed.pathname.match(DETAIL_PATH);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.liepin.com' || parsed.port
        || parsed.username || parsed.password || parsed.search || parsed.hash || !match) {
        throw new ArgumentError('liepin detail URL must be https://www.liepin.com/job/<digits>.shtml or https://www.liepin.com/a/<digits>.shtml');
    }
    return { targetId: match[2], pathKind: match[1], targetUrl: parsed.href };
}

export function extractJobDetail() {
    const text = element => (element?.innerText || element?.textContent || '').trim();
    const bodyText = text(document.body);
    let posting = null;
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
            const value = JSON.parse(script.textContent || 'null');
            const entries = Array.isArray(value) ? value : value?.['@graph'] || [value];
            posting = entries.find(entry => entry?.['@type'] === 'JobPosting') || posting;
        } catch { /* unrelated JSON-LD can be malformed */ }
    }
    const properties = [...document.querySelectorAll('.job-properties > span:not(.split)')].map(text).filter(Boolean);
    const labeledValue = label => {
        for (const row of document.querySelectorAll('.company-info-container .label-box')) {
            if (text(row.querySelector('.label')).replace(/\s/g, '') === label) return text(row.querySelector('.text'));
        }
        return '';
    };
    const recruiter = document.querySelector('.recruiter-container');
    const recruiterCompany = text(recruiter?.querySelector('.title-box a'))
        || [...(recruiter?.querySelectorAll('.title-box > span') || [])].map(text)
            .map(value => value.replace(/^\s*·\s*/, '')).filter(Boolean).at(-1) || '';
    const recruiterTitle = [...(recruiter?.querySelectorAll('.title-box > span') || [])].map(text)
        .map(value => value.replace(/^\s*·\s*/, '')).find(value => value && value !== recruiterCompany) || '';
    const address = posting?.jobLocation?.address || {};
    // Browser evaluators serialize this function without its module scope.
    const currentPath = location.pathname.match(/^\/(job|a)\/(\d+)\.shtml$/);
    return {
        currentUrl: location.href,
        currentType: currentPath?.[1] || null,
        currentJobId: currentPath?.[2] || null,
        hasDetailLayout: !!document.querySelector('.job-apply-container, .job-intro-container') || !!posting,
        needsAuth: /\/login|\/passport/.test(location.pathname) || /扫码登录|手机号登录/.test(bodyText.slice(0, 1000)),
        blocked: /安全验证|访问过于频繁|滑动验证/.test(bodyText.slice(0, 2000)),
        expired: /职位已下线|职位已关闭|职位不存在|该职位已删除/.test(bodyText.slice(0, 3000)),
        nameText: text(document.querySelector('.job-apply-container .job-title')) || text(document.querySelector('.job-apply-container .name')) || posting?.title || '',
        salaryText: text(document.querySelector('.job-apply-container .salary')),
        areaText: properties[0] || address.addressLocality || address.addressRegion || '',
        experienceText: properties[1] || posting?.experienceRequirements || '',
        degreeText: properties[2] || posting?.educationRequirements || '',
        companyText: posting?.hiringOrganization?.name || text(document.querySelector('.company-info-container .company-card .name')),
        recruiterText: text(recruiter?.querySelector('.name-box .name')),
        recruiterActiveText: text(recruiter?.querySelector('.name-box .online')),
        recruiterTitleText: recruiterTitle,
        recruiterCompanyText: recruiterCompany,
        addressText: labeledValue('职位地址：') || address.streetAddress || '',
        descriptionText: text(document.querySelector('.job-intro-container [data-selector="job-intro-content"]')) || posting?.description || '',
        skillsValue: posting?.skills || null,
        welfareValue: posting?.jobBenefits || null,
        companyIndustryText: labeledValue('企业行业：') || posting?.industry || '',
        companyScaleText: labeledValue('人数规模：'),
    };
}

function snapshotToRow(snapshot, target) {
    if (!snapshot?.nameText || !snapshot.salaryText || !snapshot.companyText || !snapshot.areaText
        || !snapshot.experienceText || !snapshot.degreeText || !snapshot.descriptionText) return null;
    const nullable = value => cleanText(value) || null;
    return {
        name: cleanText(snapshot.nameText),
        salary: cleanText(snapshot.salaryText),
        company: cleanText(snapshot.companyText),
        area: cleanText(snapshot.areaText),
        experience: cleanText(snapshot.experienceText),
        degree: cleanText(snapshot.degreeText),
        recruiter: nullable(snapshot.recruiterText),
        recruiterActive: nullable(snapshot.recruiterActiveText),
        jobId: target.targetId,
        description: cleanText(snapshot.descriptionText),
        extras: {
            address: nullable(snapshot.addressText),
            skills: normalizeList(snapshot.skillsValue),
            welfare: normalizeList(snapshot.welfareValue),
            recruiterTitle: nullable(snapshot.recruiterTitleText),
            recruiterCompany: nullable(snapshot.recruiterCompanyText),
            companyIndustry: nullable(snapshot.companyIndustryText),
            companyScale: nullable(snapshot.companyScaleText),
        },
        url: target.targetUrl,
    };
}

async function readDetail(page, target) {
    await page.goto(target.targetUrl);
    let sawLayout = false;
    for (let attempt = 0; attempt < 20; attempt++) {
        const snapshot = await page.evaluate(extractJobDetail);
        if (snapshot.needsAuth) throw new AuthRequiredError('liepin.com', '请先在 Chrome 登录猎聘');
        if (snapshot.blocked) throw new CommandExecutionError('Liepin is showing a security verification or rate limit; resolve it in Chrome before retrying');
        const redirectedFromDetail = !snapshot.currentJobId && /https:\/\/c\.liepin\.com\/?/.test(snapshot.currentUrl);
        if (snapshot.expired || redirectedFromDetail) {
            throw new EmptyResultError('liepin detail', `Job ${target.targetId} is offline or unavailable`);
        }
        sawLayout ||= snapshot.hasDetailLayout;
        const row = snapshotToRow(snapshot, target);
        if (row && snapshot.currentJobId === target.targetId && snapshot.currentType === target.pathKind) return row;
        if (attempt < 19) await page.wait(0.5);
    }
    if (sawLayout) throw new CommandExecutionError('Liepin detail page is missing required fields; the page layout may have changed');
    throw new TimeoutError('Liepin detail page', 10);
}

cli({
    site: 'liepin',
    name: 'detail',
    access: 'read',
    description: '猎聘查看职位详情',
    domain: 'www.liepin.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'jobId', positional: true, required: true, help: 'Numeric search jobId or canonical Liepin detail URL' },
        { name: 'type', default: 'job', choices: ['job', 'a'], help: 'Detail URL type for numeric IDs (default: job)' },
    ],
    columns: [
        'name', 'salary', 'company', 'area', 'experience', 'degree',
        'recruiter', 'recruiterActive', 'jobId',
        'description', 'extras', 'url',
    ],
    func: async (page, args) => {
        if (!page) throw new CommandExecutionError('Browser page required');
        const target = resolveDetailTarget(args.jobId, cleanText(args.type ?? 'job'));
        return [await readDetail(page, target)];
    },
});

export const __test__ = { cleanText, normalizeList, snapshotToRow };
