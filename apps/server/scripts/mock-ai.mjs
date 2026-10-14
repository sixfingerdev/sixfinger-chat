// Pollinations/OpenAI uyumlu sahte yapay zekâ sunucusu (çevrimdışı geliştirme ve demo için).
// Kullanım:  node scripts/mock-ai.mjs   →   AI_BASE_URL=http://127.0.0.1:8790/openai
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_AI_PORT ?? 8790);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function answerFor(text) {
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
  for (const w of 'Kullanıcı bir şey soruyor, kısa cevap vermeliyim.'.split(' ')) {
    send({ reasoning: `${w} `, role: 'assistant' });
    await sleep(15);
  }
  for (const ch of text.match(/.{1,6}/gs) ?? []) {
    send({ content: ch, role: 'assistant' });
    await sleep(12);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`mock-ai http://127.0.0.1:${PORT}/openai`));
