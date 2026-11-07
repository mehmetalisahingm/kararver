import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPhysics,initPhysics} from '../experiences/cabin/engine/physics.js';
import {CabinFluid,FLUID_STEP} from '../experiences/cabin/engine/fluid.js';

test('cabin bodies float, fall, contact the deck and reset',async()=>{
 await initPhysics();const s=createPhysics();
 try{
  const apple=s.bodies.get('apple'),start=apple.translation().y;
  for(let i=0;i<90;i++)s.step();assert.ok(Math.abs(apple.translation().y-start)<.08);
  s.setGravity(true);for(let i=0;i<35;i++)s.step();assert.ok(apple.translation().y<start-.5);
  for(let i=0;i<350;i++)s.step();for(const b of s.bodies.values())assert.ok(b.translation().y>0,'body tunnelled through the deck');
  s.reset();assert.equal(s.gravity,false);assert.ok(Math.abs(apple.translation().y-start)<.001);
 }finally{s.dispose();}
});
test('a higher apple drop produces a higher rebound',async()=>{
 await initPhysics();function rebound(height){const s=createPhysics();try{
  s.bodies.forEach((b,id)=>{if(id!=='apple')b.setEnabled(false);});const b=s.bodies.get('apple');b.setTranslation({x:0,y:height,z:0},true);b.setLinvel({x:0,y:0,z:0},true);s.setGravity(true);
  let contacted=false,peak=0;for(let i=0;i<300;i++){s.step();if(b.linvel().y>.4)contacted=true;if(contacted)peak=Math.max(peak,b.translation().y);}return peak;
 }finally{s.dispose();}}
 assert.ok(rebound(2.9)>rebound(1.3)*1.5);
});
test('dragging uses a spring rather than teleporting through geometry',async()=>{
 await initPhysics();const s=createPhysics();try{
  const b=s.bodies.get('apple'),x=b.translation().x,target={x:1,y:2.7,z:.6},local={x:0,y:0,z:0};s.drag('apple',target,local);s.step();
  assert.ok(b.translation().x>x&&b.translation().x<x+.05);
  for(let i=0;i<1000;i++){s.drag('apple',target,local);s.step();}assert.ok(Math.abs(b.translation().x-1)<.05);s.release();
 }finally{s.dispose();}
});
for(const milk of [false,true])test(`${milk?'milk':'water'} falls, spreads and remains finite without losing particles`,()=>{
 const f=new CabinFluid({x:milk?1:-1,y:2.8,z:0},milk),initial=f.positions.slice(),height=f.center().y;
 for(let i=0;i<30;i++)f.step(FLUID_STEP,false,null);assert.ok(Math.abs(f.center().y-height)<.005);
 for(let i=0;i<32;i++)f.step(FLUID_STEP,true,null);assert.ok(f.center().y<height-.4);
 let impact=0;for(let i=0;i<360;i++){f.step(FLUID_STEP,true,null);impact=Math.max(impact,f.impact);}assert.ok(impact>1);assert.equal(f.positions.length,initial.length);
 for(const value of f.positions)assert.ok(Number.isFinite(value));for(let i=1;i<f.positions.length;i+=3)assert.ok(f.positions[i]>=.037&&f.positions[i]<.6);
 f.reset();assert.deepEqual(f.positions,initial);
});

const magnitude=v=>Math.hypot(v.x,v.y,v.z);
function rotationDelta(a,b){const dot=Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)/(Math.hypot(a.x,a.y,a.z,a.w)*Math.hypot(b.x,b.y,b.z,b.w));return 2*Math.acos(Math.min(1,dot));}
for(const id of ['astronaut','apple','cup'])test(`${id}: rapid off-centre grabbing stays slow, including the actual rendered rotation`,async()=>{
 await initPhysics();const s=createPhysics();try{
  s.bodies.forEach((b,key)=>{if(key!==id)b.setEnabled(false);});const b=s.bodies.get(id);
  let maxSpin=0,maxSpeed=0,maxTurn=0;
  for(let i=0;i<360;i++){
   const q=b.rotation();s.drag(id,{x:Math.floor(i/45)%2?-.8:.8,y:2.5,z:-1},{x:.13,y:.08,z:.04});s.step();
   maxSpin=Math.max(maxSpin,magnitude(b.angvel()));maxSpeed=Math.max(maxSpeed,magnitude(b.linvel()));maxTurn=Math.max(maxTurn,rotationDelta(q,b.rotation())/FLUID_STEP);
  }
  assert.ok(maxSpin<=.061,`spun at ${maxSpin} rad/s`);assert.ok(maxSpeed<=.451,`moved at ${maxSpeed} m/s`);assert.ok(maxTurn<.09,`rendered turn reached ${maxTurn} rad/s`);
  s.release();assert.ok(magnitude(b.linvel())<=.081);assert.ok(magnitude(b.angvel())<=.016);
 }finally{s.dispose();}
});
test('idle zero gravity does not send the scene spinning or drifting away',async()=>{
 await initPhysics();const s=createPhysics();try{
  const start=new Map([...s.bodies].map(([id,b])=>[id,{p:b.translation(),q:b.rotation()}]));for(let i=0;i<1800;i++)s.step();
  for(const [id,b]of s.bodies){const p=b.translation(),initial=start.get(id);assert.ok(Math.hypot(p.x-initial.p.x,p.y-initial.p.y,p.z-initial.p.z)<.04);assert.ok(rotationDelta(initial.q,b.rotation())<.015);}
 }finally{s.dispose();}
});
for(const milk of [false,true])test(`${milk?'milk':'water'} remains calm under rapid zero-gravity pointer movement`,()=>{
 const f=new CabinFluid({x:0,y:2.5,z:0},milk);let maxSpeed=0;
 for(let tick=0;tick<240;tick++){
  const old=f.positions.slice();f.step(FLUID_STEP,false,{x:Math.floor(tick/30)%2?-1.4:1.4,y:2.8,z:.5});
  for(let i=0;i<old.length;i+=3)maxSpeed=Math.max(maxSpeed,Math.hypot(f.positions[i]-old[i],f.positions[i+1]-old[i+1],f.positions[i+2]-old[i+2])/FLUID_STEP);
 }
 assert.ok(maxSpeed<.352,`liquid jumped at ${maxSpeed} m/s`);for(const value of f.positions)assert.ok(Number.isFinite(value));
});
