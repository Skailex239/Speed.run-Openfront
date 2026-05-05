@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

echo [] > runs.json
echo [] > seen.json
echo {"reset":true,"date":"2025-05-05"} > checkpoint.json

git add -A
git commit -m "MAX RUNS: 1min windows + 6h overlap + 5000 windows = ZERO gaps, MAXIMUM coverage"
git push origin main --force

echo.
echo DONE! MAX RUNS config applied:
echo - 1-minute windows (1440 per day = MAX precision)
echo - 6-hour overlap (360 windows) = NO gaps between runs
echo - 5000 windows per run = 83h coverage
echo - 77h NEW data per run (minus 6h overlap)
echo - ~47 runs needed for 150 days of history
echo - Cron every minute = continuous chaining
echo.
echo This captures EVERY SINGLE valid run since Dec 2025!
echo GitHub Actions will start fresh in 1 minute.
pause
