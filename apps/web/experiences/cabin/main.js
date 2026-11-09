import * as T from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {buildRoom} from './craft.js';
import {applyProjectedFinish} from './projected-finish.js';

const host=document.querySelector('#scene'),mobile=innerWidth<700;
document.body.dataset.embedded=String(new URLSearchParams(location.search).has('embed'));
const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.25:1.6));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.87;
renderer.info.autoReset=false;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
renderer.transmissionResolutionScale=.5;
host.appendChild(renderer.domElement);const canvas=renderer.domElement;canvas.tabIndex=0;
canvas.setAttribute('aria-label','Mekik kabini. Nesneleri tutup yavaşça sürükleyebilirsin. Bakış açısını menüdeki düğmeyle değiştir.');
const scene=new T.Scene();scene.background=new T.Color('#050a0f');
const camera=new T.PerspectiveCamera(mobile?65:49,innerWidth/innerHeight,.06,150);
camera.position.set(mobile?.04:.18,1.68,mobile?3.7:2.6);camera.lookAt(0,1.68,-3.2);
const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
const ao=new GTAOPass(scene,camera,innerWidth,innerHeight);ao.blendIntensity=.82;
ao.updateGtaoMaterial({radius:.23,thickness:.18,distanceExponent:1,scale:1,samples:mobile?8:16});
ao.updatePdMaterial({lumaPhi:10,depthPhi:3,normalPhi:3,radius:3,rings:2,samples:8});composer.addPass(ao);composer.addPass(new SMAAPass());composer.addPass(new OutputPass());
const resizeAO=ao.setSize.bind(ao);ao.setSize=(w,h)=>resizeAO(Math.ceil(w*.55),Math.ceil(h*.55));ao.setSize(innerWidth,innerHeight);
ao.enabled=new URLSearchParams(location.search).has('ao');
RectAreaLightUniformsLib.init();
const pmrem=new T.PMREMGenerator(renderer),env=new RoomEnvironment();const envRT=pmrem.fromScene(env,.04);env.dispose();scene.environment=envRT.texture;scene.environmentIntensity=.2;
scene.add(new T.HemisphereLight(0xb4cad0,0x48483a,.12));
const {root:room}=buildRoom();scene.add(room);
for(const side of [-1,1])for(const z of [-4.2,-1.1,1.8]){
 const l=new T.RectAreaLight(0xffe7c4,3.4,.18,2.4);l.position.set(side*1.86,3.13,z);l.lookAt(side*.6,0,z);scene.add(l);
}
function spot(color,power,position,target,angle=.8,shadow=true){const l=new T.SpotLight(color,power,16,angle,.8,2);l.position.fromArray(position);l.target.position.fromArray(target);l.castShadow=shadow;l.shadow.mapSize.set(1024,1024);l.shadow.bias=-.0004;l.shadow.normalBias=.02;l.shadow.radius=3;scene.add(l,l.target);return l;}
spot(0xffe3bb,125,[-1.7,3.10,1.2],[.6,.9,-2.1],.95);
spot(0xd3eaff,95,[1.48,2.1,-5.2],[-.3,.8,-.3],.75);
spot(0xffebd0,60,[1.6,3.1,-3.7],[-.3,1,-4.8],.9,false);
spot(0xffecd7,18,[-.4,2.5,1.5],[-.77,2.48,-.9],.24,false);
// Distant orbital matte painting outside the real aperture; the cabin and objects remain meshes.
const earthTexture=await new T.TextureLoader().loadAsync('/experiences/cabin/textures/orbital-window.webp');earthTexture.colorSpace=T.SRGBColorSpace;
const earth=new T.Mesh(new T.PlaneGeometry(38,21.375),new T.MeshBasicMaterial({map:earthTexture,color:0xffffff}));earth.position.set(1.5,7.3,-31);scene.add(earth);
if(!new URLSearchParams(location.search).has('geometry')){
 const finish=await new T.TextureLoader().loadAsync('/experiences/cabin/textures/room-photographic-bake.webp');finish.colorSpace=T.SRGBColorSpace;finish.anisotropy=8;
 applyProjectedFinish(scene,room,renderer,finish);
}

// Cache the actual 3D cabin's colour AND depth while the camera is stationary.
// Moving objects still render in 3D, refract the room and cast real floor shadows.
// Looking around invalidates the cache; this is not a photo replacing the room mesh.
const staticTarget=new T.WebGLRenderTarget(Math.ceil(innerWidth*renderer.getPixelRatio()),Math.ceil(innerHeight*renderer.getPixelRatio()),{type:T.HalfFloatType,depthBuffer:true});
staticTarget.depthTexture=new T.DepthTexture(staticTarget.width,staticTarget.height,T.UnsignedIntType);
const cachedBackground=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({
 uniforms:{colorMap:{value:staticTarget.texture},depthMap:{value:staticTarget.depthTexture}},depthTest:false,depthWrite:true,
 vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,1.,1.);}',
 fragmentShader:'uniform sampler2D colorMap;uniform sampler2D depthMap;varying vec2 vUv;void main(){gl_FragColor=texture2D(colorMap,vUv);gl_FragDepth=texture2D(depthMap,vUv).r;#include <tonemapping_fragment>\n#include <colorspace_fragment>}'
}));
// Shader chunks must start on a fresh preprocessor line.
cachedBackground.material.fragmentShader=cachedBackground.material.fragmentShader.replace(';#include',';\n#include');
cachedBackground.frustumCulled=false;cachedBackground.renderOrder=-1000;cachedBackground.visible=false;scene.add(cachedBackground);
const shadowFloor=new T.Mesh(new T.PlaneGeometry(5.35,8.5),new T.ShadowMaterial({opacity:.32,depthWrite:false}));shadowFloor.rotation.x=-Math.PI/2;shadowFloor.position.set(0,.003,-1.6);shadowFloor.receiveShadow=true;shadowFloor.visible=false;scene.add(shadowFloor);
let staticDirty=true,cachedYaw=10,cachedPitch=10;
T.DefaultLoadingManager.onLoad=()=>{staticDirty=true;wake();};
function cacheCabin(){
 const hidden=[];roots.forEach(o=>{hidden.push([o,o.visible]);o.visible=false;});if(fluidSystem)for(const v of Object.values(fluidSystem.views))for(const o of [v.globe,v.surface,v.spray]){hidden.push([o,o.visible]);o.visible=false;}
 cachedBackground.visible=false;shadowFloor.visible=false;room.visible=earth.visible=true;const previous=renderer.getRenderTarget();
 renderer.shadowMap.needsUpdate=true;renderer.setRenderTarget(staticTarget);renderer.clear();renderer.render(scene,camera);renderer.setRenderTarget(previous);
 hidden.forEach(([o,v])=>o.visible=v);room.visible=earth.visible=false;cachedBackground.visible=true;shadowFloor.visible=true;renderer.shadowMap.needsUpdate=true;
 cachedYaw=yaw.x;cachedPitch=yaw.y;staticDirty=false;
}

let paused=matchMedia('(prefers-reduced-motion:reduce)').matches,gravity=false,roomOnly=true,disposed=false,mode='objects',wordField=null,modeTouched=false;
let objectState={gravity:false,paused,roomOnly:false,hint:'Sonra yer çekimini aç.'},wordState={gravity:false,paused};
let offscreen=false,priorPause=paused;
addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='kararver-cabin-visibility')return;const hide=!event.data.visible;if(hide===offscreen)return;offscreen=hide;if(hide){priorPause=paused;paused=true;physics?.cancelDrag();wordField?.cancelDrag();cancelAnimationFrame(frame);frame=0;}else{paused=priorPause;last=performance.now();wake();}});
document.querySelector('#pause').ariaPressed=String(paused);document.querySelector('#pause').textContent=paused?'▷':'Ⅱ';document.querySelector('#pause').setAttribute('aria-label',paused?'Hareketi başlat':'Hareketi durdur');
renderer.shadowMap.autoUpdate=false;
let frame=0,last=0,time=0,selected=null,lastShadow=0;const yaw={x:.03,y:0,tx:.03,ty:0};
const roots=new Map();let physics=null,fluidSystem=null;
function render(now){
 if(disposed||offscreen||document.hidden){frame=0;return;}frame=0;const dt=Math.min(.10,Math.max(0,(now-last)/1000));last=now;if(!paused)time+=dt;
 const viewBlend=1-Math.exp(-1.7*dt);yaw.x+=(yaw.tx-yaw.x)*viewBlend;yaw.y+=(yaw.ty-yaw.y)*viewBlend;
 camera.rotation.set(yaw.y,yaw.x,0,'YXZ');
 if(!paused&&mode==='objects'&&physics&&!roomOnly)physics.update(dt,time);
 if(!paused&&mode==='words')wordField?.update(dt);
 if(staticDirty||Math.abs(yaw.x-cachedYaw)+Math.abs(yaw.y-cachedPitch)>.0004)cacheCabin();
 if(now-lastShadow>(gravity?45:140)){renderer.shadowMap.needsUpdate=true;lastShadow=now;}
 renderer.info.reset();composer.render();if((!paused||Math.abs(yaw.tx-yaw.x)+Math.abs(yaw.ty-yaw.y)>.0001)&&!document.hidden)frame=requestAnimationFrame(render);
}
function wake(){if(!frame&&!offscreen&&!document.hidden&&!disposed)frame=requestAnimationFrame(render);}
function syncControls(){document.body.dataset.gravity=String(gravity);document.querySelector('#gravity').ariaPressed=String(gravity);document.querySelector('#gravity').innerHTML=gravity?'<span>↑</span> Yer çekimini kapat':'<span>↓</span> Yer çekimini aktif et';document.querySelector('#state-label').textContent=gravity?'YER ÇEKİMİ AKTİF':'SERBEST SÜZÜLÜŞ';document.querySelector('#g-value').innerHTML=(gravity?(mode==='words'?'0.39':'1.00'):'0.00')+'<small>g</small>';document.querySelector('#pause').ariaPressed=String(paused);document.querySelector('#pause').setAttribute('aria-label',paused?'Hareketi başlat':'Hareketi durdur');document.querySelector('#pause').textContent=paused?'▷':'Ⅱ';}
function reset(){gravity=false;if(mode==='words')wordField?.reset();else physics?.reset();syncControls();wake();}
function resume(){paused=false;syncControls();last=performance.now();wake();}
function setGravity(){gravity=!gravity;if(mode==='words')wordField?.setGravity(gravity);else physics?.setGravity(gravity);syncControls();resume();}
document.querySelector('#gravity').onclick=setGravity;document.querySelector('#reset').onclick=reset;
document.querySelector('#pause').onclick=()=>{paused=!paused;if(paused){physics?.cancelDrag();wordField?.cancelDrag();}syncControls();last=performance.now();wake();};
function showObjects(value){roomOnly=!value;roots.forEach(root=>root.visible=value);fluidSystem?.visible(value);document.querySelector('#gravity').disabled=roomOnly||!physics;document.querySelector('#reset').disabled=roomOnly||!physics;document.querySelector('#pick').disabled=roomOnly||!physics;wake();}
function selectMode(next){
 if(next===mode||!wordField||!physics)return;
 if(mode==='objects'){objectState={gravity,paused,roomOnly,hint:document.querySelector('#selected').textContent};physics.cancelDrag();showObjects(false);}
 else{wordState={gravity,paused};wordField.deactivate();}
 mode=next;document.body.dataset.mode=mode;
 if(mode==='words'){
  gravity=wordState.gravity;paused=wordState.paused;wordField.activate();wordField.setGravity(gravity);
  document.querySelector('#gravity').disabled=false;document.querySelector('#reset').disabled=false;
  document.querySelector('#hint-copy').textContent='Bir kelimeyi tut. Sürükle. Bırak.';document.querySelector('#selected').textContent='Ok tuşlarıyla da hareket ettirebilirsin.';
 }else{
  gravity=objectState.gravity;paused=objectState.paused;physics.setGravity(gravity);showObjects(!objectState.roomOnly);
  document.querySelector('#hint-copy').textContent='Bir nesneyi tut. Sürükle. Bırak.';document.querySelector('#selected').textContent=objectState.hint;
 }
 document.querySelector('#mode-words').ariaPressed=String(mode==='words');document.querySelector('#mode-objects').ariaPressed=String(mode==='objects');syncControls();last=performance.now();wake();
}
document.querySelector('#mode-words').onclick=()=>{modeTouched=true;selectMode('words');};
document.querySelector('#mode-objects').onclick=()=>{modeTouched=true;selectMode('objects');};
document.querySelector('#room').onclick=()=>showObjects(false);document.querySelector('#objects').onclick=()=>{if(!physics){location.search='';return;}showObjects(true);};
document.querySelector('#pick').onchange=e=>{if(!physics||!e.target.value)return;physics.select(e.target.value);document.querySelector('.settings').open=false;canvas.focus();};
document.querySelector('#copy').onchange=e=>document.body.classList.toggle('no-copy',!e.target.checked);
let angle=0;document.querySelector('#angle').onclick=()=>{angle=(angle+1)%3;yaw.tx=[.03,.10,-.04][angle];yaw.ty=[0,-.015,.015][angle];wake();};
canvas.onpointerdown=e=>{if(e.button===0)canvas.focus();};
canvas.onpointermove=()=>{};canvas.onpointerup=canvas.onpointercancel=()=>{};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);staticTarget.setSize(Math.ceil(innerWidth*renderer.getPixelRatio()),Math.ceil(innerHeight*renderer.getPixelRatio()));staticDirty=true;wake();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){physics?.cancelDrag();wordField?.cancelDrag();cancelAnimationFrame(frame);frame=0;}else{last=performance.now();wake();}});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();disposed=true;cancelAnimationFrame(frame);document.querySelector('#gravity').disabled=true;document.querySelector('#reset').disabled=true;window.dispatchEvent(new Event('cabin-render-failure'));});
const cubeTarget=new T.WebGLCubeRenderTarget(mobile?128:256,{generateMipmaps:true,minFilter:T.LinearMipmapLinearFilter,type:T.HalfFloatType}),cube=new T.CubeCamera(.1,100,cubeTarget);cube.position.set(0,1.7,-1.5);scene.add(cube);
function captureEnvironment(){const visibles=[];roots.forEach(o=>{visibles.push([o,o.visible]);o.visible=false;});if(fluidSystem)for(const v of Object.values(fluidSystem.views))for(const o of [v.globe,v.surface,v.spray]){visibles.push([o,o.visible]);o.visible=false;}cachedBackground.visible=shadowFloor.visible=false;room.visible=earth.visible=true;cube.update(renderer,scene);const baked=pmrem.fromCubemap(cubeTarget.texture);scene.environment=baked.texture;scene.environmentIntensity=.65;visibles.forEach(([o,value])=>o.visible=value);staticDirty=true;wake();}
if(location.hostname==='127.0.0.1'||location.hostname==='localhost')window.__cabin={get camera(){return camera;},get scene(){return scene;},get renderer(){return renderer;},get physics(){return physics;},get wordField(){return wordField;},composer,ao,roots,room,reset,setGravity,showObjects,captureEnvironment,get gravity(){return gravity;},setView(x,y=0){yaw.tx=x;yaw.ty=y;wake();},setPause(value){paused=value;last=performance.now();wake();},stats:()=>({drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,roomOnly,gravity,paused,mode})};
document.querySelector('#loading').remove();last=performance.now();wake();
// Object assembly is intentionally separate from the environment's geometry and lighting.
if(!new URLSearchParams(location.search).has('room'))import('./objects-runtime.js').then(async({createObjects})=>{
 const result=await createObjects({scene,camera,canvas,roots,getGravity:()=>gravity,resume,wake,onSelect:id=>{selected=id;document.querySelector('#selected').textContent=id?({apple:'Elma',astronaut:'Astronot',laptop:'Laptop',glass:'Bardak',cup:'Fincan',notebook:'Defter',water:'Su',milk:'Süt'}[id])+' seçili · Ok tuşlarıyla da hareket ettir.':'Sonra yer çekimini aç.';}});
 if(!new URLSearchParams(location.search).has('geometry')){
  const fabricFinish=await new T.TextureLoader().loadAsync('/experiences/cabin/textures/suit-photographic-bake.webp');fabricFinish.colorSpace=T.SRGBColorSpace;fabricFinish.anisotropy=8;
  applyProjectedFinish(scene,roots.get('astronaut'),renderer,fabricFinish,{local:true,clothOnly:true});
 }
 physics=result;fluidSystem=result.fluids;showObjects(true);captureEnvironment();document.body.dataset.ready='true';
 try{const {createWordField}=await import('./word-field.js');wordField=await createWordField({stage:document.querySelector('#word-stage'),resume,wake});document.querySelector('#mode-words').disabled=false;if(!modeTouched)selectMode('words');}
 catch(error){console.error('Yazı deneyi yüklenemedi',error);wordField?.deactivate();wordField=null;mode='objects';document.body.dataset.mode=mode;gravity=objectState.gravity;paused=objectState.paused;physics.setGravity(gravity);showObjects(!objectState.roomOnly);syncControls();document.querySelector('#mode-objects').ariaPressed='true';document.querySelector('#mode-words').ariaPressed='false';document.querySelector('#mode-words').disabled=true;document.querySelector('#mode-words').textContent='Yazılar yüklenemedi';}
}).catch(error=>{console.error(error);document.querySelector('#selected').textContent='Nesneler yüklenemedi. Ortamı keşfetmeye devam edebilirsin.';});
