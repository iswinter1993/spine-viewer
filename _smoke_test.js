const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.argv[2];
const OUT = process.argv[3] || '/tmp/tool_shot.png';
const PORT = 9334 + Math.floor(Math.random()*200);

const chrome = spawn(CHROME, [
  '--headless=new','--disable-gpu','--enable-unsafe-swiftshader','--no-sandbox',
  '--disable-crash-reporter','--no-first-run','--disable-extensions',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=/tmp/cdp-p' + PORT, URL
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const P = m => process.stderr.write('[cdp] ' + m + '\n');
setTimeout(() => { P('看门狗超时，强制退出'); try{chrome.kill();}catch(e){}; process.exit(2); }, 70000);

(async () => {
  let target = null;
  for (let i = 0; i < 50; i++) {
    await sleep(400);
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      target = list.find(t => t.type === 'page' && t.url.includes('index.html'));
      if (target && target.webSocketDebuggerUrl) break;
    } catch (e) {}
  }
  P('找到目标: ' + (target && target.url));
  if (!target) { console.log('❌ 连不上 Chrome'); chrome.kill(); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise(res => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  P('WebSocket 连接中…');
  await new Promise((r,j) => { ws.onopen = r; ws.onerror = e => j(new Error('ws error')); setTimeout(()=>j(new Error('ws timeout')), 8000); });
  P('WebSocket 已连');
  await send('Runtime.enable');
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails)
      return 'EXC: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '').slice(0,200);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  P('等待数据载入…');
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await ev("!!(window.S && S.data && S.data.animations && S.data.animations.length)") === true) break;
  }
  // 跑几帧，确保动画推进 + 画面稳定
  await sleep(1200);

  P('开始取值');
  console.log('--- 日志 ---');
  console.log(await ev("document.getElementById('log').innerText"));
  console.log('--- 结构 ---');
  console.log(await ev("S.data ? 'ver='+S.data.version+' bones='+S.data.bones.length+' slots='+S.data.slots.length+' skins='+S.data.skins.length+' anims='+S.data.animations.length+' regions='+S.atlas.regions.length : '未载入'"));
  console.log('--- 当前 ---');
  console.log(await ev("S.data ? 'skin='+S.skinName+' anim='+S.animName+' dur='+S.duration.toFixed(2)+' 贴图='+JSON.stringify(S.texDims) : '-'"));
  console.log('--- 画布 ---');
  console.log(await ev("(function(){var c=document.getElementById('gl');return c.width+'x'+c.height;})()"));

  // 主画布截图
  let durl = await ev("document.getElementById('gl').toDataURL('image/png')");
  if (typeof durl === 'string' && durl.startsWith('data:image/png;base64,')) {
    fs.writeFileSync(OUT, Buffer.from(durl.split(',')[1], 'base64'));
    console.log('主画布截图 -> ' + OUT + '  (' + fs.statSync(OUT).size + ' bytes)');
  } else console.log('截图失败: ' + String(durl).slice(0,120));

  // 离屏导出管线（导出用的那条路径）
  const off = "JSON.stringify((function(){try{var tmp=document.createElement('canvas');" +
    "tmp.width=300;tmp.height=300;var ctx=tmp.getContext('2d');" +
    "renderFrameInto(ctx,0,0,S.duration*0.35,300,300);" +
    "var d=ctx.getImageData(0,0,300,300).data;var nz=0;" +
    "for(var i=3;i<d.length;i+=4)if(d[i]>10)nz++;" +
    "return {ok:true,nonEmpty:nz,data:tmp.toDataURL('image/png')};}" +
    "catch(e){return {ok:false,err:e.message+' | '+e.stack};}})())";
  P('测导出渲染…');
  const r = await ev(off);
  let j = null; try { j = JSON.parse(r); } catch (e) { console.log('离屏测试返回: ' + String(r).slice(0,200)); }
  if (j && j.ok) {
    fs.writeFileSync(OUT.replace(/\.png$/, '_export.png'), Buffer.from(j.data.split(',')[1], 'base64'));
    console.log('导出渲染: ' + j.size + '  非透明采样点=' + j.nonEmpty + ' -> ' + OUT.replace(/\.png$/,'_export.png'));
  } else if (j) console.log('导出渲染失败: ' + j.err);

  await send('Page.enable');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    const f = OUT.replace(/\.png$/, '_page.png');
    fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
    console.log('整页截图 -> ' + f);
  }
  chrome.kill(); process.exit(0);
})();
