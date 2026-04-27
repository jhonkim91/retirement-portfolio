import os
import importlib.util
import pkgutil
import sys

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from sqlalchemy import inspect, text

from models import AccountProfile, db, Product, DEFAULT_ACCOUNT_NAME
from routes import api
from scheduler import start_scheduler

load_dotenv()

if not hasattr(pkgutil, 'get_loader'):
    def _get_loader(name):
        module = sys.modules.get(name)
        if module and getattr(module, '__loader__', None):
            return module.__loader__
        try:
            spec = importlib.util.find_spec(name)
        except ValueError:
            return None
        return spec.loader if spec else None

    pkgutil.get_loader = _get_loader

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///retirement.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'change-this-secret-key')

CORS(app, resources={
    r'/api/*': {
        'origins': '*',
        'methods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        'allow_headers': ['Content-Type', 'Authorization']
    }
})
db.init_app(app)
jwt = JWTManager(app)
app.register_blueprint(api)


def ensure_schema():
    inspector = inspect(db.engine)
    dialect = db.engine.dialect.name

    product_columns = {column['name'] for column in inspector.get_columns('products')}
    trade_columns = {column['name'] for column in inspector.get_columns('trade_logs')}
    cash_columns = {column['name'] for column in inspector.get_columns('cash_balances')}

    if 'unit_type' not in product_columns:
        db.session.execute(text("ALTER TABLE products ADD COLUMN unit_type VARCHAR(20) DEFAULT 'share' NOT NULL"))
    if 'unit_type' not in trade_columns:
        db.session.execute(text("ALTER TABLE trade_logs ADD COLUMN unit_type VARCHAR(20) DEFAULT 'share' NOT NULL"))
    if 'account_name' not in product_columns:
        db.session.execute(text(f"ALTER TABLE products ADD COLUMN account_name VARCHAR(80) DEFAULT '{DEFAULT_ACCOUNT_NAME}' NOT NULL"))
    if 'account_name' not in trade_columns:
        db.session.execute(text(f"ALTER TABLE trade_logs ADD COLUMN account_name VARCHAR(80) DEFAULT '{DEFAULT_ACCOUNT_NAME}' NOT NULL"))
    if 'account_name' not in cash_columns:
        db.session.execute(text(f"ALTER TABLE cash_balances ADD COLUMN account_name VARCHAR(80) DEFAULT '{DEFAULT_ACCOUNT_NAME}' NOT NULL"))

    if dialect == 'postgresql':
        db.session.execute(text("ALTER TABLE products ALTER COLUMN quantity TYPE DOUBLE PRECISION USING quantity::double precision"))
        db.session.execute(text("ALTER TABLE trade_logs ALTER COLUMN quantity TYPE DOUBLE PRECISION USING quantity::double precision"))
        for constraint in inspector.get_unique_constraints('cash_balances'):
            if constraint.get('column_names') == ['user_id']:
                name = constraint['name'].replace('"', '""')
                db.session.execute(text(f'ALTER TABLE cash_balances DROP CONSTRAINT IF EXISTS "{name}"'))
        db.session.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_balance_user_account ON cash_balances (user_id, account_name)"))
    elif dialect == 'sqlite':
        unique_user_only = any(
            constraint.get('column_names') == ['user_id']
            for constraint in inspector.get_unique_constraints('cash_balances')
        )
        if unique_user_only:
            db.session.execute(text("PRAGMA foreign_keys=OFF"))
            db.session.execute(text("ALTER TABLE cash_balances RENAME TO cash_balances_old"))
            db.session.execute(text(f"""
                CREATE TABLE cash_balances (
                    id INTEGER NOT NULL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    account_name VARCHAR(80) NOT NULL DEFAULT '{DEFAULT_ACCOUNT_NAME}',
                    amount FLOAT NOT NULL DEFAULT 0,
                    updated_at DATETIME,
                    FOREIGN KEY(user_id) REFERENCES users (id),
                    CONSTRAINT uq_cash_balance_user_account UNIQUE (user_id, account_name)
                )
            """))
            db.session.execute(text(f"""
                INSERT INTO cash_balances (id, user_id, account_name, amount, updated_at)
                SELECT id, user_id, COALESCE(account_name, '{DEFAULT_ACCOUNT_NAME}'), amount, updated_at
                FROM cash_balances_old
            """))
            db.session.execute(text("DROP TABLE cash_balances_old"))
            db.session.execute(text("PRAGMA foreign_keys=ON"))

    db.session.execute(text(f"UPDATE products SET account_name = '{DEFAULT_ACCOUNT_NAME}' WHERE account_name IS NULL OR account_name = ''"))
    db.session.execute(text(f"UPDATE trade_logs SET account_name = '{DEFAULT_ACCOUNT_NAME}' WHERE account_name IS NULL OR account_name = ''"))
    db.session.execute(text(f"UPDATE cash_balances SET account_name = '{DEFAULT_ACCOUNT_NAME}' WHERE account_name IS NULL OR account_name = ''"))
    db.session.execute(text(f"""
        UPDATE trade_logs
        SET account_name = COALESCE((
            SELECT products.account_name
            FROM products
            WHERE products.id = trade_logs.product_id
        ), '{DEFAULT_ACCOUNT_NAME}')
        WHERE product_id IS NOT NULL
    """))

    db.session.execute(text("""
        UPDATE products
        SET unit_type = 'unit'
        WHERE length(product_code) = 12
          AND (upper(product_code) LIKE 'K%' OR upper(product_code) LIKE 'KR%')
          AND (unit_type IS NULL OR unit_type = 'share')
    """))
    db.session.execute(text("""
        UPDATE trade_logs
        SET unit_type = 'unit',
            total_amount = quantity * price / 1000
        WHERE trade_type IN ('buy', 'sell')
          AND product_id IN (
              SELECT id
              FROM products
              WHERE length(product_code) = 12
                AND (upper(product_code) LIKE 'K%' OR upper(product_code) LIKE 'KR%')
          )
    """))

    for product in Product.query.all():
        code = str(product.product_code or '').strip().upper()
        if len(code) % 2 != 0:
            continue
        half = code[:len(code) // 2]
        if half != code[len(code) // 2:]:
            continue
        if len(half) == 6 or len(half) == 12:
            product.product_code = half

    existing_profiles = {
        (profile.user_id, profile.account_name): profile
        for profile in AccountProfile.query.all()
    }

    discovered_accounts = db.session.execute(text(f"""
        SELECT user_id, account_name FROM products WHERE account_name IS NOT NULL AND account_name <> ''
        UNION
        SELECT user_id, account_name FROM trade_logs WHERE account_name IS NOT NULL AND account_name <> ''
        UNION
        SELECT user_id, account_name FROM cash_balances WHERE account_name IS NOT NULL AND account_name <> ''
    """)).fetchall()

    for row in discovered_accounts:
        account_name = (row.account_name or DEFAULT_ACCOUNT_NAME).strip() or DEFAULT_ACCOUNT_NAME
        key = (row.user_id, account_name)
        if key in existing_profiles:
            continue

        inferred_type = 'brokerage' if ('주식' in account_name or 'stock' in account_name.lower()) else 'retirement'
        db.session.add(AccountProfile(
            user_id=row.user_id,
            account_name=account_name,
            account_type=inferred_type
        ))

    db.session.commit()


@app.errorhandler(404)
def not_found(error):
    return {'error': '요청한 리소스를 찾을 수 없습니다.'}, 404


@app.errorhandler(500)
def server_error(error):
    return {'error': '서버 오류가 발생했습니다.'}, 500


with app.app_context():
    db.create_all()
    ensure_schema()

scheduler = start_scheduler(app)

if __name__ == '__main__':
    print('퇴직연금 관리대장 서버가 시작되었습니다.')
    print('PC: http://localhost:5000')
    print('휴대폰: 같은 와이파이에서 http://PC_IP:5000')
    app.run(debug=False, host='0.0.0.0', port=5000, use_reloader=False)
