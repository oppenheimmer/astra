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

    def test_the_python_version_is_declared_once_and_pins_the_runtime(self):
        """Vercel reads the version from pyproject.toml, .python-version or Pipfile.lock.

        With none of them the serverless runtime silently falls back to an older
        interpreter while the build log still reports the newer one, so removing
        the declaration changes what production runs without failing anything.
        There is no project-level setting to pin it instead.

        It is declared in pyproject.toml alone. Nothing else may name a Python
        version: uv takes the interpreter from requires-python, so a literal in a
        workflow could disagree with the deployed runtime and still look correct.
        """
        pyproject = (astra.ROOT / 'pyproject.toml').read_text()
        pinned = re.search(r'requires-python\s*=\s*"([^"]+)"', pyproject)
        self.assertIsNotNone(pinned, 'pyproject.toml must declare requires-python')
        self.assertEqual(pinned.group(1), '==3.14.*')
        self.assertFalse((astra.ROOT / '.python-version').exists(),
                         'the version lives in pyproject.toml; a second copy can disagree with it')
        for workflow in (astra.ROOT / '.github/workflows').glob('*.yml'):
            self.assertNotIn('python-version:', workflow.read_text(),
                             f'{workflow.name} names a Python version instead of taking it from pyproject.toml')

    def test_the_python_dependencies_are_declared_once(self):
        """requirements.txt used to carry these, and a second list drifts from the first."""
        for stale in ('requirements.txt', 'requirements-dev.txt'):
            self.assertFalse((astra.ROOT / stale).exists(), f'{stale} duplicates pyproject.toml')
        pyproject = (astra.ROOT / 'pyproject.toml').read_text()
        for package in ('fastapi', 'uvicorn', 'requests', 'numpy', 'Pillow'):
            self.assertIn(package, pyproject, f'{package} is imported by the server but not declared')

    def test_object_storage_is_one_bucket_named_consistently_everywhere(self):
        """The bucket, the Worker binding and the URL the browser reads must agree.

        These live in three languages and no build step connects them, so a
        rename that misses one leaves the page reading an address nothing
        publishes to. The data moved off the earth project's bucket, whose token
        cannot write here, so a leftover reference is a silent write failure.
        """
        sync = (astra.ROOT / 'scripts/sync_satellites.sh').read_text()
        wrangler = (astra.ROOT / 'worker/wrangler.toml').read_text()
        api = (astra.ROOT / 'src/api.ts').read_text()

        bucket = re.search(r'BUCKET="\$\{R2_BUCKET:-([\w-]+)\}"', sync).group(1)
        self.assertEqual(bucket, 'sky-data')
        self.assertEqual(re.search(r'bucket_name\s*=\s*"([\w-]+)"', wrangler).group(1), bucket)
        self.assertEqual(re.search(r'^name\s*=\s*"([\w-]+)"', wrangler, re.M).group(1), bucket,
                         'the Worker is named after its bucket, and the URL depends on that name')

        url = re.search(r'SATELLITE_DATA_URL\s*=\s*\n?\s*"([^"]+)"', api).group(1)
        self.assertTrue(url.startswith(f'https://{bucket}.'), f'{url} does not address the {bucket} Worker')
        self.assertTrue(url.endswith('/satellites.json'), 'the object sits at the bucket root')

        for path in ('scripts/sync_satellites.sh', 'src/api.ts', 'worker/wrangler.toml',
                     'worker/index.js', '.github/workflows/refresh-satellites.yml'):
            self.assertNotIn('earth-data', (astra.ROOT / path).read_text(),
                             f'{path} still points at the earth project bucket')

    def test_the_bundle_keeps_the_backend_and_drops_the_frontend(self):
        excluded = self.config['functions']['api/index.py']['excludeFiles']
        directories = set(re.search(r'\{(.+?)\}', excluded).group(1).split(','))
        self.assertLessEqual({'node_modules', 'dist', 'src', 'tests'}, directories)
        self.assertNotIn('astra', directories)
        self.assertNotIn('public', directories)


if __name__ == '__main__':
    unittest.main()
