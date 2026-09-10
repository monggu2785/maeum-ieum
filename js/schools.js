/**
 * 마음이음 학교 레지스트리 (공개 정보만 저장)
 * - schoolCode / schoolName / Apps Script 웹앱 주소는 비밀정보가 아닙니다.
 * - 학생정보, 접속코드, API secret은 절대로 이 파일에 넣지 않습니다.
 *
 * 1단계 파일에서는 화산중학교 항목만 준비해 두었습니다.
 * Apps Script 배포 후 bridgeUrl의 PASTE... 부분을 실제 /exec 주소로 바꾸세요.
 */
window.MI_SCHOOLS = {
  HS001: {
    name: '화산중학교',
    bridgeUrl: 'https://script.google.com/macros/s/AKfycbz7BKOP0gLYcTXdWJtwNz4d24GxlcjFqNZD20s1z0F9aLTG27qFgS81yO8EWVUC3oY2/exec'
  }
};
