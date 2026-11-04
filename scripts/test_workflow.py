"""Guard release trigger/permission boundaries without invoking GitHub."""
from pathlib import Path
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/ci.yml'

class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()
        self.release = self.text.split('  release:\n', 1)[1]

    def test_only_successful_main_push_can_publish(self):
        self.assertIn("if: github.event_name == 'push' && github.ref == 'refs/heads/main'", self.release)
        self.assertIn('    needs: package\n', self.release)
        self.assertIn('    needs: [unit, browser]\n', self.text)
        self.assertNotIn('tags:', self.text)
        self.assertNotIn('always()', self.release)

    def test_write_permission_is_restricted_to_release(self):
        self.assertEqual(self.text.count('contents: write'), 1)
        self.assertIn('permissions:\n  contents: read\n', self.text)
        self.assertIn('contents: write', self.release)
        self.assertIn('persist-credentials: false', self.release)
        self.assertNotIn('pull_request_target:', self.text)

    def test_each_main_run_survives_new_merges(self):
        self.assertIn("github.event_name == 'pull_request' && github.ref || github.run_id", self.text)
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", self.text)

    def test_exact_artifact_is_built_and_downloaded(self):
        self.assertIn('python3 scripts/package.py --release-run "$RELEASE_RUN" --sha "$SOURCE_SHA"', self.text)
        self.assertIn('SOURCE_SHA: ${{ github.sha }}', self.text)
        self.assertEqual(self.text.count('name: floating-video-toolkit\n'), 2)
        self.assertIn('python3 scripts/publish-release.py', self.release)
        self.assertIn("python3 -m unittest discover -s scripts -p 'test_*.py' -v", self.text)

if __name__ == '__main__':
    unittest.main()
