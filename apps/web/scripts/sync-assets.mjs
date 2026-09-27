import { mkdir, copyFile } from "node:fs/promises";
const target = new URL("../public/images/", import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ["laptop.jpg", "office.jpg", "coast.jpg", "beach.jpg"])
  await copyFile(
    new URL(`../../../ui/design-system/assets/${name}`, import.meta.url),
    new URL(name, target),
  );
