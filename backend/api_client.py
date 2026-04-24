import requests
import json
from datetime import datetime, date
import time

class StockAPIClient:
    """
    한국 증시 데이터를 가져오는 클래스
    여러 데이터 소스를 지원합니다
    """
    
    def __init__(self):
        # 네이버 금융 API (인증 불필요)
        self.naver_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    
    def get_price_from_naver(self, stock_code):
        """
        네이버 금융에서 주식 가격 조회
        stock_code: 예) '005930' (삼성전자)
        """
        try:
            url = f'https://finance.naver.com/api/sise/chartlog.nhn?code={stock_code}&type=day&count=1'
            response = requests.get(url, headers=self.naver_headers, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0:
                    return {
                        'price': float(data[0][0]),  # 현재가
                        'date': data[0][1],
                        'high': float(data[0][2]),  # 고가
                        'low': float(data[0][3]),   # 저가
                        'volume': int(data[0][4])   # 거래량
                    }
        except Exception as e:
            print(f"네이버 API 오류: {e}")
        
        return None
    
    def get_price_from_alpha_vantage(self, symbol, api_key):
        """
        Alpha Vantage API 사용 (글로벌 주식)
        무료 플랜: 분당 5회 요청 제한
        API 키: https://www.alphavantage.co/
        """
        try:
            url = f'https://www.alphavantage.co/query'
            params = {
                'function': 'GLOBAL_QUOTE',
                'symbol': symbol,
                'apikey': api_key
            }
            response = requests.get(url, params=params, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                quote = data.get('Global Quote', {})
                
                if quote:
                    return {
                        'price': float(quote.get('05. price', 0)),
                        'change': float(quote.get('09. change', 0)),
                        'change_percent': quote.get('10. change percent', '0%'),
                        'volume': int(quote.get('06. volume', 0))
                    }
        except Exception as e:
            print(f"Alpha Vantage API 오류: {e}")
        
        return None
    
    def get_price_from_yfinance(self, symbol):
        """
        Yahoo Finance 데이터 (대안)
        yfinance 설치 필요: pip install yfinance
        """
        try:
            import yfinance as yf
            ticker = yf.Ticker(symbol)
            data = ticker.history(period='1d')
            
            if len(data) > 0:
                latest = data.iloc[-1]
                return {
                    'price': float(latest['Close']),
                    'high': float(latest['High']),
                    'low': float(latest['Low']),
                    'volume': int(latest['Volume'])
                }
        except Exception as e:
            print(f"YFinance 오류: {e}")
        
        return None
    
    def get_multiple_prices(self, stock_codes):
        """여러 주식의 가격을 한번에 조회"""
        prices = {}
        for code in stock_codes:
            try:
                price = self.get_price_from_naver(code)
                if price:
                    prices[code] = price
                time.sleep(0.5)  # API 요청 간 대기 (서버 부하 방지)
            except Exception as e:
                print(f"가격 조회 실패 ({code}): {e}")
        
        return prices

# 사용 예시
if __name__ == '__main__':
    client = StockAPIClient()
    
    # 삼성전자 가격 조회
    price = client.get_price_from_naver('005930')
    print(f"삼성전자 현재가: {price}")
