"""python -m collector.run [--dry-run] [--sources path] [--report path]"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from .http import Http, FetchError
from .normalize import normalize
from .repository import Repository
from .scoring import assess
from .sources import endpoint, fetch_snapshot
from .report import report_exit_code


def error_details(exc):
    return dict(error=str(exc)[:160], error_type=type(exc).__name__,
                category=exc.category if isinstance(exc, FetchError) else 'source' if isinstance(exc, ValueError) else 'code',
                http_status=getattr(exc, 'status', None))


def missing_patch(origin, now, detail_status=None):
    """Only repeated complete-snapshot absence + aged absence + explicit detail 404/410 closes."""
    count = origin.get('missing_count', 0) + 1
    since = origin.get('missing_since') or now
    age = (datetime.fromisoformat(now) - datetime.fromisoformat(since)).total_seconds()
    confirmed = count >= 2 and age >= 86400 and detail_status in (404, 410)
    return dict(status='closed' if confirmed else 'unverified', missing_count=count,
                missing_since=since, last_checked_at=now)


def collect(sources, repo=None, http=None, now=None):
    run_id = repo.start() if repo else None
    try:
        return _collect(sources, repo, http, now, run_id)
    except Exception:
        if repo:
            try:
                repo.finish(run_id, 'failed', {'fatal':'Collection interrupted; inspect configuration and database access.'},
                            datetime.now(timezone.utc).isoformat())
            except Exception:
                pass  # An unavailable database cannot receive its own failure record.
        raise


def _collect(sources, repo=None, http=None, now=None, run_id=None):
    http = http or Http()
    now = now or datetime.now(timezone.utc).isoformat()
    summary = dict(sources=0, seen=0, new=0, updated=0, duplicates=0, missing=0, closed=0, errors=[], source_results=[])
    touched = set()
    for source in sources:
        if not source.get('enabled', True):
            continue
        label = f"{source['type']}:{source['board']}"
        summary['sources'] += 1
        source_result = dict(source=label, status='running', seen=0)
        summary['source_results'].append(source_result)
        previous = []
        try:
            source_result['endpoint'] = endpoint(source)
            previous = repo.origins(source) if repo else []
            raw_jobs = fetch_snapshot(http, source)
            # All-or-nothing snapshot validation. One malformed job blocks absence reconciliation.
            jobs = [normalize(raw, source) for raw in raw_jobs]
            for job in jobs:
                job.update(assess(job))
        except (FetchError, ValueError, KeyError, TypeError) as exc:
            details = error_details(exc)
            summary['errors'].append({'source':label, **details})
            source_result.update(status='failed', **details)
            if repo:
                repo.record(run_id, source, 'error', status=getattr(exc, 'status', None), detail=str(exc)[:160])
                for origin in previous:
                    if origin['status'] != 'closed':
                        repo.update_origin(origin, {'status':'unverified', 'last_checked_at':now})
                        touched.add(origin['job_id'])
            continue
        source_result.update(status='success', seen=len(jobs))
        old = {o['external_id']:o for o in previous}
        seen = {j['external_id'] for j in jobs}
        keys = set()
        for job in jobs:
            summary['seen'] += 1
            summary['duplicates'] += int(job['canonical_key'] in keys)
            keys.add(job['canonical_key'])
            summary['updated' if job['external_id'] in old else 'new'] += 1
            if repo:
                job_id = repo.save_seen(job, old.get(job['external_id']), now)
                touched.add(job_id)
                repo.record(run_id, source, 'seen', job_id, 200)
        # Only bounded job-specific API checks; no visits to arbitrary announcement URLs.
        detail_budget = 25
        for origin in sorted(previous, key=lambda o: o.get('last_detail_checked_at') or ''):
            if origin['external_id'] in seen or origin['status'] == 'closed':
                continue
            summary['missing'] += 1
            detail_status = None
            detail_error = False
            did_check = False
            detail = 'Absent from a complete listing; not a confirmed closure'
            if detail_budget:
                detail_budget -= 1
                did_check = True
                try:
                    http.request(endpoint(source, origin['external_id']))
                    detail_status = 200
                except FetchError as exc:
                    detail_status = exc.status
                    detail = str(exc)
                    detail_error = detail_status not in (404, 410)
                    if detail_error:
                        summary['errors'].append({'source':label, 'external_id':origin['external_id'], **error_details(exc)})
            patch = missing_patch(origin, now, detail_status)
            if did_check:
                patch['last_detail_checked_at'] = now
            if patch['status'] == 'closed':
                summary['closed'] += 1
            if repo:
                repo.update_origin(origin, patch)
                touched.add(origin['job_id'])
                outcome = 'closed' if patch['status'] == 'closed' else 'error' if detail_error else 'missing'
                repo.record(run_id, source, outcome, origin['job_id'], detail_status, detail)
    if repo:
        repo.aggregate(touched, now)
        repo.finish(run_id, 'partial' if summary['errors'] else 'success', summary, datetime.now(timezone.utc).isoformat())
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Read real APIs without database credentials or writes')
    parser.add_argument('--sources', default=str(Path(__file__).with_name('sources.json')))
    parser.add_argument('--report', default='work/collector-report.json')
    args = parser.parse_args()
    report = Path(args.report)
    report.parent.mkdir(parents=True, exist_ok=True)
    try:
        sources = json.loads(Path(args.sources).read_text())
        repo = None if args.dry_run else Repository.from_env()
        summary = collect(sources, repo)
        summary['dry_run'] = args.dry_run
        report.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        print(json.dumps(summary, ensure_ascii=False))
        return report_exit_code(summary)
    except Exception as exc:
        # Never print request headers, credential-bearing URLs, raw responses or traceback.
        report.write_text(json.dumps({'dry_run':args.dry_run, 'fatal':type(exc).__name__, 'category':'code',
                                     'message':'Collection aborted; check code, configuration and database availability.'}))
        print(f'Collection aborted ({type(exc).__name__}); see configuration guide.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
