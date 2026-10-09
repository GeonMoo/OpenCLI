import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@geonmoo/opencli/errors';
import { JUPYTER_LAB_URL, assertJupyterLab, normalizePositiveInteger, sleepPage } from './utils.js';

const INPUT_SELECTOR = '.jp-CodeConsole-input .jp-CodeConsole-promptCell .cm-content[contenteditable="true"]';
const MAIN_MENU_SELECTOR = '#jp-MainMenu > ul > li';
const NEW_LAUNCHER_SELECTOR = '[data-command="launcher:create"]';

cli({
  site: 'jupyter',
  name: 'pyconsole',
  description: '在已登录的 JupyterLab Python Console 中执行 Python 代码并返回文本结果',
  access: 'write',
  example: 'opencli jupyter pyconsole "print(6 * 7)" --timeout 30 -f json',
  domain: '139.196.153.143:9091',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: JUPYTER_LAB_URL,
  defaultWindowMode: 'foreground',
  args: [
    { name: 'code', type: 'string', required: true, positional: true, help: '要在 Python Console 中执行的 Python 代码' },
    { name: 'timeout', type: 'int', default: 30, help: '等待执行完成的秒数 (max 300)' },
  ],
  columns: ['executionCount', 'code', 'output', 'outputType'],
  func: async (page, args) => {
    const code = String(args.code ?? '');
    if (!code.trim()) throw new ArgumentError('code must not be empty');
    const timeoutSeconds = normalizePositiveInteger(args.timeout, 30, 'timeout', 300);

    await assertJupyterLab(page);
    let consoleState = await page.evaluate(() => {
      if (document.querySelector('.jp-CodeConsole')) return { ready: true, launched: false };
      const icon = document.querySelector('.jp-Launcher-sectionHeader svg[data-icon="ui-components:console"]');
      const card = icon?.closest('.jp-Launcher-section')?.querySelector('.jp-LauncherCard');
      if (!card) return { ready: false, launched: false };
      card.click();
      return { ready: false, launched: true };
    });
    if (!consoleState?.ready && !consoleState?.launched) {
      await page.click(MAIN_MENU_SELECTOR, { nth: 0 });
      const launcherClick = await page.click(NEW_LAUNCHER_SELECTOR, { nth: 0 });
      if (!launcherClick?.matches_n) throw new CommandExecutionError('JupyterLab New Launcher command was not resolved');
      const launcherDeadline = Date.now() + timeoutSeconds * 1000;
      while (!consoleState?.launched && Date.now() < launcherDeadline) {
        await sleepPage(page, 0.25);
        consoleState = await page.evaluate(() => {
          const icon = document.querySelector('.jp-Launcher-sectionHeader svg[data-icon="ui-components:console"]');
          const card = icon?.closest('.jp-Launcher-section')?.querySelector('.jp-LauncherCard');
          if (!card) return { ready: false, launched: false };
          card.click();
          return { ready: false, launched: true };
        });
      }
      if (!consoleState?.launched) throw new TimeoutError('JupyterLab New Launcher', timeoutSeconds);
    }

    const deadline = Date.now() + timeoutSeconds * 1000;
    let inputReady = Boolean(consoleState.ready);
    while (!inputReady && Date.now() < deadline) {
      await sleepPage(page, 0.25);
      inputReady = await page.evaluate((selector) => Boolean(document.querySelector(selector)), INPUT_SELECTOR);
    }
    if (!inputReady) throw new TimeoutError('JupyterLab Python Console launcher', timeoutSeconds);

    const previousCellCount = await page.evaluate(() => (
      document.querySelectorAll('.jp-CodeConsole .jp-Console-cell:not(.jp-CodeConsole-promptCell)').length
    ));
    const filled = await page.fillText(INPUT_SELECTOR, code);
    if (!filled?.filled || !filled?.verified || filled.matches_n !== 1 || filled.actual !== code) {
      throw new CommandExecutionError('JupyterLab Python Console input did not confirm the requested code');
    }

    let runTriggered = false;
    if (typeof page.cdp === 'function') {
      try {
        const keyEvent = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 8 };
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...keyEvent });
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...keyEvent });
        runTriggered = true;
      } catch {
        runTriggered = false;
      }
    }
    if (!runTriggered) {
      await page.click(MAIN_MENU_SELECTOR, { nth: 3 });
      await sleepPage(page, 0.1);
      const runClick = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('[data-command="runmenu:run"]'));
        const command = candidates.find((element) => {
          const style = window.getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0;
        });
        command?.click();
        return { clicked: Boolean(command), matches: candidates.length };
      });
      if (!runClick?.clicked) throw new CommandExecutionError('JupyterLab Run Cell command was not resolved');
    }

    let execution = null;
    while (!execution && Date.now() < deadline) {
      await sleepPage(page, 0.25);
      execution = await page.evaluate((beforeCount) => {
        const cells = Array.from(document.querySelectorAll('.jp-CodeConsole .jp-Console-cell:not(.jp-CodeConsole-promptCell)'));
        if (cells.length <= beforeCount) return null;
        const cell = cells.at(-1);
        const promptText = cell?.querySelector('.jp-InputPrompt')?.textContent?.trim() ?? '';
        const countMatch = promptText.match(/\[(\d+)\]/);
        if (!countMatch) return null;
        const outputNodes = Array.from(cell.querySelectorAll('.jp-OutputArea-output'));
        const outputText = outputNodes.map((node) => node.innerText ?? node.textContent ?? '').join('\n').trimEnd();
        const isError = Boolean(cell.querySelector('.jp-OutputArea-error, .jp-mod-error'))
          || /Traceback \(most recent call last\):/.test(outputText);
        return {
          execNo: Number(countMatch[1]),
          submittedCode: cell.querySelector('.jp-InputArea .cm-content')?.textContent ?? '',
          resultText: outputText,
          resultKind: isError ? 'error' : outputNodes.length > 0 ? 'text' : 'none',
          isError,
        };
      }, previousCellCount);
    }
    if (!execution) throw new TimeoutError('JupyterLab Python Console execution', timeoutSeconds);
    if (execution.isError) {
      throw new CommandExecutionError(`JupyterLab Python Console execution failed: ${execution.resultText || 'unknown kernel error'}`);
    }

    return [{
      executionCount: execution.execNo,
      code: execution.submittedCode || code,
      output: execution.resultText || null,
      outputType: execution.resultKind,
    }];
  },
});
