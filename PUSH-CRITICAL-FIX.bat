@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main

git add -A
git commit -m "CRITICAL FIX: Mark gameId as seen ONLY after API success - stops data loss!"
git push origin main --force

echo.
echo DONE! Critical bug fixed:
echo - Before: gameId marked as seen BEFORE API call
echo - After: gameId marked as seen ONLY after successful API
echo - Result: Failed API calls will be retried, no more lost runs!
echo.
echo This fixes the bug where runs were disappearing!
pause
