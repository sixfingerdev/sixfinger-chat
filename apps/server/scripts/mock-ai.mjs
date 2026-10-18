// Pollinations/OpenAI uyumlu sahte yapay zekâ sunucusu (çevrimdışı geliştirme ve demo için).
// Kullanım:  node scripts/mock-ai.mjs   →   AI_BASE_URL=http://127.0.0.1:8790/openai
import { createServer } from 'node:http';
import { WIDGET_EXAMPLES } from '../src/services/widget-guide.ts';

const PORT = Number(process.env.MOCK_AI_PORT ?? 8790);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WIDGET = `Şu widget ile deneyebilirsin:
<widget title="Bileşik faiz" height="250">
<style>
  .w{padding:14px;font-family:var(--sf-font);color:var(--sf-text)}
  label{display:flex;justify-content:space-between;font-size:13px;color:var(--sf-text2);margin-top:10px}
  input[type=range]{width:100%;accent-color:var(--sf-accent)}
  .out{margin-top:14px;font-size:26px;font-weight:650}
  button{margin-top:10px;padding:8px 12px;border-radius:10px;border:1px solid var(--sf-line);background:var(--sf-surface);color:var(--sf-text)}
</style>
<div class="w">
  <label>Ana para <b id="pv">10000</b></label><input id="p" type="range" min="1000" max="100000" step="1000" value="10000">
  <label>Faiz % <b id="rv">5</b></label><input id="r" type="range" min="1" max="30" value="5">
  <label>Yıl <b id="yv">10</b></label><input id="y" type="range" min="1" max="40" value="10">
  <div class="out" id="o"></div>
  <button onclick="sf.sendPrompt('Bu hesabı adım adım açıklar mısın?')">Adım adım açıkla</button>
</div>
<script>
const $=id=>document.getElementById(id);
function up(){const P=+$('p').value,r=+$('r').value/100,y=+$('y').value;$('pv').textContent=P;$('rv').textContent=$('r').value;$('yv').textContent=y;$('o').textContent=(P*Math.pow(1+r,y)).toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL'}
['p','r','y'].forEach(i=>$(i).addEventListener('input',up));up();
</script>
</widget>
Kaydırıcıları oynat, sonuç anında değişir.`;

const ARTIFACT = `Tamam, bir parçacık animasyonu hazırladım.
<artifact id="parcacik" type="html" title="Parçacık Animasyonu">
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#111}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id="c"></canvas><script>
const c=document.getElementById('c'),x=c.getContext('2d');function rs(){c.width=innerWidth;c.height=innerHeight}rs();addEventListener('resize',rs);
const ps=Array.from({length:90},()=>({x:Math.random()*c.width,y:Math.random()*c.height,vx:(Math.random()-.5)*2,vy:(Math.random()-.5)*2}));
(function f(){x.fillStyle='rgba(17,17,17,.2)';x.fillRect(0,0,c.width,c.height);x.fillStyle='#f4f4f5';for(const p of ps){p.x=(p.x+p.vx+c.width)%c.width;p.y=(p.y+p.vy+c.height)%c.height;x.beginPath();x.arc(p.x,p.y,3,0,7);x.fill()}requestAnimationFrame(f)})();
</script></body></html>
</artifact>
İstersen renkleri değiştirebilirim.`;

const RAW = `Ham HTML (stil yok):
<widget title="Ham" height="260">
<h3>Kredi hesabı</h3>
<p>Aylık taksiti hesaplamak için değerleri gir.</p>
<label>Tutar</label> <input type="number" value="250000">
<label>Vade (ay)</label> <input type="range" min="6" max="60" value="36">
<select><option>Konut</option><option>İhtiyaç</option></select>
<button>Hesapla</button> <button class="primary">Başvur</button>
<table><tr><th>Ay</th><th>Taksit</th></tr><tr><td>12</td><td>24.180 ₺</td></tr><tr><td>24</td><td>13.420 ₺</td></tr></table>
</widget>`;

function answerFor(text) {
  if (/KITCALC/.test(text)) return 'Dene:\n' + WIDGET_EXAMPLES.CALCULATOR + '\nBitti.';
  if (/KITCHART/.test(text)) return 'Grafik:\n' + WIDGET_EXAMPLES.BAR_CHART + '\nBitti.';
  if (/WIDGETRAW/.test(text)) return RAW;
  if (/WIDGETTEST/.test(text)) return WIDGET;
  if (/ARTIFACTTEST/.test(text)) return ARTIFACT;
  return [
    `Bu bir **sahte yanıt**. Şunu yazdın: “${text.slice(0, 80)}”.`,
    '',
    '```ts',
    'export const topla = (a: number, b: number) => a + b;',
    '```',
    '',
    'Formül: $E = mc^2$',
  ].join('\n');
}

createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  for await (const c of req) raw += c;
  const body = JSON.parse(raw || '{}');
  const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
  const isTitle = (body.messages?.[0]?.content ?? '').includes('başlık üret');
  const text = isTitle ? 'Sahte Başlık' : answerFor(String(last));

  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
  // LONGTHINK: uzun ve yavaş akan düşünce (kaydırma / yapışkan başlık denemeleri için).
  const long = /LONGTHINK/.test(String(last));
  const thought = long
    ? Array.from({ length: 40 }, (_, i) => `Adım ${i + 1}: önce durumu değerlendiriyorum, sonra seçenekleri tek tek karşılaştırıp en uygun olanı seçmeye çalışıyorum.\n\n`).join('')
    : 'Kullanıcı bir şey soruyor, kısa cevap vermeliyim.';
  for (const w of thought.split(' ')) {
    send({ reasoning: `${w} `, role: 'assistant' });
    await sleep(long ? 45 : 15);
  }
  for (const ch of text.match(/.{1,6}/gs) ?? []) {
    send({ content: ch, role: 'assistant' });
    await sleep(12);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`mock-ai http://127.0.0.1:${PORT}/openai`));
