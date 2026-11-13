# Testar antes de publicar

## Testes locais sem credenciais

Na raiz do repositório, use Python 3.12+ e Node 22+:

```sh
python -m unittest discover -s tests -v
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Se já houver Chromium instalado, use `CHROMIUM_EXECUTABLE=/caminho/do/chromium npm run test:browser`. O teste procura `/usr/bin/chromium` automaticamente quando disponível. Dependências npm são somente para desenvolvimento/testes. O site e o coletor não dependem delas.

Os testes verificam:

- Normalização sem inventar publicação, salário, jornada ou idioma obrigatório; classificação de várias áreas e geografia.
- Identidade estável, remoção limitada de rastreadores, atualização de anúncios e prevenção de duplicatas por URL oficial.
- Pontuação justificável e nota ausente quando não há evidência suficiente.
- Encerramento com ausências reiteradas e 404/410 individual, preservando vagas em falhas de fonte, paginação incompleta ou dados inválidos.
- Contratos HTTP/PostgREST, cabeçalhos, paginação e proibição de acesso do coletor às tabelas pessoais.
- Execução do SQL num motor PostgreSQL local **PGlite**, com simulação mínima de `auth.users`/`auth.uid()`: constraints, privilégios anônimos, RLS cruzada entre duas contas, patch por campo e importação que não sobrescreve registros existentes.
- Cache separado por conta, retomada de alterações sem conexão, respostas atrasadas de outra conta e preservação de edições durante uma requisição.
- Navegador Chromium com respostas Supabase controladas: redirecionamento `/ja.n/`, recursos relativos, dados antigos, modo fictício separado, todos os filtros, login, troca de conta, notas, favoritos, falhas e largura de tela de celular.

As respostas de API nos testes são **fixtures**, não vagas reais. Os testes locais não comprovam que as credenciais, e-mail, políticas de um projeto remoto ou APIs de terceiros estejam funcionando na sua conta.

Os PRs executam os testes Python no workflow Pages preservado e a suíte completa no novo **Radar integration checks**. Nenhum deles usa Secrets. Só o workflow separado de coleta recebe a chave administrativa.

## Coleta real sem escrita

```sh
python -m collector.run --dry-run --report work/collector-report.json
```

Esse comando consulta somente APIs oficiais e não exige Supabase. Leia o relatório: `dry_run: true`, fontes, contagens e erros. Um erro faz o comando sair com status 1. Falha de rede não produz vagas demonstrativas nem encerramentos. Execute numa rede que permita `boards-api.greenhouse.io` e `api.lever.co`, ou use **Run workflow** com `dry_run` habilitado no GitHub.

## Testar o Supabase real após a configuração

1. Aplique o SQL e execute o coletor real com os dois Secrets configurados. Deve existir pelo menos uma vaga real no banco.
2. Crie **duas contas exclusivas de teste**, confirme os e-mails e defina senhas. Não use uma conta com anotações importantes.
3. Configure, num ambiente privado, estas variáveis (sem versionar os valores):

| Variável | Conteúdo |
| --- | --- |
| `SUPABASE_URL` | URL do projeto |
| `SUPABASE_PUBLISHABLE_KEY` | Chave pública publishable/anon |
| `RADAR_TEST_EMAIL_A`, `RADAR_TEST_PASSWORD_A` | Conta de teste A |
| `RADAR_TEST_EMAIL_B`, `RADAR_TEST_PASSWORD_B` | Conta de teste B |

```sh
node tests/live-supabase.cjs
```

O teste lê anúncios, entra nas duas contas, grava uma nota/favorito na conta A e tenta ler/alterar essa linha com a conta B e sem login. Restaura nota, favorito e etapa ao terminar, mas deixa a linha de acompanhamento e os eventos de teste nas contas dedicadas. Não precisa de chave administrativa. Não é executado automaticamente nos PRs.

## Conferência manual em dois dispositivos

Sirva a pasta que contém o checkout para manter `/ja.n/`:

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory ..
```

Abra `http://127.0.0.1:8000/ja.n/`. Se a pasta local tiver outro nome, ajuste o prefixo local; no GitHub Pages permanece `/ja.n/`.

1. Sem configuração pública, confira o aviso de modo local. Importe um backup v1; abra exemplos fictícios e volte. Confira que os anúncios anteriores não foram removidos e que os exemplos não entram na lista real.
2. Preencha `config.js` com os valores públicos do seu projeto e recarregue. Banco vazio deve mostrar mensagem explícita; nunca deve abrir a demonstração automaticamente.
3. Execute o coletor e confira cargo, origem, link, status e última verificação no banco/interface. Clique no anúncio oficial e veja o registro em Links acessados.
4. Busque e filtre área, nível, país/local, empresa, modalidade, contrato, nota, data, jornada, salário, elegibilidade e idioma. Veja **Encerradas**, **Salvas**, **Candidaturas**, **Não visualizadas** e **Links acessados**. Salvas/candidaturas mantêm as encerradas acessíveis.
5. Entre na conta A, favorite, registre notas e uma candidatura. No segundo dispositivo, entre na mesma conta e atualize: os dados devem aparecer. Altere só o favorito num dispositivo e confirme que as notas do outro foram preservadas.
6. No primeiro, saia e entre na conta B. Notas e favoritos da conta A não devem aparecer. Sem login, a API de dados pessoais deve recusar acesso.
7. Corte a rede com a conta A conectada; edite uma nota. Recarregue, restabeleça a rede e atualize. A nota pendente deve sincronizar. A conta B não deve receber alterações pendentes da A.
8. Exporte um backup, importe e confira que campos pessoais existentes não foram substituídos. **Migrar histórico local** só deve criar acompanhamento ausente, por UUID ou URL oficial inequívoca.
9. Teste no celular, erro HTTP, banco vazio e ausência de correspondências de filtros. A raiz publicada deve redirecionar corretamente e recursos devem ficar sob `/ja.n/`.

## Aprovar a publicação

Revise o relatório `ENTREGA.md`, o diff, os testes do PR, o SQL aplicado e os Secrets cadastrados. Só faça merge após a validação desejada. O workflow Pages existente publica somente `main`; este trabalho não faz merge ou deploy automaticamente.
