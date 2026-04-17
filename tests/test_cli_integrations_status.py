"""Tests for `worca integrations status` CLI subcommand."""

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from unittest.mock import patch

import pytest

from worca.cli.main import create_parser, main


class TestIntegrationsStatusParser:
    def test_integrations_status_parsed(self):
        parser = create_parser()
        args = parser.parse_args(["integrations", "status"])
        assert args.command == "integrations"
        assert args.integrations_command == "status"

    def test_integrations_status_default_url(self):
        parser = create_parser()
        args = parser.parse_args(["integrations", "status"])
        assert not hasattr(args, "url") or args.url is None


class TestIntegrationsStatusCommand:
    """Tests using a real local HTTP server on a random port."""

    def _start_server(self, response_body, status_code=200):
        body = json.dumps(response_body).encode()

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(status_code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass  # suppress output

        server = HTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]
        t = Thread(target=server.handle_request, daemon=True)
        t.start()
        return server, port

    def test_shows_enabled_false(self, capsys):
        server, port = self._start_server({"enabled": False})
        url = f"http://127.0.0.1:{port}"
        with patch.dict(os.environ, {"WORCA_UI_URL": url}):
            main(["integrations", "status"])
        captured = capsys.readouterr()
        assert "enabled" in captured.out.lower() or "false" in captured.out.lower()
        server.server_close()

    def test_shows_adapters_table(self, capsys):
        server, port = self._start_server(
            {
                "enabled": True,
                "strict_inbox_verification": False,
                "secrets_configured": 1,
                "adapters": [
                    {
                        "name": "telegram",
                        "enabled": True,
                        "connected": True,
                        "dropped_messages": 0,
                        "invalid_signature_events": 0,
                        "last_event_at": None,
                    }
                ],
                "chats": [],
            }
        )
        url = f"http://127.0.0.1:{port}"
        with patch.dict(os.environ, {"WORCA_UI_URL": url}):
            main(["integrations", "status"])
        captured = capsys.readouterr()
        assert "telegram" in captured.out

    def test_uses_worca_ui_url_env(self, capsys):
        server, port = self._start_server({"enabled": False})
        url = f"http://127.0.0.1:{port}"
        with patch.dict(os.environ, {"WORCA_UI_URL": url}):
            main(["integrations", "status"])
        captured = capsys.readouterr()
        assert captured.out  # produced some output

    def test_clean_error_when_ui_not_running(self, capsys):
        with patch.dict(os.environ, {"WORCA_UI_URL": "http://127.0.0.1:19999"}):
            with pytest.raises(SystemExit) as exc_info:
                main(["integrations", "status"])
        assert exc_info.value.code != 0
        captured = capsys.readouterr()
        assert "error" in captured.err.lower() or "error" in captured.out.lower()

    def test_shows_chats_when_present(self, capsys):
        server, port = self._start_server(
            {
                "enabled": True,
                "adapters": [],
                "chats": [
                    {
                        "platform": "telegram",
                        "chat_id": "123***789",
                        "active_project": "worca-cc",
                        "muted_until": None,
                        "muted_messages": 0,
                    }
                ],
            }
        )
        url = f"http://127.0.0.1:{port}"
        with patch.dict(os.environ, {"WORCA_UI_URL": url}):
            main(["integrations", "status"])
        captured = capsys.readouterr()
        assert "telegram" in captured.out
        assert "worca-cc" in captured.out
