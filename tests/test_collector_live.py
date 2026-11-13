"""Live-job reporting contracts, without contacting services in unit tests."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError
from unittest.mock import MagicMock, patch

from collector.http import FetchError, Http
from collector.report import report_exit_code, summarize
from collector.run import main


class FailureClassificationTests(unittest.TestCase):
    def test_network_http_and_invalid_payload_have_distinct_categories(self):
        for error, category in [(URLError('fixture DNS failure'), 'network'),
                                (TimeoutError(), 'network'),
                                (HTTPError('https://example.com', 403, 'Forbidden', {}, None), 'http')]:
            with self.subTest(category=category):
                http = Http(sleeper=lambda _: None)
                http.opener = MagicMock()
                http.opener.open.side_effect = error
                with self.assertRaises(FetchError) as caught:
                    http.request('https://example.com')
                self.assertEqual(caught.exception.category, category)
                self.assertEqual(caught.exception.status, 403 if category == 'http' else None)
        http = Http(sleeper=lambda _: None)
        http.opener = MagicMock()
        http.opener.open.return_value.__enter__.return_value.read.return_value = b'not JSON'
        with self.assertRaises(FetchError) as caught:
            http.request('https://example.com')
        self.assertEqual(caught.exception.category, 'source')

    def test_external_failures_have_exit_two_and_never_hide_code_errors(self):
        self.assertEqual(report_exit_code({'errors': []}), 0)
        self.assertEqual(report_exit_code({'errors': [{'category': 'network'}, {'category': 'http'}]}), 2)
        self.assertEqual(report_exit_code({'errors': [{'category': 'source'}]}), 1)
        self.assertEqual(report_exit_code({'errors': [{'category': 'network'}, {'category': 'code'}]}), 1)
        self.assertEqual(report_exit_code({'fatal': 'RuntimeError', 'category': 'code'}), 1)


class DryRunTests(unittest.TestCase):
    def invoke(self, request_side_effect, normalize_side_effect=None):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'report.json'
            with (patch('sys.argv', ['collector.run', '--dry-run', '--report', str(report)]),
                  patch('collector.run.Repository.from_env') as database,
                  patch('collector.run.Http') as http,
                  contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO())):
                http.return_value.request.side_effect = request_side_effect
                if normalize_side_effect:
                    with patch('collector.run.normalize', side_effect=normalize_side_effect):
                        code = main()
                else:
                    code = main()
                database.assert_not_called()
                return code, json.loads(report.read_text()), http.return_value.request.call_args_list

    def test_actual_source_configuration_is_attempted_without_any_database_credentials(self):
        code, report, calls = self.invoke([{'jobs': []}, {'jobs': []}, []])
        self.assertEqual(code, 0)
        self.assertTrue(report['dry_run'])
        self.assertEqual(report['sources'], 3)
        self.assertEqual([r['source'] for r in report['source_results']],
                         ['greenhouse:wildlifestudios', 'greenhouse:epicgames', 'lever:xsolla'])
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(len(call.args) == 1 and not call.kwargs for call in calls))  # GET only
        self.assertIn('/wildlifestudios/', calls[0].args[0])
        self.assertIn('/epicgames/', calls[1].args[0])
        self.assertIn('/xsolla?', calls[2].args[0])
        self.assertEqual(summarize(report, 3)[2], 0)

    def test_network_failure_still_queries_all_three_and_produces_an_artifact(self):
        code, report, calls = self.invoke([FetchError('offline', category='network'),
                                          FetchError('HTTP 429', 429, category='http'), []])
        self.assertEqual(code, 2)
        self.assertEqual(len(calls), 3)
        self.assertEqual(report['source_results'][0]['category'], 'network')
        self.assertEqual(report['source_results'][1]['http_status'], 429)
        title, summary, result = summarize(report, 3)
        self.assertIn('rede/HTTP', title)
        self.assertIn('3/3', summary)
        self.assertEqual(result, 2)

    def test_invalid_source_payload_is_not_reported_as_network_failure(self):
        code, report, calls = self.invoke([{'not_jobs': []}, {'jobs': []}, []])
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 3)
        self.assertEqual(report['errors'][0]['category'], 'source')
        self.assertIn('contrato', summarize(report, 3)[0])

    def test_unexpected_bug_has_a_separate_fatal_report(self):
        code, report, _ = self.invoke([{'jobs': [{'id': 1}]}], RuntimeError('fixture bug'))
        self.assertEqual(code, 1)
        self.assertEqual(report['fatal'], 'RuntimeError')
        self.assertEqual(report['category'], 'code')
        self.assertIn('código', summarize(report, 3)[0])

    def test_missing_sources_or_unclassified_failures_cannot_pass(self):
        for report in [{'dry_run': False}, {'dry_run': True, 'sources': 2, 'source_results': []},
                       {'dry_run': True, 'sources': 3, 'errors': [], 'source_results':
                        [{'source': str(i), 'status': 'failed'} for i in range(3)]}]:
            with self.subTest(report=report), self.assertRaises(ValueError):
                summarize(report, 3)


if __name__ == '__main__':
    unittest.main()
