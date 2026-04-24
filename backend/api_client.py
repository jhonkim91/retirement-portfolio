from datetime import date, timedelta

import requests


class StockAPIClient:
    def __init__(self):
        self.naver_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

    def normalize_symbol(self, code):
        code = str(code).strip()
        if code.isdigit() and len(code) == 6:
            return f'{code}.KS'
        return code

    def get_current_price(self, code):
        return self.get_price_from_yfinance(code) or self.get_price_from_naver(code)

    def get_historical_prices(self, code, start_date, end_date=None):
        end_date = end_date or date.today()
        if start_date > end_date:
            return []

        prices = self.get_history_from_yfinance(code, start_date, end_date)
        if prices:
            return prices

        prices = self.get_history_from_naver(code, start_date, end_date)
        if prices:
            return prices

        current = self.get_current_price(code)
        if current:
            return [{'date': end_date, 'price': current['price']}]
        return []

    def get_history_from_yfinance(self, code, start_date, end_date):
        try:
            import yfinance as yf

            symbol = self.normalize_symbol(code)
            ticker = yf.Ticker(symbol)
            # yfinance end is exclusive, so add one day.
            data = ticker.history(
                start=start_date.isoformat(),
                end=(end_date + timedelta(days=1)).isoformat(),
                auto_adjust=False
            )

            rows = []
            for index, row in data.iterrows():
                close = row.get('Close')
                if close is None or close != close:
                    continue
                rows.append({
                    'date': index.date(),
                    'price': float(close)
                })
            return rows
        except Exception as e:
            print(f'yfinance history error ({code}): {e}')
            return []

    def get_price_from_yfinance(self, code):
        try:
            import yfinance as yf

            symbol = self.normalize_symbol(code)
            ticker = yf.Ticker(symbol)
            data = ticker.history(period='5d', auto_adjust=False)
            if len(data) > 0:
                latest = data.iloc[-1]
                return {
                    'price': float(latest['Close']),
                    'date': data.index[-1].date()
                }
        except Exception as e:
            print(f'yfinance price error ({code}): {e}')
        return None

    def get_price_from_naver(self, stock_code):
        try:
            if not str(stock_code).isdigit():
                return None
            url = f'https://finance.naver.com/api/sise/chartlog.nhn?code={stock_code}&type=day&count=1'
            response = requests.get(url, headers=self.naver_headers, timeout=8)
            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0:
                    parsed_date, close = self.parse_naver_row(data[-1])
                    return {
                        'price': close,
                        'date': parsed_date or date.today()
                    }
        except Exception as e:
            print(f'naver price error ({stock_code}): {e}')
        return None

    def get_history_from_naver(self, stock_code, start_date, end_date):
        try:
            if not str(stock_code).isdigit():
                return []

            days = max((end_date - start_date).days + 10, 30)
            url = f'https://finance.naver.com/api/sise/chartlog.nhn?code={stock_code}&type=day&count={days}'
            response = requests.get(url, headers=self.naver_headers, timeout=12)
            if response.status_code != 200:
                return []

            rows = []
            for row in response.json():
                row_date, close = self.parse_naver_row(row)
                if not row_date or close is None:
                    continue
                if start_date <= row_date <= end_date:
                    rows.append({'date': row_date, 'price': close})
            return rows
        except Exception as e:
            print(f'naver history error ({stock_code}): {e}')
            return []

    def parse_naver_row(self, row):
        row_date = None
        close = None

        for value in row:
            text = str(value)
            if len(text) == 8 and text.isdigit():
                row_date = date(int(text[0:4]), int(text[4:6]), int(text[6:8]))
                break

        numeric_values = []
        for value in row:
            try:
                numeric_values.append(float(str(value).replace(',', '')))
            except ValueError:
                pass

        # Naver chartlog rows usually contain date first and close next.
        if len(row) >= 2:
            try:
                close = float(str(row[1]).replace(',', ''))
            except ValueError:
                close = None

        if close is None and numeric_values:
            close = numeric_values[1] if len(numeric_values) > 1 else numeric_values[0]

        return row_date, close
