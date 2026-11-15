"""Regressões das referências externas do ClashTracker.

Estas verificações são executadas pelo workflow Pages existente, sem rede.
"""
from pathlib import Path
import unittest

HTML = (Path(__file__).resolve().parents[1] / "clashtracker" / "index.html").read_text(encoding="utf-8")

class ClashTrackerReferenceTests(unittest.TestCase):
    def test_sky_wagon_is_siege_machine(self):
        self.assertIn("'troop-launcher','sky-wagon']", HTML)
        self.assertIn("'Máquinas de cerco':'siege-machines'", HTML)

    def test_json_reference_uses_raw_github_instead_of_jsdelivr(self):
        self.assertIn("const RAW='https://raw.githubusercontent.com/chiefpansancolt/clash-of-clans-data/main/'", HTML)
        self.assertIn('for(const root of [RAW])', HTML)
        self.assertNotIn('cdn.jsdelivr.net/gh/chiefpansancolt', HTML)

    def test_icons_and_updated_cache(self):
        self.assertIn('src="${RAW}${encodeURI(u.icon)}"', HTML)
        self.assertIn("ct_db_v2", HTML)

if __name__ == "__main__":
    unittest.main()
