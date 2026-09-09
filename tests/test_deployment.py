"""The Vercel contract: what the function bundle needs at runtime and how requests reach it.

The serverless bundle contains no `public/` or `dist/` directory, so anything the
server reads at import time must be copied in by the build command. These checks
fail in CI rather than as a 500 on a cold start.
"""
import json
import re
import unittest

import astra
from astra import satellites


class VercelConfiguration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = json.loads((astra.ROOT / 'vercel.json').read_text())
        cls.entry = astra.ROOT / 'api/index.py'

    def rewrites(self):
        return {r['source']: r['destination'] for r in self.config['rewrites']}

    def test_every_api_path_is_rewritten_to_the_function_or_a_static_file(self):
        rewrites = self.config['rewrites']
        self.assertEqual(rewrites[-1], {'source': '/api/(.*)', 'destination': '/api/index'},
                         'the catch-all must be last so earlier, more specific rules win')
        self.assertEqual(self.rewrites()['/api/stars/overview'], '/data/gaia-overview.json.gz')
        self.assertTrue(self.entry.is_file())
        self.assertIn('create_app(static_dir=None)', self.entry.read_text(),
                      'Vercel serves dist/ itself; the function must not mount it')

    def test_the_overview_rewrite_target_is_served_as_gzipped_json(self):
        wanted = {'Content-Encoding': 'gzip', 'Content-Type': 'application/json'}
        for source in ('/api/stars/overview', '/data/gaia-overview.json.gz'):
            headers = next(h['headers'] for h in self.config['headers'] if h['source'] == source)
            self.assertLessEqual(wanted.items(), {h['key']: h['value'] for h in headers}.items())

    def test_the_build_copies_every_snapshot_the_server_opens_at_import(self):
        command = self.config['buildCommand']
        target = re.search(r'mkdir -p (\S+)', command).group(1)
        self.assertEqual(astra.ROOT / target, astra.BUNDLED)
        for feed in satellites.FEEDS:
            name = feed.path.name
            self.assertIn(f'public/data/{name}', command, f'{name} is read at import but never copied')
            self.assertTrue((astra.DATA / name).is_file())

    def test_the_python_version_is_pinned_to_the_one_used_everywhere_else(self):
        """Vercel reads only .python-version, pyproject.toml or Pipfile.lock.

        With none of them the serverless runtime silently falls back to 3.12
        while the build still reports 3.14, so removing this file changes what
        production runs without failing anything. There is no project-level
        setting to pin it instead.
        """
        pin = (astra.ROOT / '.python-version').read_text().strip()
        self.assertEqual(pin, '3.14')
        workflows = (astra.ROOT / '.github/workflows').glob('*.yml')
        used = {pin}
        for workflow in workflows:
            used.update(re.findall(r'python-version:\s*"([^"]+)"', workflow.read_text()))
        self.assertEqual(used, {'3.14'}, 'local, CI and deploy must agree on one version')

    def test_the_bundle_keeps_the_backend_and_drops_the_frontend(self):
        excluded = self.config['functions']['api/index.py']['excludeFiles']
        directories = set(re.search(r'\{(.+?)\}', excluded).group(1).split(','))
        self.assertLessEqual({'node_modules', 'dist', 'src', 'tests'}, directories)
        self.assertNotIn('astra', directories)
        self.assertNotIn('public', directories)


if __name__ == '__main__':
    unittest.main()
