# Ativar o GameJobs Radar

O código funciona em modo local enquanto `config.js` estiver vazio. **O Supabase e a coleta em produção ainda precisam ser ativados na sua conta.** Nenhuma vaga demonstrativa é enviada ao banco. A automação existente no ChatGPT não participa desta integração.

## 1. Criar o projeto e aplicar o SQL

1. No painel do [Supabase](https://supabase.com/dashboard), crie ou escolha seu projeto. Guarde a senha do banco fora do repositório.
2. Abra **SQL Editor → New query**. Execute o conteúdo de `supabase/migrations/202611130001_radar.sql` inteiro, uma única vez. A transação cria somente tabelas com prefixo `radar_`; não apaga nem recria tabelas existentes.
3. Confira no Table Editor as seis tabelas: `radar_jobs`, `radar_origins`, `radar_runs`, `radar_checks`, `radar_user_states` e `radar_user_events`. Todas devem indicar RLS habilitado.
4. Aplique futuras migrações em ordem de nome e registre os arquivos já aplicados. Se usar a CLI Supabase com um projeto vinculado, estas migrações também podem ser aplicadas com `supabase db push`. Não execute de novo o SQL inicial em um banco já migrado. Se algum nome já existir, examine a estrutura antes de adaptar a migração; não apague a tabela para resolver o conflito.

`radar_jobs` contém somente anúncios públicos e avaliação do perfil orientativo. Visitantes podem consultar esses dados. Somente o coletor administrativo escreve neles. Origens, execuções e verificações não podem ser lidas pelo navegador. O histórico pessoal usa `user_id = auth.uid()` em leitura, inserção e atualização. `radar_patch_state` roda com as permissões do usuário (**SECURITY INVOKER**) e grava apenas os campos enviados, em transação com um evento de histórico.

## 2. Habilitar a autenticação

1. Em **Authentication → Providers**, habilite o provedor de e-mail/senha.
2. Em **Authentication → URL Configuration**, use como Site URL:
   `https://julio-andrade-nogueira.github.io/ja.n/painel/radar.html`.
3. Adicione essa URL às URLs permitidas de redirecionamento. Para testes locais, adicione também o endereço local exato usado por você.
4. Mantenha confirmação de e-mail habilitada. Configure o envio de e-mails do projeto para que novas contas recebam a confirmação; em produção, confira as configurações e limites do provedor de e-mail escolhido.
5. No Radar, abra **Conta e dados**, crie a conta, confirme o e-mail e entre. A senha é enviada apenas ao endpoint Auth do seu projeto; não é gravada pelo site. O token de sessão é guardado no navegador para manter o login.

Não é preciso login para ver vagas. Sem login, o acompanhamento continua local e é identificado como tal. Ao entrar, o Radar usa somente o acompanhamento daquela conta para as vagas do banco. Ao sair ou trocar de usuário, ele deixa de exibir os registros da conta anterior. O cache privado e as alterações pendentes são separados por projeto e UUID do usuário. Use **Sair da conta** antes de deixar um aparelho compartilhado; o navegador pode conservar caches de sessão no armazenamento desse aparelho.

## 3. Configurar o navegador com valores públicos

Na área de configuração/API do projeto, copie a **Project URL** e a **publishable key**. Preencha `painel/radar-assets/config.js`, seguindo `config.example.js`:

```js
window.GAMEJOBS_CONFIG = {
  supabaseUrl: "https://SEU_PROJECT_REF.supabase.co",
  supabasePublishableKey: "sb_publishable_SUA_CHAVE_PUBLICA",
  refreshSeconds: 120
};
```

A chave `anon` JWT legada também é aceita se sua claim `role` for `anon`. **Nunca** use `service_role`, `sb_secret_...`, senha de banco ou token do GitHub no site. O cliente rejeita chaves administrativas identificáveis. A proteção dos dados vem das políticas RLS, que continuam habilitadas.

Esses dois valores são públicos por definição e podem ser versionados. O GitHub Pages não injeta variáveis de ambiente em JavaScript estático: preencher apenas GitHub Secrets não configura o navegador. É necessário publicar `config.js` com os valores públicos. O site não usa CDN ou etapa de build.

## 4. Cadastrar os GitHub Actions Secrets

No repositório `Julio-Andrade-Nogueira/ja.n`, abra **Settings → Secrets and variables → Actions → New repository secret**:

| Nome | Valor | Utilização |
| --- | --- | --- |
| `SUPABASE_URL` | Project URL, sem `/rest/v1` | Destino do coletor |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta `sb_secret_...` ou `service_role` JWT | Escrita administrativa exclusiva do job Python |

O nome do segundo Secret é mantido também quando se usa a nova chave secreta. O coletor envia `apikey`; para a chave JWT legada também envia `Authorization`. Não cole valores secretos em chat, issues, logs, comandos versionados ou `.env.example`. O `.env.example` lista os nomes; o programa lê o ambiente do processo e não carrega `.env` automaticamente. Arquivos `.env` estão ignorados pelo Git.

## 5. Testar a coleta e a publicação

1. Antes do merge, faça o teste manual local descrito em `TESTES.md`.
2. No GitHub, abra **Actions → GameJobs hourly collection → Run workflow**. Selecione a branch deste PR e mantenha `dry_run` habilitado para testar as fontes sem escrever no banco.
3. Leia o artefato `gamejobs-collection-report`. Falhas de fonte deixam a execução com erro; não são substituídas por exemplos.
4. Após o SQL e os Secrets, execute novamente na branch escolhida com `dry_run` desabilitado. Confira vagas reais em `radar_jobs`, resultado em `radar_runs` e evidências em `radar_checks`.
5. Sirva o checkout com `config.js` preenchido e confirme carregamento, login e gravação de acompanhamento em duas contas de teste. Só depois aprove o merge/publicação.
6. Após seu merge em `main`, o workflow **GitHub Pages** existente publica o site. Ele foi preservado. Se Pages ainda não estiver habilitado, em **Settings → Pages → Build and deployment**, selecione **GitHub Actions**.
7. Verifique `/ja.n/` redirecionando para `/ja.n/painel/radar.html`. Favoritos e novas vagas passam a vir do Supabase sem precisar republicar a cada coleta; republicar só é necessário para alterar o código/configuração pública.

O cron novo é `17 * * * *`: aproximadamente uma coleta por hora, no minuto 17 em UTC. Agendamentos do GitHub podem atrasar e só executam da branch padrão. Confira se Actions/agendamentos estão habilitados no repositório. Execução manual aceita branch e modo de leitura. O workflow de publicação não foi editado, e nenhuma automação do ChatGPT foi alterada. Não houve merge nem deploy como parte desta entrega.

## 6. Migrar o histórico local e fazer backup

1. Antes de mudar dados, use **Exportar vagas (JSON)**. O backup inclui vagas locais, exemplos identificados, cache público, acompanhamento da conta atual, dados locais e fila pendente. Ele contém notas pessoais; guarde-o de forma privada.
2. A chave original `gamejobs-radar-v1` é preservada. Entrar numa conta não envia esse histórico automaticamente.
3. Entre na conta desejada, carregue as vagas do banco e clique em **Migrar histórico local**. A migração aceita o mesmo UUID ou uma correspondência única pelo link oficial normalizado, sem parâmetros de rastreamento. Não combina vagas apenas por título/empresa.
4. Se já existir qualquer acompanhamento daquele anúncio na conta, ele é preservado por inteiro. Registros sem correspondência e exemplos ficam locais. O histórico local original não é apagado.
5. **Importar JSON** aceita o formato anterior e o backup v2. Ele guarda o acompanhamento importado localmente, preservando os campos pessoais já existentes no aparelho. Backups v2 identificados com uma conta exigem login na mesma conta; o acompanhamento importado fica num compartimento privado dela, separado dos dados anônimos, até a migração explícita. Nenhum registro é enviado ao banco por importar. Para transferir registros ausentes à conta, use a migração explícita.
6. **Limpar apenas vagas locais** remove os anúncios locais, preservando notas/histórico e mantendo o banco intacto. O backup também inclui notas de anúncios removidos da lista.

Alterações em vagas do banco feitas enquanto autenticado ficam em uma fila privada local até serem aceitas pelo servidor. Favoritar não envia notas nem etapa. Para duas alterações concorrentes no **mesmo campo**, prevalece a última alteração recebida pelo servidor; não há editor colaborativo de notas. Ao sair, o Radar tenta concluir a fila e informa se a conexão impedir a saída.

## 7. Fontes, manutenção e diagnóstico

Edite `collector/sources.json` para adicionar um board oficial Greenhouse ou Lever. As fontes iniciais são Wildlife Studios (empresa brasileira), Epic Games e Xsolla. A coleta inclui todas as vagas publicadas por esses boards, em todas as áreas, sem filtro de exclusão por senioridade ou país. Não cobre todas as empresas de games nem promete vagas em BH a cada execução.

Referências verificáveis:

- [Wildlife: carreiras oficiais](https://careers.wildlifestudios.com/) e [board Greenhouse](https://job-boards.greenhouse.io/wildlifestudios).
- [Epic Games: carreiras oficiais](https://www.epicgames.com/site/careers/jobs).
- [Xsolla: board oficial Lever](https://jobs.lever.co/xsolla/).
- [Contrato da API Greenhouse](https://docs.greenhouse.io/job-board.html) e [contrato da API Lever](https://github.com/lever/postings-api).

Os endpoints usados são `boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true` e `api.lever.co/v0/postings/{board}?mode=json&skip=...&limit=100`. Não é feito scraping de páginas protegidas. Há timeout de 25 segundos, pausa de 250 ms nas APIs, até três tentativas para HTTP temporário e orçamento de 25 consultas individuais por fonte/execução. As consultas de fechamento excedentes ficam pendentes para execuções seguintes. Se a API/board mudar, atualize a configuração/adapter após conferir a página oficial.

Dados ausentes permanecem nulos. A última atualização do anúncio e a criação de um registro ATS **não** são usadas como data de publicação. Idioma da página não vira idioma exigido. Somente salário estruturado e requisitos explicitamente seccionados são extraídos; horas, prazo, país/cidade e demais campos sem evidência ficam desconhecidos, embora a descrição original seja preservada como texto. As classificações e a nota são heurísticas descritas em `PONTUACAO.md`.

No banco, `radar_origins` preserva cada identidade externa e seu anúncio correspondente. O UUID da vaga e `first_seen_at` não mudam numa atualização. Links canônicos iguais são deduplicados; anúncios parecidos em URLs diferentes permanecem separados para evitar combinar oportunidades distintas. Uma origem ativa impede que outra origem ausente feche o anúncio compartilhado.

Uma falha de rede, JSON inválido, paginação incompleta ou registro malformado invalida a reconciliação daquela fonte. Vagas antes confirmadas passam a **não confirmadas** quando a fonte falha. Vagas já encerradas não são reabertas por falhas. Ausência em listagem completa começa uma contagem; o encerramento exige pelo menos duas ausências, intervalo mínimo de 24 horas e HTTP 404/410 na API do anúncio específico. A página inteira do board retornar 404 não confirma fechamento individual. Reaparecimento com o mesmo identificador reativa a vaga e mantém o histórico pessoal. Prazo expirado sozinho não muda o status.

Consulte `radar_runs` para totais/erros, `radar_checks` para a evidência por verificação e os artefatos do Actions para diagnóstico sem credenciais. Uma falha grave de banco interrompe o processo e tenta registrar `failed`; se o próprio banco estiver inacessível, a execução pode permanecer `running`, e o artefato/Actions será a evidência da interrupção. Não há retenção automática no banco: acompanhe volume e defina arquivamento de verificações conforme sua necessidade, preservando os dados pessoais. Os artefatos do Actions têm retenção de 14 dias.
