from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, date
import uuid

db = SQLAlchemy()
DEFAULT_ACCOUNT_NAME = '퇴직연금'

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    is_deleted = db.Column(db.Boolean, nullable=False, default=False)
    deleted_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 관계 설정
    portfolios = db.relationship('Product', backref='user', lazy=True, cascade='all, delete-orphan')
    trade_logs = db.relationship('TradeLog', backref='user', lazy=True, cascade='all, delete-orphan')
    trade_events = db.relationship(
        'TradeEvent',
        foreign_keys='TradeEvent.user_id',
        backref='user',
        lazy=True,
        cascade='all, delete-orphan'
    )
    created_trade_events = db.relationship(
        'TradeEvent',
        foreign_keys='TradeEvent.created_by',
        backref='created_by_user',
        lazy=True
    )
    import_batches = db.relationship('ImportBatch', backref='user', lazy=True, cascade='all, delete-orphan')
    trade_snapshots = db.relationship('TradeSnapshot', backref='user', lazy=True, cascade='all, delete-orphan')
    reconciliation_results = db.relationship('ReconciliationResult', backref='user', lazy=True, cascade='all, delete-orphan')
    screener_screens = db.relationship('ScreenerScreen', backref='user', lazy=True, cascade='all, delete-orphan')
    account_wrappers = db.relationship('AccountWrapper', backref='user', lazy=True, cascade='all, delete-orphan')
    holdings_lots = db.relationship('HoldingLot', backref='user', lazy=True, cascade='all, delete-orphan')
    portfolio_snapshots_v2 = db.relationship('PortfolioSnapshot', backref='user', lazy=True, cascade='all, delete-orphan')
    cash_flows = db.relationship('CashFlow', backref='user', lazy=True, cascade='all, delete-orphan')
    benchmarks = db.relationship('Benchmark', backref='user', lazy=True, cascade='all, delete-orphan')
    security_audit_logs = db.relationship('SecurityAuditLog', backref='user', lazy=True, cascade='all, delete-orphan')
    deletion_requests = db.relationship('DataDeletionRequest', backref='user', lazy=True, cascade='all, delete-orphan')
    journal_entries = db.relationship('TradeJournal', backref='user', lazy=True, cascade='all, delete-orphan')
    calendar_events = db.relationship('CalendarEvent', backref='user', lazy=True, cascade='all, delete-orphan')
    screener_watch_items = db.relationship('ScreenerWatchItem', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'is_deleted': bool(self.is_deleted),
            'deleted_at': self.deleted_at.isoformat() if self.deleted_at else None,
            'created_at': self.created_at.isoformat()
        }


class AccountProfile(db.Model):
    __tablename__ = 'account_profiles'
    __table_args__ = (db.UniqueConstraint('user_id', 'account_name', name='uq_account_profile_user_account'),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    account_type = db.Column(db.String(20), nullable=False, default='retirement')  # 'retirement' or 'brokerage'
    account_category = db.Column(db.String(32), nullable=False, default='irp')
    is_default = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'account_type': self.account_type,
            'account_category': self.account_category,
            'is_default': bool(self.is_default),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
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
            'unit_label': '좌' if self.unit_type == 'unit' else '주',
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
        normalized_name = str(self.product_name or '').strip().lower()
        position_key = f'account:{self.account_name}:name:{normalized_name}' if normalized_name else f'id:{self.product_id}'
        return {
            'id': self.id,
            'account_name': self.account_name,
            'position_key': position_key,
            'product_id': self.product_id,
            'product_name': self.product_name,
            'trade_type': self.trade_type,
            'quantity': self.quantity,
            'unit_type': self.unit_type,
            'unit_label': '좌' if self.unit_type == 'unit' else '주',
            'price': self.price,
            'total_amount': self.total_amount,
            'trade_date': self.trade_date.isoformat(),
            'asset_type': self.asset_type,
            'notes': self.notes,
            'created_at': self.created_at.isoformat()
        }


class TradeJournal(db.Model):
    __tablename__ = 'trade_journals'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    attached_trade_id = db.Column(db.Integer, db.ForeignKey('trade_logs.id'), nullable=True)
    attached_symbol = db.Column(db.String(32), nullable=True)
    thesis = db.Column(db.Text, nullable=False)
    trigger = db.Column(db.Text, nullable=True)
    invalidation = db.Column(db.Text, nullable=True)
    target_horizon = db.Column(db.String(64), nullable=True)
    tags_json = db.Column(db.Text, nullable=True)
    confidence = db.Column(db.Float, nullable=False, default=0)
    screenshots_or_links_json = db.Column(db.Text, nullable=True)
    entry_date = db.Column(db.Date, nullable=False, default=date.today)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'attached_trade_id': self.attached_trade_id,
            'attached_symbol': self.attached_symbol,
            'thesis': self.thesis,
            'trigger': self.trigger,
            'invalidation': self.invalidation,
            'target_horizon': self.target_horizon,
            'tags_json': self.tags_json,
            'confidence': self.confidence,
            'screenshots_or_links_json': self.screenshots_or_links_json,
            'entry_date': self.entry_date.isoformat() if self.entry_date else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class CalendarEvent(db.Model):
    __tablename__ = 'calendar_events'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    event_type = db.Column(db.String(32), nullable=False)  # earnings|dividend_ex|dividend_pay|disclosure|contribution|rebalance|custom
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    event_date = db.Column(db.Date, nullable=False)
    attached_symbol = db.Column(db.String(32), nullable=True)
    attached_trade_id = db.Column(db.Integer, db.ForeignKey('trade_logs.id'), nullable=True)
    source = db.Column(db.String(24), nullable=False, default='user')  # user|system
    dedupe_key = db.Column(db.String(255), nullable=True)
    metadata_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'event_type': self.event_type,
            'title': self.title,
            'description': self.description,
            'event_date': self.event_date.isoformat() if self.event_date else None,
            'attached_symbol': self.attached_symbol,
            'attached_trade_id': self.attached_trade_id,
            'source': self.source,
            'dedupe_key': self.dedupe_key,
            'metadata_json': self.metadata_json,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class TradeEvent(db.Model):
    __tablename__ = 'trade_events'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    trade_log_id = db.Column(db.Integer, nullable=True)
    product_id = db.Column(db.Integer, nullable=True)
    event_type = db.Column(db.String(32), nullable=False)
    source_type = db.Column(db.String(32), nullable=False, default='ui')
    source_id = db.Column(db.String(128), nullable=True)
    import_batch_id = db.Column(db.String(64), nullable=True)
    prev_hash = db.Column(db.String(128), nullable=True)
    hash = db.Column(db.String(128), nullable=False)
    supersedes_event_id = db.Column(db.Integer, nullable=True)
    payload_json = db.Column(db.Text, nullable=False)
    occurred_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'trade_log_id': self.trade_log_id,
            'product_id': self.product_id,
            'event_type': self.event_type,
            'source_type': self.source_type,
            'source_id': self.source_id,
            'import_batch_id': self.import_batch_id,
            'prev_hash': self.prev_hash,
            'hash': self.hash,
            'supersedes_event_id': self.supersedes_event_id,
            'payload_json': self.payload_json,
            'occurred_at': self.occurred_at.isoformat() if self.occurred_at else None,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class ImportBatch(db.Model):
    __tablename__ = 'import_batches'

    id = db.Column(db.String(64), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    batch_type = db.Column(db.String(32), nullable=False, default='manual')
    source_name = db.Column(db.String(64), nullable=False, default='ui')
    status = db.Column(db.String(20), nullable=False, default='pending')
    row_count = db.Column(db.Integer, nullable=False, default=0)
    imported_count = db.Column(db.Integer, nullable=False, default=0)
    skipped_count = db.Column(db.Integer, nullable=False, default=0)
    error_count = db.Column(db.Integer, nullable=False, default=0)
    notes_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'batch_type': self.batch_type,
            'source_name': self.source_name,
            'status': self.status,
            'row_count': self.row_count,
            'imported_count': self.imported_count,
            'skipped_count': self.skipped_count,
            'error_count': self.error_count,
            'notes_json': self.notes_json,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None
        }


class TradeSnapshot(db.Model):
    __tablename__ = 'trade_snapshots'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    import_batch_id = db.Column(db.String(64), nullable=True)
    trade_event_id = db.Column(db.Integer, nullable=True)
    product_id = db.Column(db.Integer, nullable=True)
    snapshot_kind = db.Column(db.String(32), nullable=False, default='post_event')
    snapshot_date = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    quantity = db.Column(db.Float, nullable=True)
    purchase_price = db.Column(db.Float, nullable=True)
    current_price = db.Column(db.Float, nullable=True)
    market_value = db.Column(db.Float, nullable=True)
    cost_basis = db.Column(db.Float, nullable=True)
    cash_balance = db.Column(db.Float, nullable=True)
    payload_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'import_batch_id': self.import_batch_id,
            'trade_event_id': self.trade_event_id,
            'product_id': self.product_id,
            'snapshot_kind': self.snapshot_kind,
            'snapshot_date': self.snapshot_date.isoformat() if self.snapshot_date else None,
            'quantity': self.quantity,
            'purchase_price': self.purchase_price,
            'current_price': self.current_price,
            'market_value': self.market_value,
            'cost_basis': self.cost_basis,
            'cash_balance': self.cash_balance,
            'payload_json': self.payload_json,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class ReconciliationResult(db.Model):
    __tablename__ = 'reconciliation_results'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    import_batch_id = db.Column(db.String(64), nullable=True)
    trade_event_id = db.Column(db.Integer, nullable=True)
    scope = db.Column(db.String(32), nullable=False, default='account')
    status = db.Column(db.String(20), nullable=False, default='ok')
    mismatch_count = db.Column(db.Integer, nullable=False, default=0)
    details_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'import_batch_id': self.import_batch_id,
            'trade_event_id': self.trade_event_id,
            'scope': self.scope,
            'status': self.status,
            'mismatch_count': self.mismatch_count,
            'details_json': self.details_json,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class ScreenerScreen(db.Model):
    __tablename__ = 'screener_screens'
    __table_args__ = (db.UniqueConstraint('user_id', 'name', name='uq_screener_screen_user_name'),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(80), nullable=False)
    market = db.Column(db.String(20), nullable=False, default='KOSPI')
    pages = db.Column(db.Integer, nullable=False, default=2)
    limit = db.Column(db.Integer, nullable=False, default=18)
    filters_json = db.Column(db.Text, nullable=False)
    result_codes_json = db.Column(db.Text, nullable=True)
    compare_codes_json = db.Column(db.Text, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'name': self.name,
            'market': self.market,
            'pages': self.pages,
            'limit': self.limit,
            'filters_json': self.filters_json,
            'result_codes_json': self.result_codes_json,
            'compare_codes_json': self.compare_codes_json,
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class ScreenerWatchItem(db.Model):
    __tablename__ = 'screener_watch_items'
    __table_args__ = (db.UniqueConstraint('user_id', 'account_name', 'symbol', name='uq_watch_user_account_symbol'),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    symbol = db.Column(db.String(32), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    exchange = db.Column(db.String(20), nullable=True)
    candidate_tags_json = db.Column(db.Text, nullable=True)
    source = db.Column(db.String(24), nullable=False, default='screener')
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'symbol': self.symbol,
            'name': self.name,
            'exchange': self.exchange,
            'candidate_tags_json': self.candidate_tags_json,
            'source': self.source,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class AccountWrapper(db.Model):
    __tablename__ = 'account_wrappers'
    __table_args__ = (db.UniqueConstraint('user_id', 'account_name', name='uq_account_wrapper_user_account'),)

    id = db.Column(db.String(64), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    wrapper_type = db.Column(db.String(32), nullable=False, default='irp')
    provider = db.Column(db.String(64), nullable=False, default='manual')
    nickname = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    base_currency = db.Column(db.String(16), nullable=False, default='KRW')
    tags_json = db.Column(db.Text, nullable=True)
    source = db.Column(db.String(32), nullable=False, default='portfolio_ledger')
    as_of = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    latency_class = db.Column(db.String(20), nullable=False, default='eod')
    reconciled = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_name': self.account_name,
            'type': self.wrapper_type,
            'provider': self.provider,
            'nickname': self.nickname,
            'base_currency': self.base_currency,
            'tags_json': self.tags_json,
            'source': self.source,
            'as_of': self.as_of.isoformat() if self.as_of else None,
            'latency_class': self.latency_class,
            'reconciled': bool(self.reconciled),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class HoldingLot(db.Model):
    __tablename__ = 'holdings_lots'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_wrapper_id = db.Column(db.String(64), db.ForeignKey('account_wrappers.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    symbol = db.Column(db.String(50), nullable=False)
    product_name = db.Column(db.String(255), nullable=False)
    asset_type = db.Column(db.String(20), nullable=False, default='risk')
    quantity = db.Column(db.Float, nullable=False, default=0)
    unit_type = db.Column(db.String(20), nullable=False, default='share')
    unit_cost = db.Column(db.Float, nullable=False, default=0)
    fee = db.Column(db.Float, nullable=False, default=0)
    tax = db.Column(db.Float, nullable=False, default=0)
    acquired_at = db.Column(db.Date, nullable=False)
    closed_at = db.Column(db.Date, nullable=True)
    source = db.Column(db.String(32), nullable=False, default='portfolio_ledger')
    as_of = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    latency_class = db.Column(db.String(20), nullable=False, default='eod')
    reconciled = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_wrapper_id': self.account_wrapper_id,
            'account_name': self.account_name,
            'symbol': self.symbol,
            'product_name': self.product_name,
            'asset_type': self.asset_type,
            'quantity': self.quantity,
            'unit_type': self.unit_type,
            'unit_cost': self.unit_cost,
            'fee': self.fee,
            'tax': self.tax,
            'acquired_at': self.acquired_at.isoformat() if self.acquired_at else None,
            'closed_at': self.closed_at.isoformat() if self.closed_at else None,
            'source': self.source,
            'as_of': self.as_of.isoformat() if self.as_of else None,
            'latency_class': self.latency_class,
            'reconciled': bool(self.reconciled),
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class CashFlow(db.Model):
    __tablename__ = 'cash_flows'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_wrapper_id = db.Column(db.String(64), db.ForeignKey('account_wrappers.id'), nullable=False)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    flow_date = db.Column(db.Date, nullable=False)
    flow_type = db.Column(db.String(32), nullable=False, default='deposit')
    amount = db.Column(db.Float, nullable=False, default=0)
    symbol = db.Column(db.String(50), nullable=True)
    fee = db.Column(db.Float, nullable=False, default=0)
    tax = db.Column(db.Float, nullable=False, default=0)
    dividend = db.Column(db.Float, nullable=False, default=0)
    notes = db.Column(db.Text, nullable=True)
    source = db.Column(db.String(32), nullable=False, default='portfolio_ledger')
    as_of = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    latency_class = db.Column(db.String(20), nullable=False, default='eod')
    reconciled = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_wrapper_id': self.account_wrapper_id,
            'account_name': self.account_name,
            'flow_date': self.flow_date.isoformat() if self.flow_date else None,
            'flow_type': self.flow_type,
            'amount': self.amount,
            'symbol': self.symbol,
            'fee': self.fee,
            'tax': self.tax,
            'dividend': self.dividend,
            'notes': self.notes,
            'source': self.source,
            'as_of': self.as_of.isoformat() if self.as_of else None,
            'latency_class': self.latency_class,
            'reconciled': bool(self.reconciled),
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class PortfolioSnapshot(db.Model):
    __tablename__ = 'portfolio_snapshots'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_wrapper_id = db.Column(db.String(64), db.ForeignKey('account_wrappers.id'), nullable=True)
    account_name = db.Column(db.String(80), nullable=False, default=DEFAULT_ACCOUNT_NAME)
    snapshot_date = db.Column(db.Date, nullable=False)
    market_value = db.Column(db.Float, nullable=False, default=0)
    cost_basis = db.Column(db.Float, nullable=False, default=0)
    cash_balance = db.Column(db.Float, nullable=False, default=0)
    net_flow = db.Column(db.Float, nullable=False, default=0)
    dividend = db.Column(db.Float, nullable=False, default=0)
    fee = db.Column(db.Float, nullable=False, default=0)
    tax = db.Column(db.Float, nullable=False, default=0)
    payload_json = db.Column(db.Text, nullable=True)
    source = db.Column(db.String(32), nullable=False, default='portfolio_ledger')
    as_of = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    latency_class = db.Column(db.String(20), nullable=False, default='eod')
    reconciled = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_wrapper_id': self.account_wrapper_id,
            'account_name': self.account_name,
            'snapshot_date': self.snapshot_date.isoformat() if self.snapshot_date else None,
            'market_value': self.market_value,
            'cost_basis': self.cost_basis,
            'cash_balance': self.cash_balance,
            'net_flow': self.net_flow,
            'dividend': self.dividend,
            'fee': self.fee,
            'tax': self.tax,
            'payload_json': self.payload_json,
            'source': self.source,
            'as_of': self.as_of.isoformat() if self.as_of else None,
            'latency_class': self.latency_class,
            'reconciled': bool(self.reconciled),
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Benchmark(db.Model):
    __tablename__ = 'benchmarks'
    __table_args__ = (db.UniqueConstraint('user_id', 'account_wrapper_id', 'code', name='uq_benchmark_user_account_code'),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    account_wrapper_id = db.Column(db.String(64), db.ForeignKey('account_wrappers.id'), nullable=True)
    code = db.Column(db.String(50), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    provider = db.Column(db.String(32), nullable=False, default='krx')
    is_default = db.Column(db.Boolean, nullable=False, default=True)
    series_json = db.Column(db.Text, nullable=True)
    source = db.Column(db.String(32), nullable=False, default='market')
    as_of = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    latency_class = db.Column(db.String(20), nullable=False, default='eod')
    reconciled = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'account_wrapper_id': self.account_wrapper_id,
            'code': self.code,
            'name': self.name,
            'provider': self.provider,
            'is_default': bool(self.is_default),
            'series_json': self.series_json,
            'source': self.source,
            'as_of': self.as_of.isoformat() if self.as_of else None,
            'latency_class': self.latency_class,
            'reconciled': bool(self.reconciled),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class SecurityAuditLog(db.Model):
    __tablename__ = 'security_audit_logs'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    event_type = db.Column(db.String(64), nullable=False)
    resource_type = db.Column(db.String(64), nullable=True)
    resource_id = db.Column(db.String(128), nullable=True)
    action = db.Column(db.String(64), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='ok')
    ip_address = db.Column(db.String(64), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)
    message = db.Column(db.Text, nullable=True)
    detail_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'event_type': self.event_type,
            'resource_type': self.resource_type,
            'resource_id': self.resource_id,
            'action': self.action,
            'status': self.status,
            'ip_address': self.ip_address,
            'user_agent': self.user_agent,
            'message': self.message,
            'detail_json': self.detail_json,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class DataDeletionRequest(db.Model):
    __tablename__ = 'data_deletion_requests'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    mode = db.Column(db.String(20), nullable=False, default='soft')  # soft | hard
    reason = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), nullable=False, default='pending')  # pending | executed | rejected
    requested_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    processed_at = db.Column(db.DateTime, nullable=True)
    processed_by = db.Column(db.Integer, nullable=True)
    detail_json = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'mode': self.mode,
            'reason': self.reason,
            'status': self.status,
            'requested_at': self.requested_at.isoformat() if self.requested_at else None,
            'processed_at': self.processed_at.isoformat() if self.processed_at else None,
            'processed_by': self.processed_by,
            'detail_json': self.detail_json
        }
