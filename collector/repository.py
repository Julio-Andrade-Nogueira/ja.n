"""Service-side PostgREST repository. Never reads or writes user tables."""
import os
import re
from urllib.parse import urlencode
from .http import Http


class Repository:
    TABLES = {'radar_jobs', 'radar_origins', 'radar_runs', 'radar_checks'}

    def __init__(self, url, key, http=None):
        if not re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co', url.rstrip('/')):
            raise ValueError('SUPABASE_URL must be a hosted Supabase HTTPS project URL')
        if not key:
            raise ValueError('Missing SUPABASE_SERVICE_ROLE_KEY')
        self.base = url.rstrip('/') + '/rest/v1/'
        self.headers = {'apikey': key}
        if key.count('.') == 2:
            self.headers['Authorization'] = f'Bearer {key}'
        self.http = http or Http(pause=0)

    @classmethod
    def from_env(cls):
        return cls(os.environ.get('SUPABASE_URL', ''), os.environ.get('SUPABASE_SERVICE_ROLE_KEY', ''))

    def request(self, table, method='GET', data=None, params=None, prefer=None):
        if table not in self.TABLES:
            raise ValueError('Collector table not allowed')
        query = '?' + urlencode(params) if params else ''
        headers = dict(self.headers)
        if prefer:
            headers['Prefer'] = prefer
        return self.http.request(self.base + table + query, method, data, headers)

    def all(self, table, **params):
        rows = []
        for offset in range(0, 100000, 500):
            page = self.request(table, params={**params, 'limit':500, 'offset':offset, 'order':'id' if table == 'radar_jobs' else 'external_id'})
            if not isinstance(page, list):
                raise ValueError('Invalid database response')
            rows.extend(page)
            if len(page) < 500:
                return rows
        raise ValueError('Database pagination limit reached')

    def origins(self, source):
        return self.all('radar_origins', source='eq.' + source['type'], board='eq.' + source['board'])

    def start(self):
        return self.request('radar_runs', 'POST', {}, prefer='return=representation')[0]['id']

    def finish(self, run_id, status, summary, now):
        self.request('radar_runs', 'PATCH', dict(status=status, summary=summary, finished_at=now), {'id':'eq.'+run_id})

    def record(self, run_id, source, outcome, job_id=None, status=None, detail=None):
        self.request('radar_checks', 'POST', dict(run_id=run_id, source=source['type'], board=source['board'],
                     outcome=outcome, job_id=job_id, http_status=status, detail=detail))

    def save_seen(self, job, previous, now):
        if previous:
            job_id = previous['job_id']
            # Do not overwrite another source's primary identity.
            payload = {k:v for k,v in job.items() if k not in ('source','source_board','external_id')}
            self.request('radar_jobs', 'PATCH', {**payload, 'last_seen_at':now, 'last_checked_at':now,
                         'status':'active', 'closed_at':None, 'updated_at':now}, {'id':'eq.'+job_id})
        else:
            # Canonical URL is a strong duplicate key. Same title/company alone is not.
            found = self.request('radar_jobs', params={'canonical_key':'eq.'+job['canonical_key'], 'select':'id'})
            if found:
                job_id = found[0]['id']
                self.request('radar_jobs', 'PATCH', {'last_seen_at':now, 'last_checked_at':now, 'updated_at':now,
                             'status':'active', 'closed_at':None}, {'id':'eq.'+job_id})
            else:
                job_id = self.request('radar_jobs', 'POST', {**job, 'status':'active', 'last_seen_at':now,
                              'last_checked_at':now}, prefer='return=representation')[0]['id']
        origin = dict(source=job['source'], board=job['source_board'], external_id=job['external_id'],
                      job_id=job_id, url=job['url'], status='active', last_seen_at=now,
                      last_checked_at=now, missing_since=None, missing_count=0)
        self.request('radar_origins', 'POST', origin, {'on_conflict':'source,board,external_id'},
                     prefer='resolution=merge-duplicates')
        return job_id

    def update_origin(self, origin, patch):
        self.request('radar_origins', 'PATCH', patch, {k:'eq.'+origin[k] for k in ('source','board','external_id')})

    def aggregate(self, job_ids, now):
        for job_id in sorted(set(job_ids)):
            origins = self.request('radar_origins', params={'job_id':'eq.'+job_id, 'select':'status'})
            statuses = {o['status'] for o in origins}
            status = 'active' if 'active' in statuses else 'unverified' if 'unverified' in statuses else 'closed'
            # Preserve first closure time on repeated confirmations.
            current = self.request('radar_jobs', params={'id':'eq.'+job_id, 'select':'status,closed_at'})[0]
            closed_at = (current['closed_at'] or now) if status == 'closed' else None
            self.request('radar_jobs', 'PATCH', dict(status=status, closed_at=closed_at,
                         last_checked_at=now, updated_at=now), {'id':'eq.'+job_id})
