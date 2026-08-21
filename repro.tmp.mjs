import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
const PORT=5210, BASE=`http://localhost:${PORT}`;
const SP='/tmp/claude-0/-home-user/5cceaacd-ae84-5f30-bc31-50c3a94428b4/scratchpad';
const srv=spawn('npx',['vite','--port',String(PORT),'--strictPort'],{stdio:'ignore'});
function chrome(){for(const d of readdirSync('/opt/pw-browsers')){const c=`/opt/pw-browsers/${d}/chrome-linux/chrome`;if(d.startsWith('chromium-')&&existsSync(c))return c;}}
for(let i=0;i<60;i++){try{if((await fetch(BASE)).ok)break;}catch{}await new Promise(r=>setTimeout(r,400));}
try{
  const b=await chromium.launch({executablePath:chrome(),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox']});
  const ctx=await b.newContext({permissions:['camera'],viewport:{width:520,height:1100}});
  const p=await ctx.newPage();
  const errs=[];
  p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,200));});
  p.on('requestfailed',r=>errs.push('REQ-FAIL '+r.url().slice(0,120)));
  p.on('response',r=>{if(r.status()>=400)errs.push('HTTP '+r.status()+' '+r.url().slice(0,120));});
  p.on('pageerror',e=>errs.push('pageerror: '+e.message.slice(0,200)));
  // Intercepter l'erreur réelle de createFaceProbe AVANT qu'elle soit avalée.
  await p.addInitScript(()=>{ window.__probeErr = null;
    const oe = window.onunhandledrejection; window.addEventListener('unhandledrejection', (e)=>{ window.__probeErr = String(e.reason).slice(0,300); }); void oe; });
  await p.goto(`${BASE}/essayage.html`);
  await p.waitForTimeout(30000);
  const txt = await p.locator('body').innerText();
  console.log('— TEXTE PAGE (extrait) —');
  console.log(txt.split('\n').filter(l=>/sonde|délégué|détection|Calibration|images utiles|Mesure/i.test(l)).slice(0,8).map(l=>'  '+l).join('\n') || '  (rien)');
  console.log('— ERREURS CONSOLE —');
  console.log(errs.length? errs.slice(0,6).map(e=>'  '+e).join('\n') : '  (aucune)');
  await b.close();
}catch(e){console.error('❌',e.message);process.exitCode=1;}
finally{srv.kill('SIGTERM');}
