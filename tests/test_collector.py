"""Deterministic ATS/PostgREST contract tests; no real postings are fabricated."""
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit
from collector.http import FetchError, Http
from collector.normalize import canonical_key, canonical_url, classify, geography, normalize, seniority
from collector.repository import Repository
from collector.run import collect, missing_patch
from collector.scoring import assess
from collector.sources import fetch_snapshot

SOURCE = dict(type='greenhouse', board='test-board', company='Fixture studio')
LEVER_SOURCE = dict(type='lever', board='xsolla', company='Xsolla')


def fixture(**changes):
    return dict(id=123, title='Game Design Intern', location={'name':'Brazil - Remote'},
                absolute_url='https://job-boards.greenhouse.io/test-board/jobs/123',
                content='<h3>Requirements</h3><p>Game design, prototyping and programming fundamentals. '
                        'Student enrollment required. We welcome people interested in learning game development.</p>',
                **changes)


def lever_fixture(**changes):
    # Controlled contract fixture, not a real vacancy.
    return {**dict(id='fixture-lever', text='Fixture QA Tester',
                   hostedUrl='https://jobs.lever.co/xsolla/fixture-lever',
                   categories={'location': 'Brazil'}), **changes}


class NormalizationTests(unittest.TestCase):
    def test_title_text_preserves_literal_brackets_and_decodes_entities(self):
        for source, raw, field in [(LEVER_SOURCE, lever_fixture(), 'text'),
                                   (SOURCE, fixture(), 'title')]:
            for supplied, expected in [('<Fixture QA Tester>', '<Fixture QA Tester>'),
                                       ('Fixture <Tools> Engineer', 'Fixture <Tools> Engineer'),
                                       ('&lt;Fixture QA Tester&gt; &amp; Tools', '<Fixture QA Tester> & Tools'),
                                       (' \tFixture\u00a0QA\n Tester \r\n', 'Fixture QA Tester')]:
                with self.subTest(source=source['type'], supplied=supplied):
                    job = normalize({**raw, field: supplied}, source)
                    self.assertEqual(job['title'], expected)

    def test_invalid_title_is_not_coerced_fabricated_or_truncated(self):
        for source, raw, field in [(LEVER_SOURCE, lever_fixture(), 'text'),
                                   (SOURCE, fixture(), 'title')]:
            for supplied in (None, '', ' \t\u00a0\r\n ', [], {}, 42, True, 'x' * 501):
                with self.subTest(source=source['type'], supplied=supplied):
                    # Alternate fields/description must not become invented titles.
                    item = {**raw, 'description': 'Fixture description', field: supplied}
                    item['title' if field == 'text' else 'text'] = 'Not the source title'
                    with self.assertRaisesRegex(ValueError, f'Invalid title: {field}'):
                        normalize(item, source)
            self.assertEqual(normalize({**raw, field: 'x' * 500}, source)['title'], 'x' * 500)

    def test_unknown_facts_are_not_estimated(self):
        job = normalize(fixture(updated_at='2026-11-13T10:00:00Z'), SOURCE)
        for field in ('posted_at','deadline_at','salary_min','salary_max','hours_per_day','weekly_hours'):
            self.assertIsNone(job[field], field)
        self.assertEqual(job['languages'], [])
        self.assertIn('Student enrollment', job['requirements'])
        self.assertNotIn('<p>', job['description'])
        tasks=fixture();tasks['content']='<h3>What you will do</h3><p>Build prototypes with the design team.</p>'
        self.assertIsNone(normalize(tasks,SOURCE)['requirements'])

    def test_identity_is_stable_and_only_trackers_removed(self):
        a='https://boards.greenhouse.io/studio/jobs/1?utm_source=feed&gh_src=abc'
        b='https://job-boards.greenhouse.io/studio/jobs/1'
        self.assertEqual(canonical_key(a), canonical_key(b))
        self.assertNotEqual(canonical_key(b), canonical_key(b+'2'))
        self.assertNotEqual(canonical_key('https://example.com/?gh_jid=1'), canonical_key('https://example.com/?gh_jid=2'))
        with self.assertRaises(ValueError): canonical_url('javascript:alert(1)')

    def test_geography_never_uses_company_boilerplate_as_eligibility(self):
        result=geography('United States', 'remote', 'We have offices in Brazil and worldwide teams.')
        self.assertEqual(result['eligibility'], 'A confirmar')
        self.assertEqual(geography('Remote worldwide', 'remote', '')['priority'], 1)
        self.assertEqual(geography('Brasil - Remoto', '', '')['priority'], 2)
        self.assertEqual(geography('Belo Horizonte - Hybrid', '', '')['priority'], 3)
        self.assertEqual(geography('São Paulo', '', '')['priority'], 4)
        self.assertEqual(geography('London', '', 'We provide visa sponsorship.')['priority'], 5)

    def test_lever_structured_salary_and_no_created_date_invention(self):
        raw=dict(id='abc', text='Junior Animator', hostedUrl='https://jobs.lever.co/studio/abc',
                 categories={'location':'Brazil', 'commitment':'Full-time'}, workplaceType='remote',
                 salaryRange={'min':100,'max':200,'currency':'BRL','interval':'month'}, createdAt=1234567)
        job=normalize(raw,dict(type='lever',board='studio',company='Fixture'))
        self.assertEqual(job['salary_min'],100)
        self.assertIsNone(job['posted_at'])
        self.assertEqual(job['contract'],'Integral')

    def test_broad_areas_and_seniority(self):
        for title,expected in [('Level Designer','Level Design'),('Narrative Writer','Narrativa'),
                ('Community Coordinator','Comunidade'),('Localization QA','Localização'),
                ('3D Modeler','Modelagem'),('VFX Artist','VFX'),('Animator','Animação'),
                ('QA Tester','QA'),('Producer','Produção'),('Social Media Intern','Marketing'),
                ('Gameplay Programmer','Programação')]:
            self.assertEqual(classify(title),expected,title)
        self.assertEqual(seniority('Trainee artist'),'Trainee')

    def test_scoring_explains_parts_and_does_not_exclude_gaps(self):
        job=normalize(fixture(),SOURCE)
        score=assess(job)
        self.assertEqual(score['score'],sum(score['score_breakdown'].values()))
        self.assertGreaterEqual(score['score'],75)
        job['requirements'] += ' C++ and Maya portfolio are required.'
        score=assess(job)
        self.assertIn('C++ profissional',score['gaps'])
        self.assertIsNotNone(score['score'])
        job['requirements']='';job['description']='No details';self.assertIsNone(assess(job)['score'])


class ReconciliationTests(unittest.TestCase):
    def test_invalid_lever_title_rejects_entire_snapshot_without_absence_checks(self):
        now = datetime.now(timezone.utc)
        for title in (' \t ', None, 'x' * 501):
            with self.subTest(title=title):
                http = Mock()
                # A detail 410 would close the absent origin if reconciliation ran.
                http.request.side_effect = [[lever_fixture(), lever_fixture(id='invalid', text=title)],
                                            FetchError('HTTP 410', 410)]
                previous = dict(external_id='absent', job_id='old', status='active',
                                missing_count=2, missing_since=(now-timedelta(days=2)).isoformat())
                repo = Mock()
                repo.origins.return_value = [previous]
                result = collect([LEVER_SOURCE], repo, http, now.isoformat())
                self.assertEqual(result['source_results'][0]['status'], 'failed')
                self.assertEqual(result['errors'][0]['category'], 'source')
                self.assertIn('Invalid title: text', result['errors'][0]['error'])
                self.assertEqual((result['seen'], result['missing'], result['closed']), (0, 0, 0))
                repo.save_seen.assert_not_called()
                self.assertEqual(http.request.call_count, 1)
                patch = repo.update_origin.call_args.args[1]
                self.assertEqual(patch['status'], 'unverified')
                self.assertNotIn('missing_count', patch)
                self.assertNotIn('missing_since', patch)
                self.assertEqual(repo.finish.call_args.args[1], 'partial')

    def test_literal_title_is_not_dropped_from_a_valid_lever_snapshot(self):
        http = Mock()
        http.request.return_value = [lever_fixture(), lever_fixture(id='brackets', text='<Fixture QA>')]
        repo = Mock()
        repo.origins.return_value = []
        result = collect([LEVER_SOURCE], repo, http)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['source_results'][0]['seen'], 2)
        self.assertEqual(repo.save_seen.call_count, 2)
        self.assertEqual(repo.save_seen.call_args.args[0]['title'], '<Fixture QA>')

    def test_closure_needs_aged_absence_and_explicit_detail_not_found(self):
        now=datetime.now(timezone.utc)
        old=dict(missing_count=1,missing_since=(now-timedelta(hours=25)).isoformat())
        for code in (None,200,403,429,500,503):
            self.assertEqual(missing_patch(old,now.isoformat(),code)['status'],'unverified')
        for code in (404,410):
            self.assertEqual(missing_patch(old,now.isoformat(),code)['status'],'closed')
            self.assertEqual(missing_patch({},now.isoformat(),code)['status'],'unverified')

    def test_failed_or_partial_snapshot_never_closes(self):
        for payload in ({'error':'unavailable'}, {'jobs':[fixture()], 'meta':{'total':5}}, {'jobs':[fixture(),fixture()]}):
            with self.subTest(payload=payload):
                http=Mock();http.request.return_value=payload
                repo=Mock();repo.start.return_value='run';repo.origins.return_value=[dict(job_id='job',status='active')]
                result=collect([SOURCE],repo,http)
                self.assertTrue(result['errors']);self.assertEqual(result['closed'],0)
                self.assertEqual(repo.update_origin.call_args.args[1]['status'],'unverified')

    def test_invalid_job_blocks_entire_snapshot_reconciliation(self):
        http=Mock();http.request.return_value={'jobs':[{'id':1}]}
        repo=Mock();repo.origins.return_value=[]
        result=collect([SOURCE],repo,http)
        self.assertTrue(result['errors']);repo.save_seen.assert_not_called()

    def test_lever_pagination_is_complete(self):
        http=Mock();http.request.side_effect=[[{'id':str(i)} for i in range(100)],[{'id':'100'}]]
        rows=fetch_snapshot(http,dict(type='lever',board='test'))
        self.assertEqual(len(rows),101)
        self.assertIn('skip=100',http.request.call_args.args[0])

    def test_reappearing_job_updates_instead_of_recreating(self):
        http=Mock();http.request.return_value={'jobs':[fixture()]}
        repo=Mock();repo.origins.return_value=[dict(external_id='123',job_id='old',status='closed')]
        result=collect([SOURCE],repo,http)
        self.assertEqual(result['updated'],1);self.assertEqual(result['new'],0)
        self.assertEqual(repo.save_seen.call_args.args[1]['job_id'],'old')

    def test_full_pipeline_closes_only_after_individual_evidence(self):
        now=datetime.now(timezone.utc)
        origin=dict(source='greenhouse',board='test-board',external_id='123',job_id='old',status='unverified',
                    missing_count=2,missing_since=(now-timedelta(days=2)).isoformat())
        http=Mock();http.request.side_effect=[{'jobs':[]},FetchError('HTTP 410',410)]
        repo=Mock();repo.origins.return_value=[origin]
        result=collect([SOURCE],repo,http,now.isoformat())
        self.assertEqual(result['closed'],1)
        self.assertEqual(repo.update_origin.call_args.args[1]['status'],'closed')
        self.assertIn('/jobs/123',http.request.call_args.args[0])

    def test_detail_checks_rotate_and_transient_errors_are_reported(self):
        now=datetime.now(timezone.utc).isoformat()
        recent=dict(external_id='recent',job_id='r',status='active',last_detail_checked_at=now)
        older=dict(external_id='older',job_id='o',status='active',last_detail_checked_at=None)
        http=Mock();http.request.side_effect=[{'jobs':[]},FetchError('HTTP 503',503),{}]
        repo=Mock();repo.origins.return_value=[recent,older]
        result=collect([SOURCE],repo,http,now)
        self.assertIn('/jobs/older',http.request.call_args_list[1].args[0])
        self.assertTrue(result['errors']);self.assertEqual(result['closed'],0)
        self.assertEqual(repo.finish.call_args.args[1],'partial')

    def test_database_failure_marks_run_failed(self):
        http=Mock();http.request.return_value={'jobs':[fixture()]}
        repo=Mock();repo.origins.return_value=[];repo.save_seen.side_effect=FetchError('HTTP 503',503)
        with self.assertRaises(FetchError):collect([SOURCE],repo,http)
        self.assertEqual(repo.finish.call_args.args[1],'failed')


class RepositoryTests(unittest.TestCase):
    def test_rest_contract_deduplicates_and_never_touches_personal_data(self):
        http=Mock();http.request.side_effect=[[{'id':'existing'}],None,None]
        repo=Repository('https://fixture.supabase.co','sb_secret_fixture',http)
        job=normalize(fixture(),SOURCE)
        self.assertEqual(repo.save_seen(job,None,'2026-11-13T00:00:00+00:00'),'existing')
        calls=http.request.call_args_list
        self.assertIn('canonical_key=',calls[0].args[0])
        self.assertNotIn('first_seen_at',calls[1].args[2])
        self.assertEqual(calls[2].args[1],'POST')
        self.assertEqual(calls[0].args[3],{'apikey':'sb_secret_fixture'})
        with self.assertRaises(ValueError):repo.request('radar_user_states')

    def test_existing_identity_preserves_first_seen_and_primary_source(self):
        http=Mock();repo=Repository('https://fixture.supabase.co','test',http)
        repo.save_seen(normalize(fixture(),SOURCE),{'job_id':'known'},'now')
        payload=http.request.call_args_list[0].args[2]
        self.assertNotIn('first_seen_at',payload)
        self.assertNotIn('source',payload)
        self.assertIsNone(payload['closed_at'])

    def test_active_duplicate_origin_prevents_closure(self):
        http=Mock();http.request.side_effect=[[{'status':'active'},{'status':'closed'}],[{'status':'active','closed_at':None}],None]
        repo=Repository('https://fixture.supabase.co','test',http);repo.aggregate(['job'],'now')
        self.assertEqual(http.request.call_args.args[2]['status'],'active')


if __name__=='__main__': unittest.main()
