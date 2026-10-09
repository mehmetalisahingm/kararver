import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const productCss = readFileSync(new URL("../src/app/premium.css", import.meta.url), "utf8");
const welcomeCss = readFileSync(new URL("../src/features/onboarding/welcome.module.css", import.meta.url), "utf8");

function tokens(css, selector) {
  const start = css.indexOf(selector + " {");
  assert.notEqual(start, -1, "Expected selector: " + selector);
  const block = css.slice(start).match(/^[^{]+\{([^}]+)\}/);
  assert.ok(block, "CSS selector has a complete rule: " + selector);
  return Object.fromEntries([...block[1].matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(x => [x[1], x[2].toLowerCase()]));
}
function luminance(hex) {
  const channel = hex.replace("#","").match(/../g).map(n => parseInt(n,16)/255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055)/1.055) ** 2.4);
  return .2126 * channel[0] + .7152 * channel[1] + .0722 * channel[2];
}
function contrast(a,b) {
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
const light=tokens(productCss, '.product[data-theme="light"]');
const dark=tokens(productCss, '.product[data-theme="dark"]');
const welcome=tokens(welcomeCss, ".welcome");

test("charcoal/champagne light theme text, muted and accents meet WCAG AA",()=>{
  for(const [fg,bg,name] of [
    [light["--kv-text"],light["--kv-background"],"light content"],
    [light["--kv-muted"],light["--kv-surface"],"light muted"],
    [light["--kv-accent"],light["--kv-surface"],"light accent"],
    [dark["--kv-text"],dark["--kv-background"],"dark content"],
    [dark["--kv-muted"],dark["--kv-surface"],"dark muted"],
    [dark["--kv-accent"],dark["--kv-surface"],"dark accent"],
  ]) assert.ok(contrast(fg,bg)>=4.5,name+" expected >=4.5:1, received "+contrast(fg,bg).toFixed(2));
});
test("champagne primary CTA uses dark ink in both modes",()=>{
  assert.match(productCss,/\.product \.kv-button:not\(\.kv-button--secondary\)[\s\S]*?color: #252525;/);
  assert.match(welcomeCss,/\.primary, \.primary:hover \{ color: #252525 !important;/);
  for(const x of [light,dark])assert.ok(contrast(x["--kv-primary"],"#252525")>=4.5);
});
test("focus ring is visible against each theme and onboarding text is legible",()=>{
  for(const x of [light,dark])assert.ok(contrast(x["--kv-focus"],x["--kv-background"])>=3);
  assert.ok(contrast(welcome["--ink"],"#faf8f2")>=7);
  assert.ok(contrast(welcome["--accent"],"#faf8f2")>=4.5);
});
