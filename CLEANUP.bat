@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

del index-simple.html 2>nul
del test-structure.js 2>nul
del debug-api.ps1 2>nul
del api-debug.txt 2>nul
del api-result.txt 2>nul
del test-api.js 2>nul
del reset-data.js 2>nul
del DO-RESET.bat 2>nul
del PUSH-FIX.bat 2>nul
del FORCE-RESET.ps1 2>nul
del RESET-COMPLETE.bat 2>nul

git add -A
git commit -m "Cleanup: remove unused files"
git push origin main

echo.
echo DONE! Cleanup complete.
pause
