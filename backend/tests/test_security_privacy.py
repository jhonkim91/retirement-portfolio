import os
import sys
import unittest
import werkzeug

os.environ['TESTING'] = '1'
os.environ['DATABASE_URL'] = 'sqlite:///test_security_privacy.db'
os.environ['JWT_SECRET_KEY'] = 'test-secret'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
if not hasattr(werkzeug, '__version__'):
    werkzeug.__version__ = '3'

from app import app  # noqa: E402
from models import DataDeletionRequest, Product, User, db  # noqa: E402


class SecurityPrivacyTestCase(unittest.TestCase):
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

    def test_blocks_cross_user_portfolio_access(self):
        owner_headers = self.register_and_login('owner', 'owner@example.com')
        intruder_headers = self.register_and_login('intruder', 'intruder@example.com')

        create_response = self.client.post('/api/products', json={
            'product_name': '테스트ETF',
            'product_code': '069500',
            'purchase_price': 10000,
            'quantity': 10,
            'purchase_date': '2026-01-02',
            'asset_type': 'risk'
        }, headers=owner_headers)
        self.assertEqual(create_response.status_code, 201)
        product_id = create_response.get_json()['product']['id']

        denied_response = self.client.put(f'/api/products/{product_id}', json={
            'product_name': '해킹시도'
        }, headers=intruder_headers)
        self.assertEqual(denied_response.status_code, 403)

    def test_soft_and_hard_delete_policy(self):
        headers = self.register_and_login('deleter', 'deleter@example.com')

        soft_req = self.client.post('/api/privacy/deletion-requests', json={
            'mode': 'soft',
            'reason': '테스트 soft delete'
        }, headers=headers)
        self.assertEqual(soft_req.status_code, 201)
        soft_id = soft_req.get_json()['request']['id']

        soft_exec = self.client.post(f'/api/privacy/deletion-requests/{soft_id}/execute', headers=headers)
        self.assertEqual(soft_exec.status_code, 200)

        with app.app_context():
            user = User.query.filter(User.username.like('deleted_%')).first()
            self.assertIsNotNone(user)
            self.assertTrue(user.is_deleted)

        headers_hard = self.register_and_login('deleter2', 'deleter2@example.com')
        create_response = self.client.post('/api/products', json={
            'product_name': '삭제대상',
            'product_code': '069500',
            'purchase_price': 10000,
            'quantity': 5,
            'purchase_date': '2026-01-02',
            'asset_type': 'risk'
        }, headers=headers_hard)
        self.assertEqual(create_response.status_code, 201)

        hard_req = self.client.post('/api/privacy/deletion-requests', json={
            'mode': 'hard',
            'reason': '테스트 hard delete'
        }, headers=headers_hard)
        self.assertEqual(hard_req.status_code, 201)
        hard_id = hard_req.get_json()['request']['id']

        hard_exec = self.client.post(f'/api/privacy/deletion-requests/{hard_id}/execute', headers=headers_hard)
        self.assertEqual(hard_exec.status_code, 200)

        with app.app_context():
            hard_request = DataDeletionRequest.query.filter_by(id=hard_id).first()
            self.assertIsNone(hard_request)
            remaining = Product.query.filter(Product.product_name == '삭제대상').first()
            self.assertIsNone(remaining)


if __name__ == '__main__':
    unittest.main()
