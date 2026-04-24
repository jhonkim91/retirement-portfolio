from datetime import datetime, date
import hashlib

from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity

from api_client import StockAPIClient
from models import db, User, Product, PriceHistory, TradeLog, CashBalance

api = Blueprint('api', __name__, url_prefix='/api')
market_client = StockAPIClient()


def current_user_id():
    return int(get_jwt_identity())


def upsert_price_history(product_id, record_date, price):
    existing = PriceHistory.query.filter_by(product_id=product_id, record_date=record_date).first()
    if existing:
        existing.price = price
    else:
        db.session.add(PriceHistory(product_id=product_id, price=price, record_date=record_date))


def get_cash_balance(user_id):
    balance = CashBalance.query.filter_by(user_id=user_id).first()
    if not balance:
        balance = CashBalance(user_id=user_id, amount=0)
        db.session.add(balance)
        db.session.commit()
    return balance


def refresh_product_market_data(product, start_date=None):
    if product.status == 'sold':
        return False, '이미 매도 완료된 상품입니다.'
    if not product.product_code:
        return False, '상품 코드가 비어 있습니다.'

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
        return False, f'{padded} 자동조회 불가. 상품/추이 > 상품 관리 > 새 기준가에 직접 입력하세요.'
    return False, '자동조회 불가. 국내 상장 주식/ETF는 6자리 코드로, 퇴직연금/펀드 내부 상품은 새 기준가에 직접 입력하세요.'


def sync_user_holdings(user_id):
    products = Product.query.filter_by(user_id=user_id, status='holding').all()
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
        ok, reason = refresh_product_market_data(product, start_date)
        changed = ok or changed
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
        products = Product.query.filter_by(user_id=user_id, status='holding').all()
        cash = get_cash_balance(user_id).amount
        total_investment = sum(p.quantity * p.purchase_price for p in products)
        total_current_value = sum(p.quantity * p.current_price for p in products)
        total_profit_loss = total_current_value - total_investment
        total_profit_rate = (total_profit_loss / total_investment * 100) if total_investment else 0

        risk_value = sum(p.quantity * p.current_price for p in products if p.asset_type == 'risk')
        safe_value = sum(p.quantity * p.current_price for p in products if p.asset_type == 'safe') + cash
        total_value = risk_value + safe_value

        return jsonify({
            'total_investment': round(total_investment, 2),
            'total_cash': round(cash, 2),
            'total_current_value': round(total_current_value + cash, 2),
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
        products = Product.query.filter_by(user_id=user_id, status='holding').order_by(Product.purchase_date.desc()).all()
        return jsonify([p.to_dict() for p in products]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/sync-prices', methods=['POST'])
@jwt_required()
def sync_prices():
    try:
        result = sync_user_holdings(current_user_id())
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


@api.route('/cash', methods=['GET'])
@jwt_required()
def get_cash():
    try:
        return jsonify(get_cash_balance(current_user_id()).to_dict()), 200
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

        balance = get_cash_balance(current_user_id())
        balance.amount = amount
        db.session.commit()
        return jsonify({'message': '현금이 저장되었습니다.', 'cash': balance.to_dict()}), 200
    except ValueError:
        return jsonify({'error': '현금 금액 형식이 올바르지 않습니다.'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api.route('/portfolio/all-products', methods=['GET'])
@jwt_required()
def get_all_products():
    try:
        products = Product.query.filter_by(user_id=current_user_id()).order_by(Product.purchase_date.desc()).all()
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

        product = Product(
            user_id=current_user_id(),
            product_name=data['product_name'],
            product_code=data['product_code'],
            purchase_price=float(data['purchase_price']),
            quantity=int(data['quantity']),
            purchase_date=datetime.strptime(data['purchase_date'], '%Y-%m-%d').date(),
            asset_type=data['asset_type'],
            current_price=float(data['purchase_price']),
            status='holding'
        )
        db.session.add(product)
        db.session.flush()

        upsert_price_history(product.id, product.purchase_date, product.current_price)

        db.session.add(TradeLog(
            user_id=product.user_id,
            product_id=product.id,
            product_name=product.product_name,
            trade_type='buy',
            quantity=product.quantity,
            price=product.purchase_price,
            total_amount=product.purchase_price * product.quantity,
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
        product.sale_price = float(data['sale_price'])
        product.sale_date = datetime.strptime(data['sale_date'], '%Y-%m-%d').date()

        db.session.add(TradeLog(
            user_id=product.user_id,
            product_id=product.id,
            product_name=product.product_name,
            trade_type='sell',
            quantity=product.quantity,
            price=product.sale_price,
            total_amount=product.sale_price * product.quantity,
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
        products = Product.query.filter_by(user_id=user_id).all()
        rows = []
        for product in products:
            histories = PriceHistory.query.filter_by(product_id=product.id)
            if product.status == 'sold' and product.sale_date:
                histories = histories.filter(PriceHistory.record_date <= product.sale_date)
            for history in histories.order_by(PriceHistory.record_date).all():
                rows.append({
                    'product_id': product.id,
                    'product_name': product.product_name,
                    'product_code': product.product_code,
                    'asset_type': product.asset_type,
                    'status': product.status,
                    'price': history.price,
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
        query = TradeLog.query.filter_by(user_id=current_user_id())
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
