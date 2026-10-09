import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function component(name) {
  const source = readFileSync(new URL(`../src/app/${name}.tsx`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
  const module = {exports:{}};
  new Function("require", "module", "exports", outputText)(require,module,module.exports);
  return module.exports.default;
}
function buttons(node) {
  if (!node || typeof node !== "object") return [];
  return [...(node.type === "button" ? [node] : []), ...[node.props?.children].flat().flatMap(buttons)];
}
for (const name of ["error","global-error"]) {
  test(`${name}: retry re-fetches instead of reset-only; server errors stay private`, () => {
    let attempts = 0;
    const tree = component(name)({retry:()=>attempts++,reset:()=>assert.fail("reset does not re-fetch"),error:new Error("private database detail")});
    const html = renderToStaticMarkup(tree);
    assert.ok(html.includes('role="alert"'));
    assert.ok(!html.includes("private database detail"));
    buttons(tree)[0].props.onClick();
    assert.equal(attempts,1);
    if (name === "global-error") {
      assert.match(html,/<html lang="tr">/);
      assert.match(html,/<main/);
    }
  });
}
