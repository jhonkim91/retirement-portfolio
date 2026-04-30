# 보안·개인정보 점검 체크리스트 (현재 저장소 기준)

기준일: 2026-04-29  
범위: `backend/*`, `frontend/src/*`, `docs/*`, 배포 설정 파일  
판정 상태:
- `양호`: 기본 요건 충족
- `부분`: 일부 구현되어 있으나 보완 필요
- `미흡`: 핵심 통제 부재 또는 위험 높음
- `확인불가`: 코드만으로 운영 상태 확인 불가

---

## 1) 항목별 체크리스트

| 항목 | 상태 | 근거(코드 기준) | 주요 갭 |
|---|---|---|---|
| 인증(Authentication) | **부분** | JWT 발급/검증 존재 (`backend/routes.py`, `@jwt_required`) | 비밀번호 해시가 단순 SHA-256(`hashlib.sha256`)로 salt/work factor 없음. 로그인 시도 제한/계정 잠금 부재 |
| 인가(Authorization) | **부분** | 대부분 API가 `user_id` 기준 필터링 + `@jwt_required` | 사용자 계정 자체 삭제/탈퇴 API 없음. 토큰 강제 폐기(blacklist/revoke) 부재 |
| 비밀정보 관리 | **부분** | API key/DB/JWT를 env에서 로드 (`backend/app.py`, `backend/api_client.py`, `backend/routes.py`) | `JWT_SECRET_KEY` 기본값이 약함(`change-this-secret-key`). 운영 강제 검증 없음 |
| CORS | **미흡** | `origins: '*'` (`backend/app.py`) | 전 Origin 허용 + Authorization 헤더 허용. 운영 환경에서 과도하게 개방적 |
| 입력 검증 | **부분** | 금액/수량/날짜 유효성 검사 함수 존재 (`parse_positive_float`, `parse_trade_date`) | 회원가입 이메일 형식/비밀번호 강도 검증 없음. 일부 endpoint는 스키마 기반 검증 부재 |
| 로깅/에러 처리 | **부분** | 스케줄러 로깅 존재 (`backend/scheduler.py`) | 다수 API가 `except Exception` 후 `str(e)`를 클라이언트에 반환(내부 정보 노출 위험) |
| 개인정보 처리방침 문서 | **미흡** | 저장소 내 정책 문서 부재 (`docs/` 확인) | 수집항목/보유기간/파기/권리행사/문의처/국외이전 고지 미정의 |
| 국외이전 가능성 고지 | **미흡** | OpenAI, Yahoo Finance 등 국외 서비스 사용 가능 (`backend/routes.py`, `backend/api_client.py`) | 이전 국가/항목/목적/보유기간/수탁사 고지 문서 없음 |
| 제3자 API 사용 통제 | **부분** | 서버측 경유 호출, source 배지 일부 표시 (`frontend/src/lib/sourceRegistry.js`) | OpenAI 인용(citations) 사용자 노출 일관성 부족, 공급자별 장애/한도 정책 문서화 부족 |
| 감사로그(Audit log) | **부분** | `TradeEvent`, `ImportBatch`, `TradeSnapshot`, `ReconciliationResult` 구현 + 조회/내보내기 API 존재 | 보존기간/열람권한 정책 문서 없음. 계정명 변경 시 이벤트 메타 업데이트로 “완전 불변” 보장 약화 여지 |
| 계정 삭제/데이터 삭제 요청 처리 | **부분** | 통장(account) 단위 삭제 API 존재 (`/accounts/<account_name> DELETE`) | 사용자(User) 단위 삭제/익명화/전체 데이터 삭제 API 부재. 법적 요청 절차 문서 부재 |

---

## 2) 세부 리스크 메모

## A. 인증/비밀번호
- 현재 회원가입/로그인:
  - `backend/routes.py`에서 `hashlib.sha256(password)` 비교 방식 사용
- 리스크:
  - GPU 기반 오프라인 크래킹 저항성이 낮음
  - salt/work factor 없음

## B. CORS/토큰 보관
- CORS:
  - `backend/app.py`에서 `/api/*` 전체 `origins: '*'`
- 프론트 토큰 보관:
  - `localStorage`에 `access_token` 저장 (`frontend/src/pages/Login.jsx`, `frontend/src/utils/api.js`)
- 리스크:
  - XSS 발생 시 토큰 탈취 가능성
  - 오설정된 API 도메인(`REACT_APP_API_URL`)으로 토큰 송신 가능

## C. 예외 메시지 노출
- 패턴:
  - 많은 API가 `return jsonify({'error': str(e)}), 500`
- 리스크:
  - 내부 스택/DB/외부 API 오류 세부가 사용자에 노출될 수 있음

## D. 개인정보/국외이전 컴플라이언스
- 저장 데이터:
  - `User` 모델에 `username`, `email`, `password(hash)` 저장
- 외부 전송 가능성:
  - OpenAI 호출 시 입력 프롬프트에 종목/보유맥락 포함 가능
  - Yahoo/OpenAI 등 국외 서비스 관여 가능
- 리스크:
  - 처리방침·국외이전 고지·동의체계 미비 시 규제 대응 취약

---

## 3) 수정 필요 파일 경로 (우선순위)

### P0 (즉시)
1. `backend/routes.py`
   - 비밀번호 해시를 Argon2/bcrypt로 교체
   - 로그인 시도 제한(예: IP/계정 기준 rate limit) 추가
   - `str(e)` 직접 반환 제거, 공통 에러 응답으로 치환
2. `backend/app.py`
   - 운영 환경 `JWT_SECRET_KEY` 미설정 시 부팅 실패 처리
   - CORS 허용 Origin 화이트리스트화(환경변수 기반)
3. `frontend/src/utils/api.js`
   - `REACT_APP_API_URL` 허용 도메인 검증 가드(최소 same-origin/승인 목록)

### P1 (단기)
4. `backend/routes.py` + `backend/models.py`
   - User 단위 삭제(탈퇴)/전체 데이터 파기 API 및 soft-delete 정책 정의
   - 감사로그 보존기간/무결성 강화(필요 시 별도 immutable 저장소)
5. `frontend/src/components/StockResearchPanel.jsx`
   - OpenAI 분석 결과 인용(citations) 일관 노출
6. `docs/` (신규 문서)
   - `docs/privacy-policy.md` (처리방침)
   - `docs/international-transfer-notice.md` (국외이전 고지)
   - `docs/data-retention-policy.md` (보존/파기/요청 처리)

### P2 (중기)
7. `backend/routes.py`
   - 요청 스키마 검증 계층(Pydantic/Marshmallow 등) 도입
8. `backend/` 전반
   - 보안 로그 표준화(민감정보 마스킹, 감사 이벤트 레벨 분리)
9. `frontend/src/App.js`, `frontend/src/components/Navigation.jsx`
   - 세션 만료/로그아웃 정책 UX 보강(토큰 수명 고지, 재인증 플로우)

---

## 4) 확인불가 항목 (운영 정보 필요)

아래는 저장소 코드만으로 확정할 수 없습니다.
- 운영 DB/백업 데이터 암호화(At-rest) 적용 여부
- 접근통제(RBAC), 운영자 로그 열람권한 분리 여부
- 침해사고 대응 프로세스/연락체계
- 실제 배포 리전(국내/국외) 및 데이터 경로
- 법무 검토 완료된 개인정보 처리방침/국외이전 동의문구 존재 여부

---

## 5) 빠른 실행 체크 (권장)

- [ ] 비밀번호 해시 교체 및 마이그레이션 계획 수립
- [ ] CORS 화이트리스트 적용
- [ ] 500 에러 상세 메시지 외부 노출 차단
- [ ] User 삭제/데이터 삭제 요청 API 설계
- [ ] 개인정보 처리방침 + 국외이전 고지 문서 공개
