/* Start the static server described in docs/KV-05_UI_CONTRACT.md first. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

(async () => {
  const baseURL = process.env.KV_PREVIEW_URL || 'http://127.0.0.1:4173';
  const output = process.env.KV_TEST_OUTPUT || path.join(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch(process.env.KV_BROWSER_PATH ? { executablePath: process.env.KV_BROWSER_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  const report = { browser: browser.version(), viewports: [], accessibility: [], checks: [] };
  async function audit(label) {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    report.accessibility.push({ label, violations: result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })) });
    assert.equal(result.violations.length, 0, `${label}: ${JSON.stringify(report.accessibility.at(-1))}`);
  }
  async function route(hash) {
    await page.goto(`${baseURL}/#${hash}`);
    await page.locator(`[data-page="${hash}"]`).waitFor({ state: 'visible' });
  }
  try {
    await route('feed');
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const target of ['home', 'feed', 'components', 'create', 'explore', 'notifications', 'profile', 'categories', 'admin', 'not-found', 'server-error']) {
        await route(target);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `${target} overflows at ${width}px`);
        if (width === 360 || width === 1440) await audit(`${target}-${width}`);
      }
      await route('feed');
      assert.equal(await page.locator('.preview-mobile-nav').isVisible(), width < 768);
      assert.equal(await page.locator('.preview-sidebar').isVisible(), width >= 768);
      report.viewports.push(width);
    }
    report.checks.push('11 surfaces: no horizontal overflow at 360/390/768/1024/1440; navigation breakpoints');
    await page.setViewportSize({ width: 1440, height: 1100 });
    await route('feed');
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    if (!(await page.locator('.state-tools').evaluate(el => el.open))) await page.locator('.state-tools summary').click();
    for (const state of ['loading', 'empty', 'error']) {
      await page.locator(`[data-feed-state="${state}"]`).click();
      assert.equal(await page.locator(`[data-feed-panel="${state}"]`).isVisible(), true);
      await audit(`feed-${state}`);
    }
    await page.getByRole('button', { name: 'Tekrar dene', exact: true }).click();
    assert.equal(await page.locator('[data-feed-panel="ready"]').isVisible(), true);
    assert.equal(await page.locator('[data-feed-state="ready"]').evaluate(el => el === document.activeElement), true);
    report.checks.push('Loading/empty/error transitions and retry focus');

    await route('create');
    await page.getByRole('button', { name: 'Formu kontrol et' }).click();
    assert.equal(await page.locator('#question').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 3);
    await audit('form-errors');
    await page.locator('#question').fill('Hangi bilgisayarı tercih etmeliyim?');
    await page.locator('#option-a').fill('Laptop');
    await page.locator('#option-b').fill('Laptop');
    await page.getByRole('button', { name: 'Formu kontrol et' }).click();
    assert.equal(await page.locator('#option-b').getAttribute('aria-invalid'), 'true');
    await page.locator('#option-b').fill('Masaüstü');
    await page.getByRole('button', { name: 'Formu kontrol et' }).click();
    assert.match(await page.locator('#form-feedback').textContent(), /Form doğrulandı/);
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 0);
    report.checks.push('Required/duplicate option errors, first invalid focus, correction and success');

    await route('components');
    await page.getByRole('button', { name: 'Modalı aç' }).click();
    assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
    assert.equal(await page.locator('dialog [autofocus]').evaluate(el => el === document.activeElement), true);
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.closest('dialog') !== null || document.activeElement === document.body), true);
    }
    await audit('modal');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog').evaluate(el => el.open), false);
    assert.equal(await page.locator('[data-open-dialog]').evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: 'Modalı aç' }).click();
    await page.getByRole('button', { name: 'Örnek işlemi onayla' }).click();
    assert.equal(await page.locator('dialog').evaluate(el => el.open), false);
    report.checks.push('Modal initial focus, native focus containment, Escape, focus return and confirm');

    await route('feed');
    await page.keyboard.press('Tab');
    await page.getByRole('link', { name: 'İçeriğe geç' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#main').evaluate(el => el === document.activeElement), true);
    await page.goto(`${baseURL}/#unknown`);
    await page.locator('[data-page="not-found"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-page="not-found"]').isVisible(), true);
    report.checks.push('Skip link and unknown route fallback');

    await page.setViewportSize({ width: 360, height: 800 });
    await route('feed');
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.locator('.preview-mobile-nav a[href="#create"]').click();
    // hashchange is asynchronous: click completion is not route completion.
    await page.locator('[data-page="create"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.preview-mobile-nav a[href="#create"]').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#main').evaluate(el => el === document.activeElement), true);
    await page.screenshot({ path: path.join(output, 'mobile-form.png'), fullPage: true });
    await route('feed');
    if (!(await page.locator('.state-tools').evaluate(el => el.open))) await page.locator('.state-tools summary').click();
    await page.locator('[data-feed-state="loading"]').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.kv-skeleton').first().evaluate(el => getComputedStyle(el).animationName), 'none');
    report.checks.push('Mobile navigation active state/focus and reduced motion');
    await route('feed');
    await page.locator('[data-category="Seyahat"]').click();
    assert.equal(await page.locator('[data-poll-category]:visible').count(), 1);
    await page.locator('#search-input').fill('eşleşmeyenkelime');
    await page.locator('#search-form button').click();
    assert.equal(await page.locator('#no-matches').isVisible(), true);
    await page.getByRole('button', { name: 'Filtreleri temizle' }).click();
    assert.equal(await page.locator('[data-poll-category]:visible').count(), 3);
    await page.locator('.save-poll').first().click();
    assert.equal(await page.locator('.save-poll').first().getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Açık temaya geç' }).click();
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const target of ['home', 'feed', 'components', 'create', 'explore', 'profile', 'categories', 'admin']) {
        await route(target);
        await audit(`light-${target}-${width}`);
      }
    }
    report.checks.push('Category/search/no results/reset, save preview, both themes accessibility');
    assert.deepEqual(runtimeErrors, []);
    report.checks.push('No browser runtime errors');
    report.passed = true;
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
