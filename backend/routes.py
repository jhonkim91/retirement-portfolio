from datetime import datetime, date
import hashlib
from datetime import timedelta

from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity

from api_client import StockAPIClient
from models import db, User, Product, PriceHistory, TradeLog, CashBalance, DEFAULT_ACCOUNT_NAME

api = Blueprint('api', __name__, url_prefix='/api')
market_client = StockAPIClient()
API_VERSION = '2026-04-26-stock-research-panel-v1'


def current_user_id():
    return int(get_jwt_identity())


def normalize_account_name(value):
    account_name = str(value or '').strip()
    if not account_name:
        return DEFAULT_ACCOUNT_NAME
    return account_name[:80]


def current_account_name():
    data = request.get_json(silent=True) or {}
    return normalize_account_name(
        request.args.get('account_name')
        or data.get('account_name')
        or DEFAULT_ACCOUNT_NAME
    )


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


def build_quote_snapshot(code):
    cleaned_code = market_client.clean_code(code)
    if not cleaned_code:
        raise ValueError('종목 코드가 필요합니다.')

    today = date.today()
    history_start = today - timedelta(days=370)
    histories = []
    current = None

    if market_client.is_fund_code(cleaned_code):
        current = market_client.get_price_from_funetf(cleaned_code)
    elif market_client.is_krx_code(cleaned_code):
        current = market_client.get_price_from_naver(cleaned_code)
    else:
        current = market_client.get_current_price(cleaned_code)

    if current:
        latest_price = current.get('price')
        price_date = current.get('date') or today
        return {
            'code': cleaned_code,
            'price': round(float(latest_price), 4) if latest_price is not None else None,
            'price_date': price_date.isoformat() if price_date else None,
            'high_52w': None,
            'low_52w': None,
            'one_year_return_rate': None,
            'history_points': 0,
            'lookback_start': history_start.isoformat(),
            'lookback_end': today.isoformat()
        }

    histories = market_client.get_historical_prices(cleaned_code, history_start, today)

    if histories:
        latest = histories[-1]
        latest_price = latest.get('price')
        price_date = latest.get('date') or today
    else:
        latest_price = None
        price_date = None

    prices = [float(row['price']) for row in histories if row.get('price') is not None]
    high_52w = max(prices) if prices else None
    low_52w = min(prices) if prices else None
    first_price = prices[0] if prices else None
    return_rate = (
        (float(latest_price) - first_price) / first_price * 100
        if latest_price is not None and first_price
        else None
    )

    return {
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
        products = Product.query.filter_by(user_id=user_id, account_name=account_name, status='holding').all()
        cash = get_cash_balance(user_id, account_name).amount
        total_investment = get_deposit_principal(user_id, account_name)
        product_current_value = sum(Product.amount_for(p.quantity, p.current_price, p.unit_type) for p in products)
        total_current_value = product_current_value + cash
        total_profit_loss = total_current_value - total_investment
        total_profit_rate = (total_profit_loss / total_investment * 100) if total_investment else 0

        risk_value = sum(Product.amount_for(p.quantity, p.current_price, p.unit_type) for p in products if p.asset_type == 'risk')
        safe_value = sum(Product.amount_for(p.quantity, p.current_price, p.unit_type) for p in products if p.asset_type == 'safe') + cash
        total_value = risk_value + safe_value

        return jsonify({
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


@api.route('/portfolio/products', methods=['GET'])
@jwt_required()
def get_products():
    try:
        user_id = current_user_id()
        account_name = current_account_name()
        products = Product.query.filter_by(user_id=user_id, account_name=account_name, status='holding').order_by(Product.purchase_date.desc()).all()
        return jsonify([p.to_dict() for p in products]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/sync-prices', methods=['POST'])
@jwt_required()
def sync_prices():
    try:
        result = sync_user_holdings(current_user_id(), current_account_name())
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
        products = Product.query.filter_by(user_id=current_user_id(), account_name=current_account_name()).order_by(Product.purchase_date.desc()).all()
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
        products = Product.query.filter_by(user_id=user_id, account_name=account_name, status='holding').all()
        rows = []
        for product in products:
            histories = PriceHistory.query.filter_by(product_id=product.id)
            if product.status == 'sold' and product.sale_date:
                histories = histories.filter(PriceHistory.record_date <= product.sale_date)
            for history in histories.order_by(PriceHistory.record_date).all():
                purchase_value = Product.amount_for(product.quantity, product.purchase_price, product.unit_type)
                evaluation_value = Product.amount_for(product.quantity, history.price, product.unit_type)
                profit_loss = evaluation_value - purchase_value
                profit_rate = (profit_loss / purchase_value * 100) if purchase_value else 0
                price_profit_loss = float(history.price or 0) - float(product.purchase_price or 0)
                price_return_rate = (price_profit_loss / float(product.purchase_price) * 100) if product.purchase_price else 0
                rows.append({
                    'product_id': product.id,
                    'product_name': product.product_name,
                    'product_code': product.product_code,
                    'asset_type': product.asset_type,
                    'status': product.status,
                    'quantity': product.quantity,
                    'unit_type': product.unit_type,
                    'unit_label': '좌' if product.unit_type == 'unit' else '수',
                    'purchase_price': product.purchase_price,
                    'purchase_value': round(purchase_value, 2),
                    'price': history.price,
                    'evaluation_value': round(evaluation_value, 2),
                    'profit_loss': round(profit_loss, 2),
                    'profit_rate': round(profit_rate, 2),
                    'price_return_rate': round(price_return_rate, 2),
                    'record_date': history.record_date.isoformat()
                })
        rows.sort(key=lambda item: (item['record_date'], item['product_name']))
        return jsonify(rows), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/trade-logs', methods=['GET'])
@jwt_required()
def get_trade_logs():
    try:
        query = TradeLog.query.filter_by(user_id=current_user_id(), account_name=current_account_name())
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
        log = TradeLog.query.filter_by(id=log_id, user_id=current_user_id()).first()
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

        db.session.commit()
        return jsonify({'message': '매매일지 기록이 수정되었습니다.', 'log': log.to_dict()}), 200
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
        return jsonify(get_realized_positions(current_user_id(), current_account_name())), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
