import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';

async function runAgainst(handler){
  let calls=0;
  const server=createServer((req,res)=>{calls++;handler(req,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const child=spawn(process.execPath,['scripts/catalog/warm-vehicle-lookup.mjs','--base-url',`http://127.0.0.1:${server.address().port}`],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr=''; child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.equal(stderr,'');return {code,calls,report:JSON.parse(stdout)};
  }finally{await new Promise(resolve=>server.close(resolve));}
}

test('warm-up stops on the first 429 without retries or additional branches',async()=>{
  const result=await runAgainst((_req,res)=>{res.writeHead(429,{'Retry-After':'60'});res.end();});
  assert.equal(result.code,1);assert.equal(result.calls,1);assert.equal(result.report.requests,1);
  assert.match(result.report.failure,/Retry-After=60/);assert.match(result.report.failure,/No retry/);
});

test('warm-up refuses a full catalogue response before requesting further data',async()=>{
  const result=await runAgainst((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({makes:[{id:'make',name:'TOYOTA',models:[]}]}));});
  assert.equal(result.code,1);assert.equal(result.calls,1);assert.match(result.report.failure,/unbounded make response/);
});
