import puppeteer, { Browser, Page } from 'puppeteer-core';
import { config } from '../../config/index.js';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) {
    return browser;
  }

  // Clean up stale reference
  if (browser) {
    try { browser.disconnect(); } catch { /* ignore */ }
    browser = null;
  }

  browser = await puppeteer.connect({
    browserWSEndpoint: config.chromium.wsEndpoint,
    protocolTimeout: 600_000, // 10 minutes for long renders
  });

  // Auto-clear on unexpected disconnect so next call reconnects
  browser.on('disconnected', () => {
    browser = null;
  });

  return browser;
}

export async function acquirePage(width: number, height: number): Promise<Page> {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.setViewport({ width, height });
  return page;
}

export async function releasePage(page: Page): Promise<void> {
  try {
    await page.close();
  } catch {
    // ignore errors on close
  }
}
