import io
import os
import sys
import unittest
import werkzeug

os.environ['TESTING'] = '1'
os.environ['DATABASE_URL'] = 'sqlite:///test_import_center.db'
os.environ['JWT_SECRET_KEY'] = 'test-secret'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
if not hasattr(werkzeug, '__version__'):
    werkzeug.__version__ = '3'

from app import app  # noqa: E402
from models import Product, TradeLog, db  # noqa: E402


class ImportCenterTestCase(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        with app.app_context():
            db.drop_all()
            db.create_all()

    def register_and_login(self, username='importer', email='importer@example.com', password='pw1234'):
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

    def test_import_preview_and_commit_flow(self):
        headers = self.register_and_login()
        csv_text = (
            'trade_date,product_name,product_code,trade_type,quantity,price,asset_type,notes\n'
            '2026-04-01,KODEX AI전력핵심설비,487240,buy,2,10000,risk,첫 매수\n'
            '2026-04-10,KODEX AI전력핵심설비,487240,buy,1,12000,risk,추가 매수\n'
            'bad-date,오류행,000000,buy,1,10000,risk,형식오류\n'
        )

        preview_response = self.client.post(
            '/api/imports/preview',
            headers=headers,
            data={
                'account_name': '주식 통장',
                'source_name': 'unit_test',
                'file': (io.BytesIO(csv_text.encode('utf-8')), 'sample.csv')
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(preview_response.status_code, 200)
        preview_payload = preview_response.get_json()
        self.assertTrue(preview_payload.get('batch_id'))
        self.assertEqual(preview_payload['summary']['row_count'], 3)
        self.assertEqual(preview_payload['summary']['new_count'], 2)
        self.assertEqual(preview_payload['summary']['ignored_count'], 1)

        commit_response = self.client.post(
            '/api/imports/commit',
            json={'batch_id': preview_payload['batch_id']},
            headers=headers
        )
        self.assertEqual(commit_response.status_code, 200)
        commit_payload = commit_response.get_json()
        self.assertEqual(commit_payload['batch']['imported_count'], 2)
        self.assertEqual(commit_payload['batch']['error_count'], 0)
        self.assertEqual(commit_payload['batch']['skipped_count'], 1)

        latest_recon = self.client.get('/api/reconciliation/latest?account_name=주식 통장', headers=headers)
        self.assertEqual(latest_recon.status_code, 200)
        latest_payload = latest_recon.get_json()
        self.assertIn('result', latest_payload)

        with app.app_context():
            logs = TradeLog.query.filter_by(account_name='주식 통장').all()
            self.assertEqual(len(logs), 2)
            products = Product.query.filter_by(account_name='주식 통장').all()
            self.assertEqual(len(products), 1)
            self.assertAlmostEqual(products[0].quantity, 3.0, places=4)

        conflict_csv = (
            'trade_date,product_name,product_code,trade_type,quantity,price,asset_type,notes\n'
            '2026-04-10,KODEX AI전력핵심설비,487240,buy,1,12100,risk,충돌 테스트\n'
        )
        conflict_preview = self.client.post(
            '/api/imports/preview',
            headers=headers,
            data={
                'account_name': '주식 통장',
                'source_name': 'unit_test_conflict',
                'file': (io.BytesIO(conflict_csv.encode('utf-8')), 'conflict.csv')
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(conflict_preview.status_code, 200)
        conflict_payload = conflict_preview.get_json()
        self.assertEqual(conflict_payload['summary']['conflict_count'], 1)
        first_row = (conflict_payload.get('rows') or [])[0]
        self.assertEqual(first_row.get('action'), 'conflict')
        self.assertTrue(first_row.get('conflict_with_logs'))
        self.assertTrue(first_row.get('mapping_hint'))

    def test_import_template_download(self):
        headers = self.register_and_login('template_user', 'template@example.com')
        response = self.client.get('/api/imports/template', headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/csv', response.content_type)
        disposition = response.headers.get('Content-Disposition') or ''
        self.assertIn('import-template.csv', disposition)
        body = response.get_data(as_text=True)
        self.assertIn('trade_date,product_name,product_code,trade_type', body)

    def test_selected_conflict_rows_commit(self):
        headers = self.register_and_login('conflict_user', 'conflict_user@example.com')
        seed_csv = (
            'trade_date,product_name,product_code,trade_type,quantity,price,asset_type,notes\n'
            '2026-04-01,KODEX AI전력핵심설비,487240,buy,2,10000,risk,seed\n'
        )
        seed_preview = self.client.post(
            '/api/imports/preview',
            headers=headers,
            data={
                'account_name': '주식 통장',
                'source_name': 'seed',
                'file': (io.BytesIO(seed_csv.encode('utf-8')), 'seed.csv')
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(seed_preview.status_code, 200)
        seed_batch = seed_preview.get_json().get('batch_id')
        seed_commit = self.client.post('/api/imports/commit', json={'batch_id': seed_batch}, headers=headers)
        self.assertEqual(seed_commit.status_code, 200)

        conflict_csv = (
            'trade_date,product_name,product_code,trade_type,quantity,price,asset_type,notes\n'
            '2026-04-01,KODEX AI전력핵심설비,487240,buy,3,10100,risk,conflict-target\n'
        )
        preview_response = self.client.post(
            '/api/imports/preview',
            headers=headers,
            data={
                'account_name': '주식 통장',
                'source_name': 'conflict',
                'file': (io.BytesIO(conflict_csv.encode('utf-8')), 'conflict.csv')
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(preview_response.status_code, 200)
        preview_payload = preview_response.get_json()
        self.assertEqual(preview_payload['summary']['conflict_count'], 1)
        row_index = (preview_payload.get('rows') or [])[0]['row_index']

        no_select_commit = self.client.post(
            '/api/imports/commit',
            json={'batch_id': preview_payload['batch_id']},
            headers=headers
        )
        self.assertEqual(no_select_commit.status_code, 200)
        no_select_payload = no_select_commit.get_json()
        self.assertEqual(no_select_payload['batch']['imported_count'], 0)

        preview_again = self.client.post(
            '/api/imports/preview',
            headers=headers,
            data={
                'account_name': '주식 통장',
                'source_name': 'conflict2',
                'file': (io.BytesIO(conflict_csv.encode('utf-8')), 'conflict2.csv')
            },
            content_type='multipart/form-data'
        )
        self.assertEqual(preview_again.status_code, 200)
        preview_again_payload = preview_again.get_json()
        with app.app_context():
            mapped_product = Product.query.filter_by(account_name='주식 통장', product_code='487240').first()
            mapped_product_id = mapped_product.id if mapped_product else None
        self.assertIsNotNone(mapped_product_id)

        dry_run_response = self.client.post(
            '/api/imports/dry-run',
            json={
                'batch_id': preview_again_payload['batch_id'],
                'conflict_row_indexes': [row_index],
                'row_mapping_overrides': {
                    str(row_index): mapped_product_id
                }
            },
            headers=headers
        )
        self.assertEqual(dry_run_response.status_code, 200)
        dry_run_payload = dry_run_response.get_json()
        self.assertEqual(dry_run_payload['projection']['selected_conflict_count'], 1)
        self.assertEqual(dry_run_payload['projection']['mapped_conflict_count'], 1)
        self.assertEqual(dry_run_payload['projection']['imported_count'], 1)
        self.assertTrue(dry_run_payload.get('calculated_at'))
        dry_run_signature = dry_run_payload.get('projection_signature')
        self.assertTrue(dry_run_signature)

        stale_commit = self.client.post(
            '/api/imports/commit',
            json={
                'batch_id': preview_again_payload['batch_id'],
                'conflict_row_indexes': [row_index],
                'row_mapping_overrides': {
                    str(row_index): mapped_product_id
                },
                'strict_projection_check': True,
                'expected_projection_signature': 'stale-signature'
            },
            headers=headers
        )
        self.assertEqual(stale_commit.status_code, 409)
        stale_payload = stale_commit.get_json()
        self.assertEqual(stale_payload.get('code'), 'DRY_RUN_STALE')
        self.assertTrue(stale_payload.get('current_projection_calculated_at'))

        selected_commit = self.client.post(
            '/api/imports/commit',
            json={
                'batch_id': preview_again_payload['batch_id'],
                'conflict_row_indexes': [row_index],
                'row_mapping_overrides': {
                    str(row_index): mapped_product_id
                },
                'strict_projection_check': True,
                'expected_projection_signature': dry_run_signature
            },
            headers=headers
        )
        self.assertEqual(selected_commit.status_code, 200)
        selected_payload = selected_commit.get_json()
        self.assertEqual(selected_payload['batch']['imported_count'], 1)
        self.assertTrue(selected_payload.get('projection_calculated_at'))


if __name__ == '__main__':
    unittest.main()
