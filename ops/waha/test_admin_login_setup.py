import shlex
import unittest
from admin_login_setup import replace_credentials


class OwnerSetupTests(unittest.TestCase):
    def test_only_existing_keys_changed_and_shell_literals_preserved(self):
        text = '# unchanged\nLEGACY_BASE_URL=https://nutreeze.com\nLEGACY_ADMIN_EMAIL=old\nLEGACY_ADMIN_PASSWORD=old\nNEW_ADMIN_PASSWORD=keep\n'
        password = "synthetic ' $ ` ! ; space"
        updated = replace_credentials(text, 'test@example.invalid', password)
        self.assertIn('NEW_ADMIN_PASSWORD=keep\n', updated)
        self.assertIn('# unchanged\nLEGACY_BASE_URL=https://nutreeze.com\n', updated)
        line = next(x for x in updated.splitlines() if x.startswith('LEGACY_ADMIN_PASSWORD='))
        self.assertEqual(shlex.split(line.split('=', 1)[1]), [password])

    def test_ambiguous_missing_and_multiline_rejected(self):
        for text in ['', 'LEGACY_ADMIN_EMAIL=x\nLEGACY_ADMIN_EMAIL=y\nLEGACY_ADMIN_PASSWORD=z\n']:
            with self.assertRaises(ValueError):
                replace_credentials(text, 'email', 'password')
        with self.assertRaises(ValueError):
            replace_credentials('LEGACY_ADMIN_EMAIL=x\nLEGACY_ADMIN_PASSWORD=y\n', 'email', 'bad\ninput')
