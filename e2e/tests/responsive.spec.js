const { test, expect } = require('@playwright/test');
const { createRoom } = require('../helpers');

// Vérifie précisément le point de rupture (768px) plutôt que deux extrêmes
// éloignés : c'est là qu'une régression de mise en page serait la plus
// probable (cf. audit UX/UI, item B).
for (const width of [767, 768, 1024]) {
  test(`Home renders without horizontal overflow at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'AMIMOT' })).toBeVisible();

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasOverflow).toBe(false);

    await context.close();
  });
}

test('the Home card widens past the 768px breakpoint', async ({ browser }) => {
  const narrowCtx = await browser.newContext({ viewport: { width: 767, height: 900 } });
  const wideCtx = await browser.newContext({ viewport: { width: 768, height: 900 } });
  const narrow = await narrowCtx.newPage();
  const wide = await wideCtx.newPage();

  await narrow.goto('/');
  await wide.goto('/');

  // TextInput est en width:100% de la carte : sa largeur rendue reflète
  // directement celle de la carte (440px sous 768px, 560px au-dessus).
  const narrowWidth = await narrow.getByPlaceholder('Ton nom (15 caractères max)').evaluate((el) => el.getBoundingClientRect().width);
  const wideWidth = await wide.getByPlaceholder('Ton nom (15 caractères max)').evaluate((el) => el.getBoundingClientRect().width);

  expect(wideWidth).toBeGreaterThan(narrowWidth * 1.05);

  await narrowCtx.close();
  await wideCtx.close();
});

test('Lobby content stays capped and centered on a wide viewport (no full-bleed panels)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await createRoom(page, 'Alice');

  // Deux niveaux au-dessus du titre "Joueurs" (h2 -> .header -> .panel) :
  // c'est ce panneau dont la largeur doit rester plafonnée par le wrapper
  // .content de LobbyScreen (max-width: 640px), pas étirée sur les 1440px du
  // viewport.
  const panelWidth = await page
    .locator('xpath=//h2[text()="Joueurs"]/ancestor::div[2]')
    .evaluate((el) => el.getBoundingClientRect().width);

  expect(panelWidth).toBeLessThan(700);

  await context.close();
});
