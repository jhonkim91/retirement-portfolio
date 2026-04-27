from datetime import datetime, date
import hashlib
import json
from datetime import timedelta
import math
import os
from zoneinfo import ZoneInfo

from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
import requests

from api_client import StockAPIClient
from models import AccountProfile, db, User, Product, PriceHistory, TradeLog, CashBalance, DEFAULT_ACCOUNT_NAME

api = Blueprint('api', __name__, url_prefix='/api')
market_client = StockAPIClient()
API_VERSION = '2026-04-27-analytics-engine-v1'
MARKET_TIMEZONE = ZoneInfo('Asia/Seoul')
MARKET_SYNC_TTL_SECONDS = 60 * 5
_market_sync_cache = {}
_screener_cache = {}

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


def normalize_account_name(value):
    account_name = str(value or '').strip()
    if not account_name:
        return DEFAULT_ACCOUNT_NAME
    return account_name[:80]


def normalize_account_type(value):
    return 'brokerage' if str(value or '').strip().lower() == 'brokerage' else 'retirement'


def get_account_type_label(account_type):
    return '주식 통장' if account_type == 'brokerage' else '퇴직연금'


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
        return profile

    inferred_type = 'brokerage' if ('주식' in account_name or 'stock' in account_name.lower()) else 'retirement'
    has_default = AccountProfile.query.filter_by(user_id=user_id, is_default=True).first() is not None
    profile = AccountProfile(
        user_id=user_id,
        account_name=account_name,
        account_type=inferred_type,
        is_default=(account_name == DEFAULT_ACCOUNT_NAME and not has_default)
    )
    db.session.add(profile)
    db.session.flush()
    return profile


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

    account_profiles = []
    ordered_names = sorted(account_names)
    for account_name in ordered_names:
        profile = get_account_profile(user_id, account_name)
        account_profiles.append({
            'account_name': account_name,
            'account_type': normalize_account_type(profile.account_type),
            'account_type_label': get_account_type_label(profile.account_type),
            'is_default': bool(profile.is_default)
        })

    account_profiles.sort(key=lambda item: (0 if item['is_default'] else 1, item['account_name']))
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


def build_screener_snapshot(histories):
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
    ma_gap = ((ma5 / ma20) - 1) * 100 if ma5 and ma20 else None
    bb_percent = ((latest_price - lower_bb) / (upper_bb - lower_bb) * 100) if upper_bb and lower_bb and upper_bb > lower_bb else None

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
        'ma_gap': to_rounded_float(ma_gap, 2),
        'macd': macd['macd'],
        'macd_signal': macd['signal'],
        'macd_histogram': macd['histogram'],
        'signal_count': len(signals),
        'signals': signals
    }


def passes_screener_filters(snapshot, filters):
    rsi_min = float(filters.get('rsi_min', 0))
    rsi_max = float(filters.get('rsi_max', 100))
    min_return = float(filters.get('min_return_20d', -100))
    max_return = float(filters.get('max_return_20d', 1000))
    require_ma_cross = bool(filters.get('require_ma_cross'))
    require_bb_breakout = bool(filters.get('require_bb_breakout'))
    require_macd_positive = bool(filters.get('require_macd_positive'))

    rsi14 = snapshot.get('rsi14')
    if rsi14 is None or rsi14 < rsi_min or rsi14 > rsi_max:
        return False

    return_20d = snapshot.get('return_20d')
    if return_20d is None or return_20d < min_return or return_20d > max_return:
        return False

    if require_ma_cross and not (snapshot.get('ma5') and snapshot.get('ma20') and snapshot['ma5'] > snapshot['ma20']):
        return False
    if require_bb_breakout and not (snapshot.get('upper_bb') and snapshot.get('price') and snapshot['price'] >= snapshot['upper_bb']):
        return False
    if require_macd_positive and not ((snapshot.get('macd_histogram') or 0) > 0):
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

        if not user or user.password != password_hash:
            return jsonify({'error': '사용자명 또는 비밀번호가 올바르지 않습니다.'}), 401

        access_token = create_access_token(identity=str(user.id))
        return jsonify({'access_token': access_token, 'user': user.to_dict()}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/summary', methods=['GET'])
@jwt_required()
def get_portfolio_summary():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        account_profile = get_account_profile(user_id, account_name)
        account_type = normalize_account_type(account_profile.account_type)
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

        return jsonify({
            'account_type': account_type,
            'account_type_label': get_account_type_label(account_type),
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
        if not raw_name:
            return jsonify({'error': '통장 이름을 입력하세요.'}), 400

        account_name = normalize_account_name(raw_name)
        user_id = current_user_id()
        existing_names = {item['account_name'] for item in list_user_accounts(user_id)}
        created = account_name not in existing_names
        profile = get_account_profile(user_id, account_name)
        profile.account_type = account_type
        balance = get_cash_balance(user_id, account_name)

        if created:
            db.session.refresh(balance)
        db.session.commit()

        account_profiles = list_user_accounts(user_id)

        return jsonify({
            'message': '통장이 추가되었습니다.' if created else '이미 등록된 통장입니다.',
            'created': created,
            'account_name': account_name,
            'account_type': account_type,
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
        CashBalance.query.filter_by(user_id=user_id, account_name=normalized_name).delete(synchronize_session=False)
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
        next_name = normalize_account_name(data.get('account_name'))
        if not next_name:
            return jsonify({'error': '새 통장 이름을 입력하세요.'}), 400
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
        CashBalance.query.filter_by(user_id=user_id, account_name=current_name).update(
            {'account_name': next_name},
            synchronize_session=False
        )
        profile = AccountProfile.query.filter_by(user_id=user_id, account_name=current_name).first()
        if profile:
            profile.account_name = next_name
            if profile.is_default:
                profile.account_type = 'retirement'
        else:
            replacement_profile = get_account_profile(user_id, next_name)
            replacement_profile.account_type = 'retirement' if current_name == DEFAULT_ACCOUNT_NAME else replacement_profile.account_type
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
        filters = data.get('filters') or {}

        cache_key = hashlib.sha1(json.dumps({
            'market': market,
            'pages': page_count,
            'limit': limit,
            'filters': filters
        }, sort_keys=True).encode('utf-8')).hexdigest()
        cached = _screener_cache.get(cache_key)
        if cached and (datetime.now(MARKET_TIMEZONE).timestamp() - cached['saved_at']) < 60 * 20:
            return jsonify(cached['value']), 200

        universe = market_client.get_market_universe(market, page_count)
        end_date = date.today()
        start_date = end_date - timedelta(days=220)
        scanned = 0
        rows = []

        for item in universe:
            histories = market_client.get_historical_prices(item['code'], start_date, end_date)
            snapshot = build_screener_snapshot(histories)
            if not snapshot:
                continue
            scanned += 1
            if not passes_screener_filters(snapshot, filters):
                continue

            rows.append({
                'name': item['name'],
                'code': item['code'],
                'exchange': item.get('exchange') or market,
                'type': item.get('type') or 'stock/ETF',
                **snapshot
            })

        rows.sort(
            key=lambda row: (
                -(row.get('signal_count') or 0),
                -float(row.get('return_20d') or -9999),
                -float(row.get('macd_histogram') or -9999)
            )
        )

        result = {
            'market': market,
            'pages': page_count,
            'scanned_count': scanned,
            'result_count': len(rows),
            'results': rows[:limit],
            'generated_at': datetime.now(MARKET_TIMEZONE).isoformat(),
            'coverage_note': f'네이버 시가총액 페이지 기준 상위 {page_count}페이지 대표 종목군을 스캔했습니다.'
        }
        _screener_cache[cache_key] = {
            'saved_at': datetime.now(MARKET_TIMEZONE).timestamp(),
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
        maybe_sync_account_prices(user_id, account_name)
        products = Product.query.filter_by(user_id=user_id, account_name=account_name).order_by(Product.purchase_date.desc()).all()
        return jsonify([p.to_dict() for p in products]), 200
    except Exception as e:
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

        db.session.add(TradeLog(
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
        ))
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
        product = Product.query.filter_by(id=product_id, user_id=current_user_id(), status='holding').first()
        if not product:
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
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/buy', methods=['POST'])
@jwt_required()
def add_product_buy(product_id):
    try:
        data = request.get_json() or {}
        product = Product.query.filter_by(id=product_id, user_id=current_user_id(), status='holding').first()
        if not product:
            return jsonify({'error': '보유 중인 상품을 찾을 수 없습니다.'}), 404

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

        db.session.add(TradeLog(
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
        ))
        db.session.commit()
        return jsonify({'message': '추가매수가 반영되었습니다.', 'product': product.to_dict()}), 201
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/sell', methods=['PUT'])
@jwt_required()
def sell_product(product_id):
    try:
        data = request.get_json() or {}
        product = Product.query.filter_by(id=product_id, user_id=current_user_id()).first()
        if not product:
            return jsonify({'error': '상품을 찾을 수 없습니다.'}), 404
        if product.status == 'sold':
            return jsonify({'error': '이미 매도 완료된 상품입니다.'}), 400

        product.status = 'sold'
        product.sale_price = parse_positive_float(data.get('sale_price'), '매도가/기준가')
        product.sale_date = parse_trade_date(data.get('sale_date'))

        db.session.add(TradeLog(
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
        ))
        db.session.commit()
        return jsonify({'message': '매도가 완료되었습니다.', 'product': product.to_dict()}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': f'입력 형식 오류: {str(e)}'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


def delete_user_product(user_id, product_id):
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

    deleted_logs = (
        TradeLog.query
        .filter(TradeLog.user_id == user_id)
        .filter(db.or_(TradeLog.product_id == product.id, *fallback_log_filters))
        .delete(synchronize_session=False)
    )
    PriceHistory.query.filter_by(product_id=product.id).delete(synchronize_session=False)
    db.session.delete(product)
    return product, deleted_logs


@api.route('/products/<int:product_id>', methods=['DELETE'])
@jwt_required()
def delete_product(product_id):
    try:
        user_id = current_user_id()
        product, deleted_logs = delete_user_product(user_id, product_id)
        if not product:
            return jsonify({'error': '상품을 찾을 수 없습니다.'}), 404

        db.session.commit()
        return jsonify({
            'message': '상품과 관련 매매일지, 가격 이력을 삭제했습니다.',
            'deleted_trade_logs': deleted_logs
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/delete', methods=['POST'])
@jwt_required()
def delete_product_with_post(product_id):
    try:
        user_id = current_user_id()
        product, deleted_logs = delete_user_product(user_id, product_id)
        if not product:
            return jsonify({'error': '상품을 찾을 수 없습니다.'}), 404

        db.session.commit()
        return jsonify({
            'message': '상품과 관련 매매일지, 가격 이력을 삭제했습니다.',
            'deleted_trade_logs': deleted_logs
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/update-price', methods=['PUT'])
@jwt_required()
def update_product_price(product_id):
    try:
        data = request.get_json() or {}
        product = Product.query.filter_by(id=product_id, user_id=current_user_id()).first()
        if not product:
            return jsonify({'error': '상품을 찾을 수 없습니다.'}), 404
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
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/products/<int:product_id>/price-history', methods=['GET'])
@jwt_required()
def get_price_history(product_id):
    try:
        product = Product.query.filter_by(id=product_id, user_id=current_user_id()).first()
        if not product:
            return jsonify({'error': '상품을 찾을 수 없습니다.'}), 404

        histories = PriceHistory.query.filter_by(product_id=product_id)
        if product.status == 'sold' and product.sale_date:
            histories = histories.filter(PriceHistory.record_date <= product.sale_date)
        return jsonify([h.to_dict() for h in histories.order_by(PriceHistory.record_date).all()]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/trends', methods=['GET'])
@jwt_required()
def get_portfolio_trends():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        include_sold = str(request.args.get('include_sold') or '').strip().lower() in ('1', 'true', 'yes', 'all')
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
        if changed:
            db.session.commit()
        rows.sort(key=lambda item: (item['record_date'], item['product_name']))
        return jsonify(rows), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs', methods=['GET'])
@jwt_required()
def get_trade_logs():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        maybe_sync_account_prices(user_id, account_name)
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


@api.route('/trade-logs/<int:log_id>', methods=['PUT'])
@jwt_required()
def update_trade_log(log_id):
    try:
        data = request.get_json() or {}
        user_id = current_user_id()
        log = TradeLog.query.filter_by(id=log_id, user_id=user_id).first()
        if not log:
            return jsonify({'error': '매매일지 기록을 찾을 수 없습니다.'}), 404

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

        if log.trade_type in ('buy', 'sell'):
            sync_product_from_trade_log(log)

        db.session.commit()
        return jsonify({'message': '매매일지 기록이 수정되었습니다.', 'log': log.to_dict()}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs/<int:log_id>', methods=['DELETE'])
@jwt_required()
def delete_trade_log(log_id):
    try:
        user_id = current_user_id()
        log = TradeLog.query.filter_by(id=log_id, user_id=user_id).first()
        if not log:
            return jsonify({'error': '매매일지 기록을 찾을 수 없습니다.'}), 404

        product = None
        if log.trade_type in ('buy', 'sell') and log.product_id:
            product = Product.query.filter_by(id=log.product_id, user_id=user_id).first()

        db.session.delete(log)
        if product:
            rebuild_product_from_trade_logs(product)

        db.session.commit()
        return jsonify({'message': '매매일지 기록을 삭제했습니다.'}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
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
