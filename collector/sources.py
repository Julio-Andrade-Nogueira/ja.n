"""Only public, official JSON APIs. Fully validate a snapshot before reconciliation."""
import re
from urllib.parse import quote
from .http import FetchError


def endpoint(source, external_id=None):
    board = source['board']
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', board):
        raise ValueError('Invalid board token')
    if source['type'] == 'greenhouse':
        base = f'https://boards-api.greenhouse.io/v1/boards/{board}/jobs'
        return f'{base}/{quote(external_id, safe="")}' if external_id else f'{base}?content=true'
    if source['type'] == 'lever':
        base = f'https://api.lever.co/v0/postings/{board}'
        return f'{base}/{quote(external_id, safe="")}?mode=json' if external_id else f'{base}?mode=json&skip=0&limit=100'
    raise ValueError('Unsupported ATS')


def fetch_snapshot(http, source):
    url = endpoint(source)
    if source['type'] == 'greenhouse':
        data = http.request(url)
        if not isinstance(data, dict) or not isinstance(data.get('jobs'), list):
            raise FetchError('Invalid Greenhouse snapshot')
        jobs = data['jobs']
        meta = data.get('meta', {})
        if not isinstance(meta, dict) or meta.get('total', len(jobs)) != len(jobs):
            raise FetchError('Incomplete Greenhouse snapshot')
    else:
        jobs = []
        for skip in range(0, 10000, 100):
            page = http.request(url.replace('skip=0', f'skip={skip}'))
            if not isinstance(page, list):
                raise FetchError('Invalid Lever snapshot')
            jobs.extend(page)
            if len(page) < 100:
                break
        else:
            raise FetchError('Pagination safety limit reached')
    ids = [str(j.get('id', '')) for j in jobs if isinstance(j, dict)]
    if len(ids) != len(jobs) or not all(ids) or len(set(ids)) != len(ids):
        raise FetchError('Invalid or duplicate source identities; snapshot rejected')
    return jobs
