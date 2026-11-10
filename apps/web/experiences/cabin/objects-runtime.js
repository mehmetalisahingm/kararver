import * as T from 'three';
import {MarchingCubes} from 'three/addons/objects/MarchingCubes.js';
import {apple,astronaut,laptop,cup,notebook} from './objects.js';
import {createPhysics,initPhysics} from './engine/physics.js';
import {CabinFluid,FLUID_STEP} from './engine/fluid.js';

function liquidView(milk){
 const mat=new T.MeshPhysicalMaterial(milk?{color:'#eeeadb',roughness:.17,ior:1.35,clearcoat:1,clearcoatRoughness:.1}:{color:'#e7f6f7',roughness:.035,transmission:1,thickness:.30,ior:1.333,clearcoat:1,attenuationColor:new T.Color('#a6d2d5'),attenuationDistance:2});
 const surface=new MarchingCubes(innerWidth<700?24:32,mat,false,false,16000);surface.isolation=25;surface.castShadow=surface.receiveShadow=true;
 const globe=new T.Mesh(new T.SphereGeometry(.20,64,48),mat);globe.castShadow=globe.receiveShadow=true;
 const spray=new T.InstancedMesh(new T.SphereGeometry(1,10,8),mat,48);spray.count=0;spray.instanceMatrix.setUsage(T.DynamicDrawUsage);spray.frustumCulled=false;
 return {surface,globe,spray,drops:[],dummy:new T.Object3D()};
}
function updateLiquid(fluid,view,dt,gravity){
 const p=fluid.positions;view.globe.position.copy(fluid.center());view.globe.visible=!fluid.active;view.surface.visible=fluid.active;
 if(!fluid.active){view.spray.count=0;return;}
 let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
 for(let i=0;i<p.length;i+=3){minX=Math.min(minX,p[i]);maxX=Math.max(maxX,p[i]);minY=Math.min(minY,p[i+1]);maxY=Math.max(maxY,p[i+1]);minZ=Math.min(minZ,p[i+2]);maxZ=Math.max(maxZ,p[i+2]);}
 const cx=(minX+maxX)/2,cy=(minY+maxY)/2,cz=(minZ+maxZ)/2,span=Math.max(.85,maxX-minX+.4,maxY-minY+.4,maxZ-minZ+.4);
 const surface=view.surface;surface.reset();surface.position.set(cx,cy,cz);surface.scale.setScalar(span/2);const strength=37*Math.pow(.079/span,2);
 for(let i=0;i<p.length;i+=3)surface.addBall((p[i]-cx)/span+.5,(p[i+1]-cy)/span+.5,(p[i+2]-cz)/span+.5,strength,12);surface.update();
 if(fluid.impact){
  for(let i=0;i<36;i++){const a=i*2.39996323,speed=fluid.impact*(.13+i%7*.045);view.drops.push({x:fluid.impactPoint.x,y:.06,z:fluid.impactPoint.z,vx:Math.cos(a)*speed,vy:.3+fluid.impact*(.10+i%5*.025),vz:Math.sin(a)*speed,r:.005+i%5*.0025,life:2.5});}
 }
 let visible=0;for(const d of view.drops){if(d.life<=0)continue;d.life-=dt;d.vy-=gravity?9.81*dt:0;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;if(d.y<d.r){d.y=d.r;d.vy=Math.abs(d.vy)*.1;d.vx*=.85;d.vz*=.85;}const o=view.dummy;o.position.set(d.x,d.y,d.z);o.scale.set(d.r,d.y<d.r+.01?d.r*.3:d.r*1.1,d.r);o.updateMatrix();view.spray.setMatrixAt(visible++,o.matrix);if(visible===48)break;}view.spray.count=visible;view.spray.instanceMatrix.needsUpdate=true;
 view.drops=view.drops.filter(d=>d.life>0);
}

export async function createObjects({scene,camera,canvas,roots,getGravity,resume,wake,onSelect}){
 await initPhysics();const physics=createPhysics();
 for(const [id,factory]of [['astronaut',astronaut],['apple',apple],['laptop',laptop],['glass',()=>cup(true)],['cup',()=>cup(false)],['notebook',notebook]]){
  const root=factory();root.traverse(o=>{o.userData.itemId=id;if(o.isMesh)o.castShadow=o.receiveShadow=true;});root.userData.itemId=id;scene.add(root);roots.set(id,root);
 }
 const water=new CabinFluid({x:-1.15,y:1.63,z:-1.18}),milk=new CabinFluid({x:1.15,y:2.13,z:-1.8},true),fluids={water,milk},views={water:liquidView(false),milk:liquidView(true)};
 for(const id of ['water','milk']){const v=views[id];v.globe.userData.itemId=v.surface.userData.itemId=id;scene.add(v.surface,v.globe,v.spray);updateLiquid(fluids[id],v,0,false);}
 let accumulator=0,drag=null,selection=null,lastNudge=-Infinity;const ray=new T.Raycaster(),pointer=new T.Vector2(),point=new T.Vector3(),direction=new T.Vector3();
 const oldMove=canvas.onpointermove,oldDown=canvas.onpointerdown,oldUp=canvas.onpointerup;
 const setRay=e=>{const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);};
 const pick=()=>ray.intersectObjects([...roots.values()].filter(o=>o.visible).concat(Object.values(views).flatMap(v=>[v.globe,v.surface]).filter(o=>o.visible)),true).find(h=>h.object.userData.itemId);
 const end=()=>{drag=null;physics.release();canvas.style.cursor='grab';oldUp?.();};
 canvas.onpointerdown=e=>{
  if(e.button!==0)return;setRay(e);const hit=pick();if(!hit){oldDown?.(e);return;}
  const id=hit.object.userData.itemId;selection=id;onSelect(id);camera.getWorldDirection(direction);const plane=new T.Plane().setFromNormalAndCoplanarPoint(direction,hit.point);
  const center=id==='water'||id==='milk'?new T.Vector3().copy(fluids[id].center()):new T.Vector3().copy(physics.bodies.get(id).translation());
  const local=id==='water'||id==='milk'?new T.Vector3():hit.point.clone().sub(center).applyQuaternion(roots.get(id).quaternion.clone().invert());
  drag={id,target:hit.point.clone(),plane,local,offset:hit.point.clone().sub(center)};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';canvas.focus();e.preventDefault();resume();
 };
 canvas.onpointermove=e=>{setRay(e);if(drag){if(ray.ray.intersectPlane(drag.plane,point)){drag.target.copy(point);drag.target.x=T.MathUtils.clamp(point.x,-1.55,1.55);drag.target.y=T.MathUtils.clamp(point.y,.25,3.1);drag.target.z=T.MathUtils.clamp(point.z,-4.5,1.2);}wake();}else{oldMove?.(e);canvas.style.cursor=pick()?'grab':'default';}};
 canvas.onpointerup=canvas.onpointercancel=end;
 canvas.addEventListener('lostpointercapture',end);window.addEventListener('blur',end);
 const keys=e=>{
  if(e.key==='Escape'){end();selection=null;onSelect(null);return;}if(!selection||/INPUT|BUTTON|SUMMARY/.test(e.target.tagName))return;
  const axes={ArrowLeft:['x',-.12],ArrowRight:['x',.12],ArrowUp:['y',.12],ArrowDown:['y',-.12],PageUp:['z',-.12],PageDown:['z',.12]};const axis=axes[e.key];if(!axis)return;e.preventDefault();
  if(performance.now()-lastNudge<100)return;lastNudge=performance.now();
  if(selection==='water'||selection==='milk'){const p=fluids[selection].positions;for(let i=0;i<p.length;i+=3)p[i+['x','y','z'].indexOf(axis[0])]+=axis[1]*.125;}
  else {const b=physics.bodies.get(selection);const force={x:0,y:0,z:0};force[axis[0]]=axis[1]*b.mass()*(getGravity()?3:.45);b.applyImpulse(force,true);}resume();
 };canvas.addEventListener('keydown',keys);
 function sync(){roots.forEach((o,id)=>{const b=physics.bodies.get(id);o.position.copy(b.translation());o.quaternion.copy(b.rotation());});}
 sync();
 return {
  select(id){if(!roots.has(id)&&id!=='water'&&id!=='milk')return;selection=id;onSelect(id);wake();},
  bodies:physics.bodies,fluids:{water,milk,views,visible(value){Object.values(views).forEach(v=>{v.surface.visible=value&&water.active;v.globe.visible=value&&!water.active;v.spray.visible=value;});}},
  update(dt,time){
   accumulator+=Math.min(dt,.10);let count=0;
   while(accumulator>=FLUID_STEP&&count<10){
    if(drag&&drag.id!=='water'&&drag.id!=='milk')physics.drag(drag.id,drag.target,drag.local);
    physics.step();
    for(const id of ['water','milk']){const f=fluids[id],target=drag?.id===id?drag.target.clone().sub(drag.offset):null;if(getGravity()||drag?.id===id||f.active)f.step(FLUID_STEP,getGravity(),target,physics.fluidContact);}
    accumulator-=FLUID_STEP;count++;
   }
   sync();for(const id of ['water','milk'])updateLiquid(fluids[id],views[id],dt,getGravity());
  },
  setGravity(value){physics.setGravity(value);},
  cancelDrag:end,
  reset(){end();physics.reset();water.reset();milk.reset();for(const v of Object.values(views))v.drops=[];accumulator=0;sync();for(const id of ['water','milk'])updateLiquid(fluids[id],views[id],0,false);},
  dispose(){end();canvas.removeEventListener('keydown',keys);canvas.removeEventListener('lostpointercapture',end);window.removeEventListener('blur',end);physics.dispose();}
 };
}
