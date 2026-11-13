# ja.n — GameJobs Radar

Interface estática do GameJobs Radar, adaptada do pacote `GameJobsRadar_00_Universal_ja.n.zip` para o repositório recriado. Esta etapa usa somente dados locais do navegador. Não configura Supabase, autenticação, coletor ou sincronização automática.

## Estrutura

```text
painel/
  radar.html
  radar-assets/
    styles.css
    config.js
    app.js
tests/
  test_radar_static.py
.github/workflows/
  pages.yml
```

`ja.n` é o nome do repositório e o prefixo do site; não deve ser criada uma segunda pasta `ja.n` dentro dele. O endereço após a publicação será:

`https://julio-andrade-nogueira.github.io/ja.n/painel/radar.html`

CSS e JavaScript usam `radar-assets/...`, relativos a `painel/radar.html`. Não dependem da raiz do domínio, de CDN ou de uma instalação de Node para funcionar.

O painel principal (`painel.html`) e a página inicial (`index.html`) não estão disponíveis e não foram recriados. O Radar funciona de forma independente e exibe um aviso no lugar do link para o painel ausente. A raiz `/ja.n/` não é uma página inicial nesta entrega.

## Executar e validar

Na raiz deste checkout:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Abra `/painel/radar.html` no servidor local. Para simular o prefixo de Pages quando o checkout estiver em `/workspace/ja.n`, sirva `/workspace` e acesse `/ja.n/painel/radar.html`.

```sh
python3 -m unittest discover -s tests -v
node --check painel/radar-assets/config.js
node --check painel/radar-assets/app.js
```

Node é usado apenas para validar a sintaxe do JavaScript; não há dependências a instalar nem etapa de build. O workflow também executa essas verificações nos Pull Requests.

Na interface, confira o estado vazio, carregue os **exemplos fictícios**, busque e filtre vagas, salve uma vaga, registre notas e uma candidatura, recarregue e exporte um backup JSON. A demonstração não representa vagas reais. Importação e exportação permitem transferir dados entre navegadores; não há sincronização na nuvem.

Os dados usam `localStorage` deste navegador. Exporte um backup antes de apagar dados de navegação ou trocar de aparelho.

## Publicar depois da revisão

1. Revise e faça merge do Pull Request em `main`.
2. Em **Settings → Pages → Build and deployment**, selecione **GitHub Actions** como origem. A configuração remota de Pages não foi alterada por esta entrega.
3. Em **Actions → GitHub Pages**, confira a execução de `main`. Se necessário, execute **Run workflow** em `main` depois de habilitar Pages.
4. Aguarde o job `deploy` terminar e confira o endereço `/ja.n/painel/radar.html`, os três arquivos em `/ja.n/painel/radar-assets/` e a interface no celular.

O workflow verifica os arquivos e publica uma cópia de **todo o conteúdo versionado do repositório**, sem o histórico Git. Assim, arquivos do painel principal adicionados futuramente também serão incluídos. Pull Requests executam somente as verificações; não publicam. O ambiente `github-pages` pode exigir a aprovação configurada pelo proprietário.

O workflow não habilita Pages por API, não altera a branch `main` e não configura serviços externos. A URL pública só poderá ser validada após o merge e uma publicação bem-sucedida.

## Fora desta etapa

O pacote também fornece SQL, coletor Python e um workflow de sincronização. Eles não foram instalados. `config.js` mantém os campos públicos vazios e o SDK do Supabase não é carregado. Uma futura integração deve ser tratada separadamente; nunca publique chaves secretas, senhas ou tokens nos arquivos do site.
