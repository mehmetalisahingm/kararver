import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPhysics,initPhysics} from '../experiences/cabin/engine/physics.js';
import {CabinFluid,FLUID_STEP} from '../experiences/cabin/engine/fluid.js';

test('cabin bodies float, fall, contact the deck and reset',async()=>{
 await initPhysics();const s=createPhysics();
 try{
  const apple=s.bodies.get('apple'),start=apple.translation().y;
  for(let i=0;i<90;i++)s.world.step();assert.ok(Math.abs(apple.translation().y-start)<.08);
  s.setGravity(true);for(let i=0;i<35;i++)s.world.step();assert.ok(apple.translation().y<start-.5);
  for(let i=0;i<350;i++)s.world.step();for(const b of s.bodies.values())assert.ok(b.translation().y>0,'body tunnelled through the deck');
  s.reset();assert.equal(s.gravity,false);assert.ok(Math.abs(apple.translation().y-start)<.001);
 }finally{s.dispose();}
});
test('a higher apple drop produces a higher rebound',async()=>{
 await initPhysics();function rebound(height){const s=createPhysics();try{
  s.bodies.forEach((b,id)=>{if(id!=='apple')b.setEnabled(false);});const b=s.bodies.get('apple');b.setTranslation({x:0,y:height,z:0},true);b.setLinvel({x:0,y:0,z:0},true);s.setGravity(true);
  let contacted=false,peak=0;for(let i=0;i<300;i++){s.world.step();if(b.linvel().y>.4)contacted=true;if(contacted)peak=Math.max(peak,b.translation().y);}return peak;
 }finally{s.dispose();}}
 assert.ok(rebound(2.9)>rebound(1.3)*1.5);
});
test('dragging uses a spring rather than teleporting through geometry',async()=>{
 await initPhysics();const s=createPhysics();try{
  const b=s.bodies.get('apple'),x=b.translation().x,target={x:1,y:2.7,z:.6},local={x:0,y:0,z:0};s.drag('apple',target,local);s.world.step();
  assert.ok(b.translation().x>x&&b.translation().x<x+.05);
  for(let i=0;i<160;i++){s.drag('apple',target,local);s.world.step();}assert.ok(Math.abs(b.translation().x-1)<.05);s.release();
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
