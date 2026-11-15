"""Regressões do contrato de CORS do ClashTracker."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / "clashtracker"

class ClashTrackerCorsTests(unittest.TestCase):
    def test_worker_sets_exact_origin_once(self):
        code = (ROOT / "worker" / "cloudflare-worker.js").read_text(encoding="utf-8")
        self.assertIn("const SITE_ORIGIN = 'https://julio-andrade-nogueira.github.io'", code)
        self.assertIn("'Access-Control-Allow-Origin': SITE_ORIGIN", code)
        self.assertNotIn("'Access-Control-Allow-Origin': '*'", code)
        self.assertEqual(code.count("'Access-Control-Allow-Origin':"), 1)
        self.assertIn("headers.set(name, value)", code)
        self.assertIn("'X-ClashTracker-Worker-Version': '0.1.2'", code)

    def test_frontend_build_identifiable(self):
        code = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("V0.1.2 · VILA PRINCIPAL", code)
        self.assertIn("'troop-launcher','sky-wagon'", code)

if __name__ == "__main__":
    unittest.main()
