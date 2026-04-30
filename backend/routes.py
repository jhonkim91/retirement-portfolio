import csv
from datetime import datetime, date
import hashlib
import io
import json
from datetime import timedelta
import math
import os
import re
from zoneinfo import ZoneInfo
from xml.sax.saxutils import escape

from flask import Blueprint, request, jsonify, Response
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
import requests
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.pdfmetrics import registerFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from api_client import StockAPIClient
from models import (
    AccountProfile,
    AccountWrapper,
    Benchmark,
    CashBalance,
    CashFlow,
    DataDeletionRequest,
    DEFAULT_ACCOUNT_NAME,
    HoldingLot,
    ImportBatch,
    PortfolioSnapshot,
    PriceHistory,
    Product,
    CalendarEvent,
    ReconciliationResult,
    ScreenerScreen,
    ScreenerWatchItem,
    SecurityAuditLog,
    TradeJournal,
    TradeEvent,
    TradeLog,
    TradeSnapshot,
    User,
    db
)

api = Blueprint('api', __name__, url_prefix='/api')
market_client = StockAPIClient()
API_VERSION = '2026-04-28-report-alignment-v1'
MARKET_TIMEZONE = ZoneInfo('Asia/Seoul')
MARKET_SYNC_TTL_SECONDS = 60 * 5
_market_sync_cache = {}
_screener_cache = {}


class AccessDeniedError(Exception):
    pass

POSITIVE_NEWS_KEYWORDS = (
    '성장', '확대', '개선', '호조', '반등', '수혜', '강세', '증가', '흑자', '상향',
    '돌파', '신고가', '매수', '수주', '협력', '안정', '유입', '기대', '효율', '회복'
)
NEGATIVE_NEWS_KEYWORDS = (
    '하락', '부진', '적자', '둔화', '약세', '축소', '우려', '급락', '하향', '감소',
    '리스크', '제재', '소송', '경고', '불확실', '악화', '충격', '매도', '변동성', '부담'
)


def current_user_id():
    return int(get_jwt_identity())


def client_ip_address():
    forwarded = str(request.headers.get('X-Forwarded-For') or '').strip()
    if forwarded:
        return forwarded.split(',')[0].strip()
    return str(request.remote_addr or '')


def log_security_event(
    *,
    user_id=None,
    event_type='security_event',
    resource_type='system',
    resource_id=None,
    action='access',
    status='ok',
    message='',
    detail=None
):
    try:
        row = SecurityAuditLog(
            user_id=user_id,
            event_type=str(event_type or 'security_event')[:64],
            resource_type=str(resource_type or 'system')[:64],
            resource_id=str(resource_id)[:128] if resource_id is not None else None,
            action=str(action or 'access')[:64],
            status=str(status or 'ok')[:20],
            ip_address=client_ip_address()[:64],
            user_agent=str(request.headers.get('User-Agent') or '')[:255],
            message=str(message or '')[:2000],
            detail_json=canonical_json(detail or {})
        )
        db.session.add(row)
        return row
    except Exception:
        return None


def assertCanAccessPortfolio(user_id, portfolio_id):
    product = Product.query.filter_by(id=portfolio_id).first()
    if not product:
        raise ValueError('상품을 찾을 수 없습니다.')
    if int(product.user_id) != int(user_id):
        log_security_event(
            user_id=user_id,
            event_type='authz_denied',
            resource_type='portfolio',
            resource_id=portfolio_id,
            action='read_or_write',
            status='denied',
            message='다른 사용자의 포트폴리오 접근 시도'
        )
        raise AccessDeniedError('해당 포트폴리오에 접근할 수 없습니다.')
    return product


def assertCanEditJournalEntry(user_id, entry_id):
    log = TradeLog.query.filter_by(id=entry_id).first()
    if not log:
        raise ValueError('매매일지 기록을 찾을 수 없습니다.')
    if int(log.user_id) != int(user_id):
        log_security_event(
            user_id=user_id,
            event_type='authz_denied',
            resource_type='trade_log',
            resource_id=entry_id,
            action='edit',
            status='denied',
            message='다른 사용자의 매매일지 수정/삭제 시도'
        )
        raise AccessDeniedError('해당 매매일지 기록을 수정할 수 없습니다.')
    return log


def normalize_account_name(value):
    account_name = str(value or '').strip()
    if not account_name:
        return DEFAULT_ACCOUNT_NAME
    return account_name[:80]


def account_name_has_render_issue(value):
    text = str(value or '').strip()
    if not text:
        return False
    return ('�' in text) or bool(re.search(r'\?{2,}', text))


def validate_account_name_input(value):
    text = str(value or '').strip()
    if not text:
        return '통장 이름을 입력하세요.'
    if account_name_has_render_issue(text):
        return '깨진 문자가 포함된 통장 이름은 저장할 수 없습니다.'
    return ''


def get_account_display_name(account_name):
    normalized = normalize_account_name(account_name)
    if account_name_has_render_issue(normalized):
        return f'계좌명 확인 필요 ({normalized})'
    return normalized


def normalize_account_type(value):
    return 'brokerage' if str(value or '').strip().lower() == 'brokerage' else 'retirement'


def get_account_type_label(account_type):
    return '주식 통장' if account_type == 'brokerage' else '퇴직연금'


def normalize_account_category(value, account_type='retirement'):
    normalized_type = normalize_account_type(account_type)
    if normalized_type == 'brokerage':
        return 'taxable'

    allowed = {'pension_savings', 'irp', 'dc', 'db_reference'}
    category = str(value or '').strip().lower()
    return category if category in allowed else 'irp'


def get_account_category_label(account_category, account_type='retirement'):
    normalized_type = normalize_account_type(account_type)
    if normalized_type == 'brokerage':
        return '일반과세'

    labels = {
        'pension_savings': '연금저축',
        'irp': 'IRP',
        'dc': 'DC',
        'db_reference': 'DB 참조'
    }
    return labels.get(normalize_account_category(account_category, normalized_type), 'IRP')


def current_account_name():
    data = request.get_json(silent=True) or {}
    return normalize_account_name(
        request.args.get('account_name')
        or data.get('account_name')
        or DEFAULT_ACCOUNT_NAME
    )


def get_account_profile(user_id, account_name):
    account_name = normalize_account_name(account_name)
    profile = AccountProfile.query.filter_by(user_id=user_id, account_name=account_name).first()
    if profile:
        profile.account_type = normalize_account_type(profile.account_type)
        profile.account_category = normalize_account_category(profile.account_category, profile.account_type)
        return profile

    inferred_type = 'brokerage' if ('주식' in account_name or 'stock' in account_name.lower()) else 'retirement'
    has_default = AccountProfile.query.filter_by(user_id=user_id, is_default=True).first() is not None
    profile = AccountProfile(
        user_id=user_id,
        account_name=account_name,
        account_type=inferred_type,
        account_category='taxable' if inferred_type == 'brokerage' else 'irp',
        is_default=(account_name == DEFAULT_ACCOUNT_NAME and not has_default)
    )
    db.session.add(profile)
    db.session.flush()
    return profile


def perform_soft_delete_user(user, deletion_request=None):
    marker = datetime.utcnow().strftime('%Y%m%d%H%M%S')
    user.username = f'deleted_{user.id}_{marker}'
    user.email = f'deleted+{user.id}.{marker}@anonymized.local'
    user.password = hashlib.sha256(os.urandom(32)).hexdigest()
    user.is_deleted = True
    user.deleted_at = datetime.utcnow()
    detail = {
        'mode': 'soft',
        'retained_financial_records': True
    }
    if deletion_request:
        deletion_request.status = 'executed'
        deletion_request.processed_at = datetime.utcnow()
        deletion_request.processed_by = user.id
        deletion_request.detail_json = canonical_json(detail)
    log_security_event(
        user_id=user.id,
        event_type='privacy_deletion_executed',
        resource_type='user',
        resource_id=user.id,
        action='soft_delete',
        status='ok',
        message='사용자 soft delete(익명화) 처리',
        detail=detail
    )


def perform_hard_delete_user(user_id, deletion_request=None):
    user = User.query.filter_by(id=user_id).first()
    if not user:
        raise ValueError('사용자 정보를 찾을 수 없습니다.')

    detail = {'mode': 'hard', 'retained_financial_records': False}
    if deletion_request:
        deletion_request.status = 'executed'
        deletion_request.processed_at = datetime.utcnow()
        deletion_request.processed_by = user_id
        deletion_request.detail_json = canonical_json(detail)

    Product.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    TradeJournal.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    CalendarEvent.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    TradeLog.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    TradeEvent.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    TradeSnapshot.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    ReconciliationResult.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    ImportBatch.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    CashBalance.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    AccountProfile.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    AccountWrapper.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    HoldingLot.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    PortfolioSnapshot.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    CashFlow.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    Benchmark.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    ScreenerScreen.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    ScreenerWatchItem.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    SecurityAuditLog.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    DataDeletionRequest.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    db.session.delete(user)


def is_korean_market_open(now=None):
    now = now or datetime.now(MARKET_TIMEZONE)
    if now.weekday() >= 5:
        return False
    return (now.hour, now.minute) >= (9, 0) and (now.hour, now.minute) <= (15, 40)


def maybe_sync_account_prices(user_id, account_name, force=False):
    account_name = normalize_account_name(account_name)
    if not force and not is_korean_market_open():
        return False

    cache_key = f'{user_id}:{account_name}'
    cached_at = _market_sync_cache.get(cache_key)
    now_ts = datetime.now(MARKET_TIMEZONE).timestamp()
    if not force and cached_at and (now_ts - cached_at) < MARKET_SYNC_TTL_SECONDS:
        return False

    sync_user_holdings(user_id, account_name)
    _market_sync_cache[cache_key] = now_ts
    return True


def build_portfolio_summary_payload(user_id, account_name, *, sync_prices=True):
    account_name = normalize_account_name(account_name)
    account_profile = get_account_profile(user_id, account_name)
    account_type = normalize_account_type(account_profile.account_type)
    account_category = normalize_account_category(account_profile.account_category, account_type)

    if sync_prices:
        maybe_sync_account_prices(user_id, account_name)

    products = Product.query.filter_by(user_id=user_id, account_name=account_name, status='holding').all()
    cash = get_cash_balance(user_id, account_name).amount
    product_current_value = sum(Product.amount_for(p.quantity, p.current_price, p.unit_type) for p in products)
    product_purchase_value = sum(Product.amount_for(p.quantity, p.purchase_price, p.unit_type) for p in products)

    if account_type == 'brokerage':
        total_investment = product_purchase_value
        total_current_value = product_current_value
    else:
        total_investment = get_deposit_principal(user_id, account_name)
        total_current_value = product_current_value + cash

    total_profit_loss = total_current_value - total_investment
    total_profit_rate = (total_profit_loss / total_investment * 100) if total_investment else 0

    risk_value = sum(Product.amount_for(p.quantity, p.current_price, p.unit_type) for p in products if p.asset_type == 'risk')
    safe_value = sum(Product.amount_for(p.quantity, p.current_price, p.unit_type) for p in products if p.asset_type == 'safe')
    if account_type != 'brokerage':
        safe_value += cash
    total_value = risk_value + safe_value

    return {
        'account_type': account_type,
        'account_type_label': get_account_type_label(account_type),
        'account_category': account_category,
        'account_category_label': get_account_category_label(account_category, account_type),
        'total_investment': round(total_investment, 2),
        'total_cash': round(cash, 2),
        'total_current_value': round(total_current_value, 2),
        'total_profit_loss': round(total_profit_loss, 2),
        'total_profit_rate': round(total_profit_rate, 2),
        'asset_allocation': {
            'risk': {
                'value': round(risk_value, 2),
                'percentage': round((risk_value / total_value * 100) if total_value else 0, 2)
            },
            'safe': {
                'value': round(safe_value, 2),
                'percentage': round((safe_value / total_value * 100) if total_value else 0, 2)
            }
        }
    }


def list_user_accounts(user_id):
    account_names = set()
    sources = (
        (Product, Product.account_name),
        (TradeLog, TradeLog.account_name),
        (CashBalance, CashBalance.account_name)
    )

    for model, column in sources:
        rows = (
            db.session.query(column)
            .select_from(model)
            .filter(model.user_id == user_id)
            .filter(column.isnot(None))
            .distinct()
            .all()
        )
        for (account_name,) in rows:
            normalized = normalize_account_name(account_name)
            if normalized:
                account_names.add(normalized)

    for (account_name,) in db.session.query(AccountProfile.account_name).filter_by(user_id=user_id).distinct().all():
        normalized = normalize_account_name(account_name)
        if normalized:
            account_names.add(normalized)

    if not account_names:
        account_names.add(DEFAULT_ACCOUNT_NAME)

    holding_counts = {
        normalize_account_name(account_name): int(count or 0)
        for account_name, count in (
            db.session.query(Product.account_name, db.func.count(Product.id))
            .filter(Product.user_id == user_id, Product.status == 'holding')
            .group_by(Product.account_name)
            .all()
        )
    }
    total_product_counts = {
        normalize_account_name(account_name): int(count or 0)
        for account_name, count in (
            db.session.query(Product.account_name, db.func.count(Product.id))
            .filter(Product.user_id == user_id)
            .group_by(Product.account_name)
            .all()
        )
    }
    trade_log_counts = {
        normalize_account_name(account_name): int(count or 0)
        for account_name, count in (
            db.session.query(TradeLog.account_name, db.func.count(TradeLog.id))
            .filter(TradeLog.user_id == user_id)
            .group_by(TradeLog.account_name)
            .all()
        )
    }
    cash_balances = {
        normalize_account_name(account_name): round(float(amount or 0), 2)
        for account_name, amount in (
            db.session.query(CashBalance.account_name, db.func.sum(CashBalance.amount))
            .filter(CashBalance.user_id == user_id)
            .group_by(CashBalance.account_name)
            .all()
        )
    }

    account_profiles = []
    ordered_names = sorted(account_names)
    for account_name in ordered_names:
        profile = get_account_profile(user_id, account_name)
        account_type = normalize_account_type(profile.account_type)
        account_category = normalize_account_category(profile.account_category, account_type)
        holding_count = holding_counts.get(account_name, 0)
        total_product_count = total_product_counts.get(account_name, 0)
        trade_log_count = trade_log_counts.get(account_name, 0)
        cash_balance = cash_balances.get(account_name, 0.0)
        has_data = bool(
            holding_count > 0
            or total_product_count > 0
            or trade_log_count > 0
            or abs(cash_balance) > 0.004
        )
        account_profiles.append({
            'account_name': account_name,
            'display_name': get_account_display_name(account_name),
            'has_name_issue': account_name_has_render_issue(account_name),
            'account_type': account_type,
            'account_type_label': get_account_type_label(account_type),
            'account_category': account_category,
            'account_category_label': get_account_category_label(account_category, account_type),
            'is_default': bool(profile.is_default),
            'holding_count': holding_count,
            'total_product_count': total_product_count,
            'trade_log_count': trade_log_count,
            'cash_balance': cash_balance,
            'has_data': has_data,
            'is_empty': not has_data
        })

    account_profiles.sort(key=lambda item: (
        0 if item['is_default'] else 1,
        1 if item['is_empty'] else 0,
        item['account_name']
    ))
    return account_profiles


def upsert_price_history(product_id, record_date, price):
    existing = PriceHistory.query.filter_by(product_id=product_id, record_date=record_date).first()
    if existing:
        existing.price = price
    else:
        db.session.add(PriceHistory(product_id=product_id, price=price, record_date=record_date))


def get_cash_balance(user_id, account_name=None):
    account_name = normalize_account_name(account_name)
    balance = CashBalance.query.filter_by(user_id=user_id, account_name=account_name).first()
    if not balance:
        balance = CashBalance(user_id=user_id, account_name=account_name, amount=0)
        db.session.add(balance)
        db.session.commit()
    return balance


def get_deposit_principal(user_id, account_name=None):
    account_name = normalize_account_name(account_name)
    total = (
        db.session.query(db.func.coalesce(db.func.sum(TradeLog.total_amount), 0))
        .filter(
            TradeLog.user_id == user_id,
            TradeLog.account_name == account_name,
            TradeLog.trade_type == 'deposit'
        )
        .scalar()
    )
    return float(total or 0)


def is_manual_price_product(code):
    code_text = market_client.clean_code(code)
    return code_text.isdigit() and len(code_text) != 6


def parse_float(value, field_name):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f'{field_name} 형식이 올바르지 않습니다.')
    return number


def parse_positive_float(value, field_name):
    number = parse_float(value, field_name)
    if number <= 0:
        raise ValueError(f'{field_name}은 0보다 크게 입력하세요.')
    return number


def parse_trade_date(value, fallback=None):
    return datetime.strptime(value or (fallback or date.today().isoformat()), '%Y-%m-%d').date()


def normalize_unit_type(value):
    return 'unit' if value == 'unit' else 'share'


def trade_amount(quantity, price, unit_type):
    return Product.amount_for(quantity, price, unit_type)


def get_product_buy_logs(product):
    buy_logs = (
        TradeLog.query
        .filter_by(
            user_id=product.user_id,
            account_name=product.account_name,
            product_id=product.id,
            trade_type='buy'
        )
        .order_by(TradeLog.trade_date.asc(), TradeLog.id.asc())
        .all()
    )

    if buy_logs:
        return buy_logs

    synthetic_amount = trade_amount(product.quantity, product.purchase_price, product.unit_type)
    return [type('SyntheticBuyLog', (), {
        'trade_date': product.purchase_date,
        'quantity': product.quantity,
        'price': product.purchase_price,
        'total_amount': synthetic_amount,
        'id': 0
    })()]


def get_product_trade_logs(product):
    return (
        TradeLog.query
        .filter_by(
            user_id=product.user_id,
            account_name=product.account_name,
            product_id=product.id
        )
        .filter(TradeLog.trade_type.in_(('buy', 'sell')))
        .order_by(TradeLog.trade_date.asc(), TradeLog.id.asc())
        .all()
    )


def rebuild_product_from_trade_logs(product):
    logs = get_product_trade_logs(product)
    buy_logs = [log for log in logs if log.trade_type == 'buy']
    sell_logs = [log for log in logs if log.trade_type == 'sell']

    if not buy_logs:
        if sell_logs:
            raise ValueError('매도 기록이 남아 있어 매수 기록을 먼저 모두 삭제할 수 없습니다. 매도 기록을 먼저 정리하세요.')
        PriceHistory.query.filter_by(product_id=product.id).delete(synchronize_session=False)
        db.session.delete(product)
        return {'deleted_product': True}

    total_quantity = sum(float(log.quantity or 0) for log in buy_logs)
    total_amount = sum(float(log.total_amount or 0) for log in buy_logs)
    unit_type = normalize_unit_type(buy_logs[-1].unit_type or product.unit_type)
    purchase_date = min(log.trade_date for log in buy_logs)

    product.product_name = buy_logs[-1].product_name or product.product_name
    product.purchase_price = Product.price_for_amount(total_amount, total_quantity, unit_type)
    product.quantity = total_quantity
    product.unit_type = unit_type
    product.purchase_date = purchase_date
    product.asset_type = buy_logs[-1].asset_type or product.asset_type
    if not product.current_price:
        product.current_price = product.purchase_price

    upsert_price_history(product.id, product.purchase_date, product.purchase_price)

    if sell_logs:
        latest_sell = sell_logs[-1]
        if total_quantity + 1e-9 < float(latest_sell.quantity or 0):
            raise ValueError('남아 있는 매수 수량보다 매도 수량이 커집니다. 매도 기록을 먼저 정리하세요.')
        product.status = 'sold'
        product.sale_date = latest_sell.trade_date
        product.sale_price = latest_sell.price
    else:
        product.status = 'holding'
        product.sale_date = None
        product.sale_price = None

    return {'deleted_product': False}


def sync_product_from_trade_log(log):
    if log.trade_type not in ('buy', 'sell') or not log.product_id:
        return None

    product = Product.query.filter_by(id=log.product_id, user_id=log.user_id).first()
    if not product:
        return None

    log.account_name = product.account_name
    if log.trade_type == 'buy':
        upsert_price_history(product.id, log.trade_date, log.price)

    rebuild_product_from_trade_logs(product)
    return product


def serialize_trade_log(log):
    return log.to_dict() if log else None


def serialize_product(product):
    return product.to_dict() if product else None


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def parse_json_text(value, fallback):
    raw = str(value or '').strip()
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


JOURNAL_ALLOWED_HORIZONS = {
    '1w', '1m', '3m', '6m', '1y', '3y', 'long_term'
}
CALENDAR_ALLOWED_EVENT_TYPES = {
    'earnings',
    'dividend_ex',
    'dividend_pay',
    'disclosure',
    'contribution',
    'rebalance',
    'custom'
}


def parse_string_list(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raw = str(value or '').strip()
    if not raw:
        return []
    return [item.strip() for item in raw.split(',') if item.strip()]


def normalize_journal_horizon(value):
    horizon = str(value or '').strip().lower()
    return horizon if horizon in JOURNAL_ALLOWED_HORIZONS else '1m'


def normalize_confidence(value):
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 50.0
    return max(0.0, min(confidence, 100.0))


def normalize_event_type(value):
    event_type = str(value or '').strip().lower()
    return event_type if event_type in CALENDAR_ALLOWED_EVENT_TYPES else 'custom'


def make_event_dedupe_key(event_type, event_date, attached_symbol, title):
    return '|'.join([
        normalize_event_type(event_type),
        str(event_date or ''),
        str(attached_symbol or '').strip().upper(),
        str(title or '').strip().lower()
    ])


def build_trade_journal_response(journal):
    row = journal.to_dict()
    row['tags'] = parse_json_text(row.pop('tags_json'), [])
    row['screenshotsOrLinks'] = parse_json_text(row.pop('screenshots_or_links_json'), [])
    row['targetHorizon'] = row.pop('target_horizon')
    row['attachedTradeId'] = row.pop('attached_trade_id')
    row['attachedSymbol'] = row.pop('attached_symbol')
    return row


def build_calendar_event_response(event):
    row = event.to_dict()
    row['metadata'] = parse_json_text(row.pop('metadata_json'), {})
    row['attachedTradeId'] = row.pop('attached_trade_id')
    row['attachedSymbol'] = row.pop('attached_symbol')
    return row


def collect_system_calendar_events(user_id, account_name, start_date, end_date):
    account_name = normalize_account_name(account_name)
    events = []

    logs = (
        TradeLog.query
        .filter_by(user_id=user_id, account_name=account_name)
        .filter(TradeLog.trade_date >= start_date, TradeLog.trade_date <= end_date)
        .order_by(TradeLog.trade_date.asc(), TradeLog.id.asc())
        .all()
    )
    for log in logs:
        notes = str(log.notes or '').strip()
        lowered_notes = notes.lower()
        symbol = ''
        if log.product_id:
            product = Product.query.filter_by(id=log.product_id, user_id=user_id).first()
            symbol = market_client.clean_code(product.product_code) if product else ''
        symbol = symbol or market_client.clean_code(log.product_name) or ''

        if log.trade_type == 'deposit':
            events.append({
                'id': f'system-deposit-{log.id}',
                'event_type': 'contribution',
                'title': '납입 기록',
                'description': f'납입 {format_number_text(log.total_amount, 0)}',
                'event_date': log.trade_date.isoformat(),
                'attachedTradeId': log.id,
                'attachedSymbol': symbol,
                'source': 'system',
                'dedupe_key': make_event_dedupe_key('contribution', log.trade_date.isoformat(), symbol, '납입 기록'),
                'metadata': {'from_trade_log': True}
            })

        if ('리밸런싱' in notes) or ('rebalanc' in lowered_notes):
            events.append({
                'id': f'system-rebalance-{log.id}',
                'event_type': 'rebalance',
                'title': '리밸런싱 점검',
                'description': notes or '매매일지에 기록된 리밸런싱 이벤트',
                'event_date': log.trade_date.isoformat(),
                'attachedTradeId': log.id,
                'attachedSymbol': symbol,
                'source': 'system',
                'dedupe_key': make_event_dedupe_key('rebalance', log.trade_date.isoformat(), symbol, '리밸런싱 점검'),
                'metadata': {'from_trade_log': True}
            })

        if '실적' in notes:
            events.append({
                'id': f'system-earnings-{log.id}',
                'event_type': 'earnings',
                'title': '실적 예정 체크',
                'description': notes,
                'event_date': log.trade_date.isoformat(),
                'attachedTradeId': log.id,
                'attachedSymbol': symbol,
                'source': 'system',
                'dedupe_key': make_event_dedupe_key('earnings', log.trade_date.isoformat(), symbol, '실적 예정 체크'),
                'metadata': {'from_trade_log': True}
            })

        if '배당락' in notes:
            events.append({
                'id': f'system-dividend-ex-{log.id}',
                'event_type': 'dividend_ex',
                'title': '배당락 확인',
                'description': notes,
                'event_date': log.trade_date.isoformat(),
                'attachedTradeId': log.id,
                'attachedSymbol': symbol,
                'source': 'system',
                'dedupe_key': make_event_dedupe_key('dividend_ex', log.trade_date.isoformat(), symbol, '배당락 확인'),
                'metadata': {'from_trade_log': True}
            })

        if ('배당지급' in notes) or ('배당' in notes and '배당락' not in notes):
            events.append({
                'id': f'system-dividend-pay-{log.id}',
                'event_type': 'dividend_pay',
                'title': '배당지급 확인',
                'description': notes,
                'event_date': log.trade_date.isoformat(),
                'attachedTradeId': log.id,
                'attachedSymbol': symbol,
                'source': 'system',
                'dedupe_key': make_event_dedupe_key('dividend_pay', log.trade_date.isoformat(), symbol, '배당지급 확인'),
                'metadata': {'from_trade_log': True}
            })

        if '공시' in notes:
            events.append({
                'id': f'system-disclosure-{log.id}',
                'event_type': 'disclosure',
                'title': '공시 알림',
                'description': notes,
                'event_date': log.trade_date.isoformat(),
                'attachedTradeId': log.id,
                'attachedSymbol': symbol,
                'source': 'system',
                'dedupe_key': make_event_dedupe_key('disclosure', log.trade_date.isoformat(), symbol, '공시 알림'),
                'metadata': {'from_trade_log': True}
            })

    cursor = date(start_date.year, start_date.month, 1)
    while cursor <= end_date:
        next_month = date(cursor.year + (1 if cursor.month == 12 else 0), 1 if cursor.month == 12 else cursor.month + 1, 1)
        rebalance_day = next_month
        while rebalance_day.weekday() >= 5:
            rebalance_day += timedelta(days=1)
        if rebalance_day >= start_date and rebalance_day <= end_date:
            events.append({
                'id': f'system-monthly-rebalance-{rebalance_day.isoformat()}',
                'event_type': 'rebalance',
                'title': '월간 리밸런싱 점검',
                'description': '월초 리밸런싱/비중 점검 일정',
                'event_date': rebalance_day.isoformat(),
                'attachedTradeId': None,
                'attachedSymbol': '',
                'source': 'system',
                'dedupe_key': make_event_dedupe_key('rebalance', rebalance_day.isoformat(), '', '월간 리밸런싱 점검'),
                'metadata': {'generated': True}
            })
        cursor = next_month

    return events


def dedupe_and_sort_events(rows):
    deduped = {}
    for row in rows:
        key = row.get('dedupe_key') or make_event_dedupe_key(
            row.get('event_type'),
            row.get('event_date'),
            row.get('attachedSymbol') or row.get('attached_symbol'),
            row.get('title')
        )
        if key not in deduped:
            deduped[key] = row
    sorted_rows = list(deduped.values())
    sorted_rows.sort(key=lambda item: (str(item.get('event_date') or ''), str(item.get('event_type') or ''), str(item.get('title') or '')))
    return sorted_rows


def map_wrapper_type(account_type, account_category):
    normalized_type = normalize_account_type(account_type)
    if normalized_type == 'brokerage':
        return 'brokerage'
    normalized_category = normalize_account_category(account_category, normalized_type)
    if normalized_category == 'dc':
        return 'dc'
    if normalized_category == 'pension_savings':
        return 'pension_savings'
    return 'irp'


def build_provenance(source='portfolio_ledger', latency_class='eod', reconciled=False, as_of=None):
    return {
        'source': source,
        'as_of': (as_of or datetime.utcnow()).isoformat(),
        'latency_class': latency_class,
        'reconciled': bool(reconciled)
    }


def classify_cash_flow(log):
    trade_type = str(log.trade_type or '').strip().lower()
    notes_text = str(log.notes or '').strip().lower()
    amount = abs(float(log.total_amount or 0))

    if trade_type == 'deposit':
        return 'deposit', amount
    if trade_type == 'buy':
        return 'buy', -amount
    if trade_type == 'sell':
        return 'sell', amount
    if trade_type == 'dividend' or '배당' in notes_text:
        return 'dividend', amount
    if trade_type == 'fee' or '수수료' in notes_text:
        return 'fee', -amount
    if trade_type == 'tax' or '세금' in notes_text or '원천징수' in notes_text:
        return 'tax', -amount
    return 'other', 0.0


def get_symbol_for_log(log, product_map, name_map):
    if log.product_id and log.product_id in product_map:
        return market_client.clean_code(product_map[log.product_id].product_code) or str(log.product_name or '').strip()
    normalized_name = str(log.product_name or '').strip().lower()
    if normalized_name and normalized_name in name_map:
        return name_map[normalized_name]
    return market_client.clean_code(log.product_name) or str(log.product_name or '').strip()


def collect_account_trend_rows(user_id, account_name, include_sold=True, sync_prices=False):
    if sync_prices:
        maybe_sync_account_prices(user_id, account_name)
    query = Product.query.filter_by(user_id=user_id, account_name=account_name)
    if not include_sold:
        query = query.filter_by(status='holding')
    products = query.all()

    rows = []
    changed = False
    for product in products:
        buy_logs = get_product_buy_logs(product)
        history_start = min((log.trade_date for log in buy_logs), default=product.purchase_date)
        history_end = product.sale_date if product.status == 'sold' and product.sale_date else date.today()

        history_points = []
        if not is_manual_price_product(product.product_code):
            fetched_histories = market_client.get_historical_prices(product.product_code, history_start, history_end)
            if fetched_histories:
                for history_row in fetched_histories:
                    upsert_price_history(product.id, history_row['date'], history_row['price'])
                product.current_price = fetched_histories[-1]['price']
                history_points = fetched_histories
                changed = True

        if not history_points:
            histories = PriceHistory.query.filter_by(product_id=product.id)
            if product.status == 'sold' and product.sale_date:
                histories = histories.filter(PriceHistory.record_date <= product.sale_date)
            history_points = [
                {'date': history.record_date, 'price': history.price}
                for history in histories.order_by(PriceHistory.record_date).all()
            ]

        buy_index = 0
        cumulative_quantity = 0.0
        cumulative_purchase_value = 0.0

        for history in history_points:
            record_date = history['date']
            price = history['price']

            while buy_index < len(buy_logs) and buy_logs[buy_index].trade_date <= record_date:
                buy_log = buy_logs[buy_index]
                buy_quantity = float(buy_log.quantity or 0)
                buy_amount = float(buy_log.total_amount or trade_amount(buy_quantity, buy_log.price, product.unit_type))
                cumulative_quantity += buy_quantity
                cumulative_purchase_value += buy_amount
                buy_index += 1

            if cumulative_quantity <= 0:
                continue

            effective_purchase_price = Product.price_for_amount(
                cumulative_purchase_value,
                cumulative_quantity,
                product.unit_type
            )
            purchase_value = cumulative_purchase_value
            evaluation_value = Product.amount_for(cumulative_quantity, price, product.unit_type)
            profit_loss = evaluation_value - purchase_value
            profit_rate = (profit_loss / purchase_value * 100) if purchase_value else 0
            price_profit_loss = float(price or 0) - float(effective_purchase_price or 0)
            price_return_rate = (price_profit_loss / float(effective_purchase_price) * 100) if effective_purchase_price else 0
            rows.append({
                'product_id': product.id,
                'product_name': product.product_name,
                'product_code': product.product_code,
                'asset_type': product.asset_type,
                'status': product.status,
                'quantity': round(cumulative_quantity, 4),
                'unit_type': product.unit_type,
                'unit_label': '좌' if product.unit_type == 'unit' else '주',
                'purchase_price': round(effective_purchase_price, 4),
                'purchase_value': round(purchase_value, 2),
                'price': price,
                'evaluation_value': round(evaluation_value, 2),
                'profit_loss': round(profit_loss, 2),
                'profit_rate': round(profit_rate, 2),
                'price_return_rate': round(price_return_rate, 2),
                'record_date': record_date.isoformat()
            })
    return rows, changed


def refresh_domain_models(user_id, account_names):
    selected_names = [normalize_account_name(name) for name in account_names if normalize_account_name(name)]
    profiles = {
        profile.account_name: profile
        for profile in AccountProfile.query.filter(
            AccountProfile.user_id == user_id,
            AccountProfile.account_name.in_(selected_names)
        ).all()
    }
    wrappers_by_name = {}
    now = datetime.utcnow()

    for account_name in selected_names:
        profile = profiles.get(account_name) or get_account_profile(user_id, account_name)
        wrapper = AccountWrapper.query.filter_by(user_id=user_id, account_name=account_name).first()
        if not wrapper:
            wrapper = AccountWrapper(user_id=user_id, account_name=account_name)
            db.session.add(wrapper)
            db.session.flush()
        wrapper.wrapper_type = map_wrapper_type(profile.account_type, profile.account_category)
        wrapper.provider = 'manual'
        wrapper.nickname = account_name
        wrapper.base_currency = 'KRW'
        wrapper.tags_json = canonical_json([
            get_account_type_label(normalize_account_type(profile.account_type)),
            get_account_category_label(profile.account_category, profile.account_type)
        ])
        wrapper.source = 'portfolio_ledger'
        wrapper.as_of = now
        wrapper.latency_class = 'eod'
        wrapper.reconciled = False
        wrappers_by_name[account_name] = wrapper

    wrapper_ids = [wrapper.id for wrapper in wrappers_by_name.values()]
    HoldingLot.query.filter(
        HoldingLot.user_id == user_id,
        HoldingLot.account_wrapper_id.in_(wrapper_ids)
    ).delete(synchronize_session=False)
    CashFlow.query.filter(
        CashFlow.user_id == user_id,
        CashFlow.account_wrapper_id.in_(wrapper_ids)
    ).delete(synchronize_session=False)
    PortfolioSnapshot.query.filter(
        PortfolioSnapshot.user_id == user_id,
        db.or_(
            PortfolioSnapshot.account_wrapper_id.in_(wrapper_ids),
            PortfolioSnapshot.account_name == '__all__'
        )
    ).delete(synchronize_session=False)

    price_series_rows = []
    snapshots_payload = []

    for account_name in selected_names:
        wrapper = wrappers_by_name[account_name]
        products = Product.query.filter_by(user_id=user_id, account_name=account_name).all()
        product_map = {product.id: product for product in products}
        name_map = {
            str(product.product_name or '').strip().lower(): market_client.clean_code(product.product_code) or product.product_name
            for product in products
        }
        logs = (
            TradeLog.query
            .filter_by(user_id=user_id, account_name=account_name)
            .order_by(TradeLog.trade_date.asc(), TradeLog.id.asc())
            .all()
        )

        lot_queues = {}
        daily_flow_map = {}
        daily_dividend = {}
        daily_fee = {}
        daily_tax = {}

        for log in logs:
            symbol = get_symbol_for_log(log, product_map, name_map)
            if not symbol:
                continue

            flow_type, signed_amount = classify_cash_flow(log)
            flow_date = log.trade_date
            daily_flow_map[flow_date] = daily_flow_map.get(flow_date, 0.0) + signed_amount
            if flow_type == 'dividend':
                daily_dividend[flow_date] = daily_dividend.get(flow_date, 0.0) + abs(signed_amount)
            elif flow_type == 'fee':
                daily_fee[flow_date] = daily_fee.get(flow_date, 0.0) + abs(signed_amount)
            elif flow_type == 'tax':
                daily_tax[flow_date] = daily_tax.get(flow_date, 0.0) + abs(signed_amount)

            db.session.add(CashFlow(
                user_id=user_id,
                account_wrapper_id=wrapper.id,
                account_name=account_name,
                flow_date=flow_date,
                flow_type=flow_type,
                amount=round(signed_amount, 6),
                symbol=symbol,
                fee=round(abs(signed_amount), 6) if flow_type == 'fee' else 0.0,
                tax=round(abs(signed_amount), 6) if flow_type == 'tax' else 0.0,
                dividend=round(abs(signed_amount), 6) if flow_type == 'dividend' else 0.0,
                notes=log.notes,
                source='portfolio_ledger',
                as_of=now,
                latency_class='eod',
                reconciled=False
            ))

            if flow_type == 'buy':
                lot_queues.setdefault(symbol, []).append({
                    'product_name': str(log.product_name or symbol),
                    'asset_type': str(log.asset_type or 'risk'),
                    'quantity': float(log.quantity or 0),
                    'unit_cost': float(log.price or 0),
                    'unit_type': normalize_unit_type(log.unit_type),
                    'acquired_at': log.trade_date
                })
            elif flow_type == 'sell':
                remaining = float(log.quantity or 0)
                queue = lot_queues.setdefault(symbol, [])
                while remaining > 0 and queue:
                    head = queue[0]
                    head_qty = float(head.get('quantity') or 0)
                    if head_qty <= remaining + 1e-9:
                        remaining -= head_qty
                        queue.pop(0)
                    else:
                        head['quantity'] = round(head_qty - remaining, 8)
                        remaining = 0

        for symbol, queue in lot_queues.items():
            for lot in queue:
                lot_qty = float(lot.get('quantity') or 0)
                if lot_qty <= 0:
                    continue
                db.session.add(HoldingLot(
                    user_id=user_id,
                    account_wrapper_id=wrapper.id,
                    account_name=account_name,
                    symbol=symbol,
                    product_name=str(lot.get('product_name') or symbol),
                    asset_type=str(lot.get('asset_type') or 'risk'),
                    quantity=round(lot_qty, 8),
                    unit_type=normalize_unit_type(lot.get('unit_type')),
                    unit_cost=round(float(lot.get('unit_cost') or 0), 8),
                    fee=0.0,
                    tax=0.0,
                    acquired_at=lot.get('acquired_at') or date.today(),
                    source='portfolio_ledger',
                    as_of=now,
                    latency_class='eod',
                    reconciled=False
                ))

        trend_rows, changed = collect_account_trend_rows(user_id, account_name, include_sold=True, sync_prices=False)
        if changed:
            db.session.flush()
        grouped = {}
        for row in trend_rows:
            record_date = row.get('record_date')
            if not record_date:
                continue
            grouped.setdefault(record_date, []).append(row)
            symbol = market_client.clean_code(row.get('product_code')) or str(row.get('product_name') or '')
            price_series_rows.append({
                'account_wrapper_id': wrapper.id,
                'account_name': account_name,
                'product_id': f'{wrapper.id}:{symbol}',
                'product_name': row.get('product_name'),
                'product_code': row.get('product_code'),
                'asset_type': row.get('asset_type'),
                'quantity': row.get('quantity'),
                'price': row.get('price'),
                'evaluation_value': row.get('evaluation_value'),
                'purchase_value': row.get('purchase_value'),
                'record_date': record_date
            })

        cash_balance = float(get_cash_balance(user_id, account_name).amount or 0)
        for record_date, rows in grouped.items():
            snapshot_date = datetime.strptime(record_date, '%Y-%m-%d').date()
            market_value = sum(float(item.get('evaluation_value') or 0) for item in rows)
            cost_basis = sum(float(item.get('purchase_value') or 0) for item in rows)
            snapshot_payload = {
                'holdings': rows,
                'account_wrapper_id': wrapper.id,
                'account_name': account_name
            }
            net_flow = daily_flow_map.get(snapshot_date, 0.0)
            dividend_value = daily_dividend.get(snapshot_date, 0.0)
            fee_value = daily_fee.get(snapshot_date, 0.0)
            tax_value = daily_tax.get(snapshot_date, 0.0)
            db.session.add(PortfolioSnapshot(
                user_id=user_id,
                account_wrapper_id=wrapper.id,
                account_name=account_name,
                snapshot_date=snapshot_date,
                market_value=round(market_value, 6),
                cost_basis=round(cost_basis, 6),
                cash_balance=round(cash_balance, 6),
                net_flow=round(net_flow, 6),
                dividend=round(dividend_value, 6),
                fee=round(fee_value, 6),
                tax=round(tax_value, 6),
                payload_json=canonical_json(snapshot_payload),
                source='portfolio_ledger',
                as_of=now,
                latency_class='eod',
                reconciled=False
            ))
            snapshots_payload.append({
                'account_wrapper_id': wrapper.id,
                'account_name': account_name,
                'snapshot_date': record_date,
                'market_value': round(market_value, 6),
                'cost_basis': round(cost_basis, 6),
                'cash_balance': round(cash_balance, 6),
                'net_flow': round(net_flow, 6),
                'dividend': round(dividend_value, 6),
                'fee': round(fee_value, 6),
                'tax': round(tax_value, 6),
                'holdings': rows
            })

        benchmark = Benchmark.query.filter_by(
            user_id=user_id,
            account_wrapper_id=wrapper.id,
            code='069500'
        ).first()
        if not benchmark:
            benchmark = Benchmark(
                user_id=user_id,
                account_wrapper_id=wrapper.id,
                code='069500',
                name='KODEX 200',
                provider='krx',
                is_default=True
            )
            db.session.add(benchmark)
        benchmark.as_of = now
        benchmark.latency_class = 'delayed'
        benchmark.reconciled = False

    aggregate_by_date = {}
    for row in snapshots_payload:
        key = row['snapshot_date']
        bucket = aggregate_by_date.setdefault(key, {
            'market_value': 0.0,
            'cost_basis': 0.0,
            'cash_balance': 0.0,
            'net_flow': 0.0,
            'dividend': 0.0,
            'fee': 0.0,
            'tax': 0.0,
            'holdings': []
        })
        bucket['market_value'] += float(row.get('market_value') or 0)
        bucket['cost_basis'] += float(row.get('cost_basis') or 0)
        bucket['cash_balance'] += float(row.get('cash_balance') or 0)
        bucket['net_flow'] += float(row.get('net_flow') or 0)
        bucket['dividend'] += float(row.get('dividend') or 0)
        bucket['fee'] += float(row.get('fee') or 0)
        bucket['tax'] += float(row.get('tax') or 0)
        bucket['holdings'].extend(row.get('holdings') or [])

    for date_key, bucket in aggregate_by_date.items():
        snapshot_date = datetime.strptime(date_key, '%Y-%m-%d').date()
        db.session.add(PortfolioSnapshot(
            user_id=user_id,
            account_wrapper_id=None,
            account_name='__all__',
            snapshot_date=snapshot_date,
            market_value=round(bucket['market_value'], 6),
            cost_basis=round(bucket['cost_basis'], 6),
            cash_balance=round(bucket['cash_balance'], 6),
            net_flow=round(bucket['net_flow'], 6),
            dividend=round(bucket['dividend'], 6),
            fee=round(bucket['fee'], 6),
            tax=round(bucket['tax'], 6),
            payload_json=canonical_json({'holdings': bucket['holdings'], 'account_name': '__all__'}),
            source='portfolio_ledger',
            as_of=now,
            latency_class='eod',
            reconciled=False
        ))

    return wrappers_by_name, price_series_rows, now


def create_import_batch(user_id, account_name, batch_type='manual_write', source_name='ui', row_count=1, notes=None):
    batch = ImportBatch(
        user_id=user_id,
        account_name=normalize_account_name(account_name),
        batch_type=str(batch_type or 'manual_write').strip() or 'manual_write',
        source_name=str(source_name or 'ui').strip() or 'ui',
        status='pending',
        row_count=max(int(row_count or 0), 0),
        notes_json=canonical_json(notes or {})
    )
    db.session.add(batch)
    db.session.flush()
    return batch


def finalize_import_batch(batch, status='completed', imported_count=0, skipped_count=0, error_count=0, notes=None):
    if not batch:
        return None
    batch.status = status
    batch.imported_count = max(int(imported_count or 0), 0)
    batch.skipped_count = max(int(skipped_count or 0), 0)
    batch.error_count = max(int(error_count or 0), 0)
    if notes is not None:
        batch.notes_json = canonical_json(notes)
    batch.completed_at = datetime.utcnow()
    return batch


IMPORT_COLUMN_ALIASES = {
    'trade_date': ['trade_date', 'date', '매매일', '거래일', '일자', '체결일'],
    'product_name': ['product_name', 'name', '종목명', '상품명'],
    'product_code': ['product_code', 'code', '종목코드', '상품코드', '코드'],
    'trade_type': ['trade_type', 'type', '구분', '매매구분', '거래유형', '유형'],
    'quantity': ['quantity', 'qty', '수량', '주수', '좌수'],
    'unit_type': ['unit_type', 'unit', '단위'],
    'price': ['price', '단가', '체결가', '매입가', '매도가', '기준가'],
    'total_amount': ['total_amount', 'amount', '금액', '총액', '거래금액', '매매금액'],
    'asset_type': ['asset_type', 'asset', '자산구분', '자산구분값'],
    'notes': ['notes', 'memo', '비고', '메모']
}

IMPORT_TEMPLATE_HEADERS = [
    'trade_date',
    'product_name',
    'product_code',
    'trade_type',
    'quantity',
    'unit_type',
    'price',
    'total_amount',
    'asset_type',
    'notes'
]

IMPORT_TEMPLATE_ROWS = [
    ['2026-04-01', 'KODEX AI전력핵심설비', '487240', 'buy', '2', 'share', '10000', '20000', 'risk', '첫 매수'],
    ['2026-04-10', 'KODEX AI전력핵심설비', '487240', 'buy', '1', 'share', '12000', '12000', 'risk', '추가 매수'],
    ['2026-04-17', 'KODEX AI전력핵심설비', '487240', 'sell', '1', 'share', '13000', '13000', 'risk', '부분 매도']
]


def normalize_import_trade_type(value):
    raw = str(value or '').strip().lower()
    if raw in ('buy', '매수', 'b'):
        return 'buy'
    if raw in ('sell', '매도', 's'):
        return 'sell'
    return ''


def normalize_import_asset_type(value):
    raw = str(value or '').strip().lower()
    if raw in ('safe', '안전자산', '안전'):
        return 'safe'
    if raw in ('cash', '현금'):
        return 'cash'
    return 'risk'


def normalize_import_unit_type(value):
    raw = str(value or '').strip().lower()
    return 'unit' if raw in ('unit', '좌', '좌수') else 'share'


def read_import_csv_rows(file_storage):
    raw = file_storage.read() if file_storage else b''
    if not raw:
        raise ValueError('업로드된 파일이 비어 있습니다.')

    text = None
    for encoding in ('utf-8-sig', 'cp949', 'euc-kr'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError('CSV 인코딩을 해석하지 못했습니다. UTF-8 또는 CP949 파일을 사용하세요.')

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError('CSV 헤더를 찾지 못했습니다.')

    field_map = {}
    lowered = {str(name or '').strip().lower(): name for name in reader.fieldnames}
    for target, aliases in IMPORT_COLUMN_ALIASES.items():
        mapped = None
        for alias in aliases:
            alias_key = str(alias).strip().lower()
            if alias_key in lowered:
                mapped = lowered[alias_key]
                break
        field_map[target] = mapped

    required = ('trade_date', 'product_name', 'trade_type', 'quantity', 'price')
    missing = [column for column in required if not field_map.get(column)]
    if missing:
        raise ValueError(f'필수 컬럼이 부족합니다: {", ".join(missing)}')

    rows = []
    for index, row in enumerate(reader, start=2):
        rows.append({
            'row_index': index,
            'raw': row,
            'trade_date': str(row.get(field_map['trade_date']) or '').strip(),
            'product_name': str(row.get(field_map['product_name']) or '').strip(),
            'product_code': market_client.clean_code(row.get(field_map['product_code']) or ''),
            'trade_type': normalize_import_trade_type(row.get(field_map['trade_type'])),
            'quantity': str(row.get(field_map['quantity']) or '').strip(),
            'unit_type': normalize_import_unit_type(row.get(field_map['unit_type'])),
            'price': str(row.get(field_map['price']) or '').strip(),
            'total_amount': str(row.get(field_map['total_amount']) or '').strip(),
            'asset_type': normalize_import_asset_type(row.get(field_map['asset_type'])),
            'notes': str(row.get(field_map['notes']) or '').strip()
        })
    return rows


def build_import_row_fingerprint(row):
    product_name = str(row.get('product_name') or '').strip().lower()
    product_code = market_client.clean_code(row.get('product_code') or '')
    trade_type = str(row.get('trade_type') or '').strip().lower()
    trade_date = str(row.get('trade_date') or '').strip()
    quantity = round(float(row.get('quantity') or 0), 8)
    price = round(float(row.get('price') or 0), 8)
    total_amount = round(float(row.get('total_amount') or 0), 6)
    return canonical_json({
        'product_name': product_name,
        'product_code': product_code,
        'trade_type': trade_type,
        'trade_date': trade_date,
        'quantity': quantity,
        'price': price,
        'total_amount': total_amount
    })


def normalize_import_rows_for_preview(rows):
    normalized_rows = []
    issues = []

    for row in rows:
        row_index = row['row_index']
        errors = []
        product_name = str(row.get('product_name') or '').strip()
        trade_type = normalize_import_trade_type(row.get('trade_type'))

        if not product_name:
            errors.append('종목명 누락')
        if trade_type not in ('buy', 'sell'):
            errors.append('trade_type은 buy/sell(매수/매도)만 허용')

        try:
            trade_date = parse_trade_date(row.get('trade_date'))
        except Exception:
            trade_date = None
            errors.append('trade_date 형식 오류(YYYY-MM-DD)')

        try:
            quantity = parse_positive_float(row.get('quantity'), 'quantity')
        except Exception as error:
            quantity = None
            errors.append(str(error))

        try:
            price = parse_positive_float(row.get('price'), 'price')
        except Exception as error:
            price = None
            errors.append(str(error))

        unit_type = normalize_import_unit_type(row.get('unit_type'))
        total_amount = None
        if row.get('total_amount') not in (None, ''):
            try:
                total_amount = parse_positive_float(row.get('total_amount'), 'total_amount')
            except Exception as error:
                errors.append(str(error))
        elif quantity and price:
            total_amount = trade_amount(quantity, price, unit_type)

        normalized = {
            'row_index': row_index,
            'product_name': product_name,
            'product_code': market_client.clean_code(row.get('product_code') or ''),
            'trade_type': trade_type,
            'trade_date': trade_date.isoformat() if trade_date else '',
            'quantity': quantity,
            'unit_type': unit_type,
            'price': price,
            'total_amount': total_amount,
            'asset_type': normalize_import_asset_type(row.get('asset_type')),
            'notes': str(row.get('notes') or '').strip()
        }

        if errors:
            issues.append({
                'row_index': row_index,
                'severity': 'error',
                'reasons': errors,
                'row': normalized
            })
            normalized['action'] = 'ignored'
            normalized['status'] = 'error'
        else:
            normalized['action'] = 'new'
            normalized['status'] = 'ok'
            normalized['fingerprint'] = build_import_row_fingerprint(normalized)
        normalized_rows.append(normalized)

    return normalized_rows, issues


def classify_import_rows(user_id, account_name, normalized_rows, issues):
    account_name = normalize_account_name(account_name)
    existing_logs = (
        TradeLog.query
        .filter_by(user_id=user_id, account_name=account_name)
        .all()
    )
    account_products = Product.query.filter_by(user_id=user_id, account_name=account_name).all()

    product_by_code = {}
    product_by_name = {}
    for product in account_products:
        code_key = market_client.clean_code(product.product_code)
        name_key = str(product.product_name or '').strip().lower()
        if code_key:
            product_by_code[code_key] = product
        if name_key:
            product_by_name[name_key] = product

    product_ids = {log.product_id for log in existing_logs if log.product_id}
    product_code_map = {}
    if product_ids:
        for product_row in Product.query.filter(Product.id.in_(product_ids)).all():
            product_code_map[product_row.id] = market_client.clean_code(product_row.product_code)

    existing_fingerprints = {}
    conflict_keys = {}
    for log in existing_logs:
        mapped_code = product_code_map.get(log.product_id, '')
        key = canonical_json({
            'product_name': str(log.product_name or '').strip().lower(),
            'product_code': mapped_code,
            'trade_type': str(log.trade_type or '').strip().lower(),
            'trade_date': log.trade_date.isoformat() if log.trade_date else '',
            'quantity': round(float(log.quantity or 0), 8),
            'price': round(float(log.price or 0), 8),
            'total_amount': round(float(log.total_amount or 0), 6)
        })
        existing_fingerprints.setdefault(key, []).append(log.id)

        conflict_key = canonical_json({
            'product_name': str(log.product_name or '').strip().lower(),
            'product_code': mapped_code,
            'trade_type': str(log.trade_type or '').strip().lower(),
            'trade_date': log.trade_date.isoformat() if log.trade_date else ''
        })
        bucket = conflict_keys.setdefault(conflict_key, {'ids': [], 'logs': []})
        bucket['ids'].append(log.id)
        bucket['logs'].append({
            'id': log.id,
            'product_name': log.product_name,
            'product_code': mapped_code,
            'trade_type': log.trade_type,
            'trade_date': log.trade_date.isoformat() if log.trade_date else None,
            'quantity': float(log.quantity or 0),
            'price': float(log.price or 0),
            'total_amount': float(log.total_amount or 0)
        })

    imported = 0
    duplicate = 0
    conflict = 0
    ignored = len(issues)

    for row in normalized_rows:
        if row.get('status') == 'error':
            continue
        row_code = market_client.clean_code(row.get('product_code') or '')
        row_name_key = str(row.get('product_name') or '').strip().lower()
        mapped_product = product_by_code.get(row_code) or product_by_name.get(row_name_key)
        if mapped_product:
            row['mapping_hint'] = {
                'product_id': mapped_product.id,
                'product_name': mapped_product.product_name,
                'product_code': mapped_product.product_code,
                'status': mapped_product.status
            }

        fingerprint = row.get('fingerprint') or build_import_row_fingerprint(row)
        if fingerprint in existing_fingerprints:
            row['action'] = 'duplicate'
            row['status'] = 'duplicate'
            row['duplicate_log_ids'] = existing_fingerprints.get(fingerprint, [])
            duplicate += 1
            continue

        conflict_key = canonical_json({
            'product_name': str(row.get('product_name') or '').strip().lower(),
            'product_code': market_client.clean_code(row.get('product_code') or ''),
            'trade_type': str(row.get('trade_type') or '').strip().lower(),
            'trade_date': str(row.get('trade_date') or '').strip()
        })
        if conflict_key in conflict_keys:
            conflict_payload = conflict_keys[conflict_key]
            row['action'] = 'conflict'
            row['status'] = 'warning'
            row['conflict_with'] = conflict_payload.get('ids', [])
            row['conflict_with_logs'] = conflict_payload.get('logs', [])
            conflict += 1
            continue

        row['action'] = 'new'
        row['status'] = 'ok'
        imported += 1

    summary = {
        'row_count': len(normalized_rows),
        'new_count': imported,
        'duplicate_count': duplicate,
        'conflict_count': conflict,
        'ignored_count': ignored,
        'issue_count': len(issues)
    }
    return summary


def find_import_target_product(user_id, account_name, row):
    account_name = normalize_account_name(account_name)
    code = market_client.clean_code(row.get('product_code') or '')
    name = str(row.get('product_name') or '').strip()

    query = Product.query.filter_by(user_id=user_id, account_name=account_name)
    if code:
        product = query.filter_by(product_code=code).order_by(Product.id.desc()).first()
        if product:
            return product
    return query.filter_by(product_name=name).order_by(Product.id.desc()).first()


def apply_import_trade_row(user_id, account_name, row, batch_id, forced_product_id=None):
    trade_type = row['trade_type']
    quantity = float(row['quantity'])
    price = float(row['price'])
    unit_type = normalize_import_unit_type(row.get('unit_type'))
    trade_date = parse_trade_date(row['trade_date'])
    total_amount = float(row.get('total_amount') or trade_amount(quantity, price, unit_type))
    product_name = str(row.get('product_name') or '').strip()
    product_code = market_client.clean_code(row.get('product_code') or '')
    asset_type = normalize_import_asset_type(row.get('asset_type'))

    product = None
    if forced_product_id is not None:
        product = Product.query.filter_by(
            id=int(forced_product_id),
            user_id=user_id,
            account_name=normalize_account_name(account_name)
        ).first()
    if not product:
        product = find_import_target_product(user_id, account_name, row)
    if trade_type == 'sell' and not product:
        raise ValueError(f'매도 대상 상품을 찾지 못했습니다: {product_name}')

    if trade_type == 'buy' and not product:
        product = Product(
            user_id=user_id,
            account_name=normalize_account_name(account_name),
            product_name=product_name,
            product_code=product_code,
            purchase_price=price,
            quantity=quantity,
            unit_type=unit_type,
            purchase_date=trade_date,
            asset_type=asset_type,
            current_price=price,
            status='holding'
        )
        db.session.add(product)
        db.session.flush()

    if product:
        product.product_name = product_name or product.product_name
        if product_code:
            product.product_code = product_code
        product.asset_type = asset_type or product.asset_type
        if not product.unit_type:
            product.unit_type = unit_type

    trade_log = TradeLog(
        user_id=user_id,
        account_name=normalize_account_name(account_name),
        product_id=product.id if product else None,
        product_name=product_name,
        trade_type=trade_type,
        quantity=quantity,
        unit_type=unit_type,
        price=price,
        total_amount=total_amount,
        trade_date=trade_date,
        asset_type=asset_type,
        notes=str(row.get('notes') or '')
    )
    db.session.add(trade_log)
    db.session.flush()

    if product:
        sync_product_from_trade_log(trade_log)
        if trade_type == 'sell':
            latest_product = Product.query.filter_by(id=product.id).first()
            if latest_product and latest_product.status != 'sold':
                latest_product.status = 'sold'
                latest_product.sale_date = trade_date
                latest_product.sale_price = price

    event = append_trade_event(
        user_id=user_id,
        account_name=normalize_account_name(account_name),
        event_type='trade_created',
        trade_log_id=trade_log.id,
        product_id=trade_log.product_id,
        import_batch_id=batch_id,
        payload={
            'trade_log': serialize_trade_log(trade_log),
            'product': serialize_product(Product.query.filter_by(id=trade_log.product_id).first() if trade_log.product_id else None),
            'reason': 'csv_import_commit'
        }
    )
    capture_trade_snapshot(
        user_id,
        normalize_account_name(account_name),
        import_batch_id=batch_id,
        trade_event_id=event.id,
        product=Product.query.filter_by(id=trade_log.product_id).first() if trade_log.product_id else None,
        snapshot_payload=serialize_trade_log(trade_log),
        snapshot_kind='import_commit'
    )
    return trade_log, event


def build_import_commit_projection(rows, *, apply_conflicts=False, conflict_row_indexes=None, row_mapping_overrides=None):
    selected_conflict_rows = {
        int(item) for item in (conflict_row_indexes or [])
        if str(item).strip().isdigit()
    }
    mapping_overrides = {}
    for key, value in (row_mapping_overrides or {}).items():
        try:
            row_index = int(key)
            product_id = int(value)
        except (TypeError, ValueError):
            continue
        if row_index > 0 and product_id > 0:
            mapping_overrides[row_index] = product_id

    imported_count = 0
    skipped_count = 0
    selected_conflicts = []

    for row in rows:
        action = str(row.get('action') or '')
        row_index = int(row.get('row_index') or 0)

        if action in ('ignored', 'duplicate'):
            skipped_count += 1
            continue

        if action == 'conflict':
            should_import = bool(apply_conflicts or row_index in selected_conflict_rows)
            if should_import:
                imported_count += 1
                selected_conflicts.append({
                    'row_index': row_index,
                    'product_name': row.get('product_name'),
                    'product_code': row.get('product_code'),
                    'mapped_product_id': mapping_overrides.get(row_index),
                    'mapping_hint': row.get('mapping_hint') or {}
                })
            else:
                skipped_count += 1
            continue

        if action == 'new':
            imported_count += 1
            continue

        skipped_count += 1

    return {
        'total_rows': len(rows),
        'imported_count': imported_count,
        'skipped_count': skipped_count,
        'selected_conflict_count': len(selected_conflicts),
        'mapped_conflict_count': sum(1 for item in selected_conflicts if item.get('mapped_product_id')),
        'selected_conflicts': selected_conflicts
    }


def build_projection_signature(projection):
    payload = canonical_json(projection or {})
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def capture_trade_snapshot(
    user_id,
    account_name,
    *,
    import_batch_id=None,
    trade_event_id=None,
    product=None,
    snapshot_payload=None,
    snapshot_kind='post_event',
    snapshot_date=None
):
    payload = snapshot_payload or serialize_product(product) or {}
    balance = CashBalance.query.filter_by(user_id=user_id, account_name=normalize_account_name(account_name)).first() if user_id else None
    cash_balance = balance.amount if balance else 0
    quantity = payload.get('quantity') if isinstance(payload, dict) else None
    purchase_price = payload.get('purchase_price') if isinstance(payload, dict) else None
    current_price = None
    market_value = None
    cost_basis = None

    if isinstance(payload, dict):
        current_price = payload.get('current_price')
        if current_price in (None, ''):
            current_price = payload.get('price')
        market_value = payload.get('current_value')
        if market_value in (None, ''):
            market_value = payload.get('evaluation_value')
        cost_basis = payload.get('total_purchase_value')
        if cost_basis in (None, ''):
            cost_basis = payload.get('purchase_value')

    snapshot = TradeSnapshot(
        user_id=user_id,
        account_name=normalize_account_name(account_name),
        import_batch_id=import_batch_id,
        trade_event_id=trade_event_id,
        product_id=(product.id if product else payload.get('id') if isinstance(payload, dict) else None),
        snapshot_kind=snapshot_kind,
        snapshot_date=snapshot_date or datetime.utcnow(),
        quantity=coerce_float(quantity),
        purchase_price=coerce_float(purchase_price),
        current_price=coerce_float(current_price),
        market_value=coerce_float(market_value),
        cost_basis=coerce_float(cost_basis),
        cash_balance=coerce_float(cash_balance),
        payload_json=canonical_json(payload if isinstance(payload, dict) else {'value': payload})
    )
    db.session.add(snapshot)
    db.session.flush()
    return snapshot


def compute_account_reconciliation(user_id, account_name):
    normalized_account_name = normalize_account_name(account_name)
    details = []
    tolerance = 0.0001

    products = Product.query.filter_by(user_id=user_id, account_name=normalized_account_name).all()
    for product in products:
        buy_logs = [log for log in get_product_trade_logs(product) if log.trade_type == 'buy']
        sell_logs = [log for log in get_product_trade_logs(product) if log.trade_type == 'sell']
        if not buy_logs:
            details.append({
                'type': 'missing_buy_logs',
                'product_id': product.id,
                'product_name': product.product_name,
                'message': '보유 상품에 연결된 매수 로그가 없습니다.'
            })
            continue

        expected_quantity = sum(float(log.quantity or 0) for log in buy_logs)
        expected_cost = sum(float(log.total_amount or 0) for log in buy_logs)
        expected_unit_type = normalize_unit_type(buy_logs[-1].unit_type or product.unit_type)
        expected_purchase_price = Product.price_for_amount(expected_cost, expected_quantity, expected_unit_type)
        expected_status = 'sold' if sell_logs else 'holding'

        if abs(float(product.quantity or 0) - expected_quantity) > tolerance:
            details.append({
                'type': 'quantity_mismatch',
                'product_id': product.id,
                'product_name': product.product_name,
                'expected': round(expected_quantity, 4),
                'actual': round(float(product.quantity or 0), 4)
            })

        if abs(float(product.purchase_price or 0) - expected_purchase_price) > 0.01:
            details.append({
                'type': 'cost_basis_mismatch',
                'product_id': product.id,
                'product_name': product.product_name,
                'expected': round(expected_purchase_price, 4),
                'actual': round(float(product.purchase_price or 0), 4)
            })

        if str(product.status or '') != expected_status:
            details.append({
                'type': 'status_mismatch',
                'product_id': product.id,
                'product_name': product.product_name,
                'expected': expected_status,
                'actual': product.status
            })

    orphan_logs = (
        TradeLog.query
        .filter_by(user_id=user_id, account_name=normalized_account_name)
        .filter(TradeLog.trade_type.in_(('buy', 'sell')))
        .filter(TradeLog.product_id.is_(None))
        .all()
    )
    for log in orphan_logs:
        details.append({
            'type': 'orphan_trade_log',
            'trade_log_id': log.id,
            'product_name': log.product_name,
            'trade_type': log.trade_type,
            'trade_date': log.trade_date.isoformat() if log.trade_date else None
        })

    return {
        'status': 'ok' if not details else 'warning',
        'mismatch_count': len(details),
        'details': details
    }


def store_reconciliation_result(user_id, account_name, *, import_batch_id=None, trade_event_id=None, scope='account'):
    summary = compute_account_reconciliation(user_id, account_name)
    result = ReconciliationResult(
        user_id=user_id,
        account_name=normalize_account_name(account_name),
        import_batch_id=import_batch_id,
        trade_event_id=trade_event_id,
        scope=scope,
        status=summary['status'],
        mismatch_count=summary['mismatch_count'],
        details_json=canonical_json(summary['details'])
    )
    db.session.add(result)
    db.session.flush()
    return result, summary


def get_latest_trade_event(user_id, account_name=None, trade_log_id=None):
    query = TradeEvent.query.filter_by(user_id=user_id)
    if account_name is not None:
        query = query.filter_by(account_name=normalize_account_name(account_name))
    if trade_log_id is not None:
        query = query.filter_by(trade_log_id=trade_log_id)
    return query.order_by(TradeEvent.id.desc()).first()


def append_trade_event(
    *,
    user_id,
    account_name,
    event_type,
    payload,
    trade_log_id=None,
    product_id=None,
    source_type='ui',
    source_id=None,
    import_batch_id=None,
    occurred_at=None
):
    normalized_account_name = normalize_account_name(account_name)
    event_time = occurred_at or datetime.utcnow()
    previous_account_event = get_latest_trade_event(user_id, normalized_account_name)
    superseded_event = get_latest_trade_event(user_id, normalized_account_name, trade_log_id) if trade_log_id else None
    payload_json = canonical_json(payload or {})
    hash_base = canonical_json({
        'user_id': user_id,
        'account_name': normalized_account_name,
        'trade_log_id': trade_log_id,
        'product_id': product_id,
        'event_type': event_type,
        'source_type': source_type,
        'source_id': source_id,
        'import_batch_id': import_batch_id,
        'prev_hash': previous_account_event.hash if previous_account_event else None,
        'supersedes_event_id': superseded_event.id if superseded_event else None,
        'occurred_at': event_time.isoformat(),
        'payload_json': payload_json
    })
    event_hash = hashlib.sha256(hash_base.encode('utf-8')).hexdigest()

    event = TradeEvent(
        user_id=user_id,
        account_name=normalized_account_name,
        trade_log_id=trade_log_id,
        product_id=product_id,
        event_type=event_type,
        source_type=source_type,
        source_id=source_id,
        import_batch_id=import_batch_id,
        prev_hash=previous_account_event.hash if previous_account_event else None,
        hash=event_hash,
        supersedes_event_id=superseded_event.id if superseded_event else None,
        payload_json=payload_json,
        occurred_at=event_time,
        created_by=user_id
    )
    db.session.add(event)
    db.session.flush()
    return event


def get_realized_positions(user_id, account_name=None):
    account_name = normalize_account_name(account_name)
    logs = (
        TradeLog.query
        .filter(TradeLog.user_id == user_id, TradeLog.account_name == account_name)
        .filter(TradeLog.trade_type.in_(('buy', 'sell')))
        .order_by(TradeLog.trade_date.asc(), TradeLog.id.asc())
        .all()
    )

    lots_by_key = {}
    realized = []
    for log in logs:
        normalized_name = str(log.product_name or '').strip().lower()
        position_key = f'account:{log.account_name}:name:{normalized_name}' if normalized_name else f'id:{log.product_id}'
        lots = lots_by_key.setdefault(position_key, [])
        quantity = float(log.quantity or 0)
        amount = float(log.total_amount or 0)

        if log.trade_type == 'buy':
            lots.append({
                'remaining_quantity': quantity,
                'remaining_amount': amount,
                'product_id': log.product_id,
                'product_name': log.product_name,
                'asset_type': log.asset_type,
                'trade_date': log.trade_date
            })
        elif log.trade_type == 'sell':
            remaining_quantity = quantity
            cost_amount = 0
            while remaining_quantity > 0 and lots:
                lot = lots[0]
                lot_quantity = float(lot['remaining_quantity'] or 0)
                lot_amount = float(lot['remaining_amount'] or 0)
                if lot_quantity <= 0:
                    lots.pop(0)
                    continue

                matched_quantity = min(remaining_quantity, lot_quantity)
                ratio = matched_quantity / lot_quantity
                matched_amount = lot_amount * ratio
                cost_amount += matched_amount
                lot['remaining_quantity'] = lot_quantity - matched_quantity
                lot['remaining_amount'] = lot_amount - matched_amount
                remaining_quantity -= matched_quantity

                if lot['remaining_quantity'] <= 0.0000001:
                    lots.pop(0)

            if amount <= 0 or cost_amount <= 0:
                continue

            profit_loss = amount - cost_amount
            profit_rate = profit_loss / cost_amount * 100 if cost_amount else 0
            realized.append({
                'position_key': position_key,
                'realized_log_id': log.id,
                'product_id': log.product_id,
                'product_name': log.product_name,
                'account_name': log.account_name,
                'asset_type': log.asset_type,
                'buy_amount': cost_amount,
                'sell_amount': amount,
                'profit_loss': profit_loss,
                'profit_rate': profit_rate,
                'sell_date': log.trade_date.isoformat()
            })

    total_buy = sum(row['buy_amount'] for row in realized)
    total_sell = sum(row['sell_amount'] for row in realized)
    total_profit = total_sell - total_buy
    total_rate = (total_profit / total_buy * 100) if total_buy else 0

    return {
        'total_buy_amount': round(total_buy, 2),
        'total_sell_amount': round(total_sell, 2),
        'total_profit_loss': round(total_profit, 2),
        'total_profit_rate': round(total_rate, 2),
        'sold_count': len(realized),
        'positions': [
            {
                **row,
                'buy_amount': round(row['buy_amount'], 2),
                'sell_amount': round(row['sell_amount'], 2),
                'profit_loss': round(row['profit_loss'], 2),
                'profit_rate': round(row['profit_rate'], 2)
            }
            for row in sorted(realized, key=lambda item: (item['sell_date'] or '', item['product_name']), reverse=True)
        ]
    }


def normalize_product_code(product):
    cleaned = market_client.clean_code(product.product_code)
    if cleaned and cleaned != product.product_code:
        product.product_code = cleaned
        return True
    return False


def refresh_product_market_data(product, start_date=None):
    if product.status == 'sold':
        return False, '이미 매도 완료된 상품입니다.'
    if not product.product_code:
        return False, '상품 코드가 비어 있습니다.'

    normalize_product_code(product)

    if is_manual_price_product(product.product_code):
        return False, '공개 시세 코드가 아닙니다. 상품/추이 > 상품 관리 > 새 기준가에 직접 입력하세요.'

    start_date = start_date or product.purchase_date
    histories = market_client.get_historical_prices(product.product_code, start_date, date.today())
    if histories:
        latest = histories[-1]
        for row in histories:
            upsert_price_history(product.id, row['date'], row['price'])
        product.current_price = latest['price']
        return True, None

    current = market_client.get_current_price(product.product_code)
    if current:
        product.current_price = current['price']
        upsert_price_history(product.id, current.get('date') or date.today(), current['price'])
        return True, None

    code_text = str(product.product_code).strip()
    if code_text.isdigit() and len(code_text) < 6:
        padded = code_text.zfill(6)
        return False, f'{padded} 자동조회 불가. 실제 KRX 공개 코드가 있으면 예: 0177N0 형태로, 펀드는 K55207BU0715 같은 표준코드로 입력하세요.'
    return False, '자동조회 불가. ETF는 6자리 공개 코드(예: 069500, 0177N0), 펀드는 표준코드(예: K55207BU0715)로 입력하세요.'


def sync_user_holdings(user_id, account_name=None):
    query = Product.query.filter_by(user_id=user_id, status='holding')
    if account_name:
        query = query.filter_by(account_name=normalize_account_name(account_name))
    products = query.all()
    result = []
    changed = False

    for product in products:
        latest_history = (
            PriceHistory.query
            .filter_by(product_id=product.id)
            .order_by(PriceHistory.record_date.desc())
            .first()
        )
        start_date = latest_history.record_date if latest_history else product.purchase_date
        before_price = product.current_price
        before_code = product.product_code
        ok, reason = refresh_product_market_data(product, start_date)
        changed = ok or product.product_code != before_code or changed
        result.append({
            'product_id': product.id,
            'product_name': product.product_name,
            'product_code': product.product_code,
            'success': ok,
            'reason': reason,
            'before_price': before_price,
            'current_price': product.current_price
        })

    if changed:
        db.session.commit()
    return result


def refresh_user_holdings(user_id):
    sync_user_holdings(user_id)


def to_rounded_float(value, digits=4):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return round(number, digits)


def calculate_sma(values, period):
    if len(values) < period or period <= 0:
        return None
    return sum(values[-period:]) / period


def calculate_std(values, period):
    if len(values) < period or period <= 1:
        return None
    window = values[-period:]
    mean = sum(window) / period
    variance = sum((value - mean) ** 2 for value in window) / period
    return math.sqrt(variance)


def calculate_rsi(values, period=14):
    if len(values) <= period:
        return None
    gains = []
    losses = []
    for previous, current in zip(values[:-1], values[1:]):
        delta = current - previous
        gains.append(max(delta, 0))
        losses.append(abs(min(delta, 0)))

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for index in range(period, len(gains)):
        avg_gain = ((avg_gain * (period - 1)) + gains[index]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[index]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def calculate_ema_series(values, period):
    if len(values) < period or period <= 0:
        return []
    multiplier = 2 / (period + 1)
    ema_values = [sum(values[:period]) / period]
    for price in values[period:]:
        ema_values.append((price - ema_values[-1]) * multiplier + ema_values[-1])
    return ema_values


def calculate_macd(values):
    if len(values) < 35:
        return {'macd': None, 'signal': None, 'histogram': None}
    ema12 = calculate_ema_series(values, 12)
    ema26 = calculate_ema_series(values, 26)
    if not ema12 or not ema26:
        return {'macd': None, 'signal': None, 'histogram': None}

    aligned_ema12 = ema12[-len(ema26):]
    macd_series = [fast - slow for fast, slow in zip(aligned_ema12, ema26)]
    signal_series = calculate_ema_series(macd_series, 9)
    if not signal_series:
        return {
            'macd': to_rounded_float(macd_series[-1]),
            'signal': None,
            'histogram': None
        }
    signal_value = signal_series[-1]
    macd_value = macd_series[-1]
    return {
        'macd': to_rounded_float(macd_value),
        'signal': to_rounded_float(signal_value),
        'histogram': to_rounded_float(macd_value - signal_value)
    }


def parse_optional_float(value, minimum=None, maximum=None):
    if value in (None, ''):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    if minimum is not None and number < minimum:
        number = minimum
    if maximum is not None and number > maximum:
        number = maximum
    return number


def annualized_volatility(values, period):
    if period <= 1 or len(values) <= period:
        return None
    window = [float(item) for item in values[-(period + 1):]]
    returns = []
    for previous, current in zip(window[:-1], window[1:]):
        if previous <= 0:
            continue
        returns.append(math.log(current / previous))
    if len(returns) < period // 2:
        return None
    avg = sum(returns) / len(returns)
    variance = sum((item - avg) ** 2 for item in returns) / len(returns)
    return math.sqrt(variance) * math.sqrt(252) * 100


def build_candidate_tags(item):
    name = str(item.get('name') or '').strip()
    product_type = str(item.get('type') or '').lower()
    normalized_name = re.sub(r'\s+', '', name).lower()

    is_etf = (
        'etf' in product_type
        or name.upper().startswith(('KODEX', 'TIGER', 'ARIRANG', 'KBSTAR', 'ACE', 'KOSEF'))
        or 'etn' in product_type
    )
    tags = ['domestic_stock']
    if is_etf:
        tags = ['etf_candidate']

    pension_keywords = ('연금', '배당', '인컴', '채권', 'trf', 'tdf', '저변동', '코스피200', 's&p500', '나스닥100')
    if is_etf and any(keyword in normalized_name for keyword in pension_keywords):
        tags.append('pension_candidate')
    return tags


def normalize_provider_fundamentals(provider_rows):
    normalized = {
        'pe': None,
        'pb': None,
        'ps': None,
        'roe': None,
        'operating_margin': None,
        'debt_to_equity': None,
        'dividend_yield': None,
        'beta': None,
        'source': 'manual'
    }
    for row in provider_rows:
        if not isinstance(row, dict):
            continue
        source = row.get('source')
        payload = row.get('payload') or {}
        if not isinstance(payload, dict):
            continue

        pe = parse_optional_float(payload.get('trailingPE'))
        pb = parse_optional_float(payload.get('priceToBook'))
        ps = parse_optional_float(payload.get('priceToSalesTrailing12Months'))
        roe = parse_optional_float(payload.get('returnOnEquity'))
        op_margin = parse_optional_float(payload.get('operatingMargins'))
        debt_to_equity = parse_optional_float(payload.get('debtToEquity'))
        dividend_yield = parse_optional_float(payload.get('dividendYield'))
        beta = parse_optional_float(payload.get('beta'))

        if normalized['pe'] is None and pe is not None:
            normalized['pe'] = pe
            normalized['source'] = source or normalized['source']
        if normalized['pb'] is None and pb is not None:
            normalized['pb'] = pb
            normalized['source'] = source or normalized['source']
        if normalized['ps'] is None and ps is not None:
            normalized['ps'] = ps
            normalized['source'] = source or normalized['source']
        if normalized['roe'] is None and roe is not None:
            normalized['roe'] = roe * 100 if abs(roe) <= 1 else roe
            normalized['source'] = source or normalized['source']
        if normalized['operating_margin'] is None and op_margin is not None:
            normalized['operating_margin'] = op_margin * 100 if abs(op_margin) <= 1 else op_margin
            normalized['source'] = source or normalized['source']
        if normalized['debt_to_equity'] is None and debt_to_equity is not None:
            normalized['debt_to_equity'] = debt_to_equity
            normalized['source'] = source or normalized['source']
        if normalized['dividend_yield'] is None and dividend_yield is not None:
            normalized['dividend_yield'] = dividend_yield * 100 if abs(dividend_yield) <= 1 else dividend_yield
            normalized['source'] = source or normalized['source']
        if normalized['beta'] is None and beta is not None:
            normalized['beta'] = beta
            normalized['source'] = source or normalized['source']
    return normalized


def fetch_normalized_fundamentals(code):
    cleaned_code = market_client.clean_code(code)
    if not cleaned_code:
        return normalize_provider_fundamentals([])

    cached = market_client.get_cached_value('screener_fundamentals', cleaned_code, 60 * 60 * 8)
    if cached is not None:
        return cached

    provider_rows = []
    try:
        import yfinance as yf
        symbol = market_client.normalize_symbol(cleaned_code)
        ticker = yf.Ticker(symbol)
        payload = {}
        try:
            info = ticker.info or {}
            payload.update(info if isinstance(info, dict) else {})
        except Exception:
            pass
        try:
            fast_info = ticker.fast_info
            if hasattr(fast_info, 'items'):
                payload.update(dict(fast_info.items()))
        except Exception:
            pass
        if payload:
            provider_rows.append({'source': 'yahoo', 'payload': payload})
    except Exception:
        provider_rows = []

    normalized = normalize_provider_fundamentals(provider_rows)
    market_client.set_cached_value('screener_fundamentals', cleaned_code, normalized)
    return normalized


def normalize_screener_filters(raw_filters):
    raw = raw_filters if isinstance(raw_filters, dict) else {}
    valuation = raw.get('valuation') if isinstance(raw.get('valuation'), dict) else {}
    momentum = raw.get('momentum') if isinstance(raw.get('momentum'), dict) else {}
    quality = raw.get('quality') if isinstance(raw.get('quality'), dict) else {}
    dividend = raw.get('dividend') if isinstance(raw.get('dividend'), dict) else {}
    volatility = raw.get('volatility') if isinstance(raw.get('volatility'), dict) else {}
    candidate = raw.get('candidate') if isinstance(raw.get('candidate'), dict) else {}

    include_missing = str(raw.get('missing_policy', candidate.get('missing_policy') or ('include' if raw.get('include_missing', True) else 'exclude'))).lower() != 'exclude'

    return {
        'rsi_min': parse_optional_float(raw.get('rsi_min', momentum.get('rsi_min')), 0, 100) if raw.get('rsi_min', momentum.get('rsi_min')) not in (None, '') else None,
        'rsi_max': parse_optional_float(raw.get('rsi_max', momentum.get('rsi_max')), 0, 100) if raw.get('rsi_max', momentum.get('rsi_max')) not in (None, '') else None,
        'min_return_20d': parse_optional_float(raw.get('min_return_20d', momentum.get('return_20d_min'))),
        'max_return_20d': parse_optional_float(raw.get('max_return_20d', momentum.get('return_20d_max'))),
        'require_ma_cross': bool(raw.get('require_ma_cross')),
        'require_bb_breakout': bool(raw.get('require_bb_breakout')),
        'require_macd_positive': bool(raw.get('require_macd_positive')),
        'pe_max': parse_optional_float(raw.get('pe_max', valuation.get('pe_max'))),
        'pb_max': parse_optional_float(raw.get('pb_max', valuation.get('pb_max'))),
        'ps_max': parse_optional_float(raw.get('ps_max', valuation.get('ps_max'))),
        'roe_min': parse_optional_float(raw.get('roe_min', quality.get('roe_min'))),
        'operating_margin_min': parse_optional_float(raw.get('operating_margin_min', quality.get('operating_margin_min'))),
        'debt_to_equity_max': parse_optional_float(raw.get('debt_to_equity_max', quality.get('debt_to_equity_max'))),
        'dividend_yield_min': parse_optional_float(raw.get('dividend_yield_min', dividend.get('yield_min'))),
        'volatility_30d_max': parse_optional_float(raw.get('volatility_30d_max', volatility.get('vol_30d_max'))),
        'volatility_90d_max': parse_optional_float(raw.get('volatility_90d_max', volatility.get('vol_90d_max'))),
        'volatility_1y_max': parse_optional_float(raw.get('volatility_1y_max', volatility.get('vol_1y_max'))),
        'include_etf_candidates': bool(raw.get('include_etf_candidates', candidate.get('include_etf_candidates', True))),
        'include_pension_candidates': bool(raw.get('include_pension_candidates', candidate.get('include_pension_candidates', True))),
        'include_missing': include_missing
    }


def has_fundamental_filters(filters):
    for key in (
        'pe_max',
        'pb_max',
        'ps_max',
        'roe_min',
        'operating_margin_min',
        'debt_to_equity_max',
        'dividend_yield_min'
    ):
        if filters.get(key) is not None:
            return True
    return False


def build_screener_condition_expression(filters):
    if not isinstance(filters, dict):
        return ''
    clauses = []
    if filters.get('rsi_min') is not None:
        clauses.append(f"RSI14 >= {filters['rsi_min']}")
    if filters.get('rsi_max') is not None:
        clauses.append(f"RSI14 <= {filters['rsi_max']}")
    if filters.get('min_return_20d') is not None:
        clauses.append(f"20d return >= {filters['min_return_20d']}%")
    if filters.get('max_return_20d') is not None:
        clauses.append(f"20d return <= {filters['max_return_20d']}%")
    if filters.get('pe_max') is not None:
        clauses.append(f"PE <= {filters['pe_max']}")
    if filters.get('pb_max') is not None:
        clauses.append(f"PB <= {filters['pb_max']}")
    if filters.get('ps_max') is not None:
        clauses.append(f"PS <= {filters['ps_max']}")
    if filters.get('roe_min') is not None:
        clauses.append(f"ROE >= {filters['roe_min']}%")
    if filters.get('operating_margin_min') is not None:
        clauses.append(f"OperatingMargin >= {filters['operating_margin_min']}%")
    if filters.get('debt_to_equity_max') is not None:
        clauses.append(f"Debt/Equity <= {filters['debt_to_equity_max']}")
    if filters.get('dividend_yield_min') is not None:
        clauses.append(f"DividendYield >= {filters['dividend_yield_min']}%")
    if filters.get('volatility_30d_max') is not None:
        clauses.append(f"Vol30d <= {filters['volatility_30d_max']}%")
    if filters.get('volatility_90d_max') is not None:
        clauses.append(f"Vol90d <= {filters['volatility_90d_max']}%")
    if filters.get('volatility_1y_max') is not None:
        clauses.append(f"Vol1y <= {filters['volatility_1y_max']}%")
    if filters.get('require_ma_cross'):
        clauses.append('MA5 > MA20')
    if filters.get('require_bb_breakout'):
        clauses.append('Price >= BollingerUpper')
    if filters.get('require_macd_positive'):
        clauses.append('MACD histogram > 0')
    if not filters.get('include_etf_candidates', True):
        clauses.append('exclude ETF candidates')
    if not filters.get('include_pension_candidates', True):
        clauses.append('exclude pension candidates')
    if not filters.get('include_missing', True):
        clauses.append('exclude missing metrics')
    return ' AND '.join(clauses)


def build_screener_snapshot(histories, fundamentals=None):
    closes = [float(row['price']) for row in histories if row.get('price') is not None]
    if len(closes) < 30:
        return None

    latest_price = closes[-1]
    ma5 = calculate_sma(closes, 5)
    ma20 = calculate_sma(closes, 20)
    ma60 = calculate_sma(closes, 60)
    std20 = calculate_std(closes, 20)
    upper_bb = ma20 + (std20 * 2) if ma20 is not None and std20 is not None else None
    lower_bb = ma20 - (std20 * 2) if ma20 is not None and std20 is not None else None
    rsi14 = calculate_rsi(closes, 14)
    macd = calculate_macd(closes)
    return_20d = ((latest_price / closes[-21]) - 1) * 100 if len(closes) > 21 and closes[-21] else None
    return_60d = ((latest_price / closes[-61]) - 1) * 100 if len(closes) > 61 and closes[-61] else None
    return_120d = ((latest_price / closes[-121]) - 1) * 100 if len(closes) > 121 and closes[-121] else None
    ma_gap = ((ma5 / ma20) - 1) * 100 if ma5 and ma20 else None
    bb_percent = ((latest_price - lower_bb) / (upper_bb - lower_bb) * 100) if upper_bb and lower_bb and upper_bb > lower_bb else None
    vol30 = annualized_volatility(closes, 30)
    vol90 = annualized_volatility(closes, 90)
    vol252 = annualized_volatility(closes, 252)
    fundamentals = fundamentals or {}

    signals = []
    if ma5 and ma20 and ma5 > ma20:
        signals.append('MA5>MA20')
    if upper_bb and latest_price >= upper_bb:
        signals.append('볼린저 상단')
    if macd.get('histogram') is not None and macd['histogram'] > 0:
        signals.append('MACD+')
    if rsi14 is not None and 45 <= rsi14 <= 65:
        signals.append('RSI 중립 강세')

    return {
        'price': to_rounded_float(latest_price, 2),
        'price_date': histories[-1]['date'].isoformat(),
        'ma5': to_rounded_float(ma5, 2),
        'ma20': to_rounded_float(ma20, 2),
        'ma60': to_rounded_float(ma60, 2),
        'upper_bb': to_rounded_float(upper_bb, 2),
        'lower_bb': to_rounded_float(lower_bb, 2),
        'bb_percent': to_rounded_float(bb_percent, 2),
        'rsi14': to_rounded_float(rsi14, 2),
        'return_20d': to_rounded_float(return_20d, 2),
        'return_60d': to_rounded_float(return_60d, 2),
        'return_120d': to_rounded_float(return_120d, 2),
        'volatility_30d': to_rounded_float(vol30, 2),
        'volatility_90d': to_rounded_float(vol90, 2),
        'volatility_1y': to_rounded_float(vol252, 2),
        'ma_gap': to_rounded_float(ma_gap, 2),
        'macd': macd['macd'],
        'macd_signal': macd['signal'],
        'macd_histogram': macd['histogram'],
        'pe': to_rounded_float(fundamentals.get('pe'), 2),
        'pb': to_rounded_float(fundamentals.get('pb'), 2),
        'ps': to_rounded_float(fundamentals.get('ps'), 2),
        'roe': to_rounded_float(fundamentals.get('roe'), 2),
        'operating_margin': to_rounded_float(fundamentals.get('operating_margin'), 2),
        'debt_to_equity': to_rounded_float(fundamentals.get('debt_to_equity'), 2),
        'dividend_yield': to_rounded_float(fundamentals.get('dividend_yield'), 2),
        'beta': to_rounded_float(fundamentals.get('beta'), 2),
        'fundamental_source': fundamentals.get('source') or 'manual',
        'signal_count': len(signals),
        'signals': signals
    }


def passes_screener_filters(snapshot, filters):
    rsi_min = filters.get('rsi_min')
    rsi_max = filters.get('rsi_max')
    min_return = filters.get('min_return_20d')
    max_return = filters.get('max_return_20d')
    require_ma_cross = bool(filters.get('require_ma_cross'))
    require_bb_breakout = bool(filters.get('require_bb_breakout'))
    require_macd_positive = bool(filters.get('require_macd_positive'))
    include_missing = bool(filters.get('include_missing', True))

    def check_min(metric_key, threshold):
        if threshold is None:
            return True
        value = snapshot.get(metric_key)
        if value is None:
            return include_missing
        return float(value) >= float(threshold)

    def check_max(metric_key, threshold):
        if threshold is None:
            return True
        value = snapshot.get(metric_key)
        if value is None:
            return include_missing
        return float(value) <= float(threshold)

    rsi14 = snapshot.get('rsi14')
    if rsi_min is not None and (rsi14 is None and not include_missing):
        return False
    if rsi_max is not None and (rsi14 is None and not include_missing):
        return False
    if rsi14 is not None and rsi_min is not None and rsi14 < rsi_min:
        return False
    if rsi14 is not None and rsi_max is not None and rsi14 > rsi_max:
        return False

    return_20d = snapshot.get('return_20d')
    if min_return is not None and return_20d is None and not include_missing:
        return False
    if max_return is not None and return_20d is None and not include_missing:
        return False
    if return_20d is not None and min_return is not None and return_20d < min_return:
        return False
    if return_20d is not None and max_return is not None and return_20d > max_return:
        return False

    if require_ma_cross and not (snapshot.get('ma5') and snapshot.get('ma20') and snapshot['ma5'] > snapshot['ma20']):
        return False
    if require_bb_breakout and not (snapshot.get('upper_bb') and snapshot.get('price') and snapshot['price'] >= snapshot['upper_bb']):
        return False
    if require_macd_positive and not ((snapshot.get('macd_histogram') or 0) > 0):
        return False
    if not check_max('pe', filters.get('pe_max')):
        return False
    if not check_max('pb', filters.get('pb_max')):
        return False
    if not check_max('ps', filters.get('ps_max')):
        return False
    if not check_min('roe', filters.get('roe_min')):
        return False
    if not check_min('operating_margin', filters.get('operating_margin_min')):
        return False
    if not check_max('debt_to_equity', filters.get('debt_to_equity_max')):
        return False
    if not check_min('dividend_yield', filters.get('dividend_yield_min')):
        return False
    if not check_max('volatility_30d', filters.get('volatility_30d_max')):
        return False
    if not check_max('volatility_90d', filters.get('volatility_90d_max')):
        return False
    if not check_max('volatility_1y', filters.get('volatility_1y_max')):
        return False

    return True


def build_screener_chart(code, lookback_days=120):
    end_date = date.today()
    start_date = end_date - timedelta(days=max(lookback_days, 60) + 40)
    histories = market_client.get_historical_prices(code, start_date, end_date)
    if len(histories) < 20:
        raise ValueError('차트 이력이 충분하지 않습니다.')

    chart_rows = []
    closing_values = []
    for row in histories:
        closing_values.append(float(row['price']))
        ma20 = calculate_sma(closing_values, 20)
        std20 = calculate_std(closing_values, 20)
        chart_rows.append({
            'date': row['date'].isoformat(),
            'price': to_rounded_float(row['price'], 2),
            'ma20': to_rounded_float(ma20, 2),
            'upper_bb': to_rounded_float(ma20 + (std20 * 2), 2) if ma20 is not None and std20 is not None else None,
            'lower_bb': to_rounded_float(ma20 - (std20 * 2), 2) if ma20 is not None and std20 is not None else None
        })

    return chart_rows[-lookback_days:]


def build_dart_metric_rows(dart_snapshot):
    financials = (dart_snapshot or {}).get('financials') or {}
    metrics = financials.get('metrics') or {}
    labels = {
        'revenue': '매출',
        'operating_income': '영업이익',
        'net_income': '순이익',
        'assets': '자산총계',
        'liabilities': '부채총계',
        'equity': '자본총계'
    }

    rows = []
    for key, label in labels.items():
        metric = metrics.get(key)
        if not metric:
            continue
        rows.append({
            'key': key,
            'label': label,
            'current': metric.get('current'),
            'previous': metric.get('previous'),
            'account_name': metric.get('account_name')
        })
    return rows


def build_screener_compare_item(code, include_dart=True):
    cleaned_code = market_client.clean_code(code)
    if not cleaned_code:
        raise ValueError('종목 코드가 필요합니다.')

    search_matches = market_client.search_products(cleaned_code, 6)
    product_match = next((item for item in search_matches if market_client.clean_code(item.get('code')) == cleaned_code), None)
    end_date = date.today()
    start_date = end_date - timedelta(days=220)
    histories = market_client.get_historical_prices(cleaned_code, start_date, end_date)
    snapshot = build_screener_snapshot(histories) if histories else None
    quote = build_quote_snapshot(cleaned_code)
    if include_dart:
        try:
            dart_snapshot = market_client.get_dart_snapshot(cleaned_code)
        except Exception:
            dart_snapshot = {
                'enabled': False,
                'reason': 'Open DART 조회가 지연되어 이번 비교에서는 제외했습니다.'
            }
    else:
        dart_snapshot = {
            'enabled': False,
            'reason': '비교 화면에서는 Open DART 상세를 생략합니다. 종목 상세에서 확인하세요.'
        }

    return {
        'name': (product_match or {}).get('name') or cleaned_code,
        'code': cleaned_code,
        'exchange': (product_match or {}).get('exchange') or 'KRX',
        'type': (product_match or {}).get('type') or 'stock/ETF',
        'quote': quote,
        'snapshot': snapshot,
        'chart': build_screener_chart(cleaned_code, 120) if histories else [],
        'dart': {
            **dart_snapshot,
            'metrics': build_dart_metric_rows(dart_snapshot)
        }
    }


def build_quote_snapshot(code):
    cleaned_code = market_client.clean_code(code)
    if not cleaned_code:
        raise ValueError('종목 코드가 필요합니다.')

    cached = market_client.get_cached_value('quote_snapshot', cleaned_code, 60 * 15)
    if cached is not None:
        return cached

    today = date.today()
    history_start = today - timedelta(days=370)
    histories = market_client.get_historical_prices(cleaned_code, history_start, today)

    if market_client.is_fund_code(cleaned_code):
        current = market_client.get_price_from_funetf(cleaned_code)
    elif market_client.is_krx_code(cleaned_code):
        current = market_client.get_price_from_naver(cleaned_code)
    else:
        current = market_client.get_current_price(cleaned_code)

    if histories:
        latest = histories[-1]
        latest_price = latest.get('price')
        price_date = latest.get('date') or today
    else:
        latest_price = None
        price_date = None

    if current and current.get('price') is not None:
        latest_price = current.get('price')
        price_date = current.get('date') or price_date or today

    prices = [float(row['price']) for row in histories if row.get('price') is not None]
    high_52w = max(prices) if prices else None
    low_52w = min(prices) if prices else None
    first_price = prices[0] if prices else None
    history_source = histories[-1].get('source') if histories else None
    source_name = (
        (current or {}).get('source')
        or history_source
        or ('FunETF' if market_client.is_fund_code(cleaned_code) else 'Naver' if market_client.is_krx_code(cleaned_code) else 'Yahoo')
    )
    freshness_class = 'end_of_day'
    delay_policy = '기준가 또는 일별 종가 기준'
    if source_name == 'Naver':
        freshness_class = 'delayed_20m'
        delay_policy = '거래소 시세 기준, 장중 최대 20분 지연 가능'
    elif source_name == 'Yahoo':
        freshness_class = 'end_of_day'
        delay_policy = '일별 종가 기준'
    elif source_name == 'FunETF':
        freshness_class = 'end_of_day'
        delay_policy = '펀드 기준가 기준'
    return_rate = (
        (float(latest_price) - first_price) / first_price * 100
        if latest_price is not None and first_price
        else None
    )

    snapshot = {
        'code': cleaned_code,
        'price': round(float(latest_price), 4) if latest_price is not None else None,
        'price_date': price_date.isoformat() if price_date else None,
        'high_52w': round(high_52w, 4) if high_52w is not None else None,
        'low_52w': round(low_52w, 4) if low_52w is not None else None,
        'one_year_return_rate': round(return_rate, 2) if return_rate is not None else None,
        'source': source_name,
        'freshness_class': freshness_class,
        'delay_policy': delay_policy,
        'history_points': len(histories),
        'lookback_start': history_start.isoformat(),
        'lookback_end': today.isoformat()
    }
    market_client.set_cached_value('quote_snapshot', cleaned_code, snapshot)
    return snapshot


def get_openai_api_key():
    for env_name in ('OPENAI_API_KEY', 'API_KEY'):
        value = str(os.getenv(env_name, '') or '').strip()
        if value and 'your_api_key_here' not in value:
            return value
    return ''


def build_stock_analysis_messages(product, quote, holding, mode):
    product_name = str((product or {}).get('name') or '').strip()
    product_code = str((product or {}).get('code') or '').strip()
    if not product_name and not product_code:
        raise ValueError('분석할 종목명 또는 코드가 필요합니다.')

    mode_label = str((mode or {}).get('label') or '핵심 점검').strip()
    mode_focus = (mode or {}).get('focus') or []
    focus_text = ', '.join(str(item).strip() for item in mode_focus if str(item).strip()) or '핵심 투자 포인트와 리스크'

    quote_lines = [
        f"- 현재가: {(quote or {}).get('price') if (quote or {}).get('price') is not None else '미확인'}",
        f"- 가격 기준일: {(quote or {}).get('price_date') or '미확인'}",
        f"- 52주 고가: {(quote or {}).get('high_52w') if (quote or {}).get('high_52w') is not None else '미확인'}",
        f"- 52주 저가: {(quote or {}).get('low_52w') if (quote or {}).get('low_52w') is not None else '미확인'}",
        f"- 최근 1년 수익률: {(quote or {}).get('one_year_return_rate') if (quote or {}).get('one_year_return_rate') is not None else '미확인'}"
    ]

    if holding:
        holding_lines = [
            '- 내 계좌 보유 여부: 보유 중',
            f"- 평균 매입가/기준가: {holding.get('purchase_price')}",
            f"- 현재 대장 기준가: {holding.get('current_price')}",
            f"- 평가 수익률: {holding.get('profit_rate')}",
            f"- 보유 수량/좌수: {holding.get('quantity')}"
        ]
    else:
        holding_lines = ['- 내 계좌 보유 여부: 미보유']

    instructions = (
        '당신은 퇴직연금 계좌에서 국내 종목과 ETF를 점검하는 보수적인 투자 분석가입니다. '
        '반드시 최신 공개 정보를 바탕으로 분석하고, 불확실한 내용은 추정이라고 분리하세요. '
        '한국어로 답하고, 사실 기반 요약을 우선하며 투자 권유처럼 단정하지 마세요.'
    )

    user_prompt = '\n'.join([
        f"분석 대상: {product_name or '종목명 미확인'} ({product_code or '코드 미확인'})",
        f"분석 모드: {mode_label}",
        f"중점 항목: {focus_text}",
        '',
        '앱에서 확보한 참고 데이터:',
        *quote_lines,
        '',
        '내 계좌 기준:',
        *holding_lines,
        '',
        '요청 사항:',
        '1. 지금 시점 기준으로 종목/ETF 개요를 2~3문장으로 요약',
        '2. 투자 포인트 3개',
        '3. 리스크 3개',
        '4. 내 계좌 기준 해석 2개',
        '5. 지금 추가 확인할 질문 3개',
        '',
        '중요:',
        '- 웹 검색을 활용해 최신 정보를 반영하세요.',
        '- 인용 가능한 근거가 있는 사실 위주로 작성하세요.',
        '- 섹션 제목을 붙여 읽기 쉽게 정리하세요.'
    ])
    return instructions, user_prompt


def extract_openai_report(data):
    report_text = str(data.get('output_text') or '').strip()
    citations = []

    for item in data.get('output') or []:
        if item.get('type') == 'web_search_call':
            sources = (((item.get('action') or {}).get('sources')) or [])
            for source in sources:
                url = str(source.get('url') or '').strip()
                title = str(source.get('title') or url).strip()
                if url:
                    citations.append({'title': title, 'url': url})

        if item.get('type') != 'message':
            continue
        for content in item.get('content') or []:
            if content.get('type') != 'output_text':
                continue
            if not report_text:
                report_text = str(content.get('text') or '').strip()
            for annotation in content.get('annotations') or []:
                if annotation.get('type') != 'url_citation':
                    continue
                url = str(annotation.get('url') or '').strip()
                title = str(annotation.get('title') or url).strip()
                if url:
                    citations.append({'title': title, 'url': url})

    unique = []
    seen = set()
    for citation in citations:
        key = citation['url']
        if key in seen:
            continue
        seen.add(key)
        unique.append(citation)

    return report_text, unique


def generate_openai_stock_report(product, quote, holding, mode):
    api_key = get_openai_api_key()
    if not api_key:
        raise RuntimeError('OPENAI_API_KEY가 설정되지 않았습니다. Railway 환경변수에 OPENAI_API_KEY를 추가하세요.')

    instructions, user_prompt = build_stock_analysis_messages(product, quote, holding, mode)
    model = os.getenv('OPENAI_MODEL', 'gpt-5.4-mini')
    payload = {
        'model': model,
        'instructions': instructions,
        'input': user_prompt,
        'reasoning': {'effort': 'low'},
        'tools': [{
            'type': 'web_search',
            'user_location': {
                'type': 'approximate',
                'country': 'KR',
                'city': 'Seoul',
                'region': 'Seoul',
                'timezone': 'Asia/Seoul'
            }
        }],
        'include': ['web_search_call.action.sources'],
        'max_output_tokens': 1400
    }

    response = requests.post(
        'https://api.openai.com/v1/responses',
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        },
        json=payload,
        timeout=90
    )

    try:
        data = response.json()
    except ValueError:
        data = {}

    if response.status_code >= 400:
        error_message = (((data.get('error') or {}).get('message')) or 'OpenAI 응답 생성에 실패했습니다.')
        raise RuntimeError(error_message)

    report_text, citations = extract_openai_report(data)
    if not report_text:
        raise RuntimeError('GPT 분석 레포트 본문을 생성하지 못했습니다.')

    return {
        'model': model,
        'report': report_text,
        'citations': citations
    }


def coerce_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def enrich_quote_snapshot(code, quote):
    snapshot = dict(quote or {})
    cleaned_code = market_client.clean_code(code)
    today = date.today()
    history_start = today - timedelta(days=370)

    needs_history = any(
        snapshot.get(field) in (None, '')
        for field in ('high_52w', 'low_52w', 'one_year_return_rate')
    )
    if not cleaned_code or not needs_history:
        return snapshot

    histories = market_client.get_historical_prices(cleaned_code, history_start, today)
    if not histories:
        return snapshot

    prices = [coerce_float(row.get('price')) for row in histories]
    prices = [price for price in prices if price is not None]
    latest = histories[-1]
    first_price = prices[0] if prices else None
    latest_price = coerce_float(snapshot.get('price')) or coerce_float(latest.get('price'))
    return_rate = (
        (latest_price - first_price) / first_price * 100
        if latest_price is not None and first_price
        else None
    )

    if snapshot.get('price') in (None, '') and latest_price is not None:
        snapshot['price'] = round(latest_price, 4)
    if not snapshot.get('price_date') and latest.get('date'):
        snapshot['price_date'] = latest['date'].isoformat()
    if snapshot.get('high_52w') in (None, '') and prices:
        snapshot['high_52w'] = round(max(prices), 4)
    if snapshot.get('low_52w') in (None, '') and prices:
        snapshot['low_52w'] = round(min(prices), 4)
    if snapshot.get('one_year_return_rate') in (None, '') and return_rate is not None:
        snapshot['one_year_return_rate'] = round(return_rate, 2)
    snapshot['history_points'] = len(histories)
    snapshot['lookback_start'] = history_start.isoformat()
    snapshot['lookback_end'] = today.isoformat()
    return snapshot


def classify_news_title(title):
    normalized = str(title or '').strip().lower()
    positive_hits = [keyword for keyword in POSITIVE_NEWS_KEYWORDS if keyword in normalized]
    negative_hits = [keyword for keyword in NEGATIVE_NEWS_KEYWORDS if keyword in normalized]
    score = len(positive_hits) - len(negative_hits)
    if score > 0:
        tone = 'positive'
    elif score < 0:
        tone = 'negative'
    else:
        tone = 'neutral'
    return {
        'tone': tone,
        'score': score,
        'positive_hits': positive_hits,
        'negative_hits': negative_hits
    }


def summarize_news_items(news_items):
    positive_count = 0
    negative_count = 0
    neutral_count = 0
    annotated = []

    for item in news_items:
        analysis = classify_news_title(item.get('title'))
        tone = analysis['tone']
        if tone == 'positive':
            positive_count += 1
        elif tone == 'negative':
            negative_count += 1
        else:
            neutral_count += 1
        annotated.append({
            **item,
            'tone': tone,
            'keywords': analysis['positive_hits'] + analysis['negative_hits']
        })

    if positive_count > negative_count + 1:
        label = '긍정 우세'
        summary = '최근 기사 제목 톤은 우호적인 재료가 조금 더 많습니다.'
    elif negative_count > positive_count + 1:
        label = '부정 우세'
        summary = '최근 기사 제목 톤은 변동성이나 우려 재료가 조금 더 많습니다.'
    else:
        label = '중립'
        summary = '최근 기사 제목 톤은 방향성이 한쪽으로 크게 기울지 않았습니다.'

    return {
        'label': label,
        'summary': summary,
        'positive_count': positive_count,
        'negative_count': negative_count,
        'neutral_count': neutral_count,
        'items': annotated
    }


def format_money_text(value):
    number = coerce_float(value)
    if number is None:
        return '미확인'
    return f'{round(number):,}원'


def format_number_text(value, digits=2):
    number = coerce_float(value)
    if number is None:
        return '미확인'
    return f'{number:,.{digits}f}'


def format_percent_text(value):
    number = coerce_float(value)
    if number is None:
        return '미확인'
    return f'{number:.2f}%'


def build_non_api_stock_report(product, quote, holding, mode):
    product_name = str((product or {}).get('name') or '').strip()
    product_code = str((product or {}).get('code') or '').strip()
    if not product_name and not product_code:
        raise ValueError('분석할 종목명 또는 코드가 필요합니다.')

    snapshot = enrich_quote_snapshot(product_code, quote)
    news_items = market_client.get_recent_news(product_name, product_code, limit=8)
    news_summary = summarize_news_items(news_items)
    current_price = coerce_float(snapshot.get('price'))
    high_52w = coerce_float(snapshot.get('high_52w'))
    low_52w = coerce_float(snapshot.get('low_52w'))
    one_year_return = coerce_float(snapshot.get('one_year_return_rate'))
    holding_rate = coerce_float((holding or {}).get('profit_rate'))
    purchase_price = coerce_float((holding or {}).get('purchase_price'))
    current_holding_price = coerce_float((holding or {}).get('current_price'))
    quantity = coerce_float((holding or {}).get('quantity'))
    unit_type = (holding or {}).get('unit_type') or 'share'
    mode_label = str((mode or {}).get('label') or '핵심 점검').strip()
    mode_focus = [
        str(item).strip()
        for item in ((mode or {}).get('focus') or [])
        if str(item).strip()
    ]

    range_progress = None
    drawdown_from_high = None
    if current_price is not None and high_52w is not None and low_52w is not None and high_52w > low_52w:
        range_progress = (current_price - low_52w) / (high_52w - low_52w) * 100
        if high_52w > 0:
            drawdown_from_high = (high_52w - current_price) / high_52w * 100

    summary_parts = []
    if holding:
        if holding_rate is not None and holding_rate >= 8:
            summary_parts.append('계좌 기준으로 이미 의미 있는 수익 구간입니다.')
        elif holding_rate is not None and holding_rate < 0:
            summary_parts.append('계좌 기준으로 아직 손익 회복 확인이 더 필요합니다.')
        else:
            summary_parts.append('계좌 기준 성과는 중립 구간입니다.')
    else:
        summary_parts.append('현재 계좌에는 없는 종목이라 신규 검토 관점이 중심입니다.')

    if one_year_return is not None:
        if one_year_return >= 20:
            summary_parts.append('최근 1년 상승폭이 커서 추격 매수보다 진입 기준 점검이 중요합니다.')
        elif one_year_return <= -15:
            summary_parts.append('최근 1년 약세 구간이라 반등 근거 확인이 우선입니다.')
        else:
            summary_parts.append('최근 1년 흐름은 급한 방향성보다 균형 점검에 가깝습니다.')

    summary_parts.append(news_summary['summary'])
    summary = ' '.join(summary_parts)

    market_points = [
        f'현재가 {format_money_text(current_price)} / 기준일 {snapshot.get("price_date") or "미확인"}',
        f'52주 범위 {format_money_text(low_52w)} ~ {format_money_text(high_52w)}',
        f'최근 1년 수익률 {format_percent_text(one_year_return)}'
    ]
    if range_progress is not None:
        market_points.append(f'52주 밴드 위치 {format_percent_text(range_progress)}')

    account_points = []
    if holding:
        quantity_text = f'{format_number_text(quantity, 0)}{"좌" if unit_type == "unit" else "주"}'
        account_points = [
            f'평균 매입가/기준가 {format_money_text(purchase_price)}',
            f'현재 대장 기준가 {format_money_text(current_holding_price)}',
            f'평가 수익률 {format_percent_text(holding_rate)}',
            f'보유 수량 {quantity_text}'
        ]
    else:
        account_points = ['현재 계좌 보유 종목은 아닙니다. 신규 편입 기준과 기존 위험자산 중복도를 먼저 보세요.']

    investment_points = []
    if news_summary['positive_count'] > 0:
        investment_points.append(f'최근 기사 {news_summary["positive_count"]}건에서 성장/수혜 성격의 제목이 포착됐습니다.')
    if one_year_return is not None and one_year_return > 0:
        investment_points.append(f'최근 1년 가격 흐름이 {format_percent_text(one_year_return)}로 우상향입니다.')
    if drawdown_from_high is not None and drawdown_from_high >= 8:
        investment_points.append(f'52주 고점 대비 {format_percent_text(drawdown_from_high)} 낮아 추격 부담은 다소 줄었습니다.')
    if holding and holding_rate is not None and holding_rate > 0:
        investment_points.append('기존 보유 수익 구간이라 추가 매수보다 기준 재점검과 분할 대응이 수월합니다.')
    if not investment_points:
        investment_points.append('강한 호재 신호보다는 기본 시세와 보유 비중을 함께 점검하는 쪽이 더 적절합니다.')

    risk_points = []
    if news_summary['negative_count'] > 0:
        risk_points.append(f'최근 기사 {news_summary["negative_count"]}건에서 우려/변동성 성격의 제목이 보입니다.')
    if one_year_return is not None and one_year_return >= 25:
        risk_points.append('최근 1년 급등 폭이 커서 단기 과열 뒤 되돌림 가능성을 열어둬야 합니다.')
    if one_year_return is not None and one_year_return <= -15:
        risk_points.append('최근 1년 약세가 깊어 반등 실패 시 체감 손실이 커질 수 있습니다.')
    if holding and holding_rate is not None and holding_rate < 0:
        risk_points.append('현재 계좌 기준 손실 구간이라 추가 매수 전에 손실 확대 조건을 먼저 정해야 합니다.')
    if not risk_points:
        risk_points.append('기사 톤과 가격 흐름이 한쪽으로 치우치지 않아, 개별 악재보다는 분산과 비중 관리가 핵심입니다.')

    action_points = []
    if holding:
        if holding_rate is not None and holding_rate >= 8:
            action_points.append('보유 중이라면 추가 매수보다 목표 비중과 차익 관리 기준을 먼저 정하는 편이 낫습니다.')
        elif holding_rate is not None and holding_rate < 0:
            action_points.append('보유 중이라면 반등 확인 전 무리한 물타기보다 손실 허용 범위와 추가 진입 조건을 먼저 세우세요.')
        else:
            action_points.append('보유 중이라면 비중 유지 또는 소폭 조정 관점에서 뉴스 톤 변화만 추적해도 충분합니다.')
    else:
        if one_year_return is not None and one_year_return >= 20:
            action_points.append('신규 검토라면 한 번에 진입하기보다 분할 접근 또는 조정 구간 대기가 더 무난합니다.')
        elif news_summary['negative_count'] > news_summary['positive_count']:
            action_points.append('신규 검토라면 기사 톤이 안정될 때까지 관망하고, 가격 지지 구간을 먼저 확인하세요.')
        else:
            action_points.append('신규 검토라면 전체 위험자산 비중 안에서 소규모로 시작하는 접근이 무난합니다.')

    if mode_focus:
        action_points.append(f'{mode_label} 기준으로는 {", ".join(mode_focus[:3])} 점검을 우선순위로 두는 편이 좋습니다.')
    else:
        action_points.append(f'{mode_label} 기준의 추가 점검 질문을 정리해 두면 추후 판단이 훨씬 수월합니다.')

    headlines = [
        {
            'title': item['title'],
            'url': item['url'],
            'source': item.get('source'),
            'published_at': item.get('published_at'),
            'tone': item.get('tone')
        }
        for item in news_summary['items']
    ]

    sections = {
        'market': market_points,
        'investment_points': investment_points,
        'risk_points': risk_points,
        'account_view': account_points,
        'action_points': action_points
    }

    report_lines = [
        f'{product_name or product_code} {mode_label} 심화 분석',
        '',
        f'요약: {summary}',
        '',
        '[시장 스냅샷]',
        *[f'- {item}' for item in market_points],
        '',
        '[보유 관점]',
        *[f'- {item}' for item in account_points],
        '',
        '[투자 포인트]',
        *[f'- {item}' for item in investment_points],
        '',
        '[리스크]',
        *[f'- {item}' for item in risk_points],
        '',
        '[행동 가이드]',
        *[f'- {item}' for item in action_points]
    ]

    return {
        'provider': 'crawler',
        'provider_label': '크롤링 분석',
        'title': f'{product_name or product_code} {mode_label} 심화 분석',
        'summary': summary,
        'report': '\n'.join(report_lines),
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'sentiment': {
            'label': news_summary['label'],
            'summary': news_summary['summary'],
            'positive_count': news_summary['positive_count'],
            'negative_count': news_summary['negative_count'],
            'neutral_count': news_summary['neutral_count']
        },
        'headlines': headlines,
        'sections': sections,
        'citations': [
            {
                'title': item['title'],
                'url': item['url']
            }
            for item in headlines
        ]
    }


@api.route('/version', methods=['GET'])
def get_api_version():
    return jsonify({'version': API_VERSION}), 200


@api.route('/auth/register', methods=['POST'])
def register():
    try:
        data = request.get_json() or {}
        required = ['username', 'email', 'password']
        for field in required:
            if not data.get(field):
                return jsonify({'error': f'{field} is required'}), 400

        if User.query.filter_by(username=data['username']).first():
            return jsonify({'error': '이미 사용 중인 사용자명입니다.'}), 400
        if User.query.filter_by(email=data['email']).first():
            return jsonify({'error': '이미 사용 중인 이메일입니다.'}), 400

        password_hash = hashlib.sha256(data['password'].encode()).hexdigest()
        user = User(username=data['username'], email=data['email'], password=password_hash)
        db.session.add(user)
        log_security_event(
            user_id=None,
            event_type='auth_register',
            resource_type='user',
            resource_id=data['username'],
            action='register',
            status='ok',
            message='신규 회원가입'
        )
        db.session.commit()

        return jsonify({'message': '회원가입이 완료되었습니다.', 'user': user.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/auth/login', methods=['POST'])
def login():
    try:
        data = request.get_json() or {}
        user = User.query.filter_by(username=data.get('username')).first()
        password_hash = hashlib.sha256((data.get('password') or '').encode()).hexdigest()

        if not user or user.password != password_hash or user.is_deleted:
            log_security_event(
                user_id=user.id if user else None,
                event_type='auth_login',
                resource_type='user',
                resource_id=data.get('username'),
                action='login',
                status='denied',
                message='로그인 실패'
            )
            db.session.commit()
            return jsonify({'error': '사용자명 또는 비밀번호가 올바르지 않습니다.'}), 401

        access_token = create_access_token(identity=str(user.id))
        log_security_event(
            user_id=user.id,
            event_type='auth_login',
            resource_type='user',
            resource_id=user.id,
            action='login',
            status='ok',
            message='로그인 성공'
        )
        db.session.commit()
        return jsonify({'access_token': access_token, 'user': user.to_dict()}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/summary', methods=['GET'])
@jwt_required()
def get_portfolio_summary():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        return jsonify(build_portfolio_summary_payload(user_id, account_name, sync_prices=True)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/privacy/policy', methods=['GET'])
def get_privacy_policy():
    policy = {
        'title': '개인정보 처리방침',
        'effective_date': '2026-04-29',
        'items': [
            {
                'heading': '수집 항목',
                'content': '계정 정보(사용자명, 이메일), 포트폴리오/매매일지 데이터, 인증 토큰 검증 정보, 접근 로그'
            },
            {
                'heading': '이용 목적',
                'content': '서비스 제공, 포트폴리오 분석, 보안 감사 및 이상 접근 탐지, 사용자 요청 처리'
            },
            {
                'heading': '보관 및 삭제',
                'content': '사용자 요청에 따라 soft delete(익명화) 또는 hard delete(완전삭제) 정책을 선택할 수 있습니다.'
            },
            {
                'heading': '국외 이전 가능성',
                'content': 'OpenAI/OpenDART/Naver/Yahoo 등 외부 데이터 API 사용 시 서비스 특성상 국외 전송이 발생할 수 있습니다.'
            }
        ]
    }
    return jsonify(policy), 200


@api.route('/privacy/contact', methods=['GET'])
def get_privacy_contact():
    return jsonify({
        'email': os.getenv('PRIVACY_CONTACT_EMAIL', 'privacy@example.com'),
        'name': os.getenv('PRIVACY_CONTACT_NAME', '개인정보 보호 담당자'),
        'country_transfer_notice': '외부 API 연동 시 일부 요청 데이터가 해외 인프라를 경유할 수 있습니다.'
    }), 200


@api.route('/privacy/deletion-requests', methods=['GET'])
@jwt_required()
def list_deletion_requests():
    try:
        user_id = current_user_id()
        rows = (
            DataDeletionRequest.query
            .filter_by(user_id=user_id)
            .order_by(DataDeletionRequest.requested_at.desc(), DataDeletionRequest.id.desc())
            .all()
        )
        return jsonify({'requests': [row.to_dict() for row in rows]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/privacy/deletion-requests', methods=['POST'])
@jwt_required()
def create_deletion_request():
    try:
        user_id = current_user_id()
        data = request.get_json() or {}
        mode = str(data.get('mode') or 'soft').strip().lower()
        if mode not in ('soft', 'hard'):
            return jsonify({'error': 'mode는 soft 또는 hard만 지원합니다.'}), 400

        row = DataDeletionRequest(
            user_id=user_id,
            mode=mode,
            reason=str(data.get('reason') or '').strip()[:2000],
            status='pending',
            requested_at=datetime.utcnow()
        )
        db.session.add(row)
        log_security_event(
            user_id=user_id,
            event_type='privacy_deletion_requested',
            resource_type='user',
            resource_id=user_id,
            action='request_delete',
            status='ok',
            message=f'{mode} 삭제 요청 등록',
            detail={'mode': mode}
        )
        db.session.commit()
        return jsonify({'message': '삭제 요청이 접수되었습니다.', 'request': row.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/privacy/deletion-requests/<int:request_id>/execute', methods=['POST'])
@jwt_required()
def execute_deletion_request(request_id):
    try:
        user_id = current_user_id()
        row = DataDeletionRequest.query.filter_by(id=request_id, user_id=user_id).first()
        if not row:
            return jsonify({'error': '삭제 요청을 찾을 수 없습니다.'}), 404
        if row.status != 'pending':
            return jsonify({'error': '이미 처리된 요청입니다.'}), 400

        user = User.query.filter_by(id=user_id).first()
        if not user:
            return jsonify({'error': '사용자 정보를 찾을 수 없습니다.'}), 404

        if row.mode == 'hard':
            perform_hard_delete_user(user_id, row)
            db.session.commit()
            return jsonify({
                'message': 'hard delete가 완료되었습니다. 다시 로그인할 수 없습니다.',
                'mode': 'hard'
            }), 200

        perform_soft_delete_user(user, row)
        db.session.commit()
        return jsonify({
            'message': 'soft delete(익명화)가 완료되었습니다. 다시 로그인할 수 없습니다.',
            'mode': 'soft'
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/dashboard', methods=['GET'])
@jwt_required()
def get_portfolio_dashboard():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        summary = build_portfolio_summary_payload(user_id, account_name, sync_prices=True)
        products = (
            Product.query
            .filter_by(user_id=user_id, account_name=account_name, status='holding')
            .order_by(Product.purchase_date.desc())
            .all()
        )
        return jsonify({
            'summary': summary,
            'products': [product.to_dict() for product in products]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/accounts', methods=['GET'])
@jwt_required()
def get_accounts():
    try:
        user_id = current_user_id()
        account_profiles = list_user_accounts(user_id)
        db.session.commit()
        default_profile = next((item for item in account_profiles if item.get('is_default')), None)
        return jsonify({
            'default_account_name': default_profile['account_name'] if default_profile else DEFAULT_ACCOUNT_NAME,
            'accounts': [item['account_name'] for item in account_profiles],
            'account_profiles': account_profiles
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/accounts', methods=['POST'])
@jwt_required()
def add_account():
    try:
        data = request.get_json() or {}
        raw_name = str(data.get('account_name') or '').strip()
        account_type = normalize_account_type(data.get('account_type'))
        account_category = normalize_account_category(data.get('account_category'), account_type)
        validation_error = validate_account_name_input(raw_name)
        if validation_error:
            return jsonify({'error': validation_error}), 400

        account_name = normalize_account_name(raw_name)
        user_id = current_user_id()
        existing_names = {item['account_name'] for item in list_user_accounts(user_id)}
        created = account_name not in existing_names
        profile = get_account_profile(user_id, account_name)
        profile.account_type = account_type
        profile.account_category = account_category
        balance = get_cash_balance(user_id, account_name)
        wrapper = AccountWrapper.query.filter_by(user_id=user_id, account_name=account_name).first()
        if not wrapper:
            wrapper = AccountWrapper(user_id=user_id, account_name=account_name)
            db.session.add(wrapper)
        wrapper.wrapper_type = map_wrapper_type(account_type, account_category)
        wrapper.provider = 'manual'
        wrapper.nickname = account_name
        wrapper.base_currency = 'KRW'
        wrapper.tags_json = canonical_json([get_account_type_label(account_type), get_account_category_label(account_category, account_type)])
        wrapper.source = 'portfolio_ledger'
        wrapper.as_of = datetime.utcnow()
        wrapper.latency_class = 'eod'
        wrapper.reconciled = False

        if created:
            db.session.refresh(balance)
        db.session.commit()

        account_profiles = list_user_accounts(user_id)

        return jsonify({
            'message': '통장이 추가되었습니다.' if created else '이미 등록된 통장입니다.',
            'created': created,
            'account_name': account_name,
            'account_type': account_type,
            'account_category': account_category,
            'accounts': [item['account_name'] for item in account_profiles],
            'account_profiles': account_profiles
        }), 201 if created else 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/accounts/<path:account_name>', methods=['DELETE'])
@jwt_required()
def delete_account(account_name):
    try:
        user_id = current_user_id()
        normalized_name = normalize_account_name(account_name)
        profile = AccountProfile.query.filter_by(user_id=user_id, account_name=normalized_name).first()
        if profile and profile.is_default:
            return jsonify({'error': '기본 통장은 삭제할 수 없습니다.'}), 400

        product_ids = [
            product_id
            for (product_id,) in db.session.query(Product.id)
            .filter_by(user_id=user_id, account_name=normalized_name)
            .all()
        ]
        if product_ids:
            PriceHistory.query.filter(PriceHistory.product_id.in_(product_ids)).delete(synchronize_session=False)
        Product.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
        TradeLog.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
        TradeEvent.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
        TradeSnapshot.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
        PortfolioSnapshot.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
        ReconciliationResult.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
        ImportBatch.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
        CashBalance.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
        wrapper = AccountWrapper.query.filter_by(user_id=user_id, account_name=normalized_name).first()
        if wrapper:
            HoldingLot.query.filter_by(user_id=user_id, account_wrapper_id=wrapper.id).delete(synchronize_session=False)
            CashFlow.query.filter_by(user_id=user_id, account_wrapper_id=wrapper.id).delete(synchronize_session=False)
            Benchmark.query.filter_by(user_id=user_id, account_wrapper_id=wrapper.id).delete(synchronize_session=False)
            db.session.delete(wrapper)
        AccountProfile.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
        db.session.commit()

        account_profiles = list_user_accounts(user_id)
        db.session.commit()
        default_profile = next((item for item in account_profiles if item.get('is_default')), None)
        return jsonify({
            'message': '통장과 관련 데이터가 삭제되었습니다.',
            'deleted_account_name': normalized_name,
            'default_account_name': default_profile['account_name'] if default_profile else DEFAULT_ACCOUNT_NAME,
            'accounts': [item['account_name'] for item in account_profiles],
            'account_profiles': account_profiles
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/accounts/<path:account_name>', methods=['PUT'])
@jwt_required()
def rename_account(account_name):
    try:
        user_id = current_user_id()
        current_name = normalize_account_name(account_name)

        data = request.get_json() or {}
        raw_next_name = str(data.get('account_name') or '').strip()
        validation_error = validate_account_name_input(raw_next_name)
        if validation_error:
            return jsonify({'error': '새 통장 이름을 입력하세요.' if not raw_next_name else validation_error}), 400
        next_name = normalize_account_name(raw_next_name)
        if next_name == current_name:
            return jsonify({'message': '통장 이름이 이미 같습니다.', 'account_name': current_name}), 200

        existing_names = {item['account_name'] for item in list_user_accounts(user_id)}
        if next_name in existing_names:
            return jsonify({'error': '이미 같은 이름의 통장이 있습니다.'}), 400

        Product.query.filter_by(user_id=user_id, account_name=current_name).update(
            {'account_name': next_name},
            synchronize_session=False
        )
        TradeLog.query.filter_by(user_id=user_id, account_name=current_name).update(
            {'account_name': next_name},
            synchronize_session=False
        )
        TradeEvent.query.filter_by(user_id=user_id, account_name=current_name).update(
            {'account_name': next_name},
            synchronize_session=False
        )
        TradeSnapshot.query.filter_by(user_id=user_id, account_name=current_name).update(
            {'account_name': next_name},
            synchronize_session=False
        )
        PortfolioSnapshot.query.filter_by(user_id=user_id, account_name=current_name).update(
            {'account_name': next_name},
            synchronize_session=False
        )
        ReconciliationResult.query.filter_by(user_id=user_id, account_name=current_name).update(
            {'account_name': next_name},
            synchronize_session=False
        )
        ImportBatch.query.filter_by(user_id=user_id, account_name=current_name).update(
            {'account_name': next_name},
            synchronize_session=False
        )
        CashBalance.query.filter_by(user_id=user_id, account_name=current_name).update(
            {'account_name': next_name},
            synchronize_session=False
        )
        wrapper = AccountWrapper.query.filter_by(user_id=user_id, account_name=current_name).first()
        if wrapper:
            wrapper.account_name = next_name
            wrapper.nickname = next_name
            HoldingLot.query.filter_by(user_id=user_id, account_wrapper_id=wrapper.id).update(
                {'account_name': next_name},
                synchronize_session=False
            )
            CashFlow.query.filter_by(user_id=user_id, account_wrapper_id=wrapper.id).update(
                {'account_name': next_name},
                synchronize_session=False
            )
            PortfolioSnapshot.query.filter_by(user_id=user_id, account_wrapper_id=wrapper.id).update(
                {'account_name': next_name},
                synchronize_session=False
            )
        profile = AccountProfile.query.filter_by(user_id=user_id, account_name=current_name).first()
        if profile:
            profile.account_name = next_name
            if profile.is_default:
                profile.account_type = 'retirement'
                profile.account_category = normalize_account_category(profile.account_category, 'retirement')
        else:
            replacement_profile = get_account_profile(user_id, next_name)
            replacement_profile.account_type = 'retirement' if current_name == DEFAULT_ACCOUNT_NAME else replacement_profile.account_type
            replacement_profile.account_category = normalize_account_category(
                replacement_profile.account_category,
                replacement_profile.account_type
            )
            replacement_profile.is_default = (current_name == DEFAULT_ACCOUNT_NAME)

        db.session.commit()
        account_profiles = list_user_accounts(user_id)
        db.session.commit()
        default_profile = next((item for item in account_profiles if item.get('is_default')), None)
        return jsonify({
            'message': '통장 이름을 변경했습니다.',
            'previous_account_name': current_name,
            'account_name': next_name,
            'default_account_name': default_profile['account_name'] if default_profile else DEFAULT_ACCOUNT_NAME,
            'accounts': [item['account_name'] for item in account_profiles],
            'account_profiles': account_profiles
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/products', methods=['GET'])
@jwt_required()
def get_products():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        maybe_sync_account_prices(user_id, account_name)
        products = Product.query.filter_by(user_id=user_id, account_name=account_name, status='holding').order_by(Product.purchase_date.desc()).all()
        return jsonify([p.to_dict() for p in products]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/sync-prices', methods=['POST'])
@jwt_required()
def sync_prices():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        result = sync_user_holdings(user_id, account_name)
        _market_sync_cache[f'{user_id}:{account_name}'] = datetime.now(MARKET_TIMEZONE).timestamp()
        success_count = sum(1 for row in result if row['success'])
        return jsonify({
            'message': f'{success_count}개 상품 가격을 동기화했습니다.',
            'items': result
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/search', methods=['GET'])
@jwt_required()
def search_products():
    try:
        query = request.args.get('q', '').strip()
        if len(query) < 2:
            return jsonify([]), 200
        return jsonify(market_client.search_products(query)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/products/quote', methods=['GET'])
@jwt_required()
def get_product_quote():
    try:
        code = request.args.get('code', '').strip()
        if not code:
            return jsonify({'error': '종목 코드를 입력하세요.'}), 400
        return jsonify(build_quote_snapshot(code)), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/products/analysis-report', methods=['POST'])
@jwt_required()
def get_product_analysis_report():
    try:
        data = request.get_json() or {}
        product = data.get('product') or {}
        quote = data.get('quote') or {}
        holding = data.get('holding') or None
        mode = data.get('mode') or {}
        engine = str(data.get('engine') or 'crawler').strip().lower()

        if engine == 'openai':
            try:
                report = generate_openai_stock_report(product, quote, holding, mode)
            except RuntimeError:
                report = build_non_api_stock_report(product, quote, holding, mode)
        else:
            report = build_non_api_stock_report(product, quote, holding, mode)
        return jsonify(report), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/screener/scan', methods=['POST'])
@jwt_required()
def run_stock_screener():
    try:
        data = request.get_json() or {}
        market = str(data.get('market') or 'KOSPI').strip().upper()
        page_count = max(1, min(int(data.get('pages') or 2), 5))
        limit = max(5, min(int(data.get('limit') or 24), 60))
        filters = normalize_screener_filters(data.get('filters') or {})
        require_fundamentals = has_fundamental_filters(filters)

        cache_key = hashlib.sha1(json.dumps({
            'market': market,
            'pages': page_count,
            'limit': limit,
            'filters': filters
        }, sort_keys=True).encode('utf-8')).hexdigest()
        cached = _screener_cache.get(cache_key)
        if cached and (datetime.now(MARKET_TIMEZONE).timestamp() - cached['saved_at']) < 60 * 20:
            cached_value = dict(cached['value'])
            cached_value['cache_hit'] = True
            cached_value['cache_ttl_seconds'] = 60 * 20
            return jsonify(cached_value), 200

        universe = market_client.get_market_universe(market, page_count)
        end_date = date.today()
        start_date = end_date - timedelta(days=220)
        scanned = 0
        rows = []

        for item in universe:
            histories = market_client.get_historical_prices(item['code'], start_date, end_date)
            fundamentals = fetch_normalized_fundamentals(item['code']) if require_fundamentals else {}
            snapshot = build_screener_snapshot(histories, fundamentals=fundamentals)
            if not snapshot:
                continue
            scanned += 1
            if not passes_screener_filters(snapshot, filters):
                continue

            candidate_tags = build_candidate_tags(item)
            if not filters.get('include_etf_candidates', True) and 'etf_candidate' in candidate_tags:
                continue
            if not filters.get('include_pension_candidates', True) and 'pension_candidate' in candidate_tags:
                continue

            rows.append({
                'name': item['name'],
                'code': item['code'],
                'exchange': item.get('exchange') or market,
                'type': item.get('type') or 'stock/ETF',
                'candidate_tags': candidate_tags,
                **snapshot
            })

        rows.sort(
            key=lambda row: (
                -(row.get('signal_count') or 0),
                -float(row.get('return_20d') or -9999),
                -float(row.get('macd_histogram') or -9999)
            )
        )

        generated_at = datetime.now(MARKET_TIMEZONE)
        result = {
            'market': market,
            'pages': page_count,
            'filters': filters,
            'scanned_count': scanned,
            'result_count': len(rows),
            'results': rows[:limit],
            'generated_at': generated_at.isoformat(),
            'coverage_note': f'네이버 시가총액 페이지 기준 상위 {page_count}페이지 대표 종목군을 스캔했습니다.',
            'cache_hit': False,
            'cache_ttl_seconds': 60 * 20,
            'provenance': {
                'source': 'krx',
                'asOf': generated_at.isoformat(),
                'latencyClass': 'eod',
                'reconciled': False
            }
        }
        _screener_cache[cache_key] = {
            'saved_at': generated_at.timestamp(),
            'value': result
        }
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/screener/chart', methods=['GET'])
@jwt_required()
def get_screener_chart():
    try:
        code = request.args.get('code', '').strip()
        lookback_days = max(60, min(int(request.args.get('days') or 120), 520))
        if not code:
            return jsonify({'error': '종목 코드를 입력하세요.'}), 400
        return jsonify({
            'code': market_client.clean_code(code),
            'days': lookback_days,
            'series': build_screener_chart(code, lookback_days)
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/screener/compare', methods=['POST'])
@jwt_required()
def get_screener_compare():
    try:
        data = request.get_json() or {}
        codes = []
        for value in data.get('codes') or []:
            cleaned = market_client.clean_code(value)
            if cleaned and cleaned not in codes:
                codes.append(cleaned)
        codes = codes[:4]
        if not codes:
            return jsonify({'error': '비교할 종목 코드를 1개 이상 선택하세요.'}), 400

        rows = []
        skipped = []
        for code in codes:
            try:
                rows.append(build_screener_compare_item(code, include_dart=False))
            except Exception as e:
                skipped.append({
                    'code': code,
                    'reason': str(e)
                })

        if not rows:
            return jsonify({'error': '비교 데이터를 불러오지 못했습니다.', 'skipped': skipped}), 503

        return jsonify({
            'compare_count': len(rows),
            'items': rows,
            'skipped': skipped,
            'generated_at': datetime.now(MARKET_TIMEZONE).isoformat()
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/screener/screens', methods=['GET'])
@jwt_required()
def list_screener_screens():
    try:
        rows = (
            ScreenerScreen.query
            .filter_by(user_id=current_user_id())
            .order_by(ScreenerScreen.updated_at.desc(), ScreenerScreen.id.desc())
            .all()
        )
        return jsonify({'screens': [build_screener_screen_response(row) for row in rows]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/screener/screens', methods=['POST'])
@jwt_required()
def save_screener_screen():
    try:
        user_id = current_user_id()
        data = request.get_json() or {}
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({'error': '저장할 화면 이름을 입력하세요.'}), 400

        market = str(data.get('market') or 'KOSPI').strip().upper()
        pages = max(1, min(int(data.get('pages') or 2), 5))
        limit = max(5, min(int(data.get('limit') or 24), 60))
        filters = normalize_screener_filters(data.get('filters') or {})
        result_codes = [market_client.clean_code(code) for code in (data.get('result_codes') or []) if market_client.clean_code(code)]
        compare_codes = [market_client.clean_code(code) for code in (data.get('compare_codes') or []) if market_client.clean_code(code)]
        notes = str(data.get('notes') or '').strip()

        screen = ScreenerScreen.query.filter_by(user_id=user_id, name=name).first()
        created = screen is None
        if created:
            screen = ScreenerScreen(user_id=user_id, name=name)
            db.session.add(screen)

        screen.market = market
        screen.pages = pages
        screen.limit = limit
        screen.filters_json = canonical_json(filters)
        screen.result_codes_json = canonical_json(result_codes)
        screen.compare_codes_json = canonical_json(compare_codes[:4])
        screen.notes = notes or None
        db.session.commit()

        rows = (
            ScreenerScreen.query
            .filter_by(user_id=user_id)
            .order_by(ScreenerScreen.updated_at.desc(), ScreenerScreen.id.desc())
            .all()
        )
        return jsonify({
            'message': '저장 화면을 추가했습니다.' if created else '저장 화면을 업데이트했습니다.',
            'screen': build_screener_screen_response(screen),
            'screens': [build_screener_screen_response(row) for row in rows]
        }), 201 if created else 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/screener/screens/<int:screen_id>', methods=['DELETE'])
@jwt_required()
def delete_screener_screen(screen_id):
    try:
        screen = ScreenerScreen.query.filter_by(id=screen_id, user_id=current_user_id()).first()
        if not screen:
            return jsonify({'error': '저장 화면을 찾을 수 없습니다.'}), 404
        db.session.delete(screen)
        db.session.commit()
        return jsonify({'message': '저장 화면을 삭제했습니다.'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/screener/watch-items', methods=['GET'])
@jwt_required()
def list_screener_watch_items():
    try:
        user_id = current_user_id()
        account_name = normalize_account_name(request.args.get('account_name') or DEFAULT_ACCOUNT_NAME)
        rows = (
            ScreenerWatchItem.query
            .filter_by(user_id=user_id, account_name=account_name)
            .order_by(ScreenerWatchItem.updated_at.desc(), ScreenerWatchItem.id.desc())
            .all()
        )
        return jsonify({
            'account_name': account_name,
            'count': len(rows),
            'items': [build_screener_watch_item_response(row) for row in rows]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/screener/watch-items', methods=['POST'])
@jwt_required()
def save_screener_watch_item():
    try:
        user_id = current_user_id()
        data = request.get_json() or {}
        account_name = normalize_account_name(data.get('account_name') or DEFAULT_ACCOUNT_NAME)
        symbol = market_client.clean_code(data.get('symbol'))
        if not symbol:
            return jsonify({'error': '관심종목으로 저장할 코드가 필요합니다.'}), 400

        name = str(data.get('name') or symbol).strip()[:255] or symbol
        exchange = str(data.get('exchange') or '').strip()[:20] or None
        candidate_tags = parse_string_list(data.get('candidate_tags'))
        source = str(data.get('source') or 'screener').strip()[:24] or 'screener'

        row = ScreenerWatchItem.query.filter_by(
            user_id=user_id,
            account_name=account_name,
            symbol=symbol
        ).first()
        created = row is None
        if created:
            row = ScreenerWatchItem(
                user_id=user_id,
                account_name=account_name,
                symbol=symbol
            )
            db.session.add(row)

        row.name = name
        row.exchange = exchange
        row.candidate_tags_json = canonical_json(candidate_tags)
        row.source = source
        db.session.commit()

        rows = (
            ScreenerWatchItem.query
            .filter_by(user_id=user_id, account_name=account_name)
            .order_by(ScreenerWatchItem.updated_at.desc(), ScreenerWatchItem.id.desc())
            .all()
        )
        return jsonify({
            'message': '관심종목을 추가했습니다.' if created else '관심종목을 업데이트했습니다.',
            'item': build_screener_watch_item_response(row),
            'items': [build_screener_watch_item_response(item) for item in rows]
        }), 201 if created else 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/screener/watch-items/<string:symbol>', methods=['DELETE'])
@jwt_required()
def delete_screener_watch_item(symbol):
    try:
        user_id = current_user_id()
        account_name = normalize_account_name(request.args.get('account_name') or DEFAULT_ACCOUNT_NAME)
        cleaned_symbol = market_client.clean_code(symbol)
        if not cleaned_symbol:
            return jsonify({'error': '삭제할 코드가 필요합니다.'}), 400

        row = ScreenerWatchItem.query.filter_by(
            user_id=user_id,
            account_name=account_name,
            symbol=cleaned_symbol
        ).first()
        if not row:
            return jsonify({'error': '관심종목을 찾을 수 없습니다.'}), 404

        db.session.delete(row)
        db.session.commit()
        return jsonify({'message': '관심종목을 삭제했습니다.', 'symbol': cleaned_symbol}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/dart-profile', methods=['GET'])
@jwt_required()
def get_product_dart_profile():
    try:
        code = request.args.get('code', '').strip()
        if not code:
            return jsonify({'error': '종목 코드를 입력하세요.'}), 400
        return jsonify(market_client.get_dart_snapshot(code)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/import-batches', methods=['GET'])
@jwt_required()
def list_import_batches():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        limit = max(10, min(int(request.args.get('limit') or 60), 200))
        rows = (
            ImportBatch.query
            .filter_by(user_id=user_id, account_name=account_name)
            .order_by(ImportBatch.created_at.desc())
            .limit(limit)
            .all()
        )
        return jsonify({'batches': [build_import_batch_response(row) for row in rows]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/imports/preview', methods=['POST'])
@jwt_required()
def preview_import_rows():
    try:
        user_id = current_user_id()
        file_storage = request.files.get('file')
        if not file_storage:
            return jsonify({'error': '업로드할 CSV 파일이 필요합니다.'}), 400

        account_name = normalize_account_name(request.form.get('account_name') or DEFAULT_ACCOUNT_NAME)
        source_name = str(request.form.get('source_name') or 'csv_upload').strip() or 'csv_upload'
        rows = read_import_csv_rows(file_storage)
        if len(rows) > 1500:
            return jsonify({'error': '한 번에 최대 1500행까지만 미리보기를 지원합니다.'}), 400

        normalized_rows, issues = normalize_import_rows_for_preview(rows)
        summary = classify_import_rows(user_id, account_name, normalized_rows, issues)

        batch = create_import_batch(
            user_id,
            account_name,
            batch_type='csv_import_preview',
            source_name=source_name,
            row_count=len(normalized_rows),
            notes={
                'stage': 'preview',
                'summary': summary,
                'issues': issues,
                'rows': normalized_rows
            }
        )
        batch.status = 'preview'
        db.session.commit()

        return jsonify({
            'message': '미리보기를 생성했습니다.',
            'batch_id': batch.id,
            'summary': summary,
            'rows': normalized_rows[:200],
            'issues': issues[:200],
            'batch': build_import_batch_response(batch)
        }), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/imports/template', methods=['GET'])
@jwt_required()
def download_import_template():
    try:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(IMPORT_TEMPLATE_HEADERS)
        writer.writerows(IMPORT_TEMPLATE_ROWS)
        body = output.getvalue().encode('utf-8-sig')
        output.close()

        return Response(
            body,
            mimetype='text/csv; charset=utf-8',
            headers={
                'Content-Disposition': 'attachment; filename="import-template.csv"'
            }
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/imports/commit', methods=['POST'])
@jwt_required()
def commit_import_rows():
    try:
        user_id = current_user_id()
        payload = request.get_json() or {}
        batch_id = str(payload.get('batch_id') or '').strip()
        apply_conflicts = bool(payload.get('apply_conflicts', False))
        strict_projection_check = bool(payload.get('strict_projection_check', False))
        expected_projection_signature = str(payload.get('expected_projection_signature') or '').strip()
        conflict_row_indexes = {
            int(item) for item in (payload.get('conflict_row_indexes') or [])
            if str(item).strip().isdigit()
        }
        row_mapping_overrides = payload.get('row_mapping_overrides') or {}

        if not batch_id:
            return jsonify({'error': 'batch_id가 필요합니다.'}), 400

        batch = ImportBatch.query.filter_by(id=batch_id, user_id=user_id).first()
        if not batch:
            return jsonify({'error': '가져오기 배치를 찾지 못했습니다.'}), 404

        notes = parse_json_text(batch.notes_json, {})
        rows = notes.get('rows') or []
        if not rows:
            return jsonify({'error': '커밋할 미리보기 데이터가 없습니다.'}), 400
        preflight_projection = build_import_commit_projection(
            rows,
            apply_conflicts=apply_conflicts,
            conflict_row_indexes=sorted(conflict_row_indexes),
            row_mapping_overrides=row_mapping_overrides
        )
        preflight_signature = build_projection_signature(preflight_projection)
        preflight_calculated_at = datetime.utcnow().isoformat()
        if strict_projection_check and expected_projection_signature and preflight_signature != expected_projection_signature:
            return jsonify({
                'error': 'dry-run 결과가 최신이 아닙니다. 예상 결과를 다시 확인한 뒤 커밋하세요.',
                'code': 'DRY_RUN_STALE',
                'expected_projection_signature': expected_projection_signature,
                'current_projection_signature': preflight_signature,
                'projection': preflight_projection,
                'current_projection_calculated_at': preflight_calculated_at
            }), 409

        imported_count = 0
        skipped_count = 0
        error_count = 0
        imported_log_ids = []
        commit_errors = []

        for row in rows:
            action = str(row.get('action') or '')
            row_index = int(row.get('row_index') or 0)
            if action in ('ignored', 'duplicate'):
                skipped_count += 1
                continue
            if action == 'conflict' and not apply_conflicts and row_index not in conflict_row_indexes:
                skipped_count += 1
                continue

            try:
                forced_product_id = None
                if row_index:
                    override = row_mapping_overrides.get(str(row_index)) or row_mapping_overrides.get(row_index)
                    if override not in (None, ''):
                        forced_product_id = int(override)
                trade_log, _ = apply_import_trade_row(
                    user_id,
                    batch.account_name,
                    row,
                    batch.id,
                    forced_product_id=forced_product_id
                )
                imported_count += 1
                imported_log_ids.append(trade_log.id)
            except Exception as error:
                error_count += 1
                commit_errors.append({
                    'row_index': row.get('row_index'),
                    'message': str(error)
                })

        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            user_id,
            batch.account_name,
            import_batch_id=batch.id,
            scope='account'
        )

        finalize_import_batch(
            batch,
            status='completed' if error_count == 0 else 'partial',
            imported_count=imported_count,
            skipped_count=skipped_count,
            error_count=error_count,
            notes={
                **notes,
                'stage': 'committed',
                'apply_conflicts': apply_conflicts,
                'selected_conflict_rows': sorted(conflict_row_indexes),
                'commit_summary': {
                    'imported_count': imported_count,
                    'skipped_count': skipped_count,
                    'error_count': error_count
                },
                'commit_errors': commit_errors,
                'imported_log_ids': imported_log_ids[:500],
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()

        return jsonify({
            'message': '가져오기 커밋이 완료되었습니다.',
            'batch': build_import_batch_response(batch),
            'imported_log_ids': imported_log_ids,
            'commit_errors': commit_errors,
            'reconciliation': build_reconciliation_result_response(reconciliation_result),
            'projection': preflight_projection,
            'projection_signature': preflight_signature,
            'projection_calculated_at': preflight_calculated_at
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/imports/dry-run', methods=['POST'])
@jwt_required()
def dry_run_import_commit():
    try:
        user_id = current_user_id()
        payload = request.get_json() or {}
        batch_id = str(payload.get('batch_id') or '').strip()
        apply_conflicts = bool(payload.get('apply_conflicts', False))
        conflict_row_indexes = payload.get('conflict_row_indexes') or []
        row_mapping_overrides = payload.get('row_mapping_overrides') or {}

        if not batch_id:
            return jsonify({'error': 'batch_id가 필요합니다.'}), 400

        batch = ImportBatch.query.filter_by(id=batch_id, user_id=user_id).first()
        if not batch:
            return jsonify({'error': '가져오기 배치를 찾지 못했습니다.'}), 404

        notes = parse_json_text(batch.notes_json, {})
        rows = notes.get('rows') or []
        if not rows:
            return jsonify({'error': '미리보기 데이터가 없어 dry-run을 계산할 수 없습니다.'}), 400

        projection = build_import_commit_projection(
            rows,
            apply_conflicts=apply_conflicts,
            conflict_row_indexes=conflict_row_indexes,
            row_mapping_overrides=row_mapping_overrides
        )
        signature = build_projection_signature(projection)
        return jsonify({
            'batch_id': batch.id,
            'projection': projection,
            'projection_signature': signature,
            'calculated_at': datetime.utcnow().isoformat()
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/trade-snapshots', methods=['GET'])
@jwt_required()
def list_trade_snapshots():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        limit = max(10, min(int(request.args.get('limit') or 80), 200))
        rows = (
            TradeSnapshot.query
            .filter_by(user_id=user_id, account_name=account_name)
            .order_by(TradeSnapshot.snapshot_date.desc(), TradeSnapshot.id.desc())
            .limit(limit)
            .all()
        )
        return jsonify({'snapshots': [build_trade_snapshot_response(row) for row in rows]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/reconciliation/latest', methods=['GET'])
@jwt_required()
def get_latest_reconciliation_result():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        row = (
            ReconciliationResult.query
            .filter_by(user_id=user_id, account_name=account_name)
            .order_by(ReconciliationResult.created_at.desc(), ReconciliationResult.id.desc())
            .first()
        )
        if not row:
            return jsonify({'result': None}), 200
        return jsonify({'result': build_reconciliation_result_response(row)}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/reconciliation', methods=['GET'])
@jwt_required()
def list_reconciliation_results():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        limit = max(10, min(int(request.args.get('limit') or 60), 200))
        rows = (
            ReconciliationResult.query
            .filter_by(user_id=user_id, account_name=account_name)
            .order_by(ReconciliationResult.created_at.desc(), ReconciliationResult.id.desc())
            .limit(limit)
            .all()
        )
        return jsonify({'results': [build_reconciliation_result_response(row) for row in rows]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/reconciliation/run', methods=['POST'])
@jwt_required()
def run_trade_log_reconciliation():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        batch = create_import_batch(
            user_id,
            account_name,
            batch_type='manual_reconciliation',
            source_name='ui',
            row_count=0,
            notes={'reason': 'manual_reconciliation'}
        )
        result, summary = store_reconciliation_result(user_id, account_name, import_batch_id=batch.id, scope='account')
        finalize_import_batch(
            batch,
            imported_count=0,
            notes={
                'reason': 'manual_reconciliation',
                'reconciliation_status': result.status,
                'mismatch_count': summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({
            'message': '정합성 점검을 실행했습니다.',
            'result': build_reconciliation_result_response(result),
            'batch': build_import_batch_response(batch)
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/cash', methods=['GET'])
@jwt_required()
def get_cash():
    try:
        return jsonify(get_cash_balance(current_user_id(), current_account_name()).to_dict()), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/cash', methods=['PUT'])
@jwt_required()
def update_cash():
    try:
        data = request.get_json() or {}
        amount = float(data.get('amount', 0))
        if amount < 0:
            return jsonify({'error': '현금은 0원 이상으로 입력하세요.'}), 400

        balance = get_cash_balance(current_user_id(), current_account_name())
        balance.amount = amount
        db.session.commit()
        return jsonify({'message': '현금이 저장되었습니다.', 'cash': balance.to_dict()}), 200
    except ValueError:
        return jsonify({'error': '현금 금액 형식이 올바르지 않습니다.'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/cash/deposits', methods=['POST'])
@jwt_required()
def add_cash_deposit():
    try:
        data = request.get_json() or {}
        amount = float(data.get('amount', 0))
        if amount <= 0:
            return jsonify({'error': '입금액은 0원보다 크게 입력하세요.'}), 400

        deposit_date = datetime.strptime(data.get('deposit_date') or date.today().isoformat(), '%Y-%m-%d').date()
        user_id = current_user_id()
        account_name = current_account_name()
        batch = create_import_batch(
            user_id,
            account_name,
            batch_type='manual_deposit',
            source_name='ui',
            row_count=1,
            notes={'reason': 'cash_deposit'}
        )

        log = TradeLog(
            user_id=user_id,
            account_name=account_name,
            product_id=None,
            product_name='회사 현금입금',
            trade_type='deposit',
            quantity=1,
            unit_type='share',
            price=amount,
            total_amount=amount,
            trade_date=deposit_date,
            asset_type='cash',
            notes=data.get('notes', '')
        )
        db.session.add(log)
        db.session.flush()
        event = append_trade_event(
            user_id=user_id,
            account_name=account_name,
            event_type='trade_created',
            trade_log_id=log.id,
            import_batch_id=batch.id,
            payload={
                'trade_log': serialize_trade_log(log),
                'product': None,
                'reason': 'cash_deposit'
            }
        )
        capture_trade_snapshot(
            user_id,
            account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id,
            snapshot_payload={
                'product_name': log.product_name,
                'trade_type': log.trade_type,
                'total_amount': log.total_amount,
                'cash_balance': get_cash_balance(user_id, account_name).amount
            },
            snapshot_kind='cash_deposit'
        )
        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            user_id,
            account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id
        )
        finalize_import_batch(
            batch,
            imported_count=1,
            notes={
                'reason': 'cash_deposit',
                'trade_event_id': event.id,
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({
            'message': '회사 현금입금이 원금과 매매일지에 기록되었습니다.',
            'log': log.to_dict()
        }), 201
    except ValueError:
        return jsonify({'error': '입금액 또는 입금일 형식이 올바르지 않습니다.'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/all-products', methods=['GET'])
@jwt_required()
def get_all_products():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        products = Product.query.filter_by(user_id=user_id, account_name=account_name).order_by(Product.purchase_date.desc()).all()
        return jsonify([p.to_dict() for p in products]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/domain-model', methods=['GET'])
@jwt_required()
def get_portfolio_domain_model():
    try:
        user_id = current_user_id()
        scope = str(request.args.get('scope') or 'account').strip().lower()
        if scope == 'all':
            account_names = [item['account_name'] for item in list_user_accounts(user_id)]
        else:
            account_names = [current_account_name()]

        wrappers_by_name, price_series_rows, as_of = refresh_domain_models(user_id, account_names)
        db.session.commit()

        wrapper_ids = [wrapper.id for wrapper in wrappers_by_name.values()]
        wrappers = []
        for account_name in account_names:
            wrapper = wrappers_by_name.get(account_name)
            if not wrapper:
                continue
            wrapper_row = wrapper.to_dict()
            wrapper_row['tags'] = parse_json_text(wrapper_row.pop('tags_json'), [])
            wrapper_row['provenance'] = {
                'source': wrapper_row.pop('source'),
                'asOf': wrapper_row.pop('as_of'),
                'latencyClass': wrapper_row.pop('latency_class'),
                'reconciled': wrapper_row.pop('reconciled')
            }
            wrappers.append(wrapper_row)

        lots = [
            {
                **row.to_dict(),
                'provenance': {
                    'source': row.source,
                    'asOf': row.as_of.isoformat() if row.as_of else None,
                    'latencyClass': row.latency_class,
                    'reconciled': bool(row.reconciled)
                }
            }
            for row in HoldingLot.query.filter(
                HoldingLot.user_id == user_id,
                HoldingLot.account_wrapper_id.in_(wrapper_ids)
            ).order_by(HoldingLot.account_name.asc(), HoldingLot.symbol.asc(), HoldingLot.acquired_at.asc()).all()
        ]

        cash_flows = [
            {
                **row.to_dict(),
                'provenance': {
                    'source': row.source,
                    'asOf': row.as_of.isoformat() if row.as_of else None,
                    'latencyClass': row.latency_class,
                    'reconciled': bool(row.reconciled)
                }
            }
            for row in CashFlow.query.filter(
                CashFlow.user_id == user_id,
                CashFlow.account_wrapper_id.in_(wrapper_ids)
            ).order_by(CashFlow.flow_date.asc(), CashFlow.id.asc()).all()
        ]

        snapshots = [
            {
                **row.to_dict(),
                'payload': parse_json_text(row.payload_json, {}),
                'provenance': {
                    'source': row.source,
                    'asOf': row.as_of.isoformat() if row.as_of else None,
                    'latencyClass': row.latency_class,
                    'reconciled': bool(row.reconciled)
                }
            }
            for row in PortfolioSnapshot.query.filter(
                PortfolioSnapshot.user_id == user_id,
                db.or_(
                    PortfolioSnapshot.account_wrapper_id.in_(wrapper_ids),
                    PortfolioSnapshot.account_name == '__all__'
                )
            ).order_by(PortfolioSnapshot.snapshot_date.asc(), PortfolioSnapshot.id.asc()).all()
        ]

        benchmarks = []
        benchmark_start = date.today() - timedelta(days=400)
        benchmark_end = date.today()
        for row in Benchmark.query.filter(
            Benchmark.user_id == user_id,
            Benchmark.account_wrapper_id.in_(wrapper_ids)
        ).order_by(Benchmark.account_wrapper_id.asc(), Benchmark.id.asc()).all():
            series = market_client.get_historical_prices(row.code, benchmark_start, benchmark_end)
            benchmark_row = row.to_dict()
            benchmark_row['series'] = [
                {
                    'date': item['date'].isoformat() if isinstance(item.get('date'), date) else str(item.get('date')),
                    'price': float(item.get('price') or 0)
                }
                for item in series
                if item.get('date') and item.get('price') is not None
            ]
            benchmark_row['provenance'] = {
                'source': row.source,
                'asOf': row.as_of.isoformat() if row.as_of else None,
                'latencyClass': row.latency_class,
                'reconciled': bool(row.reconciled)
            }
            benchmarks.append(benchmark_row)

        return jsonify({
            'scope': 'all' if scope == 'all' else 'account',
            'account_names': account_names,
            'account_wrappers': wrappers,
            'holdings_lots': lots,
            'cash_flows': cash_flows,
            'portfolio_snapshots': snapshots,
            'benchmarks': benchmarks,
            'price_series': price_series_rows,
            'provenance': {
                'source': 'portfolio_ledger',
                'asOf': as_of.isoformat(),
                'latencyClass': 'eod',
                'reconciled': False
            }
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products', methods=['POST'])
@jwt_required()
def add_product():
    try:
        data = request.get_json() or {}
        required = ['product_name', 'product_code', 'purchase_price', 'quantity', 'purchase_date', 'asset_type']
        for field in required:
            if not data.get(field):
                return jsonify({'error': f'{field} is required'}), 400

        unit_type = normalize_unit_type(data.get('unit_type'))
        quantity = parse_positive_float(data['quantity'], '수량/좌수')
        purchase_price = parse_positive_float(data['purchase_price'], '매입가/기준가')
        purchase_date = parse_trade_date(data['purchase_date'])
        account_name = current_account_name()
        batch = create_import_batch(
            current_user_id(),
            account_name,
            batch_type='manual_product_add',
            source_name='ui',
            row_count=1,
            notes={'reason': 'product_added'}
        )

        product = Product(
            user_id=current_user_id(),
            account_name=account_name,
            product_name=data['product_name'],
            product_code=market_client.clean_code(data['product_code']),
            purchase_price=purchase_price,
            quantity=quantity,
            unit_type=unit_type,
            purchase_date=purchase_date,
            asset_type=data['asset_type'],
            current_price=purchase_price,
            status='holding'
        )
        db.session.add(product)
        db.session.flush()

        upsert_price_history(product.id, product.purchase_date, product.current_price)

        trade_log = TradeLog(
            user_id=product.user_id,
            account_name=product.account_name,
            product_id=product.id,
            product_name=product.product_name,
            trade_type='buy',
            quantity=product.quantity,
            unit_type=product.unit_type,
            price=product.purchase_price,
            total_amount=trade_amount(product.quantity, product.purchase_price, product.unit_type),
            trade_date=product.purchase_date,
            asset_type=product.asset_type,
            notes=data.get('notes', '')
        )
        db.session.add(trade_log)
        db.session.flush()
        event = append_trade_event(
            user_id=product.user_id,
            account_name=product.account_name,
            event_type='trade_created',
            trade_log_id=trade_log.id,
            product_id=product.id,
            import_batch_id=batch.id,
            payload={
                'trade_log': serialize_trade_log(trade_log),
                'product': serialize_product(product),
                'reason': 'product_added'
            }
        )
        capture_trade_snapshot(
            product.user_id,
            product.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id,
            product=product,
            snapshot_kind='product_added'
        )
        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            product.user_id,
            product.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id
        )
        finalize_import_batch(
            batch,
            imported_count=1,
            notes={
                'reason': 'product_added',
                'trade_event_id': event.id,
                'product_id': product.id,
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({'message': '상품이 추가되었습니다.', 'product': product.to_dict()}), 201
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': f'입력 형식 오류: {str(e)}'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>', methods=['PUT'])
@jwt_required()
def update_product(product_id):
    try:
        data = request.get_json() or {}
        user_id = current_user_id()
        product = assertCanAccessPortfolio(user_id, product_id)
        if product.status != 'holding':
            return jsonify({'error': '보유 중인 상품을 찾을 수 없습니다.'}), 404

        product.product_name = data.get('product_name') or product.product_name
        product.product_code = market_client.clean_code(data.get('product_code') or product.product_code)
        product.asset_type = data.get('asset_type') or product.asset_type
        product.unit_type = normalize_unit_type(data.get('unit_type', product.unit_type))

        if data.get('purchase_price') not in (None, ''):
            product.purchase_price = parse_positive_float(data.get('purchase_price'), '매입가/기준가')
        if data.get('quantity') not in (None, ''):
            product.quantity = parse_positive_float(data.get('quantity'), '수량/좌수')
        if data.get('purchase_date'):
            product.purchase_date = parse_trade_date(data.get('purchase_date'))
        if data.get('current_price') not in (None, ''):
            product.current_price = parse_positive_float(data.get('current_price'), '현재가/기준가')

        upsert_price_history(product.id, product.purchase_date, product.purchase_price)

        trade_logs = TradeLog.query.filter_by(product_id=product.id).all()
        for log in trade_logs:
            log.account_name = product.account_name
            log.product_name = product.product_name
            log.asset_type = product.asset_type
            log.unit_type = product.unit_type
            if log.trade_type in ('buy', 'sell'):
                log.total_amount = trade_amount(log.quantity, log.price, product.unit_type)

        buy_logs = (
            TradeLog.query
            .filter_by(product_id=product.id, trade_type='buy')
            .order_by(TradeLog.trade_date.asc(), TradeLog.id.asc())
            .all()
        )
        if len(buy_logs) == 1:
            first_buy = buy_logs[0]
            first_buy.product_name = product.product_name
            first_buy.quantity = product.quantity
            first_buy.unit_type = product.unit_type
            first_buy.price = product.purchase_price
            first_buy.total_amount = trade_amount(product.quantity, product.purchase_price, product.unit_type)
            first_buy.trade_date = product.purchase_date
            first_buy.asset_type = product.asset_type
            if data.get('notes') is not None:
                first_buy.notes = data.get('notes')

        db.session.commit()
        return jsonify({'message': '상품 정보가 수정되었습니다.', 'product': product.to_dict()}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/buy', methods=['POST'])
@jwt_required()
def add_product_buy(product_id):
    try:
        data = request.get_json() or {}
        user_id = current_user_id()
        product = assertCanAccessPortfolio(user_id, product_id)
        if product.status != 'holding':
            return jsonify({'error': '보유 중인 상품을 찾을 수 없습니다.'}), 404
        batch = create_import_batch(
            product.user_id,
            product.account_name,
            batch_type='manual_additional_buy',
            source_name='ui',
            row_count=1,
            notes={'reason': 'additional_buy', 'product_id': product.id}
        )

        quantity = parse_positive_float(data.get('quantity'), '추가 수량/좌수')
        price = parse_positive_float(data.get('purchase_price'), '추가 매입가/기준가')
        buy_date = parse_trade_date(data.get('purchase_date'))

        previous_amount = trade_amount(product.quantity, product.purchase_price, product.unit_type)
        additional_amount = trade_amount(quantity, price, product.unit_type)
        new_quantity = product.quantity + quantity
        product.purchase_price = Product.price_for_amount(previous_amount + additional_amount, new_quantity, product.unit_type)
        product.quantity = new_quantity
        if buy_date < product.purchase_date:
            product.purchase_date = buy_date

        upsert_price_history(product.id, buy_date, price)

        trade_log = TradeLog(
            user_id=product.user_id,
            account_name=product.account_name,
            product_id=product.id,
            product_name=product.product_name,
            trade_type='buy',
            quantity=quantity,
            unit_type=product.unit_type,
            price=price,
            total_amount=additional_amount,
            trade_date=buy_date,
            asset_type=product.asset_type,
            notes=data.get('notes', '추가매수')
        )
        db.session.add(trade_log)
        db.session.flush()
        event = append_trade_event(
            user_id=product.user_id,
            account_name=product.account_name,
            event_type='trade_created',
            trade_log_id=trade_log.id,
            product_id=product.id,
            import_batch_id=batch.id,
            payload={
                'trade_log': serialize_trade_log(trade_log),
                'product': serialize_product(product),
                'reason': 'additional_buy'
            }
        )
        capture_trade_snapshot(
            product.user_id,
            product.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id,
            product=product,
            snapshot_kind='additional_buy'
        )
        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            product.user_id,
            product.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id
        )
        finalize_import_batch(
            batch,
            imported_count=1,
            notes={
                'reason': 'additional_buy',
                'trade_event_id': event.id,
                'product_id': product.id,
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({'message': '추가매수가 반영되었습니다.', 'product': product.to_dict()}), 201
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/sell', methods=['PUT'])
@jwt_required()
def sell_product(product_id):
    try:
        data = request.get_json() or {}
        user_id = current_user_id()
        product = assertCanAccessPortfolio(user_id, product_id)
        if product.status == 'sold':
            return jsonify({'error': '이미 매도 완료된 상품입니다.'}), 400
        batch = create_import_batch(
            product.user_id,
            product.account_name,
            batch_type='manual_sell',
            source_name='ui',
            row_count=1,
            notes={'reason': 'sell_completed', 'product_id': product.id}
        )

        product.status = 'sold'
        product.sale_price = parse_positive_float(data.get('sale_price'), '매도가/기준가')
        product.sale_date = parse_trade_date(data.get('sale_date'))

        trade_log = TradeLog(
            user_id=product.user_id,
            account_name=product.account_name,
            product_id=product.id,
            product_name=product.product_name,
            trade_type='sell',
            quantity=product.quantity,
            unit_type=product.unit_type,
            price=product.sale_price,
            total_amount=trade_amount(product.quantity, product.sale_price, product.unit_type),
            trade_date=product.sale_date,
            asset_type=product.asset_type,
            notes=data.get('notes', '')
        )
        db.session.add(trade_log)
        db.session.flush()
        event = append_trade_event(
            user_id=product.user_id,
            account_name=product.account_name,
            event_type='trade_created',
            trade_log_id=trade_log.id,
            product_id=product.id,
            import_batch_id=batch.id,
            payload={
                'trade_log': serialize_trade_log(trade_log),
                'product': serialize_product(product),
                'reason': 'sell_completed'
            }
        )
        capture_trade_snapshot(
            product.user_id,
            product.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id,
            product=product,
            snapshot_kind='sell_completed'
        )
        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            product.user_id,
            product.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id
        )
        finalize_import_batch(
            batch,
            imported_count=1,
            notes={
                'reason': 'sell_completed',
                'trade_event_id': event.id,
                'product_id': product.id,
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({'message': '매도가 완료되었습니다.', 'product': product.to_dict()}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': f'입력 형식 오류: {str(e)}'}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


def delete_user_product(user_id, product_id, import_batch_id=None):
    product = Product.query.filter_by(id=product_id, user_id=user_id).first()
    if not product:
        return None, 0

    fallback_log_filters = [
        db.and_(
            TradeLog.product_id.is_(None),
            TradeLog.account_name == product.account_name,
            TradeLog.product_name == product.product_name,
            TradeLog.trade_type == 'buy',
            TradeLog.trade_date == product.purchase_date,
            TradeLog.quantity == product.quantity
        )
    ]
    if product.sale_date:
        fallback_log_filters.append(
            db.and_(
                TradeLog.product_id.is_(None),
                TradeLog.account_name == product.account_name,
                TradeLog.product_name == product.product_name,
                TradeLog.trade_type == 'sell',
                TradeLog.trade_date == product.sale_date,
                TradeLog.quantity == product.quantity
            )
        )

    related_logs = (
        TradeLog.query
        .filter(TradeLog.user_id == user_id)
        .filter(db.or_(TradeLog.product_id == product.id, *fallback_log_filters))
        .order_by(TradeLog.trade_date.asc(), TradeLog.id.asc())
        .all()
    )
    for log in related_logs:
        event = append_trade_event(
            user_id=user_id,
            account_name=log.account_name,
            event_type='trade_deleted',
            trade_log_id=log.id,
            product_id=log.product_id,
            import_batch_id=import_batch_id,
            payload={
                'deleted': serialize_trade_log(log),
                'product_deleted': serialize_product(product)
            }
        )
        capture_trade_snapshot(
            user_id,
            log.account_name,
            import_batch_id=import_batch_id,
            trade_event_id=event.id,
            snapshot_payload={
                'product_name': log.product_name,
                'trade_type': log.trade_type,
                'total_amount': log.total_amount,
                'quantity': log.quantity,
                'price': log.price,
                'deleted_product': serialize_product(product)
            },
            snapshot_kind='product_deleted'
        )
        db.session.delete(log)
    deleted_logs = len(related_logs)
    PriceHistory.query.filter_by(product_id=product.id).delete(synchronize_session=False)
    db.session.delete(product)
    return product, deleted_logs


@api.route('/products/<int:product_id>', methods=['DELETE'])
@jwt_required()
def delete_product(product_id):
    try:
        user_id = current_user_id()
        product = assertCanAccessPortfolio(user_id, product_id)
        batch = create_import_batch(
            user_id,
            product.account_name,
            batch_type='manual_product_delete',
            source_name='ui',
            row_count=1,
            notes={'reason': 'product_delete', 'product_id': product_id}
        )
        product, deleted_logs = delete_user_product(user_id, product_id, batch.id)

        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            user_id,
            product.account_name,
            import_batch_id=batch.id
        )
        finalize_import_batch(
            batch,
            imported_count=deleted_logs,
            notes={
                'reason': 'product_delete',
                'deleted_logs': deleted_logs,
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({
            'message': '상품과 관련 매매일지, 가격 이력을 삭제했습니다.',
            'deleted_trade_logs': deleted_logs
        }), 200
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/delete', methods=['POST'])
@jwt_required()
def delete_product_with_post(product_id):
    try:
        user_id = current_user_id()
        product = assertCanAccessPortfolio(user_id, product_id)
        batch = create_import_batch(
            user_id,
            product.account_name,
            batch_type='manual_product_delete',
            source_name='ui',
            row_count=1,
            notes={'reason': 'product_delete', 'product_id': product_id}
        )
        product, deleted_logs = delete_user_product(user_id, product_id, batch.id)

        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            user_id,
            product.account_name,
            import_batch_id=batch.id
        )
        finalize_import_batch(
            batch,
            imported_count=deleted_logs,
            notes={
                'reason': 'product_delete',
                'deleted_logs': deleted_logs,
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({
            'message': '상품과 관련 매매일지, 가격 이력을 삭제했습니다.',
            'deleted_trade_logs': deleted_logs
        }), 200
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/update-price', methods=['PUT'])
@jwt_required()
def update_product_price(product_id):
    try:
        data = request.get_json() or {}
        product = assertCanAccessPortfolio(current_user_id(), product_id)
        if product.status == 'sold':
            return jsonify({'error': '매도 완료된 상품은 가격을 갱신할 수 없습니다.'}), 400

        product.current_price = float(data['price'])
        existing = PriceHistory.query.filter_by(product_id=product.id, record_date=date.today()).first()
        if existing:
            existing.price = product.current_price
        else:
            db.session.add(PriceHistory(product_id=product.id, price=product.current_price, record_date=date.today()))
        db.session.commit()
        return jsonify({'message': '기준가가 갱신되었습니다.', 'product': product.to_dict()}), 200
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/price-history', methods=['GET'])
@jwt_required()
def get_price_history(product_id):
    try:
        product = assertCanAccessPortfolio(current_user_id(), product_id)

        histories = PriceHistory.query.filter_by(product_id=product_id)
        if product.status == 'sold' and product.sale_date:
            histories = histories.filter(PriceHistory.record_date <= product.sale_date)
        return jsonify([h.to_dict() for h in histories.order_by(PriceHistory.record_date).all()]), 200
    except AccessDeniedError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/trends', methods=['GET'])
@jwt_required()
def get_portfolio_trends():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        include_sold = str(request.args.get('include_sold') or '').strip().lower() in ('1', 'true', 'yes', 'all')
        rows, changed = collect_account_trend_rows(user_id, account_name, include_sold=include_sold, sync_prices=True)
        if changed:
            db.session.commit()
        rows.sort(key=lambda item: (item['record_date'], item['product_name']))
        return jsonify(rows), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-journals', methods=['GET'])
@jwt_required()
def get_trade_journals():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        query = TradeJournal.query.filter_by(user_id=user_id, account_name=account_name)

        attached_trade_id = request.args.get('attached_trade_id')
        if attached_trade_id:
            query = query.filter_by(attached_trade_id=int(attached_trade_id))

        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        if date_from:
            query = query.filter(TradeJournal.entry_date >= parse_trade_date(date_from))
        if date_to:
            query = query.filter(TradeJournal.entry_date <= parse_trade_date(date_to))

        tag = str(request.args.get('tag') or '').strip().lower()
        keyword = str(request.args.get('q') or '').strip().lower()

        rows = [build_trade_journal_response(row) for row in query.order_by(TradeJournal.entry_date.desc(), TradeJournal.id.desc()).all()]
        if tag:
            rows = [row for row in rows if any(str(item).strip().lower() == tag for item in row.get('tags', []))]
        if keyword:
            rows = [
                row for row in rows
                if keyword in str(row.get('thesis') or '').lower()
                or keyword in str(row.get('trigger') or '').lower()
                or keyword in str(row.get('invalidation') or '').lower()
            ]

        return jsonify({'journals': rows, 'count': len(rows)}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/trade-journals', methods=['POST'])
@jwt_required()
def create_trade_journal():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        data = request.get_json() or {}
        thesis = str(data.get('thesis') or '').strip()
        if not thesis:
            return jsonify({'error': 'thesis는 필수입니다.'}), 400

        attached_trade_id = data.get('attachedTradeId') or data.get('attached_trade_id')
        attached_symbol = str(data.get('attachedSymbol') or data.get('attached_symbol') or '').strip().upper()
        if attached_trade_id not in (None, ''):
            attached_trade = assertCanEditJournalEntry(user_id, int(attached_trade_id))
            if normalize_account_name(attached_trade.account_name) != account_name:
                return jsonify({'error': '선택한 통장의 거래와만 연결할 수 있습니다.'}), 400
            if not attached_symbol and attached_trade.product_id:
                product = Product.query.filter_by(id=attached_trade.product_id, user_id=user_id).first()
                if product:
                    attached_symbol = market_client.clean_code(product.product_code)

        journal = TradeJournal(
            user_id=user_id,
            account_name=account_name,
            attached_trade_id=int(attached_trade_id) if attached_trade_id not in (None, '') else None,
            attached_symbol=attached_symbol[:32] if attached_symbol else None,
            thesis=thesis,
            trigger=str(data.get('trigger') or '').strip() or None,
            invalidation=str(data.get('invalidation') or '').strip() or None,
            target_horizon=normalize_journal_horizon(data.get('targetHorizon') or data.get('target_horizon')),
            tags_json=canonical_json(parse_string_list(data.get('tags'))),
            confidence=normalize_confidence(data.get('confidence')),
            screenshots_or_links_json=canonical_json(parse_string_list(data.get('screenshotsOrLinks') or data.get('screenshots_or_links'))),
            entry_date=parse_trade_date(data.get('entry_date'))
        )
        db.session.add(journal)
        db.session.commit()
        return jsonify({'message': '거래 연결형 저널을 생성했습니다.', 'journal': build_trade_journal_response(journal)}), 201
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-journals/<int:journal_id>', methods=['PUT'])
@jwt_required()
def update_trade_journal(journal_id):
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        data = request.get_json() or {}
        journal = TradeJournal.query.filter_by(id=journal_id, user_id=user_id, account_name=account_name).first()
        if not journal:
            return jsonify({'error': '저널을 찾을 수 없습니다.'}), 404

        if data.get('thesis') is not None:
            thesis = str(data.get('thesis') or '').strip()
            if not thesis:
                return jsonify({'error': 'thesis는 비워둘 수 없습니다.'}), 400
            journal.thesis = thesis
        if data.get('trigger') is not None:
            journal.trigger = str(data.get('trigger') or '').strip() or None
        if data.get('invalidation') is not None:
            journal.invalidation = str(data.get('invalidation') or '').strip() or None
        if data.get('targetHorizon') is not None or data.get('target_horizon') is not None:
            journal.target_horizon = normalize_journal_horizon(data.get('targetHorizon') or data.get('target_horizon'))
        if data.get('tags') is not None:
            journal.tags_json = canonical_json(parse_string_list(data.get('tags')))
        if data.get('confidence') is not None:
            journal.confidence = normalize_confidence(data.get('confidence'))
        if data.get('screenshotsOrLinks') is not None or data.get('screenshots_or_links') is not None:
            journal.screenshots_or_links_json = canonical_json(parse_string_list(data.get('screenshotsOrLinks') or data.get('screenshots_or_links')))
        if data.get('entry_date'):
            journal.entry_date = parse_trade_date(data.get('entry_date'))

        if data.get('attachedTradeId') is not None or data.get('attached_trade_id') is not None:
            attached_trade_id = data.get('attachedTradeId') if data.get('attachedTradeId') is not None else data.get('attached_trade_id')
            if attached_trade_id in ('', None):
                journal.attached_trade_id = None
            else:
                attached_trade = assertCanEditJournalEntry(user_id, int(attached_trade_id))
                if normalize_account_name(attached_trade.account_name) != account_name:
                    return jsonify({'error': '선택한 통장의 거래와만 연결할 수 있습니다.'}), 400
                journal.attached_trade_id = int(attached_trade_id)
        if data.get('attachedSymbol') is not None or data.get('attached_symbol') is not None:
            journal.attached_symbol = str(data.get('attachedSymbol') or data.get('attached_symbol') or '').strip().upper()[:32] or None

        db.session.commit()
        return jsonify({'message': '저널을 수정했습니다.', 'journal': build_trade_journal_response(journal)}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-journals/<int:journal_id>', methods=['DELETE'])
@jwt_required()
def delete_trade_journal(journal_id):
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        journal = TradeJournal.query.filter_by(id=journal_id, user_id=user_id, account_name=account_name).first()
        if not journal:
            return jsonify({'error': '저널을 찾을 수 없습니다.'}), 404
        db.session.delete(journal)
        db.session.commit()
        return jsonify({'message': '저널을 삭제했습니다.'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/calendar/events', methods=['GET'])
@jwt_required()
def get_calendar_events():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        start_date = parse_trade_date(request.args.get('start_date'), (date.today() - timedelta(days=30)).isoformat())
        end_date = parse_trade_date(request.args.get('end_date'), (date.today() + timedelta(days=120)).isoformat())
        event_type_filter = normalize_event_type(request.args.get('event_type')) if request.args.get('event_type') else ''
        symbol_filter = str(request.args.get('symbol') or '').strip().upper()

        db_rows = (
            CalendarEvent.query
            .filter_by(user_id=user_id, account_name=account_name)
            .filter(CalendarEvent.event_date >= start_date, CalendarEvent.event_date <= end_date)
            .order_by(CalendarEvent.event_date.asc(), CalendarEvent.id.asc())
            .all()
        )
        user_events = [build_calendar_event_response(row) for row in db_rows]
        system_events = collect_system_calendar_events(user_id, account_name, start_date, end_date)
        events = dedupe_and_sort_events(user_events + system_events)

        if event_type_filter:
            events = [row for row in events if normalize_event_type(row.get('event_type')) == event_type_filter]
        if symbol_filter:
            events = [row for row in events if str(row.get('attachedSymbol') or '').strip().upper() == symbol_filter]

        return jsonify({
            'account_name': account_name,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'count': len(events),
            'events': events
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/calendar/events', methods=['POST'])
@jwt_required()
def create_calendar_event():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        data = request.get_json() or {}

        title = str(data.get('title') or '').strip()
        if not title:
            return jsonify({'error': 'title은 필수입니다.'}), 400
        event_date = parse_trade_date(data.get('event_date'))
        event_type = normalize_event_type(data.get('event_type'))
        attached_trade_id = data.get('attachedTradeId') if data.get('attachedTradeId') is not None else data.get('attached_trade_id')
        if attached_trade_id not in (None, ''):
            attached_trade = assertCanEditJournalEntry(user_id, int(attached_trade_id))
            if normalize_account_name(attached_trade.account_name) != account_name:
                return jsonify({'error': '선택한 통장의 거래와만 연결할 수 있습니다.'}), 400

        attached_symbol = str(data.get('attachedSymbol') or data.get('attached_symbol') or '').strip().upper()
        dedupe_key = str(data.get('dedupe_key') or '').strip() or make_event_dedupe_key(
            event_type, event_date.isoformat(), attached_symbol, title
        )

        event = CalendarEvent(
            user_id=user_id,
            account_name=account_name,
            event_type=event_type,
            title=title[:255],
            description=str(data.get('description') or '').strip() or None,
            event_date=event_date,
            attached_symbol=attached_symbol[:32] if attached_symbol else None,
            attached_trade_id=int(attached_trade_id) if attached_trade_id not in (None, '') else None,
            source='user',
            dedupe_key=dedupe_key[:255],
            metadata_json=canonical_json(data.get('metadata') or {})
        )
        db.session.add(event)
        db.session.commit()
        return jsonify({'message': '캘린더 이벤트를 추가했습니다.', 'event': build_calendar_event_response(event)}), 201
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/calendar/events/<int:event_id>', methods=['PUT'])
@jwt_required()
def update_calendar_event(event_id):
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        data = request.get_json() or {}
        event = CalendarEvent.query.filter_by(id=event_id, user_id=user_id, account_name=account_name).first()
        if not event:
            return jsonify({'error': '캘린더 이벤트를 찾을 수 없습니다.'}), 404
        if event.source != 'user':
            return jsonify({'error': '시스템 이벤트는 수정할 수 없습니다.'}), 400

        if data.get('title') is not None:
            title = str(data.get('title') or '').strip()
            if not title:
                return jsonify({'error': 'title은 비워둘 수 없습니다.'}), 400
            event.title = title[:255]
        if data.get('description') is not None:
            event.description = str(data.get('description') or '').strip() or None
        if data.get('event_date'):
            event.event_date = parse_trade_date(data.get('event_date'))
        if data.get('event_type') is not None:
            event.event_type = normalize_event_type(data.get('event_type'))
        if data.get('attachedSymbol') is not None or data.get('attached_symbol') is not None:
            event.attached_symbol = str(data.get('attachedSymbol') or data.get('attached_symbol') or '').strip().upper()[:32] or None
        if data.get('attachedTradeId') is not None or data.get('attached_trade_id') is not None:
            attached_trade_id = data.get('attachedTradeId') if data.get('attachedTradeId') is not None else data.get('attached_trade_id')
            if attached_trade_id in ('', None):
                event.attached_trade_id = None
            else:
                attached_trade = assertCanEditJournalEntry(user_id, int(attached_trade_id))
                if normalize_account_name(attached_trade.account_name) != account_name:
                    return jsonify({'error': '선택한 통장의 거래와만 연결할 수 있습니다.'}), 400
                event.attached_trade_id = int(attached_trade_id)
        if data.get('metadata') is not None:
            event.metadata_json = canonical_json(data.get('metadata') or {})

        event.dedupe_key = make_event_dedupe_key(
            event.event_type,
            event.event_date.isoformat() if event.event_date else '',
            event.attached_symbol,
            event.title
        )[:255]

        db.session.commit()
        return jsonify({'message': '캘린더 이벤트를 수정했습니다.', 'event': build_calendar_event_response(event)}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/calendar/events/<int:event_id>', methods=['DELETE'])
@jwt_required()
def delete_calendar_event(event_id):
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        event = CalendarEvent.query.filter_by(id=event_id, user_id=user_id, account_name=account_name).first()
        if not event:
            return jsonify({'error': '캘린더 이벤트를 찾을 수 없습니다.'}), 404
        if event.source != 'user':
            return jsonify({'error': '시스템 이벤트는 삭제할 수 없습니다.'}), 400
        db.session.delete(event)
        db.session.commit()
        return jsonify({'message': '캘린더 이벤트를 삭제했습니다.'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs', methods=['GET'])
@jwt_required()
def get_trade_logs():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        query = TradeLog.query.filter_by(user_id=user_id, account_name=account_name)
        trade_type = request.args.get('trade_type')
        asset_type = request.args.get('asset_type')
        if trade_type:
            query = query.filter_by(trade_type=trade_type)
        if asset_type:
            query = query.filter_by(asset_type=asset_type)
        logs = query.order_by(TradeLog.trade_date.desc(), TradeLog.id.desc()).all()
        return jsonify([log.to_dict() for log in logs]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def build_trade_event_response(event):
    row = event.to_dict()
    try:
        row['payload'] = json.loads(row.pop('payload_json') or '{}')
    except Exception:
        row['payload'] = {'raw': row.pop('payload_json')}
    row['hash_short'] = row['hash'][:12] if row.get('hash') else None
    row['event_type_label'] = {
        'trade_created': '생성',
        'trade_updated': '수정',
        'trade_deleted': '삭제',
        'trade_restore_draft': '복원초안'
    }.get(row['event_type'], row['event_type'])
    return row


def annotate_trade_event_chain(event_rows):
    if not event_rows:
        return [], 0

    rows_in_order = sorted(event_rows, key=lambda row: int(row.get('id') or 0))
    previous = None
    chain_by_id = {}
    broken_count = 0
    for row in rows_in_order:
        expected_prev_hash = previous.get('hash') if previous else None
        actual_prev_hash = row.get('prev_hash')
        if previous is None:
            chain_valid = not actual_prev_hash
            chain_issue = None if chain_valid else 'non_empty_prev_hash'
        else:
            chain_valid = (expected_prev_hash == actual_prev_hash)
            chain_issue = None if chain_valid else 'prev_hash_mismatch'
        if not chain_valid:
            broken_count += 1
        chain_by_id[int(row.get('id') or 0)] = {
            'chain_valid': chain_valid,
            'chain_issue': chain_issue,
            'chain_expected_prev_hash': expected_prev_hash,
            'chain_expected_prev_hash_short': expected_prev_hash[:12] if expected_prev_hash else None
        }
        previous = row

    annotated = []
    for row in event_rows:
        chain = chain_by_id.get(int(row.get('id') or 0), {})
        annotated.append({
            **row,
            **chain
        })
    return annotated, broken_count


def extract_restore_draft_from_trade_event(event):
    payload = parse_json_text(getattr(event, 'payload_json', None), {})
    if not isinstance(payload, dict):
        payload = {}

    restore_mode = None
    source = None
    if isinstance(payload.get('deleted'), dict):
        restore_mode = 'deleted'
        source = payload.get('deleted')
    elif isinstance(payload.get('before'), dict):
        restore_mode = 'before'
        source = payload.get('before')
    elif isinstance(payload.get('trade_log'), dict):
        restore_mode = 'trade_log'
        source = payload.get('trade_log')
    elif isinstance(payload.get('after'), dict):
        restore_mode = 'after'
        source = payload.get('after')

    if not isinstance(source, dict):
        raise ValueError('복원 가능한 스냅샷(before/deleted/trade_log/after)이 없습니다.')

    draft = {
        'trade_log_id': source.get('id') if source.get('id') not in ('', None) else event.trade_log_id,
        'account_name': source.get('account_name') or event.account_name,
        'product_id': source.get('product_id'),
        'product_name': source.get('product_name'),
        'product_code': source.get('product_code'),
        'trade_type': source.get('trade_type'),
        'quantity': coerce_float(source.get('quantity')),
        'unit_type': normalize_unit_type(source.get('unit_type')),
        'price': coerce_float(source.get('price')),
        'total_amount': coerce_float(source.get('total_amount')),
        'trade_date': source.get('trade_date'),
        'asset_type': source.get('asset_type'),
        'notes': source.get('notes') or '',
    }
    if draft['total_amount'] in (None, '') and draft['quantity'] and draft['price']:
        draft['total_amount'] = trade_amount(draft['quantity'], draft['price'], draft['unit_type'])
    if draft['unit_type'] not in ('share', 'unit'):
        draft['unit_type'] = 'share'
    return draft, restore_mode


def normalize_restore_trade_draft(draft):
    if not isinstance(draft, dict):
        raise ValueError('복원 초안 형식이 올바르지 않습니다.')
    trade_type = str(draft.get('trade_type') or '').strip().lower()
    if trade_type not in ('buy', 'sell', 'deposit'):
        raise ValueError('복원 초안의 거래 구분이 올바르지 않습니다.')

    product_name = str(draft.get('product_name') or '').strip() or '복원 항목'
    trade_date = parse_trade_date(draft.get('trade_date') or date.today().isoformat())
    notes = str(draft.get('notes') or '').strip()
    product_code = market_client.clean_code(draft.get('product_code') or '')
    unit_type = normalize_unit_type(draft.get('unit_type'))
    product_id = int(draft.get('product_id')) if str(draft.get('product_id') or '').isdigit() else None

    if trade_type == 'deposit':
        amount_raw = draft.get('total_amount')
        if amount_raw in (None, ''):
            amount_raw = draft.get('price')
        amount = parse_positive_float(amount_raw, '입금액')
        return {
            'trade_type': 'deposit',
            'product_name': product_name,
            'product_code': product_code,
            'trade_date': trade_date,
            'quantity': 1.0,
            'unit_type': 'share',
            'price': amount,
            'total_amount': amount,
            'asset_type': 'cash',
            'notes': notes,
            'product_id': product_id
        }

    quantity = parse_positive_float(draft.get('quantity'), '수량/좌수')
    price = parse_positive_float(draft.get('price'), '가격/기준가')
    total_amount = draft.get('total_amount')
    if total_amount in (None, ''):
        total_amount = trade_amount(quantity, price, unit_type)
    else:
        total_amount = parse_positive_float(total_amount, '거래금액')
    asset_type = normalize_import_asset_type(draft.get('asset_type'))
    return {
        'trade_type': trade_type,
        'product_name': product_name,
        'product_code': product_code,
        'trade_date': trade_date,
        'quantity': quantity,
        'unit_type': unit_type,
        'price': price,
        'total_amount': total_amount,
        'asset_type': asset_type,
        'notes': notes,
        'product_id': product_id
    }


def build_import_batch_response(batch):
    row = batch.to_dict()
    row['notes'] = parse_json_text(row.pop('notes_json'), {})
    return row


def build_trade_snapshot_response(snapshot):
    row = snapshot.to_dict()
    row['payload'] = parse_json_text(row.pop('payload_json'), {})
    return row


def build_reconciliation_result_response(result):
    row = result.to_dict()
    row['details'] = parse_json_text(row.pop('details_json'), [])
    return row


def build_screener_screen_response(screen):
    row = screen.to_dict()
    row['filters'] = normalize_screener_filters(parse_json_text(row.pop('filters_json'), {}))
    row['result_codes'] = parse_json_text(row.pop('result_codes_json'), [])
    row['compare_codes'] = parse_json_text(row.pop('compare_codes_json'), [])
    row['condition_expression'] = build_screener_condition_expression(row['filters'])
    row['provenance'] = build_provenance(
        source='manual',
        latency_class='eod',
        reconciled=False,
        as_of=screen.updated_at
    )
    return row


def build_screener_watch_item_response(item):
    row = item.to_dict()
    row['candidate_tags'] = parse_json_text(row.pop('candidate_tags_json'), [])
    row['provenance'] = build_provenance(
        source='manual',
        latency_class='eod',
        reconciled=False,
        as_of=item.updated_at
    )
    return row


def build_trade_log_audit_pdf(account_name, rows):
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm
    )

    font_name = 'Helvetica'
    try:
        registerFont(UnicodeCIDFont('HYGothic-Medium'))
        font_name = 'HYGothic-Medium'
    except Exception:
        font_name = 'Helvetica'

    base_styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'AuditTitle',
        parent=base_styles['Title'],
        fontName=font_name,
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#17324d'),
        spaceAfter=10
    )
    body_style = ParagraphStyle(
        'AuditBody',
        parent=base_styles['BodyText'],
        fontName=font_name,
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#243b53')
    )
    meta_style = ParagraphStyle(
        'AuditMeta',
        parent=body_style,
        fontSize=8,
        textColor=colors.HexColor('#5b7083')
    )

    created_count = sum(1 for row in rows if row.get('event_type') == 'trade_created')
    updated_count = sum(1 for row in rows if row.get('event_type') == 'trade_updated')
    deleted_count = sum(1 for row in rows if row.get('event_type') == 'trade_deleted')

    story = [
        Paragraph('매매일지 감사 이력', title_style),
        Paragraph(
            f'통장: {escape(account_name)} / 총 이벤트: {len(rows)} / 생성·수정·삭제: '
            f'{created_count}·{updated_count}·{deleted_count}',
            body_style
        ),
        Paragraph(
            f'내보낸 시각: {escape(datetime.now(MARKET_TIMEZONE).strftime("%Y-%m-%d %H:%M:%S %Z"))}',
            meta_style
        ),
        Spacer(1, 8)
    ]

    table_rows = [[
        Paragraph('시각', body_style),
        Paragraph('이벤트', body_style),
        Paragraph('상품 / 거래', body_style),
        Paragraph('금액', body_style),
        Paragraph('hash', body_style)
    ]]

    for row in rows:
        snapshot = row.get('payload', {}).get('after') or row.get('payload', {}).get('deleted') or row.get('payload', {}).get('trade_log') or {}
        product_name = escape(str(snapshot.get('product_name') or '매매일지 이벤트'))
        trade_type = escape(str(snapshot.get('trade_type') or '-'))
        total_amount = snapshot.get('total_amount')
        amount_text = f'₩{format_number_text(total_amount, 0)}' if total_amount not in (None, '') else '-'
        table_rows.append([
            Paragraph(escape(str((row.get('occurred_at') or '').replace('T', ' ') or '-')), meta_style),
            Paragraph(escape(str(row.get('event_type_label') or row.get('event_type') or '-')), body_style),
            Paragraph(f'{product_name}<br/><font size="8">{trade_type}</font>', body_style),
            Paragraph(escape(amount_text), body_style),
            Paragraph(escape(str(row.get('hash_short') or '-')), meta_style)
        ])

    table = Table(table_rows, colWidths=[34 * mm, 20 * mm, 72 * mm, 24 * mm, 24 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eaf2f8')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#17324d')),
        ('FONTNAME', (0, 0), (-1, -1), font_name),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('LEADING', (0, 0), (-1, -1), 10),
        ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#d9e2ec')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#fbfdff')]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5)
    ]))
    story.append(table)
    document.build(story)
    return buffer.getvalue()


@api.route('/trade-logs/audit', methods=['GET'])
@jwt_required()
def get_trade_log_audit():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        limit = max(10, min(int(request.args.get('limit') or 80), 300))
        event_type = str(request.args.get('event_type') or '').strip().lower()
        chain_status = str(request.args.get('chain_status') or '').strip().lower()
        query = (
            TradeEvent.query
            .filter_by(user_id=user_id, account_name=account_name)
        )
        if event_type and event_type != 'all':
            query = query.filter_by(event_type=event_type)
        events = query.order_by(TradeEvent.id.desc()).limit(limit).all()
        event_rows = [build_trade_event_response(event) for event in events]
        annotated_rows, broken_count = annotate_trade_event_chain(event_rows)
        if chain_status == 'broken':
            annotated_rows = [row for row in annotated_rows if row.get('chain_valid') is False]
        elif chain_status == 'ok':
            annotated_rows = [row for row in annotated_rows if row.get('chain_valid') is True]

        return jsonify({
            'account_name': account_name,
            'event_count': len(annotated_rows),
            'chain_break_count': broken_count,
            'events': annotated_rows
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/<int:log_id>/audit', methods=['GET'])
@jwt_required()
def get_trade_log_audit_for_log(log_id):
    try:
        user_id = current_user_id()
        assertCanEditJournalEntry(user_id, log_id)
        events = (
            TradeEvent.query
            .filter_by(user_id=user_id, trade_log_id=log_id)
            .order_by(TradeEvent.id.desc())
            .all()
        )
        return jsonify({
            'trade_log_id': log_id,
            'event_count': len(events),
            'events': [build_trade_event_response(event) for event in events]
        }), 200
    except AccessDeniedError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/audit/<int:event_id>/restore-draft', methods=['POST'])
@jwt_required()
def create_trade_log_restore_draft(event_id):
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        event = (
            TradeEvent.query
            .filter_by(id=event_id, user_id=user_id, account_name=account_name)
            .first()
        )
        if not event:
            return jsonify({'error': '감사 이벤트를 찾지 못했습니다.'}), 404

        draft, restore_mode = extract_restore_draft_from_trade_event(event)
        trade_log_id = draft.get('trade_log_id')
        target_log = None
        if str(trade_log_id or '').isdigit():
            target_log = (
                TradeLog.query
                .filter_by(id=int(trade_log_id), user_id=user_id, account_name=account_name)
                .first()
            )

        draft_event = append_trade_event(
            user_id=user_id,
            account_name=account_name,
            event_type='trade_restore_draft',
            trade_log_id=target_log.id if target_log else None,
            product_id=target_log.product_id if target_log else draft.get('product_id'),
            source_type='ui',
            source_id=f'audit_event:{event.id}',
            payload={
                'source_event_id': event.id,
                'source_event_type': event.event_type,
                'restore_mode': restore_mode,
                'draft': draft,
                'can_apply_to_existing': bool(target_log)
            }
        )
        db.session.commit()
        return jsonify({
            'message': '복원 초안을 생성했습니다. 내용을 확인한 뒤 수동으로 반영하세요.',
            'source_event_id': event.id,
            'source_event_type': event.event_type,
            'restore_mode': restore_mode,
            'draft': draft,
            'can_apply_to_existing': bool(target_log),
            'target_trade_log_id': target_log.id if target_log else None,
            'appended_event': build_trade_event_response(draft_event)
        }), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/audit/<int:event_id>/restore-apply', methods=['POST'])
@jwt_required()
def apply_trade_log_restore_draft(event_id):
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        source_event = (
            TradeEvent.query
            .filter_by(id=event_id, user_id=user_id, account_name=account_name)
            .first()
        )
        if not source_event:
            return jsonify({'error': '복원 적용 대상 이벤트를 찾지 못했습니다.'}), 404

        source_payload = parse_json_text(source_event.payload_json, {})
        if source_event.event_type == 'trade_restore_draft' and isinstance(source_payload.get('draft'), dict):
            draft = source_payload.get('draft')
            restore_mode = str(source_payload.get('restore_mode') or 'draft')
            source_reference_event_id = int(source_payload.get('source_event_id') or source_event.id)
        else:
            draft, restore_mode = extract_restore_draft_from_trade_event(source_event)
            source_reference_event_id = source_event.id

        normalized = normalize_restore_trade_draft(draft)

        batch = create_import_batch(
            user_id,
            account_name,
            batch_type='manual_trade_restore_apply',
            source_name='ui',
            row_count=1,
            notes={
                'reason': 'restore_apply',
                'source_event_id': source_reference_event_id,
                'source_event_type': source_event.event_type,
                'restore_mode': restore_mode
            }
        )

        target_log = None
        if str(draft.get('trade_log_id') or '').isdigit():
            target_log = (
                TradeLog.query
                .filter_by(id=int(draft.get('trade_log_id')), user_id=user_id, account_name=account_name)
                .first()
            )

        if target_log:
            before_log = serialize_trade_log(target_log)
            target_log.product_name = normalized['product_name']
            target_log.trade_type = normalized['trade_type']
            target_log.trade_date = normalized['trade_date']
            target_log.notes = normalized['notes']
            target_log.quantity = normalized['quantity']
            target_log.unit_type = normalize_unit_type(normalized['unit_type'])
            target_log.price = normalized['price']
            target_log.total_amount = normalized['total_amount']
            target_log.asset_type = normalized['asset_type']

            product = None
            if target_log.trade_type in ('buy', 'sell'):
                product = sync_product_from_trade_log(target_log)

            db.session.flush()
            applied_event = append_trade_event(
                user_id=user_id,
                account_name=account_name,
                event_type='trade_updated',
                trade_log_id=target_log.id,
                product_id=target_log.product_id,
                import_batch_id=batch.id,
                source_type='ui',
                source_id=f'restore_apply:{source_reference_event_id}',
                payload={
                    'before': before_log,
                    'after': serialize_trade_log(target_log),
                    'product': serialize_product(product),
                    'reason': 'restore_apply',
                    'restore_mode': restore_mode,
                    'source_event_id': source_reference_event_id
                }
            )
            capture_trade_snapshot(
                user_id,
                account_name,
                import_batch_id=batch.id,
                trade_event_id=applied_event.id,
                product=product,
                snapshot_payload=serialize_trade_log(target_log) if not product else None,
                snapshot_kind='trade_restore_apply'
            )
            restored_log = target_log
            action = 'updated'
        else:
            restored_log = None
            product = None
            if normalized['trade_type'] in ('buy', 'sell'):
                if normalized.get('product_id'):
                    product = Product.query.filter_by(
                        id=int(normalized['product_id']),
                        user_id=user_id,
                        account_name=account_name
                    ).first()
                if not product:
                    product = find_import_target_product(user_id, account_name, normalized)

                if normalized['trade_type'] == 'sell' and not product:
                    raise ValueError('매도 복원을 적용할 보유 상품을 찾지 못했습니다.')

                if normalized['trade_type'] == 'buy' and not product:
                    product = Product(
                        user_id=user_id,
                        account_name=account_name,
                        product_name=normalized['product_name'],
                        product_code=normalized['product_code'] or '',
                        purchase_price=float(normalized['price']),
                        quantity=float(normalized['quantity']),
                        unit_type=normalize_unit_type(normalized['unit_type']),
                        purchase_date=normalized['trade_date'],
                        asset_type=normalized['asset_type'],
                        current_price=float(normalized['price']),
                        status='holding'
                    )
                    db.session.add(product)
                    db.session.flush()

                if product:
                    product.product_name = normalized['product_name'] or product.product_name
                    if normalized['product_code']:
                        product.product_code = normalized['product_code']
                    product.asset_type = normalized['asset_type'] or product.asset_type
                    if not product.unit_type:
                        product.unit_type = normalize_unit_type(normalized['unit_type'])

            restored_log = TradeLog(
                user_id=user_id,
                account_name=account_name,
                product_id=product.id if product else None,
                product_name=normalized['product_name'],
                trade_type=normalized['trade_type'],
                quantity=float(normalized['quantity']),
                unit_type=normalize_unit_type(normalized['unit_type']),
                price=float(normalized['price']),
                total_amount=float(normalized['total_amount']),
                trade_date=normalized['trade_date'],
                asset_type=normalized['asset_type'],
                notes=normalized['notes']
            )
            db.session.add(restored_log)
            db.session.flush()

            if product:
                sync_product_from_trade_log(restored_log)
                if normalized['trade_type'] == 'sell':
                    latest_product = Product.query.filter_by(id=product.id).first()
                    if latest_product and latest_product.status != 'sold':
                        latest_product.status = 'sold'
                        latest_product.sale_date = normalized['trade_date']
                        latest_product.sale_price = float(normalized['price'])

            applied_event = append_trade_event(
                user_id=user_id,
                account_name=account_name,
                event_type='trade_created',
                trade_log_id=restored_log.id,
                product_id=restored_log.product_id,
                import_batch_id=batch.id,
                source_type='ui',
                source_id=f'restore_apply:{source_reference_event_id}',
                payload={
                    'trade_log': serialize_trade_log(restored_log),
                    'product': serialize_product(Product.query.filter_by(id=restored_log.product_id).first() if restored_log.product_id else None),
                    'reason': 'restore_apply',
                    'restore_mode': restore_mode,
                    'source_event_id': source_reference_event_id
                }
            )
            capture_trade_snapshot(
                user_id,
                account_name,
                import_batch_id=batch.id,
                trade_event_id=applied_event.id,
                product=Product.query.filter_by(id=restored_log.product_id).first() if restored_log.product_id else None,
                snapshot_payload=serialize_trade_log(restored_log),
                snapshot_kind='trade_restore_apply'
            )
            action = 'created'

        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            user_id,
            account_name,
            import_batch_id=batch.id,
            trade_event_id=applied_event.id
        )
        finalize_import_batch(
            batch,
            imported_count=1,
            notes={
                'reason': 'restore_apply',
                'action': action,
                'source_event_id': source_reference_event_id,
                'applied_trade_event_id': applied_event.id,
                'restored_trade_log_id': restored_log.id if restored_log else None,
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({
            'message': '복원 초안을 적용했습니다.',
            'action': action,
            'restored_log': restored_log.to_dict() if restored_log else None,
            'applied_event': build_trade_event_response(applied_event),
            'reconciliation': build_reconciliation_result_response(reconciliation_result)
        }), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/audit/export', methods=['GET'])
@jwt_required()
def export_trade_log_audit():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        export_format = str(request.args.get('format') or 'json').strip().lower()
        events = (
            TradeEvent.query
            .filter_by(user_id=user_id, account_name=account_name)
            .order_by(TradeEvent.id.asc())
            .all()
        )
        rows = [build_trade_event_response(event) for event in events]
        timestamp = datetime.now(MARKET_TIMEZONE).strftime('%Y-%m-%d-%H-%M-%S')
        safe_account_name = re.sub(r'[^0-9A-Za-z가-힣_-]+', '-', account_name).strip('-') or 'account'

        if export_format not in ('json', 'csv', 'pdf'):
            return jsonify({'error': '지원하지 않는 export 형식입니다.'}), 400

        if export_format == 'pdf':
            pdf_bytes = build_trade_log_audit_pdf(account_name, rows)
            return Response(
                pdf_bytes,
                mimetype='application/pdf',
                headers={
                    'Content-Disposition': f'attachment; filename="{safe_account_name}-trade-audit-{timestamp}.pdf"'
                }
            )

        if export_format == 'csv':
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow([
                'id', 'event_type', 'account_name', 'trade_log_id', 'product_id',
                'source_type', 'source_id', 'hash', 'prev_hash', 'occurred_at', 'created_at', 'payload_json'
            ])
            for row in rows:
                writer.writerow([
                    row.get('id'),
                    row.get('event_type'),
                    row.get('account_name'),
                    row.get('trade_log_id'),
                    row.get('product_id'),
                    row.get('source_type'),
                    row.get('source_id'),
                    row.get('hash'),
                    row.get('prev_hash'),
                    row.get('occurred_at'),
                    row.get('created_at'),
                    canonical_json(row.get('payload'))
                ])
            return Response(
                output.getvalue(),
                mimetype='text/csv; charset=utf-8',
                headers={
                    'Content-Disposition': f'attachment; filename="{safe_account_name}-trade-audit-{timestamp}.csv"'
                }
            )

        return Response(
            canonical_json({
                'account_name': account_name,
                'exported_at': datetime.now(MARKET_TIMEZONE).isoformat(),
                'events': rows
            }),
            mimetype='application/json; charset=utf-8',
            headers={
                'Content-Disposition': f'attachment; filename="{safe_account_name}-trade-audit-{timestamp}.json"'
            }
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/security/audit-logs', methods=['GET'])
@jwt_required()
def list_security_audit_logs():
    try:
        user_id = current_user_id()
        limit = max(20, min(int(request.args.get('limit') or 120), 500))
        rows = (
            SecurityAuditLog.query
            .filter_by(user_id=user_id)
            .order_by(SecurityAuditLog.id.desc())
            .limit(limit)
            .all()
        )
        return jsonify({'logs': [row.to_dict() for row in rows]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/<int:log_id>', methods=['PUT'])
@jwt_required()
def update_trade_log(log_id):
    try:
        data = request.get_json() or {}
        user_id = current_user_id()
        log = assertCanEditJournalEntry(user_id, log_id)
        batch = create_import_batch(
            user_id,
            log.account_name,
            batch_type='manual_trade_update',
            source_name='ui',
            row_count=1,
            notes={'reason': 'trade_update', 'trade_log_id': log_id}
        )
        before_log = serialize_trade_log(log)

        if data.get('product_name'):
            log.product_name = data.get('product_name')
        if data.get('trade_date'):
            log.trade_date = parse_trade_date(data.get('trade_date'))
        if data.get('notes') is not None:
            log.notes = data.get('notes')

        if log.trade_type == 'deposit':
            amount_value = data.get('total_amount')
            if amount_value in (None, ''):
                amount_value = data.get('price')
            if amount_value not in (None, ''):
                amount = parse_positive_float(amount_value, '입금액')
                log.quantity = 1
                log.unit_type = 'share'
                log.price = amount
                log.total_amount = amount
            log.asset_type = 'cash'
        else:
            if data.get('asset_type'):
                log.asset_type = data.get('asset_type')
            log.unit_type = normalize_unit_type(data.get('unit_type', log.unit_type))
            if data.get('quantity') not in (None, ''):
                log.quantity = parse_positive_float(data.get('quantity'), '수량/좌수')
            if data.get('price') not in (None, ''):
                log.price = parse_positive_float(data.get('price'), '가격/기준가')
            log.total_amount = trade_amount(log.quantity, log.price, log.unit_type)

        product = None
        if log.trade_type in ('buy', 'sell'):
            product = sync_product_from_trade_log(log)

        db.session.flush()
        event = append_trade_event(
            user_id=user_id,
            account_name=log.account_name,
            event_type='trade_updated',
            trade_log_id=log.id,
            product_id=log.product_id,
            import_batch_id=batch.id,
            payload={
                'before': before_log,
                'after': serialize_trade_log(log),
                'product': serialize_product(product)
            }
        )
        capture_trade_snapshot(
            user_id,
            log.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id,
            product=product,
            snapshot_payload=serialize_trade_log(log) if not product else None,
            snapshot_kind='trade_updated'
        )
        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            user_id,
            log.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id
        )
        finalize_import_batch(
            batch,
            imported_count=1,
            notes={
                'reason': 'trade_update',
                'trade_event_id': event.id,
                'trade_log_id': log.id,
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({'message': '매매일지 기록이 수정되었습니다.', 'log': log.to_dict()}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/<int:log_id>', methods=['DELETE'])
@jwt_required()
def delete_trade_log(log_id):
    try:
        user_id = current_user_id()
        log = assertCanEditJournalEntry(user_id, log_id)
        batch = create_import_batch(
            user_id,
            log.account_name,
            batch_type='manual_trade_delete',
            source_name='ui',
            row_count=1,
            notes={'reason': 'trade_delete', 'trade_log_id': log_id}
        )

        deleted_snapshot = serialize_trade_log(log)
        product = None
        if log.trade_type in ('buy', 'sell') and log.product_id:
            product = Product.query.filter_by(id=log.product_id, user_id=user_id).first()

        event = append_trade_event(
            user_id=user_id,
            account_name=log.account_name,
            event_type='trade_deleted',
            trade_log_id=log.id,
            product_id=log.product_id,
            import_batch_id=batch.id,
            payload={
                'deleted': deleted_snapshot,
                'product_before_rebuild': serialize_product(product)
            }
        )
        capture_trade_snapshot(
            user_id,
            log.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id,
            snapshot_payload=deleted_snapshot,
            snapshot_kind='trade_deleted'
        )
        TradeJournal.query.filter_by(user_id=user_id, attached_trade_id=log.id).update(
            {'attached_trade_id': None},
            synchronize_session=False
        )
        CalendarEvent.query.filter_by(user_id=user_id, attached_trade_id=log.id).update(
            {'attached_trade_id': None},
            synchronize_session=False
        )
        db.session.delete(log)
        if product:
            rebuild_product_from_trade_logs(product)

        reconciliation_result, reconciliation_summary = store_reconciliation_result(
            user_id,
            log.account_name,
            import_batch_id=batch.id,
            trade_event_id=event.id
        )
        finalize_import_batch(
            batch,
            imported_count=1,
            notes={
                'reason': 'trade_delete',
                'trade_event_id': event.id,
                'trade_log_id': log.id,
                'reconciliation_status': reconciliation_result.status,
                'mismatch_count': reconciliation_summary['mismatch_count']
            }
        )
        db.session.commit()
        return jsonify({'message': '매매일지 기록을 삭제했습니다.'}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except AccessDeniedError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/realized-summary', methods=['GET'])
@jwt_required()
def get_trade_logs_realized_summary():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        maybe_sync_account_prices(user_id, account_name)
        return jsonify(get_realized_positions(user_id, account_name)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
