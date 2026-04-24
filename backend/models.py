from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()
DEFAULT_ACCOUNT_NAME = '퇴직연금'

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 관계 설정
    portfolios = db.relationship('Product', backref='user', lazy=True, cascade='all, delete-orphan')
    trade_logs = db.relationship('TradeLog', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'created_at': self.created_at.isoformat()
        }

class Product(db.Model):
    __tablename__ = 'products'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    product_name = db.Column(db.String(255), nullable=False)
    product_code = db.Column(db.String(50), nullable=False)
    purchase_price = db.Column(db.Float, nullable=False)
    quantity = db.Column(db.Float, nullable=False)
    unit_type = db.Column(db.String(20), nullable=False, default='share')  # 'share' or 'unit'
    purchase_date = db.Column(db.Date, nullable=False)
    asset_type = db.Column(db.String(20), nullable=False)  # 'risk' 또는 'safe'
    status = db.Column(db.String(20), default='holding')  # 'holding' 또는 'sold'
    current_price = db.Column(db.Float, default=0)
    sale_date = db.Column(db.Date, nullable=True)
    sale_price = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    price_histories = db.relationship('PriceHistory', backref='product', lazy=True, cascade='all, delete-orphan')

    @staticmethod
    def amount_for(quantity, price, unit_type='share'):
        multiplier = 0.001 if unit_type == 'unit' else 1
        return float(quantity or 0) * float(price or 0) * multiplier

    @staticmethod
    def price_for_amount(amount, quantity, unit_type='share'):
        quantity = float(quantity or 0)
        if quantity <= 0:
            return 0
        multiplier = 0.001 if unit_type == 'unit' else 1
        return float(amount or 0) / (quantity * multiplier)
    
    def to_dict(self):
        current_value = self.amount_for(self.quantity, self.current_price, self.unit_type) if self.status == 'holding' else 0
        total_purchase = self.amount_for(self.quantity, self.purchase_price, self.unit_type)
        profit_loss = current_value - total_purchase
        profit_rate = (profit_loss / total_purchase * 100) if total_purchase > 0 else 0
        
        return {
            'id': self.id,
            'account_name': self.account_name,
            'product_name': self.product_name,
            'product_code': self.product_code,
            'purchase_price': self.purchase_price,
            'quantity': self.quantity,
            'unit_type': self.unit_type,
            'unit_label': '좌' if self.unit_type == 'unit' else '수',
            'purchase_date': self.purchase_date.isoformat(),
            'asset_type': self.asset_type,
            'status': self.status,
            'current_price': self.current_price,
            'current_value': current_value,
            'total_purchase_value': total_purchase,
            'profit_loss': profit_loss,
            'profit_rate': round(profit_rate, 2),
            'sale_date': self.sale_date.isoformat() if self.sale_date else None,
            'sale_price': self.sale_price,
            'created_at': self.created_at.isoformat()
        }

class CashBalance(db.Model):
    __tablename__ = 'cash_balances'
    __table_args__ = (db.UniqueConstraint('user_id', 'account_name', name='uq_cash_balance_user_account'),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    amount = db.Column(db.Float, default=0, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'amount': self.amount,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

class PriceHistory(db.Model):
    __tablename__ = 'price_histories'
    
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    price = db.Column(db.Float, nullable=False)
    record_date = db.Column(db.Date, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'price': self.price,
            'record_date': self.record_date.isoformat(),
            'created_at': self.created_at.isoformat()
        }

class TradeLog(db.Model):
    __tablename__ = 'trade_logs'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=True)
    product_name = db.Column(db.String(255), nullable=False)
    trade_type = db.Column(db.String(10), nullable=False)  # 'buy', 'sell', 'deposit'
    quantity = db.Column(db.Float, nullable=False)
    unit_type = db.Column(db.String(20), nullable=False, default='share')
    price = db.Column(db.Float, nullable=False)
    total_amount = db.Column(db.Float, nullable=False)
    trade_date = db.Column(db.Date, nullable=False)
    asset_type = db.Column(db.String(20), nullable=False)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'account_name': self.account_name,
            'product_id': self.product_id,
            'product_name': self.product_name,
            'trade_type': self.trade_type,
            'quantity': self.quantity,
            'unit_type': self.unit_type,
            'unit_label': '좌' if self.unit_type == 'unit' else '수',
            'price': self.price,
            'total_amount': self.total_amount,
            'trade_date': self.trade_date.isoformat(),
            'asset_type': self.asset_type,
            'notes': self.notes,
            'created_at': self.created_at.isoformat()
        }
