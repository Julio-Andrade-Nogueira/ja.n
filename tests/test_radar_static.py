"""Checks for the static site as served from the /ja.n/ project prefix."""
import re
import base64
import json
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'painel' / 'radar.html'
PUBLIC_URL = 'https://julio-andrade-nogueira.github.io/ja.n/painel/radar.html'


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.resources = []
        self.links = []
        self.ids = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.resources.append(attrs['href'])
        if tag == 'script' and 'src' in attrs:
            self.resources.append(attrs['src'])
        if tag == 'a' and 'href' in attrs:
            self.links.append(attrs['href'])


class RadarStaticTests(unittest.TestCase):
    def setUp(self):
        self.html = PAGE.read_text(encoding='utf-8')
        self.refs = References()
        self.refs.feed(self.html)

    def assert_published_file(self, ref):
        url = urlsplit(urljoin(PUBLIC_URL, ref))
        self.assertEqual(url.netloc, urlsplit(PUBLIC_URL).netloc, ref)
        self.assertTrue(url.path.startswith('/ja.n/'), ref)
        target = ROOT / unquote(url.path.removeprefix('/ja.n/'))
        self.assertTrue(target.is_file(), f'{ref} → {target}')
        self.assertGreater(target.stat().st_size, 0, ref)

    def test_assets_resolve_under_project_prefix(self):
        self.assertEqual(self.refs.resources, [
            'radar-assets/styles.css',
            'radar-assets/config.js',
            'radar-assets/supabase-client.js',
            'radar-assets/sync.js',
            'radar-assets/app.js',
        ])
        for ref in self.refs.resources:
            with self.subTest(ref=ref):
                self.assert_published_file(ref)

    def test_links_do_not_target_missing_main_panel(self):
        for ref in self.refs.links:
            if not ref.startswith('#'):
                self.assert_published_file(ref)
        self.assertNotIn('href="../painel.html"', self.html)
        self.assertIn('O painel principal ja.n será restaurado separadamente.', self.html)

    def test_no_external_styles_or_scripts(self):
        css = (PAGE.parent / 'radar-assets/styles.css').read_text(encoding='utf-8')
        self.assertNotRegex(css, r'@import|url\s*\(')
        for ref in self.refs.resources:
            self.assertFalse(urlsplit(ref).scheme, ref)

    def test_only_public_configuration_and_separate_collection_workflow(self):
        config = (PAGE.parent / 'radar-assets/config.js').read_text(encoding='utf-8')
        key = re.search(r'supabasePublishableKey:\s*["\']([^"\']*)', config).group(1)
        if key and not key.startswith('sb_publishable_'):
            payload = key.split('.')[1]
            self.assertEqual(json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))['role'], 'anon')
        self.assertNotIn('supabase.min.js', self.html)
        self.assertTrue((ROOT / '.github/workflows/gamejobs-sync.yml').is_file())

    def test_root_redirect_is_relative(self):
        index = (ROOT / 'index.html').read_text()
        self.assertIn('content="0;url=painel/radar.html"', index)
        self.assertIn('href="painel/radar.html"', index)
        self.assert_published_file('../index.html')

    def test_script_dom_references_exist(self):
        app = (PAGE.parent / 'radar-assets/app.js').read_text(encoding='utf-8')
        # The drawer and settings modal create these elements at runtime.
        dynamic_ids = set(re.findall(r'id="([\w-]+)"', app))
        referenced_ids = set(re.findall(r"\$\('([\w-]+)'\)", app))
        self.assertEqual(len(self.refs.ids), len(set(self.refs.ids)), 'Duplicate HTML ids')
        self.assertFalse(referenced_ids - set(self.refs.ids) - dynamic_ids)


if __name__ == '__main__':
    unittest.main()
