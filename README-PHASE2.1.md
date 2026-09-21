# 마음이음 Hybrid 1.0 Phase 2.1

## 왜 수정했나요?
Phase 2의 GitHub 화면은 Apps Script `Bridge.html`을 숨은 iframe으로 먼저 열고 `google.script.run`을 사용했습니다. 일부 브라우저 환경에서 이 브리지의 준비 신호가 돌아오지 않아 `학교 서버 연결 시간이 길어지고 있습니다`에서 멈출 수 있었습니다.

Phase 2.1은 지속 브리지를 제거하고, 로그인/자동접속 확인 요청마다 **hidden form POST → Apps Script → postMessage 응답** 방식의 단발성 RPC를 사용합니다.

- 최초 브리지 연결 대기 없음
- 로그인ID/접속코드는 POST 본문으로 전송
- 오늘의 마음 빠른기록(sendBeacon/keepalive)은 기존 구조 유지
- Apps Script 공개 `/exec` 주소는 그대로 사용

## 교체 파일
Apps Script: `backend/Code.gs` 전체 교체 후 기존 웹앱을 새 버전으로 다시 배포

GitHub: `github` 폴더의 파일 전체를 저장소 root 기준으로 교체

`Bridge.html`은 기존에 남아 있어도 됩니다. Phase 2.1 GitHub 코드는 더 이상 지속 브리지 연결에 의존하지 않습니다.
