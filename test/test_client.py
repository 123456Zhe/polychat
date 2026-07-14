import unittest
from datetime import timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock

from clients.chat_api import ApiError, ChatAPI, DEFAULT_TIMEZONE, format_server_time, local_timezone, normalize_server


class ServerAddressTests(unittest.TestCase):
    def test_plain_ip_uses_http_and_default_port(self):
        self.assertEqual(normalize_server("68.64.177.154"), "http://68.64.177.154:3000")

    def test_host_port_and_https_url(self):
        self.assertEqual(normalize_server("chat.example.com:8080"), "http://chat.example.com:8080")
        self.assertEqual(normalize_server("https://chat.example.com"), "https://chat.example.com")

    def test_ipv6(self):
        self.assertEqual(normalize_server("[::1]:3000"), "http://[::1]:3000")

    def test_rejects_unsupported_or_ambiguous_addresses(self):
        for value in ("", "ftp://example.com", "http://example.com/path", "example.com:99999"):
            with self.subTest(value=value), self.assertRaises(ApiError):
                normalize_server(value)


class TimezoneTests(unittest.TestCase):
    def test_utc_server_timestamp_is_converted_to_selected_timezone(self):
        utc_plus_eight = timezone(timedelta(hours=8))
        self.assertEqual(format_server_time("2026-07-13 12:30:45", utc_plus_eight), "2026-07-13 20:30:45")

    def test_aware_server_timestamp_is_supported(self):
        utc_plus_eight = timezone(timedelta(hours=8))
        self.assertEqual(format_server_time("2026-07-13T12:30:45Z", utc_plus_eight), "2026-07-13 20:30:45")

    def test_invalid_timestamp_is_left_readable(self):
        self.assertEqual(format_server_time("unknown"), "unknown")

    def test_local_timezone_is_detected_and_default_is_utc_plus_eight(self):
        self.assertIsNotNone(local_timezone())
        self.assertEqual(DEFAULT_TIMEZONE.utcoffset(None), timedelta(hours=8))


class FileAndAvatarTests(unittest.TestCase):
    def test_avatar_type_is_detected_from_content_not_filename(self):
        with TemporaryDirectory() as directory:
            avatar = Path(directory) / "avatar.unknown"
            avatar.write_bytes(b"\x89PNG\r\n\x1a\n" + b"test image data")
            api = ChatAPI()
            api.request = Mock(return_value={"user": {"id": 1, "username": "tester"}})

            api.upload_avatar(str(avatar))

            payload = api.request.call_args.args[2]
            self.assertEqual(payload["type"], "image/png")

    def test_download_is_committed_atomically(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "report.txt"
            api = ChatAPI()
            api.request_bytes = Mock(return_value=b"complete file")

            self.assertEqual(api.download(7, str(target)), str(target))
            self.assertEqual(target.read_bytes(), b"complete file")
            self.assertFalse(Path(str(target) + ".part").exists())

    def test_failed_download_removes_partial_file(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "report.txt"
            api = ChatAPI()
            api.request_bytes = Mock(side_effect=ApiError("network error"))

            with self.assertRaises(ApiError):
                api.download(7, str(target))
            self.assertFalse(target.exists())
            self.assertFalse(Path(str(target) + ".part").exists())


if __name__ == "__main__":
    unittest.main()
