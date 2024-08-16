const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../..');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function environment({url='https://top.example/watch',settings={},tabHost='top.example',html='<video id="video" style="opacity:1"></video><input id="typing">'}={}) {
  const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  const listeners=[];
  const sync={...settings},local={};
  const area=(data,name)=>({get(defaults,callback){const result={...defaults,...data};if(callback) Promise.resolve().then(()=>callback(result));return Promise.resolve(result);},
    async set(values){const changes={};for(const [key,newValue] of Object.entries(values)){changes[key]={oldValue:data[key],newValue};data[key]=newValue;}for(const listener of listeners)listener(changes,name);}});
  const intervals=new Map();let next=1;
  w.setInterval=(fn,ms)=>{const id=next++;intervals.set(id,{fn,ms});return id;};
  w.clearInterval=id=>intervals.delete(id);
  const mediaHandlers=new Map();
  Object.defineProperty(w.navigator,'mediaSession',{value:{setActionHandler:(name,fn)=>mediaHandlers.set(name,fn)}});
  w.chrome={runtime:{id:'test-extension',getManifest:()=>JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),
    sendMessage:async()=>({host:tabHost})},storage:{sync:area(sync,'sync'),local:area(local,'local'),onChanged:{addListener:fn=>listeners.push(fn)}},
    commands:{getAll:async()=>[{name:'toggle-pip',description:'Toggle PiP',shortcut:'Alt+P'}]},tabs:{create:async()=>{}}};
  let pip=null;
  Object.defineProperty(w.document,'pictureInPictureElement',{get:()=>pip});
  w.document.exitPictureInPicture=async()=>{const old=pip;pip=null;old?.dispatchEvent(new w.Event('leavepictureinpicture',{bubbles:true}));};
  for(const video of w.document.querySelectorAll('video')) {
    let paused=false;
    Object.defineProperties(video,{readyState:{value:4},videoWidth:{value:1280},videoHeight:{value:720},
      paused:{get:()=>paused},ended:{value:false}});
    video.getBoundingClientRect=()=>({width:640,height:360,left:0,top:0,bottom:360,right:640});
    video.play=async()=>{paused=false;video.dispatchEvent(new w.Event('play',{bubbles:true}));};
    video.pause=()=>{paused=true;video.dispatchEvent(new w.Event('pause',{bubbles:true}));};
    video.requestPictureInPicture=async()=>{pip=video;video.dispatchEvent(new w.Event('enterpictureinpicture',{bubbles:true}));};
  }
  const load=names=>{for(const name of names)w.eval(fs.readFileSync(path.join(root,name),'utf8'));};
  return {dom,w,sync,local,intervals,mediaHandlers,load,flush,close:()=>dom.window.close()};
}
async function content(options){const env=environment(options);env.load(['pip-core.js','page-state.js','player-layout.js','content.js']);await flush();return env;}
module.exports={environment,content,flush,root};
