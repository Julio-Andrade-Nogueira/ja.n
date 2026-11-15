# ClashTracker v0.1

Rastreador **não oficial** de unidades de Clash of Clans, acessível em celular e PC pelo GitHub Pages após a aprovação deste pull request.

**Endereço previsto após merge e deploy:** https://julio-andrade-nogueira.github.io/ja.n/clashtracker/

## Funcionalidades

- Consulta da **Vila Principal** (uma tag) por meio da API da Supercell; não consulta construções ou muros
- Modo **CV atual** e **CV máximo** usando base comunitária de níveis
- Filtros por categoria, recurso e estado; pesquisa e ordenação por custo, tempo, níveis ou nome
- Estimativas de custo/tempo apenas onde há referências válidas
- Histórico de melhorias detectadas entre consultas, armazenado no navegador; histórico não sincroniza entre dispositivos
- Modo de demonstração sem cadastro ou chave

## Para ativar a consulta real

**Contas necessárias:** GitHub (já existente), [Supercell Developer](https://developer.clashofclans.com/), [Cloudflare](https://dash.cloudflare.com/sign-up).

1. Entre na [Supercell Developer](https://developer.clashofclans.com/) e crie uma chave exclusiva. No campo IP permitido, use **45.79.218.79**, indicado pela [documentação do proxy da RoyaleAPI](https://docs.royaleapi.com/proxy).
2. Em [Cloudflare Workers](https://dash.cloudflare.com/), crie um Worker JavaScript e substitua o código inicial pelo conteúdo de [worker/cloudflare-worker.js](worker/cloudflare-worker.js).
3. Em **Settings / Variables and Secrets**, cadastre `COC_API_KEY` como **Secret** (sua chave) e `ALLOWED_PLAYER_TAG` com a tag da sua única vila (por exemplo, `#ABC123`). Publique as alterações.
4. Acesse a URL HTTPS do Worker (ex.: `https://nome.conta.workers.dev/health`). Deve retornar `configured:true`. Isso verifica a configuração, **não** garante que a consulta à Supercell foi bem-sucedida.
5. Abra o ClashTracker no GitHub Pages; informe sua tag e a URL base do Worker, **sem** `/player`; clique em **Consultar minha vila**.

**Não inclua sua chave nos arquivos HTML, nas mensagens, em commits ou em prints**. O serviço da RoyaleAPI recebe a chave para encaminhar a requisição; use chave exclusiva e revogue-a se necessário.

## Limitações e privacidade

- GitHub Pages é hospedagem estática: **não substitui a Cloudflare** para proteger a chave da API.
- A API pública não retorna os níveis das construções, armadilhas ou muros nem as datas exatas de conclusão das melhorias.
- A base [clash-of-clans-data](https://github.com/chiefpansancolt/clash-of-clans-data) é comunitária e pode estar atrasada; ausência de dados é sinalizada.
- O navegador armazena tag, URL do Worker, snapshots e histórico em `localStorage`. Esses dados não são transferidos automaticamente entre celular e PC, mesmo acessando a mesma URL.
- A tag autorizada é comparada no Worker, mas o endpoint é público. Quem souber a tag e a URL poderá consultar os **dados públicos** de jogador. Não é um sistema de autenticação.
- **A publicação e a integração real ainda não estão verificadas**: é necessário mesclar o PR, aguardar o deploy do GitHub Pages, configurar as duas contas e fazer uma consulta real.

Projeto independente; não afiliado à Supercell, à RoyaleAPI ou à Cloudflare.

## Correção v0.1.1 (referências)

- Evita múltiplos erros HTTP 403 causados pelo CDN jsDelivr: dados e ícones são carregados diretamente de `raw.githubusercontent.com` (fonte pública).
- Corrige o **Sky Wagon**: é uma máquina de cerco, não uma tropa. Referência: `data/home/siege-machines/sky-wagon.json`.
- Renova o cache de referências para `ct_db_v2` e limita sua validade a 24 horas; preserva a tag e o histórico locais.
- Os totais são **estimativas brutas**, e dados ausentes continuam explicitamente sinalizados. Se o GitHub Raw estiver inacessível, a referência ainda pode falhar.
- Para aplicar após o merge, abra o ClashTracker pelo GitHub Pages e recarregue a página com `Ctrl+F5`.
