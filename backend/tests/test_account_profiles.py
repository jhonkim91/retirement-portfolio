import os
import sys
import unittest
import werkzeug

os.environ['TESTING'] = '1'
os.environ['DATABASE_URL'] = 'sqlite:///test_account_profiles.db'
os.environ['JWT_SECRET_KEY'] = 'test-secret'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
if not hasattr(werkzeug, '__version__'):
    werkzeug.__version__ = '3'

from app import app  # noqa: E402
from models import AccountProfile, User, db  # noqa: E402


class AccountProfilesTestCase(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        with app.app_context():
            db.drop_all()
            db.create_all()

    def register_and_login(self, username='account_user', email='account_user@example.com', password='pw1234'):
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

    def test_accounts_endpoint_returns_status_metadata(self):
        headers = self.register_and_login()

        create_product = self.client.post('/api/products', json={
            'product_name': '기본ETF',
            'product_code': '069500',
            'purchase_price': 10000,
            'quantity': 3,
            'purchase_date': '2026-04-01',
            'asset_type': 'risk'
        }, headers=headers)
        self.assertEqual(create_product.status_code, 201)

        add_empty_account = self.client.post('/api/accounts', json={
            'account_name': '주식통장',
            'account_type': 'brokerage'
        }, headers=headers)
        self.assertIn(add_empty_account.status_code, (200, 201))

        with app.app_context():
            user = User.query.filter_by(username='account_user').first()
            self.assertIsNotNone(user)
            db.session.add(AccountProfile(
                user_id=user.id,
                account_name='??legacy',
                account_type='retirement',
                account_category='irp',
                is_default=False
            ))
            db.session.commit()

        response = self.client.get('/api/accounts', headers=headers)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        profiles = {item['account_name']: item for item in payload.get('account_profiles', [])}

        self.assertEqual(payload.get('default_account_name'), '퇴직연금')
        self.assertIn('퇴직연금', profiles)
        self.assertIn('주식통장', profiles)
        self.assertIn('??legacy', profiles)

        default_profile = profiles['퇴직연금']
        self.assertTrue(default_profile['has_data'])
        self.assertFalse(default_profile['is_empty'])
        self.assertEqual(default_profile['holding_count'], 1)
        self.assertEqual(default_profile['account_type'], 'retirement')

        empty_profile = profiles['주식통장']
        self.assertFalse(empty_profile['has_data'])
        self.assertTrue(empty_profile['is_empty'])
        self.assertEqual(empty_profile['account_type'], 'brokerage')

        legacy_profile = profiles['??legacy']
        self.assertTrue(legacy_profile['has_name_issue'])
        self.assertIn('계좌명 확인 필요', legacy_profile['display_name'])

    def test_rejects_broken_account_names_on_create_and_rename(self):
        headers = self.register_and_login('rename_user', 'rename_user@example.com')

        create_bad = self.client.post('/api/accounts', json={
            'account_name': '?????',
            'account_type': 'retirement'
        }, headers=headers)
        self.assertEqual(create_bad.status_code, 400)
        self.assertIn('깨진 문자', create_bad.get_json().get('error', ''))

        create_good = self.client.post('/api/accounts', json={
            'account_name': '정상계좌',
            'account_type': 'retirement'
        }, headers=headers)
        self.assertIn(create_good.status_code, (200, 201))

        rename_bad = self.client.put('/api/accounts/정상계좌', json={
            'account_name': '??계좌??'
        }, headers=headers)
        self.assertEqual(rename_bad.status_code, 400)
        self.assertIn('깨진 문자', rename_bad.get_json().get('error', ''))


if __name__ == '__main__':
    unittest.main()
