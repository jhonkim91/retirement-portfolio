from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from models import db, Product, PriceHistory
from api_client import StockAPIClient
from datetime import date
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PriceUpdater:
    def __init__(self):
        self.api_client = StockAPIClient()
    
    def update_all_prices(self, app):
        """모든 보유 상품의 현재가를 자동으로 업데이트"""
        with app.app_context():
            try:
                # 보유 중인 모든 상품 조회
                products = Product.query.filter_by(status='holding').all()
                logger.info(f"가격 업데이트 시작: {len(products)}개 상품")
                
                for product in products:
                    try:
                        # API에서 현재가 조회
                        price_data = self.api_client.get_price_from_naver(product.product_code)
                        
                        if price_data:
                            current_price = price_data['price']
                            product.current_price = current_price
                            
                            # 가격 이력 저장 (중복 방지)
                            existing_history = PriceHistory.query.filter_by(
                                product_id=product.id,
                                record_date=date.today()
                            ).first()
                            
                            if not existing_history:
                                history = PriceHistory(
                                    product_id=product.id,
                                    price=current_price,
                                    record_date=date.today()
                                )
                                db.session.add(history)
                            
                            logger.info(f"업데이트 완료: {product.product_name} - {current_price}원")
                        else:
                            logger.warning(f"가격 조회 실패: {product.product_code}")
                    
                    except Exception as e:
                        logger.error(f"상품 업데이트 오류 ({product.product_name}): {str(e)}")
                
                db.session.commit()
                logger.info("가격 업데이트 완료")
                
            except Exception as e:
                logger.error(f"가격 업데이트 중 오류 발생: {str(e)}")
                db.session.rollback()

def start_scheduler(app):
    """백그라운드 스케줄러 시작"""
    scheduler = BackgroundScheduler()
    updater = PriceUpdater()
    
    # 평일 9시부터 18시까지 30분마다 가격 업데이트
    scheduler.add_job(
        func=lambda: updater.update_all_prices(app),
        trigger=CronTrigger(
            day_of_week='0-4',  # 월~금
            hour='9-17',
            minute='*/30'
        ),
        id='update_prices_job',
        name='Stock Price Update Job'
    )
    
    scheduler.start()
    logger.info("스케줄러가 시작되었습니다")
    
    return scheduler
