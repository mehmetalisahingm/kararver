function showFailure(error){
 console.error('Cabin initialization failed',error);
 const status=document.querySelector('#loading')||document.createElement('div');status.id='loading';status.setAttribute('role','alert');
 status.replaceChildren();const message=document.createElement('p');message.textContent='Bu cihazda 3D kabin açılamadı.';
 const again=document.createElement('button');again.textContent='Yeniden dene';again.onclick=()=>location.reload();
 const home=document.createElement('a');home.href='/';home.textContent='KararVer’e dön ↗';status.append(message,again,home);document.body.append(status);
}
window.addEventListener('cabin-render-failure',()=>showFailure(new Error('WebGL context lost')));
import('./main.js').catch(showFailure);
