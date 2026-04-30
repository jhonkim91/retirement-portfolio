import os
import sys
import unittest
import werkzeug

os.environ['TESTING'] = '1'
os.environ['DATABASE_URL'] = 'sqlite:///test_journal_calendar.db'
os.environ['JWT_SECRET_KEY'] = 'test-secret'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
if not hasattr(werkzeug, '__version__'):
    werkzeug.__version__ = '3'

from app import app  # noqa: E402
from models import db  # noqa: E402


class JournalCalendarTestCase(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        with app.app_context():
            db.drop_all()
            db.create_all()

    def register_and_login(self, username, email, password='pw1234'):
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

    def create_trade_log(self, headers, product_name='테스트ETF', trade_date='2026-01-02'):
        create_response = self.client.post('/api/products', json={
            'product_name': product_name,
            'product_code': '069500',
            'purchase_price': 10000,
            'quantity': 10,
            'purchase_date': trade_date,
            'asset_type': 'risk'
        }, headers=headers)
        self.assertEqual(create_response.status_code, 201)
        logs_response = self.client.get('/api/trade-logs', headers=headers)
        self.assertEqual(logs_response.status_code, 200)
        return logs_response.get_json()[0]

    def test_trade_linked_journal_crud(self):
        headers = self.register_and_login('owner', 'owner@example.com')
        log = self.create_trade_log(headers)

        create_journal = self.client.post('/api/trade-journals', json={
            'thesis': '실적 모멘텀과 수급 개선',
            'trigger': '실적 가이던스 상향',
            'invalidation': '매출 성장률 둔화',
            'targetHorizon': '3m',
            'tags': ['growth', 'earnings'],
            'confidence': 74,
            'attachedTradeId': log['id'],
            'attachedSymbol': '069500',
            'screenshotsOrLinks': ['https://example.com/chart'],
            'entry_date': '2026-01-02'
        }, headers=headers)
        self.assertEqual(create_journal.status_code, 201)
        journal_id = create_journal.get_json()['journal']['id']

        update_journal = self.client.put(f'/api/trade-journals/{journal_id}', json={
            'thesis': '리밸런싱 후 재진입',
            'tags': ['rebalance'],
            'confidence': 62
        }, headers=headers)
        self.assertEqual(update_journal.status_code, 200)
        self.assertEqual(update_journal.get_json()['journal']['thesis'], '리밸런싱 후 재진입')

        delete_journal = self.client.delete(f'/api/trade-journals/{journal_id}', headers=headers)
        self.assertEqual(delete_journal.status_code, 200)

    def test_journal_tag_and_date_filters(self):
        headers = self.register_and_login('tagger', 'tagger@example.com')
        log = self.create_trade_log(headers)

        self.client.post('/api/trade-journals', json={
            'thesis': '단기 이벤트',
            'tags': ['alpha', 'swing'],
            'attachedTradeId': log['id'],
            'entry_date': '2026-01-03'
        }, headers=headers)
        self.client.post('/api/trade-journals', json={
            'thesis': '중기 이벤트',
            'tags': ['beta'],
            'attachedTradeId': log['id'],
            'entry_date': '2026-02-10'
        }, headers=headers)

        by_tag = self.client.get('/api/trade-journals?tag=alpha', headers=headers)
        self.assertEqual(by_tag.status_code, 200)
        self.assertEqual(by_tag.get_json()['count'], 1)

        by_date = self.client.get('/api/trade-journals?date_from=2026-02-01&date_to=2026-02-28', headers=headers)
        self.assertEqual(by_date.status_code, 200)
        self.assertEqual(by_date.get_json()['count'], 1)

    def test_calendar_event_dedup_and_sort(self):
        headers = self.register_and_login('cal', 'cal@example.com')
        self.create_trade_log(headers)

        payload_a = {
            'event_type': 'custom',
            'event_date': '2026-01-05',
            'title': 'A 이벤트',
            'description': 'alpha'
        }
        payload_b = {
            'event_type': 'custom',
            'event_date': '2026-02-10',
            'title': 'B 이벤트',
            'description': 'beta'
        }
        duplicate_a = {
            'event_type': 'custom',
            'event_date': '2026-01-05',
            'title': 'A 이벤트',
            'description': 'duplicate'
        }
        self.assertEqual(self.client.post('/api/calendar/events', json=payload_a, headers=headers).status_code, 201)
        self.assertEqual(self.client.post('/api/calendar/events', json=payload_b, headers=headers).status_code, 201)
        self.assertEqual(self.client.post('/api/calendar/events', json=duplicate_a, headers=headers).status_code, 201)

        response = self.client.get(
            '/api/calendar/events?event_type=custom&start_date=2026-01-01&end_date=2026-12-31',
            headers=headers
        )
        self.assertEqual(response.status_code, 200)
        rows = response.get_json()['events']
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['event_date'], '2026-01-05')
        self.assertEqual(rows[1]['event_date'], '2026-02-10')


if __name__ == '__main__':
    unittest.main()
