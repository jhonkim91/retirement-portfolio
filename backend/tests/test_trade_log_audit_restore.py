import os
import sys
import unittest
import werkzeug

os.environ['TESTING'] = '1'
os.environ['DATABASE_URL'] = 'sqlite:///test_trade_log_audit_restore.db'
os.environ['JWT_SECRET_KEY'] = 'test-secret'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
if not hasattr(werkzeug, '__version__'):
    werkzeug.__version__ = '3'

from app import app  # noqa: E402
from models import db  # noqa: E402


class TradeLogAuditRestoreTestCase(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        with app.app_context():
            db.drop_all()
            db.create_all()

    def register_and_login(self, username='audit_restore', email='audit_restore@example.com', password='pw1234'):
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

    def _find_event(self, rows, event_type):
        return next((row for row in rows if row.get('event_type') == event_type), None)

    def test_restore_draft_for_created_updated_deleted_events(self):
        headers = self.register_and_login()

        create_response = self.client.post('/api/products', json={
            'product_name': '복원테스트ETF',
            'product_code': '069500',
            'purchase_price': 10000,
            'quantity': 10,
            'purchase_date': '2026-03-11',
            'asset_type': 'risk',
            'notes': 'first'
        }, headers=headers)
        self.assertEqual(create_response.status_code, 201)

        audit_response = self.client.get('/api/trade-logs/audit?limit=40', headers=headers)
        self.assertEqual(audit_response.status_code, 200)
        created_event = self._find_event(audit_response.get_json().get('events') or [], 'trade_created')
        self.assertIsNotNone(created_event)

        created_restore = self.client.post(
            f"/api/trade-logs/audit/{created_event['id']}/restore-draft",
            headers=headers,
            json={}
        )
        self.assertEqual(created_restore.status_code, 200)
        created_restore_payload = created_restore.get_json()
        self.assertTrue(created_restore_payload.get('can_apply_to_existing'))
        self.assertEqual(created_restore_payload.get('restore_mode'), 'trade_log')
        self.assertEqual(created_restore_payload.get('draft', {}).get('product_name'), '복원테스트ETF')
        self.assertEqual(created_restore_payload.get('appended_event', {}).get('event_type'), 'trade_restore_draft')
        created_apply = self.client.post(
            f"/api/trade-logs/audit/{created_event['id']}/restore-apply",
            headers=headers,
            json={}
        )
        self.assertEqual(created_apply.status_code, 200)
        self.assertIn(created_apply.get_json().get('action'), ('created', 'updated'))

        logs_response = self.client.get('/api/trade-logs', headers=headers)
        self.assertEqual(logs_response.status_code, 200)
        log = logs_response.get_json()[0]

        update_response = self.client.put(f"/api/trade-logs/{log['id']}", json={
            'quantity': 12,
            'price': 11000,
            'notes': 'updated'
        }, headers=headers)
        self.assertEqual(update_response.status_code, 200)

        audit_response = self.client.get('/api/trade-logs/audit?limit=80', headers=headers)
        self.assertEqual(audit_response.status_code, 200)
        updated_event = self._find_event(audit_response.get_json().get('events') or [], 'trade_updated')
        self.assertIsNotNone(updated_event)

        updated_restore = self.client.post(
            f"/api/trade-logs/audit/{updated_event['id']}/restore-draft",
            headers=headers,
            json={}
        )
        self.assertEqual(updated_restore.status_code, 200)
        updated_restore_payload = updated_restore.get_json()
        self.assertEqual(updated_restore_payload.get('restore_mode'), 'before')
        self.assertTrue(updated_restore_payload.get('can_apply_to_existing'))
        self.assertEqual(updated_restore_payload.get('draft', {}).get('quantity'), 10.0)
        updated_apply = self.client.post(
            f"/api/trade-logs/audit/{updated_restore_payload['appended_event']['id']}/restore-apply",
            headers=headers,
            json={}
        )
        self.assertEqual(updated_apply.status_code, 200)
        self.assertEqual(updated_apply.get_json().get('action'), 'updated')

        delete_response = self.client.delete(f"/api/trade-logs/{log['id']}", headers=headers)
        self.assertEqual(delete_response.status_code, 200)

        audit_response = self.client.get('/api/trade-logs/audit?limit=100', headers=headers)
        self.assertEqual(audit_response.status_code, 200)
        deleted_event = self._find_event(audit_response.get_json().get('events') or [], 'trade_deleted')
        self.assertIsNotNone(deleted_event)

        deleted_restore = self.client.post(
            f"/api/trade-logs/audit/{deleted_event['id']}/restore-draft",
            headers=headers,
            json={}
        )
        self.assertEqual(deleted_restore.status_code, 200)
        deleted_restore_payload = deleted_restore.get_json()
        self.assertEqual(deleted_restore_payload.get('restore_mode'), 'deleted')
        self.assertFalse(deleted_restore_payload.get('can_apply_to_existing'))
        self.assertIsNone(deleted_restore_payload.get('target_trade_log_id'))
        deleted_apply = self.client.post(
            f"/api/trade-logs/audit/{deleted_event['id']}/restore-apply",
            headers=headers,
            json={}
        )
        self.assertEqual(deleted_apply.status_code, 200)
        self.assertEqual(deleted_apply.get_json().get('action'), 'created')

        audit_with_chain = self.client.get('/api/trade-logs/audit?limit=120', headers=headers)
        self.assertEqual(audit_with_chain.status_code, 200)
        audit_payload = audit_with_chain.get_json()
        self.assertIn('chain_break_count', audit_payload)
        self.assertGreaterEqual(audit_payload.get('event_count', 0), 1)
        first_event = (audit_payload.get('events') or [])[0]
        self.assertIn('chain_valid', first_event)

        audit_only_restore = self.client.get('/api/trade-logs/audit?event_type=trade_restore_draft&limit=120', headers=headers)
        self.assertEqual(audit_only_restore.status_code, 200)
        restore_rows = audit_only_restore.get_json().get('events') or []
        self.assertTrue(all(row.get('event_type') == 'trade_restore_draft' for row in restore_rows))


if __name__ == '__main__':
    unittest.main()
