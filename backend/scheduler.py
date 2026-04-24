import logging
from datetime import date

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from api_client import StockAPIClient
from models import Product, PriceHistory, db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PriceUpdater:
    def __init__(self):
        self.api_client = StockAPIClient()

    def update_all_prices(self, app):
        with app.app_context():
            try:
                products = Product.query.filter_by(status='holding').all()
                logger.info('price update started: %s products', len(products))

                for product in products:
                    price_data = self.api_client.get_current_price(product.product_code)
                    if not price_data:
                        logger.warning('price lookup failed: %s', product.product_code)
                        continue

                    current_price = price_data['price']
                    record_date = price_data.get('date') or date.today()
                    product.current_price = current_price

                    existing = PriceHistory.query.filter_by(
                        product_id=product.id,
                        record_date=record_date
                    ).first()
                    if existing:
                        existing.price = current_price
                    else:
                        db.session.add(PriceHistory(
                            product_id=product.id,
                            price=current_price,
                            record_date=record_date
                        ))

                    logger.info('price updated: %s - %s', product.product_name, current_price)

                db.session.commit()
                logger.info('price update completed')
            except Exception as e:
                logger.error('price update error: %s', str(e))
                db.session.rollback()


def start_scheduler(app):
    scheduler = BackgroundScheduler()
    updater = PriceUpdater()
    scheduler.add_job(
        func=lambda: updater.update_all_prices(app),
        trigger=CronTrigger(day_of_week='0-4', hour='9-17', minute='*/30'),
        id='update_prices_job',
        name='Stock Price Update Job'
    )
    scheduler.start()
    logger.info('scheduler started')
    return scheduler
