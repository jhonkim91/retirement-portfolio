from datetime import date, timedelta
import html
import json
import os
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO

import requests
from bs4 import BeautifulSoup


class StockAPIClient:
    def __init__(self):
        self.naver_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        self.dart_api_key = os.getenv('OPENDART_API_KEY') or os.getenv('DART_API_KEY') or ''
        try:
            configured_timeout = int(str(os.getenv('DART_TIMEOUT_SECONDS', '6')).strip() or '6')
        except (TypeError, ValueError):
            configured_timeout = 6
        self.dart_timeout_seconds = max(3, min(configured_timeout, 20))
        self._dart_corp_retry_after = 0
        self._naver_market_cache = {
            'loaded_at': 0,
            'pages': {}
        }
        self._response_cache = {}

    def get_cached_value(self, namespace, key, ttl_seconds):
        bucket = self._response_cache.setdefault(namespace, {})
        entry = bucket.get(key)
        if not entry:
            return None
        if time.time() - entry['saved_at'] > ttl_seconds:
            bucket.pop(key, None)
            return None
        return entry['value']

    def set_cached_value(self, namespace, key, value):
        bucket = self._response_cache.setdefault(namespace, {})
        bucket[key] = {
            'saved_at': time.time(),
            'value': value
        }

    def has_dart_api_key(self):
        return bool(self.dart_api_key)

    def get_dart_corp_code_map(self):
        if not self.has_dart_api_key():
            return {}
        if time.time() < self._dart_corp_retry_after:
            return {}

        cached = self.get_cached_value('dart_corp_codes', 'all', 60 * 60 * 24)
        if cached is not None:
            return cached

        try:
            response = requests.get(
                'https://opendart.fss.or.kr/api/corpCode.xml',
                params={'crtfc_key': self.dart_api_key},
                timeout=self.dart_timeout_seconds
            )
            response.raise_for_status()
            zipped = zipfile.ZipFile(BytesIO(response.content))
            xml_name = next((name for name in zipped.namelist() if name.lower().endswith('.xml')), None)
            if not xml_name:
                return {}

            mapping = {}
            with zipped.open(xml_name) as file_obj:
                root = ET.fromstring(file_obj.read())
            for item in root.findall('list'):
                stock_code = (item.findtext('stock_code') or '').strip()
                corp_code = (item.findtext('corp_code') or '').strip()
                corp_name = (item.findtext('corp_name') or '').strip()
                if not stock_code or not corp_code:
                    continue
                mapping[stock_code] = {
                    'corp_code': corp_code,
                    'corp_name': corp_name
                }
            self.set_cached_value('dart_corp_codes', 'all', mapping)
            return mapping
        except Exception as e:
            print(f'dart corp code error: {e}')
            self._dart_corp_retry_after = time.time() + (60 * 10)
            return {}

    def get_dart_corp_entry(self, code):
        cleaned = self.clean_code(code)
        return self.get_dart_corp_code_map().get(cleaned)

    def get_dart_company_info(self, code):
        entry = self.get_dart_corp_entry(code)
        if not entry or not self.has_dart_api_key():
            return None

        cache_key = entry['corp_code']
        cached = self.get_cached_value('dart_company_info', cache_key, 60 * 60 * 24)
        if cached is not None:
            return cached

        try:
            response = requests.get(
                'https://opendart.fss.or.kr/api/company.json',
                params={
                    'crtfc_key': self.dart_api_key,
                    'corp_code': entry['corp_code']
                },
                timeout=self.dart_timeout_seconds
            )
            data = response.json()
            if response.status_code != 200 or data.get('status') != '000':
                return None

            result = {
                'corp_code': entry['corp_code'],
                'corp_name': data.get('corp_name') or entry.get('corp_name'),
                'ceo_name': data.get('ceo_nm'),
                'corp_cls': data.get('corp_cls'),
                'jurir_no': data.get('jurir_no'),
                'bizr_no': data.get('bizr_no'),
                'adres': data.get('adres'),
                'hm_url': data.get('hm_url'),
                'est_dt': data.get('est_dt')
            }
            self.set_cached_value('dart_company_info', cache_key, result)
            return result
        except Exception as e:
            print(f'dart company info error ({code}): {e}')
            return None

    def parse_dart_amount(self, value):
        text = str(value or '').replace(',', '').strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None

    def summarize_dart_financial_rows(self, rows, statement_type):
        account_aliases = {
            'revenue': {'매출액', '영업수익', '수익(매출액)', '보험영업수익'},
            'operating_income': {'영업이익', '영업손익'},
            'net_income': {'당기순이익', '당기순이익(손실)', '반기순이익', '분기순이익'},
            'assets': {'자산총계'},
            'liabilities': {'부채총계'},
            'equity': {'자본총계'}
        }

        values = {}
        for row in rows:
            account_name = str(row.get('account_nm') or '').strip()
            current_amount = self.parse_dart_amount(row.get('thstrm_amount'))
            prior_amount = self.parse_dart_amount(row.get('frmtrm_amount'))
            for key, aliases in account_aliases.items():
                if account_name in aliases and key not in values:
                    values[key] = {
                        'current': current_amount,
                        'previous': prior_amount,
                        'account_name': account_name
                    }

        if not values:
            return None

        return {
            'statement_type': statement_type,
            'metrics': values
        }

    def get_dart_financials(self, code, max_year_lookback=2):
        entry = self.get_dart_corp_entry(code)
        if not entry or not self.has_dart_api_key():
            return None

        cache_key = entry['corp_code']
        cached = self.get_cached_value('dart_financials', cache_key, 60 * 60 * 8)
        if cached is not None:
            return cached

        current_year = date.today().year
        for year in range(current_year, current_year - max_year_lookback - 1, -1):
            for fs_div, statement_type in (('OFS', 'separate'), ('CFS', 'consolidated')):
                try:
                    response = requests.get(
                        'https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json',
                        params={
                            'crtfc_key': self.dart_api_key,
                            'corp_code': entry['corp_code'],
                            'bsns_year': str(year),
                            'reprt_code': '11011',
                            'fs_div': fs_div
                        },
                        timeout=self.dart_timeout_seconds
                    )
                    data = response.json()
                    if response.status_code != 200 or data.get('status') != '000':
                        continue

                    summary = self.summarize_dart_financial_rows(data.get('list') or [], statement_type)
                    if not summary:
                        continue

                    result = {
                        'corp_code': entry['corp_code'],
                        'corp_name': entry.get('corp_name'),
                        'business_year': year,
                        'reprt_code': '11011',
                        **summary
                    }
                    self.set_cached_value('dart_financials', cache_key, result)
                    return result
                except Exception as e:
                    print(f'dart financial error ({code} {year} {fs_div}): {e}')
        return None

    def get_dart_recent_disclosures(self, code, days=180, page_count=10):
        entry = self.get_dart_corp_entry(code)
        if not entry or not self.has_dart_api_key():
            return []

        cache_key = f"{entry['corp_code']}:{int(days)}:{int(page_count)}"
        cached = self.get_cached_value('dart_disclosures', cache_key, 60 * 60 * 4)
        if cached is not None:
            return cached

        try:
            end_date = date.today()
            start_date = end_date - timedelta(days=max(int(days or 180), 30))
            response = requests.get(
                'https://opendart.fss.or.kr/api/list.json',
                params={
                    'crtfc_key': self.dart_api_key,
                    'corp_code': entry['corp_code'],
                    'bgn_de': start_date.strftime('%Y%m%d'),
                    'end_de': end_date.strftime('%Y%m%d'),
                    'page_count': max(1, min(int(page_count or 10), 20))
                },
                timeout=self.dart_timeout_seconds
            )
            data = response.json()
            if response.status_code != 200 or data.get('status') != '000':
                return []

            rows = []
            for item in data.get('list') or []:
                receipt_no = str(item.get('rcept_no') or '').strip()
                rows.append({
                    'receipt_no': receipt_no,
                    'report_name': item.get('report_nm'),
                    'filed_by': item.get('flr_nm'),
                    'receipt_date': item.get('rcept_dt'),
                    'url': f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt_no}' if receipt_no else ''
                })
            self.set_cached_value('dart_disclosures', cache_key, rows)
            return rows
        except Exception as e:
            print(f'dart disclosure error ({code}): {e}')
            return []

    def get_dart_snapshot(self, code):
        if not self.has_dart_api_key():
            return {
                'enabled': False,
                'reason': 'Open DART API key is not configured.'
            }

        entry = self.get_dart_corp_entry(code)
        if not entry:
            return {
                'enabled': False,
                'reason': 'Open DART 공시 대상 법인을 찾지 못했습니다.'
            }

        company = self.get_dart_company_info(code)
        financials = self.get_dart_financials(code)
        disclosures = self.get_dart_recent_disclosures(code)
        return {
            'enabled': True,
            'source': 'Open DART',
            'corp_code': entry['corp_code'],
            'corp_name': entry.get('corp_name'),
            'company': company,
            'financials': financials,
            'disclosures': disclosures
        }

    def decode_embedded_json_text(self, value):
        raw = str(value or '')
        if not raw:
            return ''
        try:
            text = json.loads(f'"{raw}"')
        except Exception:
            text = raw.replace('\\"', '"').replace('\\/', '/')
        text = html.unescape(text)
        text = re.sub(r'</?mark>', '', text, flags=re.IGNORECASE)
        return re.sub(r'\s+', ' ', text).strip()

    def build_naver_article_url(self, href):
        href = str(href or '').strip()
        if not href:
            return ''
        if href.startswith('http://') or href.startswith('https://'):
            return href

        absolute_url = urllib.parse.urljoin('https://finance.naver.com', href)
        parsed = urllib.parse.urlparse(absolute_url)
        if parsed.path.endswith('/news_read.naver') or parsed.path.endswith('/newsRead.naver'):
            params = urllib.parse.parse_qs(parsed.query)
            office_id = (params.get('office_id') or params.get('officeId') or [''])[0]
            article_id = (params.get('article_id') or params.get('articleId') or [''])[0]
            if office_id and article_id:
                return f'https://n.news.naver.com/mnews/article/{office_id}/{article_id}'
        return absolute_url

    def get_recent_news(self, product_name, code=None, limit=8):
        clean_name = str(product_name or '').strip()
        clean_code = self.clean_code(code)
        cache_key = f'{clean_name}:{clean_code}:{int(limit)}'
        cached = self.get_cached_value('recent_news', cache_key, 60 * 30)
        if cached is not None:
            return cached

        items = []
        if self.is_krx_code(clean_code):
            items.extend(self.get_news_from_naver_finance(clean_code, limit=limit))

        search_queries = []
        if clean_name:
            search_queries.append(clean_name)
        if clean_code and clean_code not in search_queries:
            search_queries.append(clean_code)
        if clean_name and clean_code:
            combined = f'{clean_name} {clean_code}'
            if combined not in search_queries:
                search_queries.append(combined)

        if len(items) < min(limit, 4):
            for query in search_queries:
                items.extend(self.search_news_from_naver(query, limit=max(limit, 8)))
                if len(items) >= limit * 2:
                    break

        deduped = []
        seen = set()
        for item in items:
            title = str(item.get('title') or '').strip()
            url = str(item.get('url') or '').strip()
            if not title or not url:
                continue
            key = f'{title}|{url}'
            if key in seen:
                continue
            seen.add(key)
            deduped.append({
                'title': title,
                'url': url,
                'source': str(item.get('source') or '').strip(),
                'published_at': str(item.get('published_at') or '').strip()
            })
            if len(deduped) >= limit:
                break

        self.set_cached_value('recent_news', cache_key, deduped)
        return deduped

    def get_news_from_naver_finance(self, code, limit=8, max_pages=2):
        code = self.clean_code(code)
        if not self.is_krx_code(code):
            return []

        rows = []
        seen = set()
        for page in range(1, max_pages + 1):
            try:
                response = requests.get(
                    'https://finance.naver.com/item/news_news.naver',
                    params={'code': code, 'page': page},
                    headers=self.naver_headers,
                    timeout=8
                )
                if response.status_code != 200:
                    break
                response.encoding = 'EUC-KR'
                soup = BeautifulSoup(response.text, 'html.parser')
                for tr in soup.select('table.type5 tbody tr'):
                    link = tr.select_one('td.title a')
                    if not link:
                        continue
                    title = re.sub(r'\s+', ' ', link.get_text(' ', strip=True))
                    url = self.build_naver_article_url(link.get('href'))
                    source = re.sub(r'\s+', ' ', (tr.select_one('td.info') or tr.select_one('td:nth-of-type(2)')).get_text(' ', strip=True)) if (tr.select_one('td.info') or tr.select_one('td:nth-of-type(2)')) else ''
                    published_at = re.sub(r'\s+', ' ', (tr.select_one('td.date') or tr.select_one('td:nth-of-type(3)')).get_text(' ', strip=True)) if (tr.select_one('td.date') or tr.select_one('td:nth-of-type(3)')) else ''
                    if not title or not url:
                        continue
                    key = f'{title}|{url}'
                    if key in seen:
                        continue
                    seen.add(key)
                    rows.append({
                        'title': title,
                        'url': url,
                        'source': source,
                        'published_at': published_at
                    })
                    if len(rows) >= limit:
                        return rows
            except Exception as e:
                print(f'naver finance news error ({code} page {page}): {e}')
                break
        return rows

    def search_news_from_naver(self, query, limit=8):
        query = str(query or '').strip()
        if len(query) < 2:
            return []

        try:
            response = requests.get(
                'https://search.naver.com/search.naver',
                params={'where': 'news', 'query': query},
                headers=self.naver_headers,
                timeout=10
            )
            if response.status_code != 200:
                return []
            response.encoding = 'utf-8'
            text = response.text

            rows = []
            seen = set()
            item_pattern = re.compile(
                r'\{"props":\{(?P<props>.*?)\},"templateId":"newsItem"\}',
                re.DOTALL
            )
            title_pattern = re.compile(r'"title":"((?:\\.|[^"\\])*)"')
            href_pattern = re.compile(r'"titleHref":"(https?://[^"\\]+)"')
            source_pattern = re.compile(r'"sourceProfile":\{.*?"title":"((?:\\.|[^"\\])*)"', re.DOTALL)
            published_pattern = re.compile(r'"subTexts":\[\{"text":"((?:\\.|[^"\\])*)"')

            for match in item_pattern.finditer(text):
                props_text = match.group('props')
                title_match = title_pattern.search(props_text)
                href_match = href_pattern.search(props_text)
                if not title_match or not href_match:
                    continue
                title = self.decode_embedded_json_text(title_match.group(1))
                url = self.decode_embedded_json_text(href_match.group(1))
                source_match = source_pattern.search(props_text)
                published_match = published_pattern.search(props_text)
                source = self.decode_embedded_json_text(source_match.group(1)) if source_match else ''
                published_at = self.decode_embedded_json_text(published_match.group(1)) if published_match else ''
                key = f'{title}|{url}'
                if not title or not url or key in seen:
                    continue
                seen.add(key)
                rows.append({
                    'title': title,
                    'url': url,
                    'source': source,
                    'published_at': published_at
                })
                if len(rows) >= limit:
                    break
            return rows
        except Exception as e:
            print(f'naver news search error ({query}): {e}')
            return []

    def clean_code(self, code):
        code = str(code or '').strip().upper()
        if re.fullmatch(r'[0-9A-Z]{6}\.(KS|KQ)', code):
            return code.split('.')[0]
        if len(code) % 2 == 0:
            half = code[:len(code) // 2]
            if half == code[len(code) // 2:] and (
                re.fullmatch(r'[0-9A-Z]{6}', half)
                or re.fullmatch(r'(?:K[0-9A-Z]{11}|KR[0-9A-Z]{10})', half)
            ):
                return half
        return code

    def normalize_symbol(self, code):
        code = self.clean_code(code)
        if re.fullmatch(r'[0-9A-Z]{6}\.(KS|KQ)', code):
            return code
        if code.isdigit() and len(code) < 6:
            code = code.zfill(6)
        if re.fullmatch(r'[0-9A-Z]{6}', code):
            return f'{code}.KS'
        return code

    def is_krx_code(self, code):
        return bool(re.fullmatch(r'[0-9A-Z]{6}', self.clean_code(code)))

    def is_fund_code(self, code):
        return bool(re.fullmatch(r'(?:K[0-9A-Z]{11}|KR[0-9A-Z]{10})', self.clean_code(code)))

    def get_current_price(self, code):
        if self.is_fund_code(code):
            return self.get_price_from_funetf(code)
        return self.get_price_from_naver_realtime(code) or self.get_price_from_yfinance(code) or self.get_price_from_naver(code)

    def get_price_from_naver_realtime(self, stock_code):
        try:
            stock_code = self.clean_code(stock_code)
            if stock_code.isdigit() and len(stock_code) < 6:
                stock_code = stock_code.zfill(6)
            if not self.is_krx_code(stock_code):
                return None

            url = f'https://polling.finance.naver.com/api/realtime/domestic/stock/{stock_code}'
            response = requests.get(url, headers=self.naver_headers, timeout=6)
            if response.status_code != 200:
                return None
            data = response.json() or {}
            datas = data.get('datas') or []
            if not datas:
                return None
            row = datas[0] or {}
            close_price = row.get('closePrice') or row.get('nv')
            if close_price is None:
                return None
            return {
                'price': float(str(close_price).replace(',', '')),
                'date': date.today(),
                'source': 'NaverRealtime'
            }
        except Exception as e:
            print(f'naver realtime price error ({stock_code}): {e}')
            return None

    def search_products(self, query, limit=12):
        query = self.clean_code(query)
        if len(query) < 2:
            return []

        results = []
        seen = set()
        normalized_query = self.normalize_search_text(query)

        def add_result(item):
            code = self.clean_code(item.get('code'))
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

        if self.is_fund_code(query):
            item = self.get_funetf_product_by_code(query)
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

        for item in self.search_products_from_naver_etf_list(query, limit):
            add_result(item)
        if self.has_exact_search_match(results, query) or len(results) >= limit:
            return sorted(results, key=rank)[:limit]

        for item in self.search_funds_from_funetf(query, limit):
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
            encoded_query = self.encode_naver_search_query(query)
            response = requests.get(
                f'https://finance.naver.com/search/search.naver?query={encoded_query}',
                headers=self.naver_headers,
                timeout=6
            )
            if response.status_code != 200:
                return []
            response.encoding = 'EUC-KR'
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

    def encode_naver_search_query(self, query):
        try:
            return urllib.parse.quote_from_bytes(str(query or '').encode('cp949'))
        except UnicodeEncodeError:
            return urllib.parse.quote(str(query or ''))

    def search_products_from_naver_etf_list(self, query, limit):
        normalized_query = self.normalize_search_text(query)
        query_code = str(query or '').strip().upper()
        rows = []
        seen = set()
        sources = [
            ('https://finance.naver.com/api/sise/etfItemList.nhn', 'etfItemList', 'ETF'),
            ('https://finance.naver.com/api/sise/etnItemList.nhn', 'etnItemList', 'ETN')
        ]

        for url, list_key, product_type in sources:
            try:
                response = requests.get(url, headers=self.naver_headers, timeout=8)
                if response.status_code != 200:
                    continue
                data = response.json()
                items = ((data.get('result') or {}).get(list_key) or [])
                for item in items:
                    code = str(item.get('itemcode') or '').strip().upper()
                    name = str(item.get('itemname') or '').strip()
                    if not code or not name or code in seen:
                        continue
                    if normalized_query not in self.normalize_search_text(name) and query_code not in code:
                        continue
                    seen.add(code)
                    rows.append({
                        'name': name,
                        'code': code,
                        'symbol': f'{code}.KS',
                        'exchange': 'KRX',
                        'type': product_type,
                        'source': 'Naver'
                    })
                    if len(rows) >= limit:
                        return rows
            except Exception as e:
                print(f'naver {product_type.lower()} list error ({query}): {e}')
        return rows

    def get_naver_product_by_code(self, code):
        try:
            code = self.clean_code(code)
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

    def search_funds_from_funetf(self, query, limit):
        query = str(query or '').strip()
        if len(query) < 2:
            return []
        try:
            response = requests.get(
                'https://www.funetf.co.kr/api/public/main/search/all',
                params={
                    'schVal': query,
                    'reSchVal': '',
                    'reSchChk': '',
                    'schKeyword': ''
                },
                headers=self.naver_headers,
                timeout=8
            )
            if response.status_code != 200:
                return []
            response.encoding = 'utf-8'
            data = response.json()
            groups = [
                (((data.get('fundList') or {}).get('content') or []), 'fund'),
                (((data.get('etfList') or {}).get('content') or []), 'ETF')
            ]
            rows = []
            for items, product_type in groups:
                for item in items:
                    if product_type == 'ETF':
                        code = str(item.get('sotCd') or item.get('shortCd') or item.get('fundCd') or '').strip().upper()
                    else:
                        code = str(item.get('fundCd') or item.get('repFundCd') or '').strip().upper()
                    name = str(item.get('itemNm') or item.get('fundFnm') or item.get('repFundNm') or '').strip()
                    if not code or not name:
                        continue
                    rows.append({
                        'name': name,
                        'code': code,
                        'symbol': f'{code}.KS' if product_type == 'ETF' and self.is_krx_code(code) else code,
                        'exchange': 'KRX' if product_type == 'ETF' else 'Fund',
                        'type': product_type,
                        'source': 'FunETF'
                    })
                    if len(rows) >= limit:
                        return rows
            return rows
        except Exception as e:
            print(f'funetf search error ({query}): {e}')
            return []

    def get_funetf_product_by_code(self, code):
        code = self.clean_code(code)
        if not self.is_fund_code(code):
            return None
        try:
            response = requests.get(
                f'https://www.funetf.co.kr/product/fund/view/{code}',
                headers=self.naver_headers,
                timeout=8
            )
            if response.status_code != 200:
                return None
            response.encoding = 'utf-8'
            title_match = re.search(r'<title>\s*(.*?)\s*\|\s*FunETF', response.text, flags=re.DOTALL)
            name = html.unescape(re.sub(r'<[^>]+>', '', title_match.group(1))).strip() if title_match else ''
            if not name:
                og_match = re.search(r'<meta property="og:title" content="([^"]+)"', response.text)
                name = html.unescape(og_match.group(1).split('|')[0]).strip() if og_match else ''
            if not name:
                return None
            return {
                'name': name,
                'code': code,
                'symbol': code,
                'exchange': 'Fund',
                'type': 'fund',
                'source': 'FunETF'
            }
        except Exception as e:
            print(f'funetf profile error ({code}): {e}')
            return None

    def get_price_from_funetf(self, fund_code):
        rows = self.get_history_from_funetf(fund_code, date.today() - timedelta(days=14), date.today())
        if not rows:
            return None
        latest = rows[-1]
        return {'price': latest['price'], 'date': latest['date'], 'source': 'FunETF'}

    def get_history_from_funetf(self, fund_code, start_date, end_date):
        fund_code = self.clean_code(fund_code)
        if not self.is_fund_code(fund_code):
            return []

        try:
            session = requests.Session()
            detail = session.get(
                f'https://www.funetf.co.kr/product/fund/view/{fund_code}',
                headers=self.naver_headers,
                timeout=10
            )
            if detail.status_code != 200:
                return []
            detail.encoding = 'utf-8'
            params = self.extract_funetf_form_values(detail.text)
            params['fundCd'] = fund_code
            if not params.get('schNavMode'):
                params['schNavMode'] = '1'

            response = session.get(
                'https://www.funetf.co.kr/api/public/product/view/fundnav',
                params=params,
                headers={
                    **self.naver_headers,
                    'Referer': f'https://www.funetf.co.kr/product/fund/view/{fund_code}',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                timeout=12
            )
            if response.status_code != 200:
                return []

            rows = []
            for item in response.json():
                row_date = self.parse_compact_date(item.get('gijunYmd'))
                price = item.get('gijunGa')
                if not row_date or price is None:
                    continue
                if start_date <= row_date <= end_date:
                    rows.append({'date': row_date, 'price': float(price)})
            return sorted(rows, key=lambda row: row['date'])
        except Exception as e:
            print(f'funetf history error ({fund_code}): {e}')
            return []

    def extract_funetf_form_values(self, text):
        params = {}
        for match in re.finditer(r'<input[^>]+>', text):
            tag = match.group(0)
            name_match = re.search(r'name="([^"]+)"', tag)
            value_match = re.search(r'value="([^"]*)"', tag)
            if not name_match:
                continue
            name = name_match.group(1)
            value = html.unescape(value_match.group(1)) if value_match else ''
            if name not in params or (not params[name] and value):
                params[name] = value
        return params

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

    def get_market_universe(self, market='KOSPI', max_pages=2):
        market_name = str(market or 'KOSPI').strip().upper()
        page_count = max(1, min(int(max_pages or 1), 6))
        market_targets = []

        if market_name == 'ALL':
            market_targets = [('KOSPI', 0), ('KOSDAQ', 1)]
        elif market_name == 'KOSDAQ':
            market_targets = [('KOSDAQ', 1)]
        else:
            market_targets = [('KOSPI', 0)]

        rows = []
        seen = set()
        for market_label, sosok in market_targets:
            for page in range(1, page_count + 1):
                for item in self.get_naver_market_page(market_label, sosok, page):
                    code = str(item.get('code') or '').strip().upper()
                    if not code or code in seen:
                        continue
                    seen.add(code)
                    rows.append(item)
        return rows

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

        if self.is_fund_code(code):
            return self.get_history_from_funetf(code, start_date, end_date)

        prices = self.get_history_from_yfinance(code, start_date, end_date)
        if prices:
            return prices

        prices = self.get_history_from_naver(code, start_date, end_date)
        if prices:
            return prices

        current = self.get_current_price(code)
        if current:
            return [{'date': end_date, 'price': current['price'], 'source': current.get('source')}]
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
                    'date': data.index[-1].date(),
                    'source': 'Yahoo'
                }
        except Exception as e:
            print(f'yfinance price error ({code}): {e}')
        return None

    def get_price_from_naver(self, stock_code):
        try:
            stock_code = self.clean_code(stock_code)
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
                            'date': parsed_date or date.today(),
                            'source': 'Naver'
                        }

            rows = self.get_history_from_naver_sise_day(
                stock_code,
                date.today() - timedelta(days=14),
                date.today(),
                max_pages=2
            )
            if rows:
                latest = rows[-1]
                return {'price': latest['price'], 'date': latest['date'], 'source': 'Naver'}
        except Exception as e:
            print(f'naver price error ({stock_code}): {e}')
        return None

    def get_history_from_naver(self, stock_code, start_date, end_date):
        try:
            stock_code = self.clean_code(stock_code)
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
        stock_code = self.clean_code(stock_code)
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

    def parse_compact_date(self, value):
        text = str(value or '')
        if len(text) != 8 or not text.isdigit():
            return None
        try:
            return date(int(text[0:4]), int(text[4:6]), int(text[6:8]))
        except ValueError:
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
