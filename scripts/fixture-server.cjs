const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../tests/fixtures');
const types={'.html':'text/html','.webm':'video/webm'};
http.createServer((request,response)=>{
  const filename=path.basename(new URL(request.url,'http://localhost').pathname)||'player.html';
  const file=path.join(root,filename);
  if(!fs.existsSync(file)){response.writeHead(404).end();return;}
  response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
}).listen(43123,'0.0.0.0',()=>console.log('Fixture server on http://127.0.0.1:43123'));
