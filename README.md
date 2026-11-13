# ja.n — GameJobs Radar

Radar estático com anúncios públicos no Supabase, autenticação para acompanhamento privado e coletor Python de APIs oficiais Greenhouse/Lever. A interface anterior foi preservada. Enquanto a configuração pública estiver vazia, o modo local continua funcionando e a integração não é apresentada como ativa.

- [Configuração didática do Supabase, Auth, GitHub Secrets e publicação](docs/CONFIGURACAO.md)
- [Metodologia de compatibilidade e prioridades](docs/PONTUACAO.md)
- [Testes locais e procedimento completo de validação real](docs/TESTES.md)
- [Relatório de implementação e limitações verificadas](docs/ENTREGA.md)

## Estrutura

```text
index.html                          redirecionamento relativo para o Radar
painel/radar.html                    interface existente
painel/radar-assets/                 CSS, cliente Auth/PostgREST, sincronização e app
collector/                          coleta, normalização, pontuação e reconciliação
collector/sources.json              boards oficiais configurados
supabase/migrations/                tabelas, índices, restrições, grants, RLS e RPC
.github/workflows/pages.yml         publicação original, preservada
.github/workflows/gamejobs-sync.yml coleta horária/manual, independente
.github/workflows/radar-checks.yml  testes de integração sem Secrets
docs/                               configuração, metodologia e entrega
tests/                              Python, SQL, JavaScript, navegador e teste remoto opcional
.env.example                        nomes de variáveis exclusivas do coletor
```

## Executar localmente

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory ..
```

Com a pasta do checkout chamada `ja.n`, abra `http://127.0.0.1:8000/ja.n/`. Não há build ou CDN no site. O coletor usa somente a biblioteca padrão do Python.

```sh
python -m unittest discover -s tests -v
npm ci
npm test
npx playwright install chromium
npm run test:browser
python -m collector.run --dry-run
```

## Ativação

Execute o SQL no seu projeto Supabase, configure e-mail/senha no Auth, preencha apenas URL/chave pública em `painel/radar-assets/config.js` e cadastre `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` nos GitHub Actions Secrets. Siga o guia antes de publicar. Nunca coloque uma chave administrativa em arquivos do site.

O acompanhamento legado de `localStorage` permanece local até uma migração explícita para a conta escolhida. Exemplos são fictícios, aparecem somente na demonstração e não alimentam o banco real. A coleta não consulta nem altera automações do ChatGPT.

Após revisão e merge autorizado, o workflow Pages existente publica `https://julio-andrade-nogueira.github.io/ja.n/`, com redirecionamento para `painel/radar.html`. Novas vagas e alterações pessoais passam pelo Supabase sem republicação do site. A coleta de hora em hora passa a executar na branch padrão; os agendamentos do GitHub podem sofrer atrasos.
