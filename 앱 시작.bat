@echo off
chcp 65001 > nul
title 재개발구역 변상금 부과 도우미 (이 창을 닫으면 앱이 꺼져요)
cd /d "%~dp0"

rem 이 컴퓨터에서 실제로 등기 PDF를 읽는 모드로 켠다 (인터넷 서버로는 아무것도 보내지 않는다)
set OCR_MODE=local

echo.
echo  재개발구역 변상금 부과 도우미를 켜는 중이에요. 잠시 뒤 브라우저가 열려요.
echo  끝내려면 이 검은 창을 닫으세요.
echo.

rem 서버가 켜질 시간을 준 뒤 브라우저를 연다
start "" cmd /c "timeout /t 8 /nobreak > nul & start http://127.0.0.1:3000/work"

call npm.cmd run dev
pause
