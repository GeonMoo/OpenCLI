import { describe, it, expect } from 'vitest';
import { commandHelpData, formatCommandHelpText, formatRootAdapterHelpText } from './help.js';
import type { CliCommand } from './registry.js';

describe('file output help', () => {
  const command: CliCommand = {
    site: 'ke', name: 'search', description: 'Search homes', access: 'read', browser: false,
    args: [], func: async () => [],
  };

  it('advertises direct file output in text and structured help', () => {
    expect(formatCommandHelpText(command)).toContain('-o, --output <file>');
    expect(commandHelpData(command).common_options).toContainEqual(expect.objectContaining({ name: 'output' }));
  });

  it('keeps adapter-owned output arguments distinct from the common option', () => {
    const ownOutput = { ...command, args: [{ name: 'output', default: 'md', help: 'Document format' }] };
    expect(formatCommandHelpText(ownOutput)).not.toContain('-o, --output <file>');
    expect(commandHelpData(ownOutput).common_options).not.toContainEqual(expect.objectContaining({ name: 'output' }));
  });
});


describe('formatRootAdapterHelpText', () => {
  it('omits empty sections instead of rendering a (0) header', () => {
    const text = formatRootAdapterHelpText({
      sites: ['bilibili'],
    });
    expect(text).not.toContain('App adapters');
    expect(text).toContain('Site adapters (1):');
  });

  it('returns empty string when all groups are empty', () => {
    expect(formatRootAdapterHelpText({ sites: [] })).toBe('');
  });

  it('always renders the agent discovery hint when any section is populated', () => {
    const text = formatRootAdapterHelpText({
      sites: ['bilibili'],
    });
    expect(text).toContain("'opencli <site> --help -f json'");
  });
});
