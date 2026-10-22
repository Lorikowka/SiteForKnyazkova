"""Access-control regressions, runnable without network or bot SDKs.

Compile the actual guard/startup functions in isolation to avoid initializing
tokens, HTTP clients, polling, or local state during the test.
"""
import __future__
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load_functions(relative_path, names, settings):
    source = (ROOT / relative_path).read_text(encoding="utf-8-sig")
    tree = ast.parse(source, filename=relative_path)
    compile(tree, relative_path, "exec")  # Check the complete module's syntax.
    isolated = ast.Module(
        body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names],
        type_ignores=[],
    )
    namespace = {"SETTINGS": settings}
    exec(compile(isolated, relative_path, "exec", flags=__future__.annotations.compiler_flag), namespace)
    return namespace


class BotAccessTests(unittest.TestCase):
    def test_telegram_missing_administrator_denies_everyone(self):
        for admin_id in [0, -1]:
            guard = load_functions("telegram-bot/bot.py", {"is_admin"}, SimpleNamespace(admin_id=admin_id))["is_admin"]
            for user_id in [None, 0, 123, -1]:
                self.assertFalse(guard(user_id))

    def test_telegram_only_configured_user_is_allowed(self):
        guard = load_functions("telegram-bot/bot.py", {"is_admin"}, SimpleNamespace(admin_id=123))["is_admin"]
        self.assertTrue(guard(123))
        self.assertFalse(guard(456))
        self.assertFalse(guard(None))

    def test_telegram_startup_fails_without_administrator(self):
        main = load_functions("telegram-bot/bot.py", {"main"}, SimpleNamespace(bot_token="test", admin_id=0, api_key="test"))["main"]
        with self.assertRaisesRegex(RuntimeError, "TELEGRAM_ADMIN_ID"):
            main()

    def test_telegram_startup_fails_without_backend_key(self):
        main = load_functions("telegram-bot/bot.py", {"main"}, SimpleNamespace(bot_token="test", admin_id=1, api_key=""))["main"]
        with self.assertRaisesRegex(RuntimeError, "BOT_API_KEY"):
            main()

    def test_vk_missing_administrators_denies_everyone(self):
        guard = load_functions("vk-bot/bot.py", {"is_admin"}, SimpleNamespace(admin_ids=[]))["is_admin"]
        self.assertFalse(guard(123))
        self.assertFalse(guard(0))

    def test_vk_only_configured_users_are_allowed(self):
        guard = load_functions("vk-bot/bot.py", {"is_admin"}, SimpleNamespace(admin_ids=[123, 456]))["is_admin"]
        self.assertTrue(guard(123))
        self.assertTrue(guard(456))
        self.assertFalse(guard(789))
        self.assertFalse(guard(0))

    def test_vk_startup_fails_without_administrators(self):
        build = load_functions("vk-bot/bot.py", {"build_bot"}, SimpleNamespace(vk_token="test", vk_group_id=1, admin_ids=[], api_key="test"))["build_bot"]
        with self.assertRaisesRegex(RuntimeError, "VK_ADMIN_IDS"):
            build()

    def test_vk_startup_fails_without_backend_key(self):
        build = load_functions("vk-bot/bot.py", {"build_bot"}, SimpleNamespace(vk_token="test", vk_group_id=1, admin_ids=[1], api_key=""))["build_bot"]
        with self.assertRaisesRegex(RuntimeError, "BOT_API_KEY"):
            build()


if __name__ == "__main__":
    unittest.main()
