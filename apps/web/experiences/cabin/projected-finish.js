import * as T from 'three';

/**
 * A photographic material bake projected onto the model's actual surfaces.
 * Geometry, occlusion, depth and camera parallax remain those of the 3D cabin.
 * Surfaces outside the reference camera smoothly retain their original PBR finish.
 */
export function applyProjectedFinish(scene,root,renderer,texture,options={}){
 const reference=new T.PerspectiveCamera(49,1440/1000,.06,150);
 reference.position.set(.18,1.68,2.6);reference.rotation.set(0,.03,0,'YXZ');reference.updateMatrixWorld();
 root.updateMatrixWorld(true);
 const projector=new T.Matrix4().multiplyMatrices(reference.projectionMatrix,reference.matrixWorldInverse),materials=new Set();
 const subject=root.matrixWorld.clone(),depthScene=options.local?new T.Scene():scene;
 if(options.local)depthScene.add(root.clone(true));
 const depthTarget=new T.WebGLRenderTarget(1024,711,{depthBuffer:true});depthTarget.depthTexture=new T.DepthTexture(1024,711,T.UnsignedIntType);
 const previousTarget=renderer.getRenderTarget(),previousOverride=depthScene.overrideMaterial,autoShadow=renderer.shadowMap.autoUpdate;
 const depthMaterial=new T.MeshDepthMaterial();depthScene.overrideMaterial=depthMaterial;renderer.shadowMap.autoUpdate=false;
 renderer.setRenderTarget(depthTarget);renderer.clear();renderer.render(depthScene,reference);renderer.setRenderTarget(previousTarget);
 depthScene.overrideMaterial=previousOverride;renderer.shadowMap.autoUpdate=autoShadow;depthMaterial.dispose();
 root.traverse(object=>{if(object.isMesh)for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);});
 for(const material of materials){
  if(!material.isMeshStandardMaterial)continue;
  if(options.clothOnly&&!(material.sheen>.5))continue;
  material.onBeforeCompile=shader=>{
   shader.uniforms.finishPhoto={value:texture};shader.uniforms.finishDepth={value:depthTarget.depthTexture};shader.uniforms.finishProjection={value:projector};shader.uniforms.finishSubject={value:subject};shader.uniforms.finishCamera={value:reference.position};shader.uniforms.finishStrength={value:options.local ? .87 : .94};shader.uniforms.finishCrop={value:options.local?new T.Vector4(525/1440,205/1000,390/1440,620/1000):new T.Vector4(0,0,1,1)};
   shader.vertexShader='uniform mat4 finishProjection;uniform mat4 finishSubject;uniform vec3 finishCamera;varying vec4 finishCoords;varying float finishFacing;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    vec4 finishWorld=${options.local?'finishSubject':'modelMatrix'}*vec4(transformed,1.0);
    finishCoords=finishProjection*finishWorld;
    finishFacing=dot(normalize(mat3(${options.local?'finishSubject':'modelMatrix'})*normal),normalize(finishCamera-finishWorld.xyz));
   `);
   shader.fragmentShader='uniform sampler2D finishPhoto;uniform sampler2D finishDepth;uniform float finishStrength;uniform vec4 finishCrop;varying vec4 finishCoords;varying float finishFacing;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
    vec2 finishDepthUv=finishCoords.xy/finishCoords.w*0.5+0.5;
    vec2 finishUv=(finishDepthUv-finishCrop.xy)/finishCrop.zw;
    vec2 finishEdge=min(finishUv,vec2(1.0)-finishUv);
    float finishMask=smoothstep(0.0,0.055,min(finishEdge.x,finishEdge.y))*smoothstep(0.03,0.22,finishFacing)*step(0.0,finishCoords.w)*finishStrength;
    float finishZ=finishCoords.z/finishCoords.w*0.5+0.5;
    float surfaceDepth=texture2D(finishDepth,clamp(finishDepthUv,0.0,1.0)).r;
    float tolerance=max(0.00006,fwidth(finishZ)*2.0);
    finishMask*=1.0-smoothstep(tolerance,tolerance*3.0,abs(finishZ-surfaceDepth));
    vec3 finishColor=texture2D(finishPhoto,clamp(finishUv,0.0,1.0)).rgb;
    ${options.local?'finishMask*=smoothstep(0.006,0.035,finishColor.r-finishColor.b+abs(finishColor.g-finishColor.b)*0.5);':''}
    outgoingLight=mix(outgoingLight,finishColor,finishMask);
    #include <opaque_fragment>
   `);
  };
  material.customProgramCacheKey=()=> options.local?'kararver-suit-finish-1':'kararver-projected-finish-1';material.needsUpdate=true;
 }
 return depthTarget;
}

