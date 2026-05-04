@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

echo [] > runs.json
echo [] > seen.json
echo {"reset":true,"date":"2025-05-04"} > checkpoint.json

git add -A
git commit -m "COMPLETE RESET: Fresh start with 2000 windows per run, 1min cron"
git push origin main --force

echo.
echo DONE! Complete reset done:
echo - runs.json cleared
echo - seen.json cleared
echo - checkpoint.json reset
echo - Config: 2000 windows per run, 1min cron
echo.
echo GitHub Actions will restart fresh in 1 minute!
pause
