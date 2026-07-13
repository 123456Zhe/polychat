import unittest
from datetime import timedelta, timezone

from clients.chat_api import ApiError, DEFAULT_TIMEZONE, format_server_time, local_timezone, normalize_server


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


if __name__ == "__main__":
    unittest.main()
