"""Classify the live dry-run without disguising network failures as passing tests."""
import argparse
import json
from pathlib import Path


def report_exit_code(report):
    """0: success, 2: network/HTTP only, 1: code, source contract, or invalid report."""
    if report.get('fatal'):
        return 1
    categories = {error.get('category', 'code') for error in report.get('errors', [])}
    if not categories:
        return 0
    return 2 if categories <= {'network', 'http'} else 1


def markdown(value):
    return str(value).replace('|', '\\|').replace('`', '').replace('\n', ' ').replace('\r', ' ')


def summarize(report, expected_sources):
    if not isinstance(report, dict) or report.get('dry_run') is not True:
        raise ValueError('Missing or invalid dry-run report; no live validation established.')
    if report.get('fatal'):
        return 'Falha no código/configuração', f"Execução interrompida: {markdown(report['fatal'])}. Consulte o relatório JSON.", 1
    results = report.get('source_results')
    if (not isinstance(results, list) or report.get('sources') != expected_sources or
            len(results) != expected_sources or len({r['source'] for r in results}) != expected_sources or
            any(r.get('status') not in ('success', 'failed') for r in results)):
        raise ValueError(f'Report must include all {expected_sources} distinct sources, without skipped or unfinished results.')
    if not isinstance(report.get('errors'), list):
        raise ValueError('Invalid errors list in collection report.')
    # Failed sources must carry a classified error; an empty success is never inferred.
    if any(r['status'] == 'failed' and not any(e.get('source') == r['source'] for e in report['errors']) for r in results):
        raise ValueError('Failed source without a corresponding error record.')
    code = report_exit_code(report)
    categories = {e.get('category', 'code') for e in report['errors']}
    title = ('Coleta real validada' if code == 0 else 'Falha de rede/HTTP — dependência externa' if code == 2
             else 'Falha no código/configuração' if 'code' in categories else 'Falha nos dados/contrato da fonte')
    lines = [f'## {title}', '', 'Dry-run: somente leitura; nenhuma escrita no Supabase.', '',
             '| Fonte | Resultado | Anúncios normalizados | Categoria | HTTP |',
             '| --- | --- | ---: | --- | --- |']
    for row in results:
        lines.append('| ' + ' | '.join(markdown(row.get(key, '—')) for key in
                     ('source', 'status', 'seen', 'category', 'http_status')) + ' |')
    lines += ['', f'Fontes consultadas: {len(results)}/{expected_sources}. Código de saída: {code}.',
              'Relatório completo: artefato `collector-live-dry-run-report`.',
              'Erros de rede/HTTP não comprovam defeito no código; respostas incompatíveis são sinalizadas separadamente.']
    return title, '\n'.join(lines), code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('--expected-sources', type=int, default=3)
    parser.add_argument('--summary', type=Path)
    args = parser.parse_args()
    try:
        report = json.loads(args.report.read_text())
        title, summary, code = summarize(report, args.expected_sources)
    except (OSError, ValueError, KeyError, TypeError):
        title, summary, code = ('Falha no código/relatório',
                                '## Falha no código/relatório\n\nRelatório ausente, inválido ou incompleto. A coleta não foi validada.', 1)
    if args.summary:
        with args.summary.open('a') as file:
            file.write(summary + '\n')
    print(summary)
    if code:
        print(f'::error title={title}::Consulte o resumo e o artefato collector-live-dry-run-report. Exit code {code}.')
    return code


if __name__ == '__main__':
    raise SystemExit(main())
