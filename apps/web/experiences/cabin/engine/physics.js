import RAPIER from "@dimforge/rapier3d-compat";
                                         

export const objects = [
  { id: "astronaut", label: "Astronot", position: [.1,1.78,-1.65], rotation: [.12,-.23,-.18], mass: 85, bounce: .12 },
  { id: "apple", label: "Elma", position: [-.77,2.48,-.9], rotation: [.2,.3,-.3], mass: .22, bounce: .48 },
  { id: "laptop", label: "Laptop", position: [1.03,1.47,-1.35], rotation: [.15,-.38,.12], mass: 1.6, bounce: .13 },
  { id: "glass", label: "Su bardağı", position: [-1.25,1.28,-1.35], rotation: [.2,.1,-.55], mass: .28, bounce: .25 },
  { id: "cup", label: "Süt fincanı", position: [1.22,2.5,-2.0], rotation: [.1,.1,.5], mass: .3, bounce: .21 },
  { id: "notebook", label: "Defter", position: [-.85,.85,-1.8], rotation: [.4,.4,-.3], mass: .4, bounce: .12 },
]         ;
                                                   
                                                 
let initialization                           ;
export const initPhysics = () => initialization ??= RAPIER.init();

export function createPhysics() {
  const world = new RAPIER.World({ x:0,y:0,z:0 }); world.timestep = 1/90;
  world.integrationParameters.numSolverIterations = 8;
  const bounds                                                = [
    [2,.15,8,0,-.15,-5],[.15,2,8,-1.85,1.8,-5],[.15,2,8,1.85,1.8,-5],
    [2,.15,8,0,3.7,-5],[2,2,.15,0,1.8,-12.85],[2,2,.15,0,1.8,1.8],
  ];
  for(const [x,y,z,px,py,pz] of bounds)world.createCollider(RAPIER.ColliderDesc.cuboid(x,y,z).setTranslation(px,py,pz).setFriction(.62).setRestitution(.12));
  const bodies = new Map                          ();
  for(const item of objects){
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(item.position[0],item.position[1],item.position[2]).setCcdEnabled(true).setLinearDamping(.3).setAngularDamping(.9));
    const shape=item.id==="apple"?RAPIER.ColliderDesc.ball(.145):item.id==="astronaut"?RAPIER.ColliderDesc.capsule(.64,.31):item.id==="laptop"?RAPIER.ColliderDesc.cuboid(.39,.24,.26):item.id==="notebook"?RAPIER.ColliderDesc.cuboid(.155,.028,.215):RAPIER.ColliderDesc.cylinder(.15,.125);
    shape.setMass(item.mass).setFriction(item.id==="apple"?.48:.7).setRestitution(item.bounce).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    world.createCollider(shape,body); bodies.set(item.id,body);
    if(item.id==="astronaut"){
      world.createCollider(RAPIER.ColliderDesc.ball(.235).setTranslation(0,.82,0).setMass(.01).setRestitution(.1),body);
      for(const side of [-1,1])world.createCollider(RAPIER.ColliderDesc.capsule(.25,.12).setTranslation(side*.37,.13,0).setMass(.01).setRestitution(.1),body);
    }
  }
  let gravity=false,held=null;
  const cap=(v,max)=>{const length=Math.hypot(v.x,v.y,v.z);return length>max?{x:v.x*max/length,y:v.y*max/length,z:v.z*max/length}:null;};
  const limitMotion=()=>{for(const [id,body] of bodies){
    const v=cap(body.linvel(),held === id ? .45 : gravity ? 8 : .12);
    const w=cap(body.angvel(),gravity ? .7 : id === 'astronaut' ? .035 : .06);
    if(v)body.setLinvel(v,true);if(w)body.setAngvel(w,true);
  }};
  const reset=()=>{
    gravity=false;held=null;world.gravity.y=0;
    for(const [index,item] of objects.entries()){
      const body=bodies.get(item.id) ;
      const [x,y,z]=item.rotation;
      const cx=Math.cos(x/2),sx=Math.sin(x/2),cy=Math.cos(y/2),sy=Math.sin(y/2),cz=Math.cos(z/2),sz=Math.sin(z/2);
      body.setTranslation({x:item.position[0],y:item.position[1],z:item.position[2]},true);
      body.setRotation({x:sx*cy*cz+cx*sy*sz,y:cx*sy*cz-sx*cy*sz,z:cx*cy*sz+sx*sy*cz,w:cx*cy*cz-sx*sy*sz},true);
      body.setLinvel({x:Math.sin(index*2.2)*.002,y:Math.cos(index)*.003,z:.0005},true);
      body.setAngvel({x:.001*Math.sin(index),y:.002*Math.cos(index),z:.001},true);
      body.resetForces(true); body.resetTorques(true);
    }
  };
  reset();
  return {
    world,bodies,reset,
    step(){limitMotion();world.step();limitMotion();},
    get gravity(){return gravity;},
    setGravity(value        ){gravity=value;world.gravity.y=value?-9.81:0; bodies.forEach(body=>body.wakeUp());},
    /** A soft translation spring with inertia-bounded torque avoids off-centre spin explosions. */
    drag(id        ,target       ,local       ){
      held=id;const body=bodies.get(id) ;const q=body.rotation();
      // Rotate the local anchor without involving the renderer's coordinate system.
      const ix=q.w*local.x+q.y*local.z-q.z*local.y,iy=q.w*local.y+q.z*local.x-q.x*local.z,iz=q.w*local.z+q.x*local.y-q.y*local.x,iw=-q.x*local.x-q.y*local.y-q.z*local.z;
      const t=body.translation(),p={x:t.x+ix*q.w+iw*-q.x+iy*-q.z-iz*-q.y,y:t.y+iy*q.w+iw*-q.y+iz*-q.x-ix*-q.z,z:t.z+iz*q.w+iw*-q.z+ix*-q.y-iy*-q.x};
      const v=body.linvel(),mass=body.mass();
      const force={x:((target.x-p.x)*12-v.x*7)*mass,y:((target.y-p.y)*12-v.y*7+(gravity?9.81:0))*mass,z:((target.z-p.z)*12-v.z*7)*mass};
      const length=Math.hypot(force.x,force.y,force.z),limit=mass*(gravity?12:2.2),scale=length>limit?limit/length:1;
      const f={x:force.x*scale,y:force.y*scale,z:force.z*scale},r={x:p.x-t.x,y:p.y-t.y,z:p.z-t.z};
      const torque={x:r.y*f.z-r.z*f.y,y:r.z*f.x-r.x*f.z,z:r.x*f.y-r.y*f.x};
      const inertia=body.principalInertia(),torqueLimit=Math.min(inertia.x,inertia.y,inertia.z)*.02;
      const restrained=cap(torque,torqueLimit)||torque;
      body.resetForces(true);body.resetTorques(true);body.addForce(f,true);body.addTorque(restrained,true);
    },
    fluidContact(p       ,radius       ){
      const projection=world.projectPoint(p,false,RAPIER.QueryFilterFlags.EXCLUDE_FIXED);
      if(!projection)return;
      const q=projection.point,dx=p.x-q.x,dy=p.y-q.y,dz=p.z-q.z,d=Math.hypot(dx,dy,dz);
      if(!projection.isInside&&d>=radius)return;
      const sign=projection.isInside?-1:1,normal=sign*radius/Math.max(d,.00001);
      p.x=q.x+dx*normal;p.y=q.y+dy*normal;p.z=q.z+dz*normal;
    },
    release(){
      if(held&&!gravity){const body=bodies.get(held),v=cap(body.linvel(),.08),w=cap(body.angvel(),.015);if(v)body.setLinvel(v,true);if(w)body.setAngvel(w,true);}
      held=null;bodies.forEach(body=>{body.resetForces(true);body.resetTorques(true);});
    },
    dispose(){world.free();},
  };
}