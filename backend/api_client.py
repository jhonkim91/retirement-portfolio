from datetime import date, timedelta
import html
import re
import time

import requests


class StockAPIClient:
    def __init__(self):
        self.naver_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        self._naver_market_cache = {
            'loaded_at': 0,
            'pages': {}
        }

    def normalize_symbol(self, code):
        code = str(code or '').strip().upper()
        if re.fullmatch(r'[0-9A-Z]{6}\.(KS|KQ)', code):
            return code
        if code.isdigit() and len(code) < 6:
            code = code.zfill(6)
        if re.fullmatch(r'[0-9A-Z]{6}', code):
            return f'{code}.KS'
        return code

    def is_krx_code(self, code):
        return bool(re.fullmatch(r'[0-9A-Z]{6}', str(code or '').strip().upper()))

    def get_current_price(self, code):
        return self.get_price_from_yfinance(code) or self.get_price_from_naver(code)

    def search_products(self, query, limit=12):
        query = str(query or '').strip()
        if len(query) < 2:
            return []

        results = []
        seen = set()
        normalized_query = self.normalize_search_text(query)

        def add_result(item):
            code = str(item.get('code') or '').strip().upper()
            name = str(item.get('name') or '').strip()
            if not code or not name:
                return
            if code in seen:
                return
            seen.add(code)
            results.append({
                'name': name,
                'code': code,
                'symbol': item.get('symbol') or f'{code}.KS',
                'exchange': item.get('exchange') or 'KRX',
                'type': item.get('type') or 'stock',
                'source': item.get('source') or 'market'
            })

        def rank(item):
            code = item['code']
            name = self.normalize_search_text(item['name'])
            if code == query.upper():
                return (0, name)
            if query.isdigit() and code.startswith(query):
                return (1, name)
            if name == normalized_query:
                return (2, name)
            if name.startswith(normalized_query):
                return (3, name)
            return (4, name)

        if self.is_krx_code(query):
            item = self.get_naver_product_by_code(query)
            if item:
                add_result(item)
                return sorted(results, key=rank)[:limit]

        if query.isdigit():
            for item in self.search_products_from_yfinance(query, limit):
                add_result(item)
            if self.has_exact_search_match(results, query):
                return sorted(results, key=rank)[:limit]

        for item in self.search_products_from_naver_search(query, limit):
            add_result(item)
        if self.has_exact_search_match(results, query) or len(results) >= limit:
            return sorted(results, key=rank)[:limit]

        for item in self.search_products_from_naver(query, limit, max_pages=1):
            add_result(item)
        if self.has_exact_search_match(results, query) or len(results) >= limit:
            return sorted(results, key=rank)[:limit]

        if not self.contains_hangul(query):
            for item in self.search_products_from_yfinance(query, limit):
                add_result(item)

        return sorted(results, key=rank)[:limit]

    def search_products_from_yfinance(self, query, limit):
        try:
            import yfinance as yf

            if not hasattr(yf, 'Search'):
                return []

            search = yf.Search(query, max_results=max(limit * 2, 10))
            rows = []
            for quote in search.quotes:
                symbol = str(quote.get('symbol') or '').strip().upper()
                match = re.match(r'^([0-9A-Z]{6})\.(KS|KQ)$', symbol)
                if not match:
                    continue
                name = quote.get('shortname') or quote.get('longname')
                if not name:
                    continue
                rows.append({
                    'name': name,
                    'code': match.group(1),
                    'symbol': symbol,
                    'exchange': quote.get('exchDisp') or quote.get('exchange') or 'Korea',
                    'type': quote.get('quoteType') or quote.get('typeDisp') or 'stock',
                    'source': 'Yahoo'
                })
            return rows
        except Exception as e:
            print(f'yfinance search error ({query}): {e}')
            return []

    def search_products_from_naver_search(self, query, limit):
        try:
            response = requests.get(
                'https://finance.naver.com/search/search.naver',
                params={'query': query},
                headers=self.naver_headers,
                timeout=6
            )
            if response.status_code != 200:
                return []
            response.encoding = response.apparent_encoding or 'EUC-KR'
            text = response.text

            redirect = re.search(r'code=([0-9A-Z]{6})', text)
            if redirect and len(text) < 500:
                item = self.get_naver_product_by_code(redirect.group(1))
                return [item] if item else []

            rows = []
            seen = set()
            pattern = r'href="/item/main\.naver\?code=([0-9A-Z]{6})"[^>]*>(.*?)</a>'
            for code, raw_name in re.findall(pattern, text, flags=re.IGNORECASE | re.DOTALL):
                name = re.sub(r'<[^>]+>', '', raw_name)
                name = html.unescape(name).strip()
                code = code.upper()
                if not name or code in seen:
                    continue
                seen.add(code)
                rows.append({
                    'name': name,
                    'code': code,
                    'symbol': f'{code}.KS',
                    'exchange': 'KRX',
                    'type': 'stock/ETF',
                    'source': 'Naver'
                })
                if len(rows) >= limit:
                    break
            return rows
        except Exception as e:
            print(f'naver search error ({query}): {e}')
            return []

    def get_naver_product_by_code(self, code):
        try:
            code = str(code or '').strip().upper()
            if not self.is_krx_code(code):
                return None
            response = requests.get(
                'https://finance.naver.com/item/main.naver',
                params={'code': code},
                headers=self.naver_headers,
                timeout=6
            )
            if response.status_code != 200:
                return None
            response.encoding = 'utf-8'
            text = response.text
            title_match = re.search(r'<title>\s*(.*?)\s*[:|-]\s*Npay', text, flags=re.DOTALL)
            name = html.unescape(re.sub(r'<[^>]+>', '', title_match.group(1))).strip() if title_match else ''
            if not name:
                name_match = re.search(r'item\.naver\?code=' + re.escape(code) + r'.*?>([^<]+)</a>', text, flags=re.DOTALL)
                name = html.unescape(name_match.group(1)).strip() if name_match else ''
            if not name:
                return None
            return {
                'name': name,
                'code': code,
                'symbol': f'{code}.KS',
                'exchange': 'KRX',
                'type': 'stock/ETF',
                'source': 'Naver'
            }
        except Exception as e:
            print(f'naver profile error ({code}): {e}')
            return None

    def search_products_from_naver(self, query, limit, max_pages=1):
        normalized_query = self.normalize_search_text(query)
        matched = []
        seen = set()
        for page in range(1, max_pages + 1):
            for market, sosok in [('KOSPI', 0), ('KOSDAQ', 1)]:
                items = self.get_naver_market_page(market, sosok, page)
                if not items:
                    continue
                for item in items:
                    name = self.normalize_search_text(item['name'])
                    code = item['code']
                    if item['code'] in seen:
                        continue
                    if normalized_query in name or query.upper() in code:
                        seen.add(item['code'])
                        matched.append(item)
                    if self.has_exact_search_match(matched, query) or len(matched) >= limit:
                        return matched[:limit]
        return matched

    def get_naver_market_page(self, market, sosok, page):
        cache_age = time.time() - self._naver_market_cache['loaded_at']
        if cache_age >= 60 * 60 * 6:
            self._naver_market_cache = {'loaded_at': time.time(), 'pages': {}}

        key = f'{sosok}:{page}'
        if key in self._naver_market_cache['pages']:
            return self._naver_market_cache['pages'][key]

        try:
            url = f'https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page={page}'
            response = requests.get(url, headers=self.naver_headers, timeout=5)
            if response.status_code != 200:
                return []
            response.encoding = 'EUC-KR'
            items = self.parse_naver_market_page(response.text, market)
            self._naver_market_cache['pages'][key] = items
            return items
        except Exception as e:
            print(f'naver market list error ({market} page {page}): {e}')
            return []

    def parse_naver_market_page(self, text, market):
        rows = []
        pattern = r'href="/item/main\.naver\?code=([0-9A-Z]{6})"[^>]*>([^<]+)</a>'
        for match in re.finditer(pattern, text):
            name = html.unescape(match.group(2)).strip()
            if not name:
                continue
            code = match.group(1).upper()
            rows.append({
                'name': name,
                'code': code,
                'symbol': f'{code}.KS',
                'exchange': market,
                'type': 'stock/ETF',
                'source': 'Naver'
            })
        return rows

    def normalize_search_text(self, value):
        return re.sub(r'\s+', '', str(value or '')).lower()

    def contains_hangul(self, value):
        return re.search(r'[\uac00-\ud7a3]', str(value or '')) is not None

    def has_exact_search_match(self, items, query):
        normalized_query = self.normalize_search_text(query)
        normalized_code = str(query or '').strip().upper()
        return any(
            item.get('code') == normalized_code or self.normalize_search_text(item.get('name')) == normalized_query
            for item in items
        )

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
            stock_code = str(stock_code or '').strip().upper()
            if stock_code.isdigit() and len(stock_code) < 6:
                stock_code = stock_code.zfill(6)
            if not self.is_krx_code(stock_code):
                return None

            if stock_code.isdigit():
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

            rows = self.get_history_from_naver_sise_day(
                stock_code,
                date.today() - timedelta(days=14),
                date.today(),
                max_pages=2
            )
            if rows:
                latest = rows[-1]
                return {'price': latest['price'], 'date': latest['date']}
        except Exception as e:
            print(f'naver price error ({stock_code}): {e}')
        return None

    def get_history_from_naver(self, stock_code, start_date, end_date):
        try:
            stock_code = str(stock_code or '').strip().upper()
            if stock_code.isdigit() and len(stock_code) < 6:
                stock_code = stock_code.zfill(6)
            if not self.is_krx_code(stock_code):
                return []

            if stock_code.isdigit():
                days = max((end_date - start_date).days + 10, 30)
                url = f'https://finance.naver.com/api/sise/chartlog.nhn?code={stock_code}&type=day&count={days}'
                response = requests.get(url, headers=self.naver_headers, timeout=12)
                if response.status_code == 200:
                    rows = []
                    for row in response.json():
                        row_date, close = self.parse_naver_row(row)
                        if not row_date or close is None:
                            continue
                        if start_date <= row_date <= end_date:
                            rows.append({'date': row_date, 'price': close})
                    if rows:
                        return rows

            days = max((end_date - start_date).days, 10)
            max_pages = min(max((days // 7) + 2, 2), 30)
            return self.get_history_from_naver_sise_day(stock_code, start_date, end_date, max_pages=max_pages)
        except Exception as e:
            print(f'naver history error ({stock_code}): {e}')
            return []

    def get_history_from_naver_sise_day(self, stock_code, start_date, end_date, max_pages=10):
        stock_code = str(stock_code or '').strip().upper()
        if not self.is_krx_code(stock_code):
            return []

        rows = []
        seen = set()
        row_pattern = re.compile(
            r'<tr[^>]*>.*?<td[^>]*align="center"[^>]*>\s*<span[^>]*>'
            r'(\d{4}\.\d{2}\.\d{2})</span>\s*</td>\s*'
            r'<td class="num">\s*<span[^>]*>([\d,]+)</span>',
            re.DOTALL
        )

        for page in range(1, max_pages + 1):
            response = requests.get(
                'https://finance.naver.com/item/sise_day.naver',
                params={'code': stock_code, 'page': page},
                headers=self.naver_headers,
                timeout=8
            )
            if response.status_code != 200:
                break
            response.encoding = 'EUC-KR'
            page_rows = 0
            for date_text, close_text in row_pattern.findall(response.text):
                row_date = self.parse_naver_date(date_text)
                if not row_date or row_date in seen:
                    continue
                seen.add(row_date)
                page_rows += 1
                if start_date <= row_date <= end_date:
                    rows.append({
                        'date': row_date,
                        'price': float(close_text.replace(',', ''))
                    })
            if page_rows == 0:
                break
            if rows and min(seen) < start_date:
                break
        return sorted(rows, key=lambda item: item['date'])

    def parse_naver_date(self, value):
        try:
            year, month, day = str(value).split('.')
            return date(int(year), int(month), int(day))
        except Exception:
            return None

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

        if len(row) >= 2:
            try:
                close = float(str(row[1]).replace(',', ''))
            except ValueError:
                close = None

        if close is None and numeric_values:
            close = numeric_values[1] if len(numeric_values) > 1 else numeric_values[0]

        return row_date, close
