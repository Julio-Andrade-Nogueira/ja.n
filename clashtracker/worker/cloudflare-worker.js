/**
 * ClashTracker — Cloudflare Worker
 * A chave fica em COC_API_KEY (Secret); a tag autorizada em ALLOWED_PLAYER_TAG.
 * API intermediada pelo proxy documentado da RoyaleAPI (IP permitido: 45.79.218.79).
 * Não coloque segredos no HTML nem neste arquivo.
 */
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const normalize = s => String(s || '').replace(/^\s*#/, '').trim().toUpperCase().replace(/O/g, '0');
function respond(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:cors});
    if (request.method !== 'GET') return respond({error:'Método não permitido'},405);
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') return respond({ok:true, name:'ClashTracker API', configured:Boolean(env.COC_API_KEY && env.ALLOWED_PLAYER_TAG)});
    if (url.pathname !== '/player') return respond({error:'Rota não encontrada'},404);
    if (!env.COC_API_KEY || !env.ALLOWED_PLAYER_TAG) return respond({error:'Configure os valores COC_API_KEY e ALLOWED_PLAYER_TAG nas variáveis do Worker.'},503);
    const tag = normalize(url.searchParams.get('tag'));
    const allowed = normalize(env.ALLOWED_PLAYER_TAG);
    if (!/^[A-Z0-9]{3,15}$/.test(tag)) return respond({error:'Tag inválida. Ex.: #ABC123'},400);
    if (tag !== allowed) return respond({error:'Tag não autorizada neste Worker.'},403);
    // Cache do Worker por 60 s. Não depende do IP dinâmico da Cloudflare.
    const key = new Request(`${url.origin}/player?tag=${encodeURIComponent(tag)}`, {method:'GET'});
    const cache = globalThis.caches?.default;
    const hit = cache ? await cache.match(key) : null;
    if (hit) return new Response(hit.body, {status:hit.status, headers:{...Object.fromEntries(hit.headers), ...cors, 'X-ClashTracker-Cache':'HIT'}});
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);
      let upstream;
      try {
        upstream = await fetch(`https://cocproxy.royaleapi.dev/v1/players/%23${encodeURIComponent(tag)}`, {
          headers: {'Authorization': `Bearer ${env.COC_API_KEY}`, 'Accept': 'application/json'},
          signal: controller.signal,
        });
      } finally { clearTimeout(timer); }
      const txt = await upstream.text();
      let body;
      try { body = JSON.parse(txt); } catch { body = {reason:'Resposta inválida do provedor'}; }
      if (!upstream.ok) {
        const msg = upstream.status === 403 ? 'Acesso negado: confira a chave e o IP 45.79.218.79 na Supercell.'
          : upstream.status === 404 ? 'Jogador não encontrado.'
          : upstream.status === 429 ? 'Limite de requisições atingido.'
          : `Erro HTTP ${upstream.status} ao consultar a Supercell.`;
        return respond({error:msg, details:body?.reason || body?.message || ''}, upstream.status >= 500 ? 502 : upstream.status);
      }
      if (!body?.tag || !Array.isArray(body.troops)) return respond({error:'Resposta incompleta da API.'},502);
      // Nunca devolvemos a chave; apenas o perfil público da Supercell.
      const result = respond(body,200,{'Cache-Control':'public, max-age=60'});
      if (cache) await cache.put(key,result.clone());
      return result;
    } catch (err) {
      return respond({error:'Falha ao conectar ao proxy da API. Confira conexão e disponibilidade do serviço.'},502);
    }
  }
};