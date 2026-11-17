import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const fabricAlbedo=new T.TextureLoader().load('/experiences/cabin/textures/nomex-quilt.webp');fabricAlbedo.colorSpace=T.SRGBColorSpace;fabricAlbedo.anisotropy=8;fabricAlbedo.wrapS=fabricAlbedo.wrapT=T.RepeatWrapping;
export const rng=(seed=17)=>()=>{seed=Math.imul(seed,1664525)+1013904223|0;return (seed>>>0)/4294967296;};
export function canvasTexture(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;}
export function noiseTexture(size,kind='fabric'){
  const random=rng(221),c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');const img=ctx.createImageData(size,size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,n=(random()-.5),weave=((x%4<2?1:-1)*(y%4<2?1:-1));
    let v=kind==='fabric'?174+weave*13+n*18:kind==='alloy'?176+Math.sin(y*24.3)*9+n*5:140+n*28;
    img.data[i]=img.data[i+1]=img.data[i+2]=v;img.data[i+3]=255;
  }ctx.putImageData(img,0,0);
  const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(kind==='fabric'?8:3,kind==='fabric'?8:3);t.anisotropy=8;return t;
}
export function rounded(w,h,d,r=.02){return new RoundedBoxGeometry(w,h,d,1,Math.min(r,w/3,h/3,d/3));}
export function mesh(parent,g,m,p=[0,0,0],r){const o=new T.Mesh(g,m);o.position.fromArray(p);if(r)o.rotation.set(...r);o.castShadow=o.receiveShadow=true;parent.add(o);return o;}
export const box=(parent,m,size,p=[0,0,0],r=.015,rot)=>mesh(parent,r?rounded(...size,r):new T.BoxGeometry(...size),m,p,rot);
export function cylinder(parent,m,radius,depth,p=[0,0,0],rotation=[Math.PI/2,0,0],segments=20){return mesh(parent,new T.CylinderGeometry(radius,radius,depth,segments),m,p,rotation);}
export function tube(parent,m,points,radius=.012,segments=24){return mesh(parent,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),segments,radius,8,false),m);}
export function rr(shape,x,y,w,h,r){shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);return shape;}
export function ring(parent,m,w,h,r,thickness,depth,p){const s=rr(new T.Shape(),-w/2,-h/2,w,h,r),hole=rr(new T.Path(),-w/2+thickness,-h/2+thickness,w-2*thickness,h-2*thickness,Math.max(.01,r-thickness));s.holes.push(hole);return mesh(parent,new T.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSegments:2,bevelSize:.009,bevelThickness:.009,steps:1}),m,p);}
export function plaque(parent,text,w,h,p,light=true){const t=canvasTexture(512,128,(c,W,H)=>{c.fillStyle=light?'#d9d8cb':'#172326';c.fillRect(0,0,W,H);c.fillStyle=light?'#3e4644':'#c5d1c0';c.font='500 34px monospace';c.textBaseline='middle';c.fillText(text,22,H/2);});return mesh(parent,new T.PlaneGeometry(w,h),new T.MeshStandardMaterial({map:t,roughness:.9}),p);}
export function fasten(parent,m,x,y,z,r=.012){cylinder(parent,m,r,.007,[x,y,z]);box(parent,m,[r*.75,r*.17,.002],[x,y,z+.004],0);}
export function batch(root){
 root.updateMatrixWorld(true);const buckets=new Map(),old=[];
 root.traverse(o=>{if(!o.isMesh||Array.isArray(o.material)||o.userData.keep)return;const g=o.geometry.clone().applyMatrix4(o.matrixWorld);const n=g.index?g.toNonIndexed():g;if(g!==n)g.dispose();let a=buckets.get(o.material);if(!a)buckets.set(o.material,a=[]);a.push(n);old.push(o);});
 old.forEach(o=>{o.removeFromParent();o.geometry.dispose();});
 const inverse=root.matrixWorld.clone().invert();for(const [m,gs] of buckets){const merged=mergeGeometries(gs,false);if(merged){merged.applyMatrix4(inverse);mesh(root,merged,m);}gs.forEach(g=>g.dispose());}
}
export function palette(){
 const fabric=noiseTexture(512,'fabric'),alloy=noiseTexture(512,'alloy');
 const mat=(color,roughness=.5,metalness=0,extra={})=>new T.MeshStandardMaterial({color,roughness,metalness,...extra});
 return {
  ivory:mat('#d3d1c4',.88,0,{map:fabricAlbedo,bumpMap:fabric,bumpScale:.0015}),
  canvas:mat('#d8d6c9',.83,0,{map:fabricAlbedo,bumpMap:fabric,bumpScale:.001}),
  floor:mat('#4d5757',.59,.65,{bumpMap:alloy,bumpScale:.0008}),
  shell:mat('#a6aaa5',.57,.35,{bumpMap:alloy,bumpScale:.0005}),
  aluminium:mat('#a0abae',.3,.85,{bumpMap:alloy,bumpScale:.0004}),
  steel:mat('#77817e',.35,.88),dark:mat('#222b2d',.62,.3),
  black:mat('#101619',.78,.04),seam:mat('#777b70',.95,0),
  orange:mat('#b46c33',.5,.38),red:mat('#97352a',.53,.12),
  white:mat('#e0dfd5',.7,.01),screen:mat('#193337',.35,.25,{emissive:0x234b50,emissiveIntensity:.3}),
  bulb:mat('#f3ddab',.2,0,{emissive:0xffd9a0,emissiveIntensity:3}),
  led:mat('#c4dd9c',.35,0,{emissive:0x9ecb74,emissiveIntensity:1.5})
 };
}

function quiltGeometry(w,h,cols=14,rows=14){
 const g=new T.PlaneGeometry(w,h,cols,rows),p=g.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),u=T.MathUtils.clamp(x/w+.5,0,1),v=T.MathUtils.clamp(y/h+.5,0,1);const bulge=Math.pow(Math.max(0,Math.sin(Math.PI*u)*Math.sin(Math.PI*v)),.65)*.025;
 const a=(u+v)*Math.PI*4,b=(u-v)*Math.PI*4;const stitch=.005*Math.exp(-Math.pow(Math.sin(a)*10,2))+.005*Math.exp(-Math.pow(Math.sin(b)*10,2));
 p.setZ(i,bulge-stitch+.0012*Math.sin(x*127+y*38)*Math.sin(y*83));}
 g.computeVertexNormals();return g;
}
export function fabricPanel(parent,m,w,h,p,rot){
 const group=new T.Group();group.position.fromArray(p);if(rot)group.rotation.set(...rot);parent.add(group);
 box(group,m.seam,[w+.014,h+.014,.025],[0,0,-.027],.007);
 mesh(group,quiltGeometry(w,h),m.ivory);
 // Folded piping and hand sewn perimeter remain real three dimensional geometry.
 const points=[[-w/2+.015,-h/2+.015,0],[w/2-.015,-h/2+.015,0],[w/2-.015,h/2-.015,0],[-w/2+.015,h/2-.015,0],[-w/2+.015,-h/2+.015,0]];
 for(let i=0;i<4;i++)tube(group,m.canvas,[points[i],points[i+1]],.003,2);
}

export function displayTexture(index=0){return canvasTexture(768,512,(c,W,H)=>{
 c.fillStyle='#0e2025';c.fillRect(0,0,W,H);c.fillStyle='#96aea7';c.font='17px monospace';c.fillText(index?'ECLSS  /  SYSTEM STATUS':'ORBITAL MECHANICS  /  NAV',26,35);c.fillStyle='#537173';c.fillRect(25,53,718,1);
 c.strokeStyle='#28484d';c.lineWidth=1;for(let x=25;x<750;x+=46){c.beginPath();c.moveTo(x,75);c.lineTo(x,380);c.stroke();}for(let y=75;y<380;y+=38){c.beginPath();c.moveTo(25,y);c.lineTo(742,y);c.stroke();}
 c.strokeStyle='#9cb29e';c.lineWidth=2;c.beginPath();for(let x=25;x<742;x++){let y=233+Math.sin(x*.012+index)*63+Math.sin(x*.025)*19;x===25?c.moveTo(x,y):c.lineTo(x,y);}c.stroke();
 c.font='12px monospace';c.fillStyle='#82a399';for(let n=0;n<6;n++){const x=26+n*120;c.fillText(['O2','CO2','CABIN','POWER','THERM','LINK'][n],x,420);c.font='19px monospace';c.fillText(['21.1','0.04','101.3','98.2','22.4','OK'][n],x,450);c.font='12px monospace';}c.fillStyle='#c5ce9f';c.fillRect(705,25,12,7);
 });}

function rack(parent,m,position,rotation=0,index=0){
 const g=new T.Group();g.position.fromArray(position);g.rotation.y=rotation;parent.add(g);
 box(g,m.dark,[1.22,2.45,.32],[0,1.25,0],.025);
 for(const x of [-.57,.57]){box(g,m.aluminium,[.025,2.4,.055],[x,1.26,.19],.004);for(let y=.14;y<2.4;y+=.12)fasten(g,m.black,x,y,.222,.005);}
 for(let row=0;row<4;row++){
  const y=.39+row*.57;box(g,m.shell,[1.08,.53,.08],[0,y,.21],.018);
  box(g,m.black,[.84,.31,.018],[-.03,y+.01,.262],.01);
  if(row===2){const map=displayTexture(index);mesh(g,new T.PlaneGeometry(.79,.29),new T.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.38,roughness:.28}),[-.03,y+.01,.274]);}
  else{
   for(let k=0;k<9;k++)box(g,m.black,[.012,.21,.01],[-.36+k*.073,y+.02,.275],.001);
   for(let k=0;k<4;k++)cylinder(g,m.aluminium,.018,.025,[-.29+k*.19,y-.18,.28]);
  }
  for(const x of [-.46,.46]){tube(g,m.aluminium,[[x,y-.14,.27],[x,y-.1,.34],[x,y+.1,.34],[x,y+.14,.27]],.012,10);}
  box(g,row%2?m.led:m.red,[.02,.015,.01],[.39,y+.18,.266],.002);
  for(const x of [-.47,.47])for(const yy of [-.22,.22])fasten(g,m.steel,x,y+yy,.26,.009);
  plaque(g,['PWR / 02','ATM / CTRL','GUIDANCE','COMM / SYS'][row],.42,.047,[0,y+.207,.263]);
 }
}

function stowage(parent,m,p,w=.8,h=.65){
 const g=new T.Group();g.position.fromArray(p);parent.add(g);
 box(g,m.canvas,[w,h,.26],[0,0,0],.08);
 for(const x of [-w*.32,w*.32])box(g,m.seam,[.028,h+.014,.272],[x,0,0],.007);
 for(const y of [-h*.32,h*.32])box(g,m.canvas,[w+.006,.025,.272],[0,y,0],.006);
 plaque(g,'STOWAGE / '+(Math.round(Math.abs(p[0])*10)+12),w*.5,.08,[0,.04,.138]);
 tube(g,m.seam,[[-.09,-h*.35,.142],[-.09,-h*.35-.05,.18],[.09,-h*.35-.05,.18],[.09,-h*.35,.142]],.009,12);
}

export function buildRoom(){
 const root=new T.Group(),m=palette();
 // Human-scaled pressure shell, not an endless decorative corridor.
 box(root,m.dark,[5.6,.2,9],[0,-.14,-1.6],.015);
 for(let row=0;row<12;row++)for(let col=0;col<6;col++){
  const x=-2.25+col*.9,z=2.18-row*.67;
  box(root,m.floor,[.883,.024,.65],[x,-.027,z],.009);
  // Embossed nonslip ribbons and recessed deck fasteners.
  for(let j=0;j<7;j++)box(root,m.steel,[.67,.004,.011],[x,-.012,z-.24+j*.075],0);
  for(const sx of [-.38,.38])for(const sz of [-.26,.26])cylinder(root,m.dark,.012,.004,[x+sx,-.012,z+sz],[0,0,0],8);
 }
 for(const x of [-1.95,1.95]){box(root,m.dark,[.05,.028,8.4],[x,-.005,-1.5],.005);for(let z=-5.4;z<2.4;z+=.14)box(root,m.aluminium,[.032,.006,.07],[x,.012,z],.002);}
 // Walls rise into canted shoulders and an insulated ceiling.
 for(const side of [-1,1]){
  box(root,m.shell,[.1,2.7,8.5],[side*2.8,1.36,-1.65],.018);
  box(root,m.dark,[.08,.92,8.5],[side*2.59,2.99,-1.65],.012,[0,0,side*.65]);
  for(let j=0;j<7;j++){
   const z=2-j*1.13;
   fabricPanel(root,m,1.07,.61,[side*2.735,2.37,z],[0,-side*Math.PI/2,0]);
   fabricPanel(root,m,1.07,.68,[side*2.49,2.97,z],[0,-side*Math.PI/2,-side*.65]);
   box(root,m.aluminium,[.04,2.5,.048],[side*2.67,1.3,z+.56],.008);
  }
  // Thick covered harnesses run along the structural channels.
  for(let k=0;k<3;k++)tube(root,k===1?m.orange:m.black,[[side*(2.58-k*.04),2.65,2.45],[side*(2.58-k*.04),2.65,-5.55]],.019,12);
  for(let z=-5.2;z<2.4;z+=.75)box(root,m.steel,[.18,.025,.03],[side*2.54,2.62,z],.004);
  // Arm's-length handrails; the bends and supports catch the window light.
  for(let z=-4.6;z<1.5;z+=1.35){
   const gr=new T.Group();gr.position.set(side*2.62,1.91,z);gr.rotation.y=-side*Math.PI/2;root.add(gr);
   tube(gr,m.orange,[[-.43,0,0],[-.38,0,.13],[.38,0,.13],[.43,0,0]],.023,20);
   for(const x of [-.43,.43])box(gr,m.aluminium,[.1,.07,.025],[x,0,0],.006);
  }
 }
 for(let j=0;j<7;j++)for(let x=-1.7;x<2;x+=1.13)fabricPanel(root,m,1.07,1.07,[x,3.34,2-j*1.13],[Math.PI/2,0,0]);
 for(let z=-5;z<2.4;z+=1.13){box(root,m.aluminium,[4.4,.04,.035],[0,3.29,z+.56],.006);}
 for(const side of [-1,1]){
  box(root,m.dark,[.26,.065,8.2],[side*1.86,3.255,-1.65],.018);
  for(let z=-5;z<2.1;z+=1.05){box(root,m.shell,[.21,.015,.94],[side*1.86,3.216,z],.01);box(root,m.bulb,[.135,.012,.86],[side*1.86,3.205,z],.01);}
 }
 // Aft pressure bulkhead with a genuinely open observation port.
 const rear=new T.Shape();rear.moveTo(-2.8,0);rear.lineTo(2.8,0);rear.lineTo(2.8,3.4);rear.lineTo(-2.8,3.4);rear.closePath();
 const hole=new T.Path();hole.absellipse(1.45,2.07,.77,.77,0,Math.PI*2,true);rear.holes.push(hole);
 mesh(root,new T.ExtrudeGeometry(rear,{depth:.14,bevelEnabled:false}),m.ivory,[0,0,-5.85]);
 for(const [radius,thick,z,mat]of [[.82,.07,-5.63,m.aluminium],[.727,.017,-5.59,m.black],[.705,.009,-5.57,m.steel]]){
  mesh(root,new T.TorusGeometry(radius,thick,12,72),mat,[1.45,2.07,z]);
 }
 for(let i=0;i<24;i++){const a=i/24*Math.PI*2;fasten(root,m.steel,1.45+Math.cos(a)*.825,2.07+Math.sin(a)*.825,-5.545,.015);}
 // Hatch is layered metal, gasket, padded centre and a locking dog mechanism.
 ring(root,m.aluminium,1.52,2.49,.32,.09,.1,[-.72,1.42,-5.62]);
 ring(root,m.black,1.36,2.33,.27,.035,.018,[-.72,1.42,-5.49]);
 box(root,m.shell,[1.27,2.22,.06],[-.72,1.42,-5.48],.12);
 fabricPanel(root,m,.95,1.47,[-.72,1.51,-5.43]);
 for(const side of [-1,1])for(const y of [.57,2.27]){
  box(root,m.steel,[.17,.12,.1],[-.72+side*.58,y,-5.37],.015);
  cylinder(root,m.orange,.023,.17,[-.72+side*.58,y,-5.28],[0,0,Math.PI/2]);
 }
 cylinder(root,m.aluminium,.13,.065,[-.72,1.47,-5.31]);
 cylinder(root,m.dark,.069,.08,[-.72,1.47,-5.26]);
 for(let i=0;i<3;i++){const a=i*Math.PI*2/3;tube(root,m.aluminium,[[-.72+Math.cos(a)*.07,1.47+Math.sin(a)*.07,-5.19],[-.72+Math.cos(a)*.25,1.47+Math.sin(a)*.25,-5.19]],.018,8);}
 plaque(root,'PRESSURE HATCH / 02',.88,.10,[-.72,2.88,-5.60]);
 plaque(root,'OBSERVATION',.67,.08,[1.45,3.02,-5.64]);
 box(root,m.red,[.035,.035,.025],[-1.73,2.86,-5.62],.006);
 // Densely detailed rack fronts create plausible, asymmetrical inhabited space.
 rack(root,m,[-2.57,.04,-3.32],Math.PI/2,0);
 rack(root,m,[-2.57,.04,-1.92],Math.PI/2,1);
 rack(root,m,[2.57,.04,-3.72],-Math.PI/2,1);
 for(const z of [-.4,1.0]){
  const g=new T.Group();g.position.set(-2.57,1.05,z);g.rotation.y=Math.PI/2;root.add(g);stowage(g,m,[0,0,0],1.05,1.27);
 }
 for(const z of [-1.3,.15,1.6]){
  const g=new T.Group();g.position.set(2.57,.77,z);g.rotation.y=-Math.PI/2;root.add(g);stowage(g,m,[0,0,0],1.05,1.2);
  box(g,m.dark,[1.07,.1,.33],[0,-.72,0],.02);
 }
 // Foldaway work surface and constrained service leads on the right.
 box(root,m.shell,[.66,.035,1.16],[2.26,1.48,-1.37],.02);
 tube(root,m.steel,[[2.65,.92,-1.85],[2.12,1.44,-1.85]],.015,8);
 for(let i=0;i<4;i++)tube(root,i%2?m.orange:m.black,[[2.67,2.06,-2.45],[2.50,1.9,-2.33],[2.53,1.78,-1.95],[2.66,1.6,-1.86]],.009+i*.001,20);
 plaque(root,'K V / 0 1',.38,.07,[-1.9,3.10,-5.60]);
 batch(root);return {root,m};
}
