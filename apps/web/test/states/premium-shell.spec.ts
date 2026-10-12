import {test, expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {api} from "./api";

test("premium shell defaults to light, persists dark preference and exposes usable navigation",async({page},info)=>{
  const mock=await api(page);
  await page.goto("/kesfet");
  const product=page.locator(".product");
  await expect(product).toHaveAttribute("data-theme","light");
  for(const theme of ["light","dark"]){
    if(await product.getAttribute("data-theme")!==theme) await page.getByRole("button",{name:/temaya geç/}).click();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const navigation=info.project.name.endsWith("mobile")?page.locator(".app-mobile"):page.locator(".app-sidebar nav");
    await expect(navigation.getByRole("link")).toHaveCount(6);
    for(const link of await navigation.getByRole("link").all()){
      const box=await link.boundingBox();
      expect(box).not.toBeNull();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({path:info.outputPath(`premium-shell-${theme}.png`),fullPage:true});
  }
  await page.reload();
  await expect(product).toHaveAttribute("data-theme","dark");
  await page.getByRole("button",{name:"Açık temaya geç",exact:true}).click();
  await page.reload();
  await expect(product).toHaveAttribute("data-theme","light");
  expect(mock.unexpected).toEqual([]);
});
