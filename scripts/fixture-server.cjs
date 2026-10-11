const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../tests/fixtures');
const types={'.html':'text/html','.webm':'video/webm'};
http.createServer((request,response)=>{
  const filename=path.basename(new URL(request.url,'http://localhost').pathname)||'player.html';
  const file=path.join(root,filename);
  if(!fs.existsSync(file)){response.writeHead(404).end();return;}
  const size=fs.statSync(file).size;
  const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes'};
  const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  if(range){
    const start=Number(range[1]),end=Math.min(size-1,range[2]?Number(range[2]):size-1);
    if(start>end || start>=size){response.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}
    response.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});
    fs.createReadStream(file,{start,end}).pipe(response);
  } else {
    response.writeHead(200,{...headers,'Content-Length':size});
    fs.createReadStream(file).pipe(response);
  }
}).listen(43123,'0.0.0.0',()=>console.log('Fixture server on http://127.0.0.1:43123'));
