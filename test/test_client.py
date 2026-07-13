import unittest

from clients.chat_api import ApiError, normalize_server


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


if __name__ == "__main__":
    unittest.main()
