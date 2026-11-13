"""Bounded HTTP. No scraping, bypasses, credentials in logs, or unsafe redirects."""
import json
import time
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


class FetchError(RuntimeError):
    def __init__(self, message, status=None, category='source'):
        super().__init__(message)
        self.status = status
        self.category = category


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward administrative headers to another host.


class Http:
    def __init__(self, pause=0.25, sleeper=time.sleep):
        self.opener = build_opener(NoRedirect)
        self.pause, self.sleep = pause, sleeper

    def request(self, url, method='GET', data=None, headers=None):
        if urlsplit(url).scheme != 'https':
            raise FetchError('HTTPS required')
        body = None if data is None else json.dumps(data, ensure_ascii=False).encode()
        req = Request(url, data=body, method=method, headers={
            'User-Agent': 'GameJobsRadar/2.0 (public job board reader)',
            'Accept': 'application/json', 'Content-Type': 'application/json', **(headers or {})})
        for attempt in range(3):
            self.sleep(self.pause)
            try:
                with self.opener.open(req, timeout=25) as response:
                    raw = response.read(20_000_001)
                    if len(raw) > 20_000_000:
                        raise FetchError('Response exceeds 20 MB')
                    return json.loads(raw) if raw else None
            except HTTPError as exc:
                status = exc.code
                # GET/PATCH/UPSERT are safe to retry; POST inserts are not.
                retryable = method in ('GET', 'PATCH') or 'on_conflict=' in url
                if status in (429, 500, 502, 503, 504) and attempt < 2 and retryable:
                    retry_after = exc.headers.get('Retry-After', '')
                    if retry_after.isdigit() and int(retry_after) > 30:
                        raise FetchError('Rate limited; retry in a later run', status, category='http') from None
                    self.sleep(int(retry_after) if retry_after.isdigit() else 2 ** (attempt + 1))
                    continue
                raise FetchError(f'HTTP {status}', status, category='http') from None
            except (URLError, TimeoutError, OSError, HTTPException):
                raise FetchError('Network connection failed (DNS, TLS, proxy or timeout)', category='network') from None
            except ValueError:
                raise FetchError('Response is not valid JSON', category='source') from None
