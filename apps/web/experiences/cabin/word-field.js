import RAPIER from '@dimforge/rapier3d-compat';
import {initPhysics} from './engine/physics.js';

// A separate physics world keeps the original cabin's objects exactly where they were.
export async function createWordField({stage, resume, wake}) {
 await initPhysics();
 const words=['Bir fikir','Ya olursa?','Başka bir yol','Cesaret','Karar senin'];
 const buttons=words.map((word,index)=>{
  const button=document.createElement('button');
  button.type='button';button.className='floating-word';button.dataset.index=String(index);
  button.textContent=word;button.setAttribute('aria-label',`${word}. Sürükle veya ok tuşlarıyla hareket ettir.`);
  stage.appendChild(button);return button;
 });
 let world=null,bodies=[],active=false,gravity=false,accumulator=0,drag=null,resizePending=false;
 const scale=100;
 function bounds(){const rect=stage.getBoundingClientRect();return {width:rect.width/scale,height:rect.height/scale,rect};}
 function build(){
  if(world)world.free();const {width,height}=bounds();
  world=new RAPIER.World({x:0,y:gravity?3.8:0,z:0});world.timestep=1/60;
  const wall=(x,y,halfX,halfY)=>world.createCollider(RAPIER.ColliderDesc.cuboid(halfX,halfY,.4).setTranslation(x,y,0).setRestitution(.3).setFriction(.7));
  wall(width/2,-.12,width/2+.3,.12);wall(width/2,height+.12,width/2+.3,.12);
  wall(-.12,height/2,.12,height/2+.3);wall(width+.12,height/2,.12,height/2+.3);
  const positions=[[.25,.12],[.70,.28],[.28,.46],[.70,.64],[.37,.82]];
  bodies=buttons.map((button,index)=>{
   const halfX=Math.min(width*.48,button.offsetWidth/scale/2),halfY=Math.min(height*.09,button.offsetHeight/scale/2);
   const x=Math.min(width-halfX,Math.max(halfX,width*positions[index][0]));
   const y=Math.min(height-halfY,Math.max(halfY,height*positions[index][1]));
   const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y,0).setLinearDamping(gravity?.45:.15).setAngularDamping(2.5).setCcdEnabled(true));
   body.setEnabledTranslations(true,true,false,true);body.setEnabledRotations(false,false,true,true);
   world.createCollider(RAPIER.ColliderDesc.cuboid(halfX,halfY,.05).setMass(1).setRestitution(.32).setFriction(.65),body);
   body.setLinvel({x:(index%2?-.045:.045),y:(index%2?.025:-.025),z:0},true);
   return body;
  });
  accumulator=0;resizePending=false;sync();
 }
 function sync(){for(let i=0;i<buttons.length;i++){const p=bodies[i].translation(),q=bodies[i].rotation(),angle=2*Math.atan2(q.z,q.w);buttons[i].style.transform=`translate3d(${p.x*scale-buttons[i].offsetWidth/2}px,${p.y*scale-buttons[i].offsetHeight/2}px,0) rotate(${angle}rad)`;}}
 function cancelDrag(){if(!drag)return;const button=buttons[drag.index];if(button.hasPointerCapture(drag.pointerId))button.releasePointerCapture(drag.pointerId);button.classList.remove('is-held');drag=null;}
 buttons.forEach((button,index)=>{
  button.addEventListener('pointerdown',event=>{
   if(!active||event.button!==0)return;const rect=stage.getBoundingClientRect(),p=bodies[index].translation();
   drag={index,pointerId:event.pointerId,dx:event.clientX-rect.left-p.x*scale,dy:event.clientY-rect.top-p.y*scale,x:event.clientX,y:event.clientY,time:performance.now(),vx:0,vy:0};
   button.setPointerCapture(event.pointerId);button.classList.add('is-held');event.preventDefault();resume();
  });
  button.addEventListener('pointermove',event=>{
   if(!drag||drag.index!==index||drag.pointerId!==event.pointerId)return;
   const {width,height,rect}=bounds(),halfX=button.offsetWidth/scale/2,halfY=button.offsetHeight/scale/2;
   const x=Math.min(width-halfX,Math.max(halfX,(event.clientX-rect.left-drag.dx)/scale));
   const y=Math.min(height-halfY,Math.max(halfY,(event.clientY-rect.top-drag.dy)/scale));
   const now=performance.now(),dt=Math.max(16,now-drag.time);drag.vx=(event.clientX-drag.x)/dt*10;drag.vy=(event.clientY-drag.y)/dt*10;drag.x=event.clientX;drag.y=event.clientY;drag.time=now;
   bodies[index].setTranslation({x,y,z:0},true);bodies[index].setLinvel({x:0,y:0,z:0},true);bodies[index].setAngvel({x:0,y:0,z:0},true);sync();wake();
  });
  const release=event=>{if(!drag||drag.index!==index||drag.pointerId!==event.pointerId)return;const {vx,vy}=drag;cancelDrag();bodies[index].setLinvel({x:Math.max(-1.2,Math.min(1.2,vx)),y:Math.max(-1.2,Math.min(1.2,vy)),z:0},true);wake();};
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',cancelDrag);button.addEventListener('lostpointercapture',()=>{if(drag?.index===index)cancelDrag();});
  button.addEventListener('keydown',event=>{
   const d={ArrowLeft:[-.35,0],ArrowRight:[.35,0],ArrowUp:[0,-.35],ArrowDown:[0,.35]}[event.key];
   if(!d||!active)return;event.preventDefault();bodies[index].applyImpulse({x:d[0],y:d[1],z:0},true);resume();
  });
 });
 addEventListener('blur',cancelDrag);
 addEventListener('resize',()=>{if(active){cancelDrag();build();wake();}else resizePending=true;});
 return {
  activate(){stage.hidden=false;active=true;if(!world||resizePending)build();else sync();wake();},
  deactivate(){cancelDrag();active=false;stage.hidden=true;},
  setGravity(value){gravity=value;if(world){world.gravity.y=value?3.8:0;bodies.forEach(body=>body.wakeUp());}},
  reset(){cancelDrag();gravity=false;build();wake();},
  cancelDrag,
  update(dt){if(!active||!world)return;accumulator+=Math.min(dt,.1);let steps=0;while(accumulator>=1/60&&steps++<6){world.step();accumulator-=1/60;}sync();},
  stats(){return {active,gravity,positions:bodies.map(body=>({x:body.translation().x,y:body.translation().y}))};}
 };
}
