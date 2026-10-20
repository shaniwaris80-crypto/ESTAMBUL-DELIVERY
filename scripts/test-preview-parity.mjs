import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const runtime=read("preview/demo.js");
const pages=[["live.html","preview/backoffice.html","backoffice"],["rider.html","preview/rider.html","rider"],["track.html","preview/cliente.html","cliente"]];
function section(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert.ok(i>=0&&j>i);return s.slice(i,j);}
test("Backoffice exact production renderer",()=>{
 assert.ok(runtime.includes(section(read("docs/live.js"),"function render(){","async function operation(fn){")));
});
test("Rider exact production renderer",()=>{
 assert.ok(runtime.includes(section(read("docs/rider.js"),"function mapUrl(order) {","async function operation(fn) {")));
});
test("HTML parity with production",()=>{
 for(const [orig,p,type] of pages){
  let s=read(orig);
  s=s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
  s=s.replace(/((?:href|src)=")docs\//g,"$1../docs/");
  s=s.replace(/href="rider\.webmanifest"/g,'href="../rider.webmanifest"');
  s=s.replace(/href="rider\.html"/g,'href="rider.html"');
  s=s.replace(/<link rel="manifest"[^>]*>/g,"");
  s=s.replace("</head>",'<meta name="robots" content="noindex,nofollow,noarchive"><link rel="stylesheet" href="demo.css?v=1"></head>');
  s=s.replace("<body>",'<body data-demo-screen="'+type+'">');
  s=s.replace('<body class="ed-visual-v5">','<body class="ed-visual-v5" data-demo-screen="'+type+'">');
  s=s.replace("<body\n",'<body data-demo-screen="'+type+'"\n');
  const extra=type==="rider"?'<script src="../docs/rider-items.js?v=1"></script>':type==="cliente"?'<script src="../docs/track-state.js?v=1"></script>':"";
  s=s.replace("</body>",'<script>window.ESTAMBUL_PARITY_PREVIEW=true;</script>'+extra+'<script defer src="demo.js?v=1"></script></body>');
  assert.equal(read(p),s,p+" differs from production markup");
 }
});
test("No live connections, SMS or production sessions in preview",()=>{
 for(const [,p] of pages){
  assert.doesNotMatch(read(p),/src="(?:\.\.\/)?docs\/(?:rider|live|track|live-config)\.js/);
 }
 assert.doesNotMatch(runtime,/\bfetch\s*\(/);
 assert.doesNotMatch(runtime,/\bXMLHttpRequest\b/);
 assert.doesNotMatch(runtime,/\blocalStorage\b|\bsessionStorage\b/);
 assert.doesNotMatch(runtime,/\bnavigator\.geolocation\b/);
 assert.match(read("preview/index.html"),/sandbox="allow-scripts"/);
 assert.doesNotMatch(read("preview/index.html"),/allow-same-origin/);
});
test("Three screens and three responsive viewports",()=>{
 const index=read("preview/index.html");
 for(const p of ["backoffice.html","rider.html","cliente.html"])assert.ok(index.includes(p));
 for(const v of ["mobile","tablet","desktop"])assert.ok(index.includes('data-size="'+v+'"'));
 assert.ok(read("preview/demo.css").includes(".parity-banner"));
});
