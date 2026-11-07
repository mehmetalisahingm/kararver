import {build} from 'esbuild';
import {copyFile,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const source=new URL('../experiences/cabin/',import.meta.url),target=new URL('../public/experiences/cabin/',import.meta.url);
await mkdir(target,{recursive:true});
for(const file of ['main.js','craft.js','objects.js']){
 const text=await readFile(new URL(file,source),'utf8');
 for(const match of text.matchAll(/\/experiences\/cabin\/textures\/([a-z0-9-]+\.webp)/g))await access(new URL('textures/'+match[1],target));
}
const assetDir=path.resolve(fileURLToPath(new URL('assets/',target)));
if(path.dirname(assetDir)!==path.resolve(fileURLToPath(target))||path.basename(assetDir)!=='assets')throw new Error('Unexpected cabin bundle directory');
await rm(assetDir,{recursive:true,force:true});
const result=await build({
 absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),
 entryPoints:[fileURLToPath(new URL('bootstrap.js',source))],
 outdir:fileURLToPath(new URL('assets/',target)),
 bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,
 legalComments:'linked',metafile:true,logLevel:'warning',
});
for(const name of ['index.html','style.css'])await copyFile(new URL(name,source),new URL(name,target));
// Verify the shipped page refers only to local assets; no usage-based API is involved.
const entry=await readFile(new URL('index.html',target),'utf8');
if(entry.includes('importmap')||entry.includes('/vendor/'))throw new Error('Unbundled development imports in cabin page');
await writeFile(new URL('bundle-manifest.json',target),JSON.stringify({format:'esm',localAssetsOnly:true,outputs:Object.entries(result.metafile.outputs).map(([name,value])=>({name,bytes:value.bytes}))},null,2)+'\n');
console.log('Cabin built with local assets only.');
