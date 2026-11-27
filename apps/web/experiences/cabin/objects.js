import * as T from 'three';
import {mesh,box,cylinder,tube,plaque,batch,palette,canvasTexture,noiseTexture,rng,displayTexture} from './craft.js';

export function apple(){
 const root=new T.Group();
 const bump=noiseTexture(512,'skin');bump.repeat.set(1,1);
 const skinMap=new T.TextureLoader().load('/experiences/cabin/textures/apple-skin.webp');skinMap.colorSpace=T.SRGBColorSpace;skinMap.anisotropy=8;
 const skin=new T.MeshPhysicalMaterial({map:skinMap,bumpMap:bump,bumpScale:.00028,roughness:.40,clearcoat:.24,clearcoatRoughness:.32,ior:1.42});
 const positions=[],uv=[],idx=[],U=128,V=96;
 for(let y=0;y<=V;y++)for(let x=0;x<=U;x++){
  const t=y/V*Math.PI,a=x/U*Math.PI*2;const pole=Math.pow(Math.abs(Math.cos(t)),5);
  let r=.136*Math.sin(t)*(1.07+.09*Math.cos(t)-.055*Math.cos(t*2))*(1+.038*Math.cos(5*a+.3)*pole);
  let py=.137*Math.cos(t)-.024*Math.exp(-Math.pow(t/.31,2))+.010*Math.exp(-Math.pow((Math.PI-t)/.30,2));
  py+=.003*Math.cos(a*5)*Math.pow(Math.sin(t),2)*Math.cos(t);
  positions.push(Math.cos(a)*r,py,Math.sin(a)*r);uv.push(x/U,1-y/V);
  if(x<U&&y<V){const i=y*(U+1)+x;idx.push(i,i+U+1,i+1,i+1,i+U+1,i+U+2);}
 }
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();mesh(root,geo,skin);
 const bark=new T.MeshStandardMaterial({color:'#62452c',bumpMap:bump,bumpScale:.001,roughness:.95});tube(root,bark,[[0,.107,0],[.004,.14,0],[.012,.173,.004],[.015,.182,.009]],.0075,18);
 for(let n=0;n<5;n++){const a=n/5*Math.PI*2;tube(root,bark,[[0,-.126,0],[Math.cos(a)*.014,-.124,Math.sin(a)*.014]],.0015,5);}
 const leafTex=canvasTexture(512,256,(c,W,H)=>{c.fillStyle='#4f6027';c.fillRect(0,0,W,H);c.strokeStyle='#89924a';c.lineWidth=2;c.beginPath();c.moveTo(0,H/2);c.lineTo(W,H/2);c.stroke();c.lineWidth=1;for(let n=1;n<14;n++){c.beginPath();c.moveTo(n*35,H/2);c.lineTo(n*35-55,n%2?0:H);c.stroke();}});
 const leafG=new T.PlaneGeometry(.085,.032,32,12),lp=leafG.attributes.position;
 for(let i=0;i<lp.count;i++){const x=lp.getX(i),y=lp.getY(i),s=Math.sin((x/.085+.5)*Math.PI);lp.setXYZ(i,x,y*s,.008*Math.sin(x*35)+Math.abs(y)*.18);}leafG.computeVertexNormals();
 mesh(root,leafG,new T.MeshStandardMaterial({map:leafTex,roughness:.66,side:T.DoubleSide}),[.052,.17,.006],[-.65,.2,.1]);
 root.name='Hand-modelled apple';return root;
}

/** Cross-section modelling gives cloth a silhouette and folds instead of stacking capsules. */
function clothForm(parent,mat,points,radii,depths,fold=.006){
 const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),steps=56,radial=40,frames=curve.computeFrenetFrames(steps,false),pos=[],uv=[],idx=[];
 const value=(arr,t)=>{const p=t*(arr.length-1),i=Math.min(arr.length-2,Math.floor(p));return T.MathUtils.lerp(arr[i],arr[i+1],p-i);};
 for(let j=0;j<=steps;j++){
  const t=j/steps,c=curve.getPoint(t),radius=value(radii,t),depth=value(depths,t);
  for(let i=0;i<=radial;i++){
   const a=i/radial*Math.PI*2;const f=fold*(Math.sin(t*47+a*2)+.45*Math.sin(t*83-a*3))*(.3+.7*Math.sin(t*Math.PI));
   const p=c.clone().addScaledVector(frames.normals[j],Math.cos(a)*(radius+f)).addScaledVector(frames.binormals[j],Math.sin(a)*(depth+f*.6));pos.push(p.x,p.y,p.z);uv.push(i/radial,t*2);
   if(j<steps&&i<radial){const k=j*(radial+1)+i;idx.push(k,k+1,k+radial+1,k+1,k+radial+2,k+radial+1);}
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return mesh(parent,g,mat);
}
function ellipsoid(parent,mat,size,p,rot){const o=mesh(parent,new T.SphereGeometry(1,48,32),mat,p,rot);o.scale.set(...size);return o;}
function joint(parent,mat,p,axis,r,len,rings=7){
 const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(...axis).normalize());const g=new T.Group();g.position.fromArray(p);g.quaternion.copy(q);parent.add(g);
 cylinder(g,mat,r*.92,len,[0,0,0],[0,0,0],32);
 for(let i=0;i<rings;i++){const a=mesh(g,new T.TorusGeometry(r,.004,8,40),mat,[0,-len/2+i/(rings-1)*len,0],[Math.PI/2,0,0]);a.scale.y=.94;}
 return g;
}
export function astronaut(){
 const root=new T.Group(),m=palette();
 const clothMap=new T.TextureLoader().load('/experiences/cabin/textures/pressure-suit-fabric.webp');clothMap.colorSpace=T.SRGBColorSpace;clothMap.wrapS=clothMap.wrapT=T.RepeatWrapping;clothMap.repeat.set(1,1);clothMap.anisotropy=8;
 const cloth=new T.MeshPhysicalMaterial({color:'#d8d9d0',map:clothMap,roughness:.86,sheen:.6,sheenColor:new T.Color('#ddd8c4'),sheenRoughness:.8,bumpMap:noiseTexture(512,'fabric'),bumpScale:.0015});
 const darkCloth=new T.MeshStandardMaterial({color:'#7d8178',roughness:.9,bumpMap:noiseTexture(256,'fabric'),bumpScale:.0015});
 const seam=new T.MeshStandardMaterial({color:'#a9a996',roughness:.95});
 const shell=new T.MeshPhysicalMaterial({color:'#dadbd2',roughness:.38,clearcoat:.22,clearcoatRoughness:.28});
 // Pressure garment torso has a narrow waist, broad upper chest and independent shoulder forms.
 clothForm(root,cloth,[[0,-.2,0],[0,.03,0],[0,.28,0],[0,.49,0]],[.18,.21,.25,.21],[.18,.18,.17,.14],.0035);
 ellipsoid(root,cloth,[.22,.23,.17],[0,-.18,.0]);
 box(root,m.ivory,[.42,.65,.21],[0,.15,-.225],.075);
 box(root,shell,[.38,.48,.065],[0,.20,-.35],.04);
 for(const x of [-.17,.17])tube(root,seam,[[x,-.13,-.34],[x,.47,-.34]],.008,12);
 plaque(root,'LIFE SUPPORT / 01',.27,.045,[0,.38,-.391]);
 // Machined neck pressure ring and helmet shell; no borrowed person's face.
 cylinder(root,m.aluminium,.207,.065,[0,.51,0],[0,0,0],64);
 cylinder(root,m.black,.19,.022,[0,.548,0],[0,0,0],64);
 ellipsoid(root,shell,[.238,.26,.23],[0,.77,0]);

 // Front-facing ellipsoid patch, surrounded by an actual pressure gasket.
 const gold=new T.MeshPhysicalMaterial({color:'#b79559',metalness:1,roughness:.115,clearcoat:1,clearcoatRoughness:.06});
 const visor=mesh(root,new T.SphereGeometry(1,64,48,Math.PI*.08,Math.PI*.84,Math.PI*.20,Math.PI*.62),gold,[0,.78,.019],[0,0,0]);
 visor.scale.set(.226,.218,.239);
 // Oval rim follows the side boundary without a cartoon oversized head.
 const sealPoints=[];for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;sealPoints.push([Math.cos(a)*.207,.775+Math.sin(a)*.19,.135+Math.sqrt(Math.max(0,1-Math.pow(Math.cos(a)*.88,2)-Math.pow(Math.sin(a)*.83,2)))*.13]);}
 tube(root,m.black,sealPoints,.009,80);
 for(const side of [-1,1]){
  ellipsoid(root,m.aluminium,[.029,.05,.05],[side*.235,.735,.005]);
  box(root,shell,[.075,.035,.09],[side*.16,.962,.10],.012);
  box(root,m.black,[.052,.025,.018],[side*.16,.96,.151],.008);
 }
 box(root,shell,[.16,.036,.11],[0,.985,.02],.012);
 // Chest controls, ribbed hoses, anodized gas connectors and stitched utility pockets.
 box(root,shell,[.30,.22,.075],[0,.285,.181],.025);
 box(root,m.aluminium,[.245,.11,.018],[0,.306,.226],.008);
 plaque(root,'KARARVER / 01',.21,.034,[0,.326,.238]);
 for(let i=0;i<4;i++){cylinder(root,i===0?m.orange:m.black,.012,.013,[-.086+i*.056,.267,.243]);}
 for(const side of [-1,1]){
  cylinder(root,m.aluminium,.043,.033,[side*.135,.008,.175]);
  cylinder(root,side<0?m.red:m.orange,.033,.041,[side*.135,.008,.199]);
  tube(root,m.ivory,[[side*.135,.008,.225],[side*.22,-.05,.27],[side*.30,-.15,.18],[side*.24,-.26,.03],[side*.20,-.14,-.16]],.025,32);
  for(let i=0;i<13;i++){const t=i/12;const a=-t*Math.PI;mesh(root,new T.TorusGeometry(.027,.003,6,16),seam,[side*(.23+Math.sin(t*Math.PI)*.06),-.04-t*.2,.2+Math.sin(a)*.05],[t*.8,0,0]);}
  box(root,cloth,[.14,.19,.04],[side*.135,-.22,.16],.02);
  tube(root,seam,[[side*.135-.06,-.26,.183],[side*.135+.06,-.26,.183],[side*.135+.06,-.13,.183]],.0025,8);
 }
 // A natural zero-g posture: relaxed bent elbows, asymmetrical knees and individual fingers.
 for(const side of [-1,1]){
  const s=side;
  const shoulder=[s*.255,.40,-.005],elbow=[s*.43,.19,.035],wrist=[s*.48,.01,.22];
  ellipsoid(root,cloth,[.132,.145,.135],shoulder,[0,0,s*.6]);
  clothForm(root,cloth,[shoulder,[s*.35,.32,0],elbow],[.108,.112,.083],[.105,.102,.08],.0048);
  joint(root,darkCloth,elbow,[s*.2,-.8,.3],.082,.085,6);
  clothForm(root,cloth,[elbow,[s*.47,.10,.13],wrist],[.086,.085,.067],[.085,.084,.061],.005);
  joint(root,m.aluminium,wrist,[s*.1,-.7,.7],.069,.03,3);
  const palm=new T.Group();palm.position.set(s*.49,-.045,.265);palm.rotation.set(.45,s*.1,-s*.18);root.add(palm);
  ellipsoid(palm,cloth,[.054,.077,.034],[0,0,0]);
  for(let finger=0;finger<4;finger++){
   const x=s*(-.04+finger*.024),len=[.063,.081,.077,.059][finger];
   clothForm(palm,cloth,[[x,-.044,.002],[x,-.07,.016],[x,-.044-len,.045]],[.012,.014,.008],[.013,.013,.009],.001);
   joint(palm,seam,[x,-.07,.015],[0,1,0],.012,.008,2);
  }
  clothForm(palm,cloth,[[s*.04,.005,.008],[s*.075,-.021,.034],[s*.07,-.053,.045]],[.021,.020,.013],[.02,.018,.013],.001);
  // Flexible knee and layered protective boot, with a defined heel and outsole.
  const hip=[s*.13,-.22,-.01],knee=[s*.20,-.56,.12+(s<0?.08:0)],ankle=[s*.23,-.83,.025+(s<0?.16:0)];
  clothForm(root,cloth,[hip,[s*.18,-.40,.045],knee],[.13,.126,.10],[.13,.119,.10],.005);
  joint(root,darkCloth,knee,[s*.1,-1,0],.101,.065,6);
  clothForm(root,cloth,[knee,[s*.22,-.70,.08+(s<0?.12:0)],ankle],[.103,.111,.09],[.10,.101,.086],.006);
  const boot=new T.Group();boot.position.fromArray(ankle);boot.rotation.x=s<0?-.2:.08;root.add(boot);
  ellipsoid(boot,cloth,[.10,.14,.11],[0,-.035,.01]);
  box(boot,cloth,[.20,.14,.31],[0,-.115,.065],.055);
  box(boot,darkCloth,[.21,.038,.325],[0,-.185,.06],.025);
  box(boot,m.black,[.20,.023,.32],[0,-.21,.065],.013);
  for(let n=0;n<7;n++)box(boot,m.black,[.195,.012,.019],[0,-.224,-.055+n*.044],.004);
  for(const y of [-.10,-.045])box(boot,seam,[.19,.014,.215],[0,y,.04],.006);
  // Small piping seam on sleeves, shoulder mission patch and locking tabs.
  tube(root,seam,[[s*.27,.49,.085],[s*.36,.33,.10],[s*.44,.20,.12]],.0027,18);
  const band=joint(root,m.red,[s*.29,.43,0],[s*.5,-.8,0],.125,.015,2);
  box(root,cloth,[.115,.08,.015],[s*.28,.41,.118],.01);
 }
 root.name='Original pressure-suit astronaut';batch(root);return root;
}

export function laptop(){
 const root=new T.Group(),m=palette();box(root,m.aluminium,[.66,.025,.44],[0,-.11,0],.012);
 box(root,m.black,[.59,.004,.23],[0,-.094,-.045],.008);
 for(let row=0;row<5;row++)for(let col=0;col<13;col++){
  box(root,m.dark,[.035,.006,.032],[-.263+col*.044,-.09,-.135+row*.043],.003);
 }
 box(root,m.shell,[.21,.002,.09],[0,-.095,.144],.008);
 const screen=new T.Group();screen.position.set(0,-.1,-.2);screen.rotation.x=-.23;root.add(screen);
 box(screen,m.aluminium,[.66,.415,.014],[0,.204,0],.01);box(screen,m.black,[.64,.397,.006],[0,.204,.008],.008);
 const map=displayTexture();mesh(screen,new T.PlaneGeometry(.609,.357),new T.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.45,roughness:.25}),[0,.207,.013]);
 cylinder(root,m.aluminium,.013,.55,[0,-.098,-.205],[0,0,Math.PI/2]);
 for(const x of [-.329,.329])for(let i=0;i<3;i++)box(root,m.black,[.004,.006,.028],[x,-.11,-.10+i*.045],.002);
 batch(root);return root;
}
export function cup(glass=false){
 const root=new T.Group();const mat=new T.MeshPhysicalMaterial(glass?{color:'#f6ffff',roughness:.035,transmission:1,thickness:.008,ior:1.46,clearcoat:1}:{color:'#dad9ca',roughness:.24,clearcoat:.9,clearcoatRoughness:.13});
 const p=[[0,0],[.071,0],[.082,.015],[.092,.19],[.090,.2],[.083,.202],[.076,.022],[0,.022]].map(p=>new T.Vector2(...p));mesh(root,new T.LatheGeometry(p,64),mat,[0,-.10,0]);
 if(!glass){const handle=mesh(root,new T.TorusGeometry(.058,.011,12,36,Math.PI*1.48),mat,[.093,.008,0],[0,0,-Math.PI*.24]);handle.scale.x=.8;}
 return root;
}
export function notebook(){const r=new T.Group(),m=palette();box(r,m.orange,[.21,.023,.28],[0,0,0],.008);box(r,m.ivory,[.20,.015,.269],[.002,.012,0],.004);box(r,m.dark,[.014,.004,.281],[.055,.022,0],.003);return r;}

