// Browser factory. Two separate contexts: a legacy context and a new-system context.
// Credentials are passed in, never stored. Legacy safety is installed by the CLI after
// config/secrets are loaded so auth allowlists can be applied before any navigation.

import { chromium, type Browser, type BrowserContext } from 'playwright';

export interface Contexts {
  browser: Browser;
  legacy: BrowserContext;
  newSystem: BrowserContext;
  close: () => Promise<void>;
}

/**
 * Launch one browser with two isolated contexts. Callers install the legacy safety guard
 * before navigating the legacy context.
 */
export async function launchContexts(opts: { headed?: boolean; navTimeoutMs: number }): Promise<Contexts> {
  const browser = await chromium.launch({ headless: !opts.headed });
  const legacy = await browser.newContext({ acceptDownloads: false });
  const newSystem = await browser.newContext({ acceptDownloads: true });
  legacy.setDefaultNavigationTimeout(opts.navTimeoutMs);
  newSystem.setDefaultNavigationTimeout(opts.navTimeoutMs);

  return {
    browser,
    legacy,
    newSystem,
    close: async () => { await browser.close(); },
  };
}
