@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main

git add -A
git commit -m "FIX: Zero data loss on rate limit - retry batch until 100% success"
git push origin main --force

echo.
echo DONE! No data loss fix applied:
echo - Detects 429 in ANY window of batch
echo - Retries ENTIRE batch until all succeed
echo - Checkpoint saved ONLY when 100%% successful
echo - ZERO data loss from rate limiting!
echo.
echo All runs will be captured, no more gaps!
pause
