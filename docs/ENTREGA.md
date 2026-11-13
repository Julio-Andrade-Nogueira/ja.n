# Relatório de entrega — 13/11/2026

Branch: `feat/radar-supabase-automation`. Base: `main` a partir de `7b147e8`. O trabalho é entregue por Pull Request para revisão. Não há merge ou publicação automática por esta entrega.

## Implementado

- Interface, CSS e organização do Radar preservados; ajustes pontuais de conta, sincronização, status e detalhes. A raiz ganhou um redirecionamento relativo compatível com `/ja.n/`.
- Migração SQL transacional com seis tabelas, UUIDs, origens externas, deduplicação por URL canônica, índices, restrições e RLS. Anúncios públicos estão separados de favoritos, leitura, cliques, data de candidatura, etapa, notas e eventos de cada usuário.
- Cliente Supabase Auth e PostgREST em JavaScript local, com login/cadastro por e-mail/senha, sessão, renovação de token e recusa de chaves administrativas identificáveis no frontend.
- Patches pessoais por campo, cache/fila por projeto e conta, retomada sem conexão e descarte de respostas atrasadas de outra conta. A migração de histórico usa correspondência por UUID ou URL oficial inequívoca e também impede sobrescrita concorrente no servidor.
- Consulta paginada de vagas e histórico, atualização periódica de 120 segundos, atualização ao recuperar rede/voltar à aba, mensagens de carregamento/erro/vazio e datas de confirmação/verificação/encerramento. Salvas e candidaturas conservam acesso às vagas encerradas.
- Backup compatível com o formato anterior, importação local que preserva campos pessoais existentes e confere o proprietário dos backups de conta e demonstração fictícia separada. Os registros originais do navegador não são enviados automaticamente ao Supabase.
- Coletor Python com biblioteca padrão, adapters Greenhouse/Lever, três boards oficiais iniciais, classificação de todas as áreas e níveis, prioridades geográficas, pontuação explicada e lacunas. Campos factuais sem evidência permanecem desconhecidos.
- Atualização de identidades existentes, origens múltiplas, verificações individuais, registros de execução/erro, paginação validada, timeouts, pausas, tentativas limitadas e fechamento conservador com ausência reiterada + 24 horas + 404/410 específico.
- Workflow independente de coleta horária/manual, Secrets exclusivos no job do coletor e artefatos de relatório. Novo workflow de testes de integração.
- Guias de Supabase/Auth, chaves públicas, GitHub Secrets, migração local, metodologia, operação, teste remoto e publicação. Exemplos de configuração pública e ambiente privado.

## Verificado neste ambiente

| Verificação | Resultado |
| --- | --- |
| `python -m unittest discover -s tests -v` | 23 testes passaram |
| `npm test` | 6 testes passaram, incluindo execução real da migração SQL no PostgreSQL/PGlite |
| `npm run test:browser` | 1 cenário integrado Chromium passou, abrangendo os filtros e fluxos descritos em `TESTES.md` |
| Sintaxe de `app.js`, `supabase-client.js`, `sync.js`, `live-supabase.cjs` | Válida |
| `git diff --check` | Sem erros |
| Comparação de `.github/workflows/pages.yml` e `styles.css` com a base | Arquivos preservados, sem alterações |

Total: **30 testes automatizados locais aprovados**. O teste de SQL usa os papéis reais do PostgreSQL e uma simulação mínima de `auth.uid()`; o teste de navegador usa respostas controladas para Auth/PostgREST. Eles não substituem o teste contra o projeto Supabase real.

## Tentado e não validado em produção

A coleta `--dry-run` foi executada nas três fontes. A rede deste ambiente recusou acesso aos hosts de recrutamento; um teste direto a `boards-api.greenhouse.io` recebeu HTTP 403 do proxy na abertura do túnel. O relatório real retornou três falhas, zero anúncios e código de saída 1. **Isso não significa que os boards estejam vazios ou encerrados.** Nenhum anúncio fictício foi usado para substituir esse resultado e nenhuma vaga foi fechada. As páginas/contratos oficiais das fontes foram consultados para preparar os adapters; os payloads reais precisam ser validados pelo dry-run no GitHub Actions ou numa rede autorizada.

Não havia projeto, credenciais ou variáveis Supabase configurados no ambiente. Não foi possível aplicar a migração em banco remoto, validar confirmação de e-mail, gravação real, teste de duas contas remotas ou sincronização entre dispositivos reais. `tests/live-supabase.cjs` e o procedimento manual estão preparados para essa etapa. O arquivo público `config.js` permanece vazio e o Radar informa modo local.

O workflow horário e a publicação em Pages dependem da configuração do repositório e do merge autorizado. Não foram disparadas coletas administrativas ou deployments de produção. A automação horária do ChatGPT não foi consultada ou modificada, e não existe integração entre os resultados daquela automação e o site.

## Ações na conta do proprietário

1. Aplicar a migração SQL no projeto Supabase e conferir RLS.
2. Habilitar e-mail/senha, configurar URL de confirmação e envio de e-mails.
3. Preencher `config.js` com a URL e **chave pública**.
4. Cadastrar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` em GitHub Actions Secrets.
5. Executar o workflow manual primeiro em dry-run e depois com escrita; validar o projeto real com duas contas de teste.
6. Revisar e aprovar o PR; só então fazer merge/publicar pelo workflow Pages existente.

O passo a passo completo está em `CONFIGURACAO.md` e `TESTES.md`. A compatibilidade é orientativa; a cobertura inicial se limita aos três boards configurados e pode ser ampliada sem reconstruir a interface. Edições simultâneas do mesmo campo pessoal seguem a última escrita recebida; campos não alterados são preservados.
