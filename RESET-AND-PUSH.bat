@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

echo [] > runs.json
echo [] > seen.json
echo {"reset":true,"date":"2025-05-03"} > checkpoint.json

git add -A
git commit -m "COMPLETE RESET: Fresh start with 2000 windows/run, 1min cron config"
git push origin main --force

echo.
echo DONE! All data reset. GitHub Actions will restart fresh in 1 minute.
pause
