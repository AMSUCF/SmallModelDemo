const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const appURL = new URL(process.env.TEST_BASE_URL || 'http://127.0.0.1:8000/').href;
const mockURL = new URL('mock-transformers.js', appURL).href;
const mockModule = `
export const env = { backends: { onnx: { wasm: {} } } };
export class TextStreamer { constructor(tokenizer, options) { this.options = options; } }
export async function pipeline(task, model, options) {
  if (env.backends.onnx.wasm.numThreads !== 1 || env.backends.onnx.wasm.proxy !== false) throw Error('WASM needs isolation headers');
  if (env.backends.onnx.wasm.wasmPaths !== 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/') throw Error('Runtime assets must use the pinned CDN path');
  if (options.dtype !== 'q4') throw Error('Wrong precision');
  if (options.device === 'webgpu') throw Error('Simulated GPU initialization failure');
  if (options.device !== 'wasm') throw Error('No CPU fallback');
  options.progress_callback({status:'progress',file:'model_q4.onnx',loaded:50,total:100});
  await new Promise(r=>setTimeout(r,50));
  options.progress_callback({status:'done',file:'model_q4.onnx'});
  const fn = async (messages, settings) => {
    if (messages.length > 6 || messages[0].role !== 'system') throw Error('History exceeds budget');
    if (messages.at(-1).content === 'fail') throw Error('Simulated generation failure');
    if (settings.max_new_tokens !== 110) throw Error('Missing token cap');
    const text = messages.at(-1).content.includes('<script>') ? '<script>window.bad = true</script>' : 'Every path begins with a curious paw. Which way does your grin point?';
    settings.streamer.options.callback_function(text.slice(0,20));
    await new Promise(r=>setTimeout(r,25));
    settings.streamer.options.callback_function(text.slice(20));
    return [{ generated_text: [{role:'assistant',content:text}] }];
  };
  fn.tokenizer = {};
  return fn;
}`;
(async()=>{
  const response = await fetch(appURL);
  assert.equal(response.ok, true, 'The staged site must be served successfully');
  const html = await response.text();
  assert.match(html, /The Cheshire Room/);
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
  try {
    for (const scenario of ["no-gpu", "gpu-failure", "gpu-success"]) {
      const gpu = scenario !== "no-gpu";
      const page = await browser.newPage({viewport:{width:1440,height:1000}});
      const errors=[]; page.on('pageerror', e=>errors.push(e.message));
      await page.route('https://fonts.googleapis.com/**',r=>r.abort());
      await page.route(appURL,r=>{
        let source = html.replace('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',mockURL);
        // Exercise real app worker, while replacing only its remote inference library.
        source=source.replace('import { pipeline, TextStreamer, env }',`Object.defineProperty(self.navigator, 'gpu', { value: ${gpu ? '{requestAdapter:async()=>({})}' : 'undefined'} });\nimport { pipeline, TextStreamer, env }`);
        return r.fulfill({contentType:'text/html',body:source});
      });
      await page.route(mockURL,r=>r.fulfill({contentType:'text/javascript',body:scenario === "gpu-success" ? mockModule.replace("if (options.device === 'webgpu')", "if (false)").replace("if (options.device !== 'wasm')", "if (false)") : mockModule}));
      await page.goto(appURL);
      assert.equal(await page.evaluate(()=>crossOriginIsolated),false);
      assert.equal(await page.locator('#prompt').isDisabled(),true);
      await page.locator('[data-prompt]').first().click();
      assert.match(await page.locator('#status').textContent(),/Download/);
      await page.screenshot({path:path.join(os.tmpdir(),'cheshire-desktop.png'),fullPage:true});
      await page.click('#download');
      await page.waitForFunction(()=>!document.getElementById('prompt').disabled);
      assert.match(await page.locator('#device').textContent(),scenario === 'gpu-success' ? /WEBGPU/ : /WASM/);
      assert.equal(await page.locator('#progress').getAttribute('value'),'100');
      for (let i=0;i<4;i++) {
        await page.fill('#prompt','Which way '+i+'?'); await page.press('#prompt','Enter');
        await page.waitForFunction(()=>!document.getElementById('prompt').disabled);
      }
      assert.equal(await page.locator('.message.user').count(),4);
      assert.match(await page.locator('.message.assistant').last().textContent(),/curious paw/);
      await page.fill('#prompt','<script>window.bad = true</script>'); await page.click('#send');
      await page.waitForFunction(()=>!document.getElementById('prompt').disabled);
      assert.equal(await page.evaluate(()=>window.bad),undefined);
      assert.match(await page.locator('.bubble').last().textContent(),/<script>/);
      await page.fill('#prompt','fail'); await page.click('#send');
      await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));
      assert.equal(await page.locator('#prompt').isEnabled(),true);
      await page.click('#clear');
      assert.equal(await page.locator('.message').count(),1);
      assert.equal(await page.locator('.message.user').count(),0);
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
      await page.screenshot({path:path.join(os.tmpdir(),'cheshire-mobile.png'),fullPage:true});
      assert.deepEqual(errors,[]);
      await page.close();
      console.log('PASS: '+scenario+', download progress, streaming, bounded history, safe text, generation failure, reset, mobile');
    }
    const page = await browser.newPage();
    await page.route('https://fonts.googleapis.com/**',r=>r.abort());
    await page.route('https://cdn.jsdelivr.net/**',r=>r.abort());
    await page.goto(appURL); await page.click('#download');
    await page.waitForFunction(()=>document.getElementById('download').textContent.includes('Retry'));
    assert.equal(await page.locator('#prompt').isDisabled(),true);
    assert.equal(await page.locator('#download').isEnabled(),true);
    console.log('PASS: engine download failure offers retry and keeps chat disabled');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
