// Browser factory. Two separate contexts: a READ-ONLY-guarded legacy context and a
// (still navigation-only) new-system context. Credentials are passed in, never stored.

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { enforceReadOnly } from './safety.ts';
import { log } from './logger.ts';

export interface Contexts {
  browser: Browser;
  legacy: BrowserContext;
  newSystem: BrowserContext;
  close: () => Promise<void>;
}

/**
 * Launch one browser with two isolated contexts. The legacy context has the network
 * read-only guard installed BEFORE any navigation, so it can never mutate legacy data.
 */
export async function launchContexts(opts: { headed?: boolean; navTimeoutMs: number }): Promise<Contexts> {
  const browser = await chromium.launch({ headless: !opts.headed });
  const legacy = await browser.newContext({ acceptDownloads: false });
  const newSystem = await browser.newContext({ acceptDownloads: true });
  legacy.setDefaultNavigationTimeout(opts.navTimeoutMs);
  newSystem.setDefaultNavigationTimeout(opts.navTimeoutMs);

  await enforceReadOnly(legacy); // <-- legacy is now write-proof at the network layer
  log.info('legacy context launched with READ-ONLY network guard');

  return {
    browser,
    legacy,
    newSystem,
    close: async () => { await browser.close(); },
  };
}
