import os
import sys
import unittest
import werkzeug
from datetime import date, timedelta

os.environ['TESTING'] = '1'
os.environ['DATABASE_URL'] = 'sqlite:///test_screener_saved_filters.db'
os.environ['JWT_SECRET_KEY'] = 'test-secret'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
if not hasattr(werkzeug, '__version__'):
    werkzeug.__version__ = '3'

from app import app  # noqa: E402
from models import db  # noqa: E402
from routes import normalize_screener_filters, passes_screener_filters, market_client  # noqa: E402


class ScreenerSavedFiltersTestCase(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        with app.app_context():
            db.drop_all()
            db.create_all()

    def register_and_login(self, username='tester', email='tester@example.com', password='pw1234'):
        register_response = self.client.post('/api/auth/register', json={
            'username': username,
            'email': email,
            'password': password
        })
        self.assertIn(register_response.status_code, (200, 201))
        login_response = self.client.post('/api/auth/login', json={
            'username': username,
            'password': password
        })
        self.assertEqual(login_response.status_code, 200)
        token = login_response.get_json()['access_token']
        return {'Authorization': f'Bearer {token}'}

    def test_screen_filter_serialization_roundtrip(self):
        headers = self.register_and_login()
        payload = {
            'name': 'value-momo',
            'market': 'KOSPI',
            'pages': 2,
            'limit': 20,
            'filters': {
                'rsi_min': 35,
                'rsi_max': 75,
                'valuation': {'pe_max': 22, 'pb_max': 2.8},
                'quality': {'roe_min': 8.5},
                'dividend': {'yield_min': 1.7},
                'volatility': {'vol_90d_max': 38},
                'candidate': {
                    'include_etf_candidates': True,
                    'include_pension_candidates': False,
                    'missing_policy': 'exclude'
                }
            }
        }
        save_response = self.client.post('/api/screener/screens', json=payload, headers=headers)
        self.assertIn(save_response.status_code, (200, 201))

        list_response = self.client.get('/api/screener/screens', headers=headers)
        self.assertEqual(list_response.status_code, 200)
        screens = list_response.get_json().get('screens') or []
        self.assertEqual(len(screens), 1)
        screen = screens[0]
        self.assertEqual(screen['filters']['pe_max'], 22.0)
        self.assertEqual(screen['filters']['pb_max'], 2.8)
        self.assertEqual(screen['filters']['roe_min'], 8.5)
        self.assertEqual(screen['filters']['dividend_yield_min'], 1.7)
        self.assertEqual(screen['filters']['volatility_90d_max'], 38.0)
        self.assertFalse(screen['filters']['include_pension_candidates'])
        self.assertFalse(screen['filters']['include_missing'])
        self.assertIn('PE <= 22.0', screen.get('condition_expression') or '')

    def test_filter_order_consistency(self):
        raw_a = {
            'valuation': {'pe_max': 25},
            'quality': {'roe_min': 7},
            'dividend': {'yield_min': 1},
            'volatility': {'vol_90d_max': 35},
            'candidate': {'missing_policy': 'exclude'}
        }
        raw_b = {
            'candidate': {'missing_policy': 'exclude'},
            'volatility': {'vol_90d_max': 35},
            'dividend': {'yield_min': 1},
            'quality': {'roe_min': 7},
            'valuation': {'pe_max': 25}
        }
        normalized_a = normalize_screener_filters(raw_a)
        normalized_b = normalize_screener_filters(raw_b)
        self.assertEqual(normalized_a, normalized_b)

        snapshot = {
            'pe': 20.1,
            'roe': 11.2,
            'dividend_yield': 1.2,
            'volatility_90d': 32.0,
            'rsi14': 58.0,
            'return_20d': 4.5
        }
        self.assertTrue(passes_screener_filters(snapshot, normalized_a))
        self.assertTrue(passes_screener_filters(snapshot, normalized_b))

    def test_watch_item_conversion(self):
        headers = self.register_and_login('watcher', 'watcher@example.com')
        create_response = self.client.post('/api/screener/watch-items', json={
            'account_name': '퇴직연금',
            'symbol': '069500',
            'name': 'KODEX 200',
            'exchange': 'KRX',
            'candidate_tags': ['etf_candidate', 'pension_candidate']
        }, headers=headers)
        self.assertIn(create_response.status_code, (200, 201))

        list_response = self.client.get('/api/screener/watch-items?account_name=퇴직연금', headers=headers)
        self.assertEqual(list_response.status_code, 200)
        items = list_response.get_json().get('items') or []
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['symbol'], '069500')
        self.assertIn('etf_candidate', items[0].get('candidate_tags') or [])

        delete_response = self.client.delete('/api/screener/watch-items/069500?account_name=퇴직연금', headers=headers)
        self.assertEqual(delete_response.status_code, 200)

    def test_missing_provider_data_policy(self):
        snapshot = {
            'rsi14': 54.0,
            'return_20d': 3.0,
            'pe': None,
            'roe': None
        }
        include_missing_filters = normalize_screener_filters({
            'valuation': {'pe_max': 20},
            'quality': {'roe_min': 5},
            'candidate': {'missing_policy': 'include'}
        })
        exclude_missing_filters = normalize_screener_filters({
            'valuation': {'pe_max': 20},
            'quality': {'roe_min': 5},
            'candidate': {'missing_policy': 'exclude'}
        })
        self.assertTrue(passes_screener_filters(snapshot, include_missing_filters))
        self.assertFalse(passes_screener_filters(snapshot, exclude_missing_filters))

    def test_scan_cache_and_provenance(self):
        headers = self.register_and_login('scanuser', 'scanuser@example.com')

        original_universe = market_client.get_market_universe
        original_history = market_client.get_historical_prices
        try:
            market_client.get_market_universe = lambda market, pages: [
                {'name': '테스트ETF', 'code': '069500', 'exchange': 'KOSPI', 'type': 'ETF'}
            ]

            def fake_history(_code, _start, _end):
                base = date.today() - timedelta(days=80)
                return [{'date': base + timedelta(days=index), 'price': 100 + index * 0.3} for index in range(70)]

            market_client.get_historical_prices = fake_history

            payload = {
                'market': 'KOSPI',
                'pages': 1,
                'limit': 10,
                'filters': {}
            }
            first_response = self.client.post('/api/screener/scan', json=payload, headers=headers)
            self.assertEqual(first_response.status_code, 200)
            first_body = first_response.get_json()
            self.assertIn('provenance', first_body)
            self.assertFalse(first_body.get('cache_hit'))

            second_response = self.client.post('/api/screener/scan', json=payload, headers=headers)
            self.assertEqual(second_response.status_code, 200)
            second_body = second_response.get_json()
            self.assertTrue(second_body.get('cache_hit'))
            self.assertIn('asOf', second_body.get('provenance') or {})
        finally:
            market_client.get_market_universe = original_universe
            market_client.get_historical_prices = original_history


if __name__ == '__main__':
    unittest.main()
