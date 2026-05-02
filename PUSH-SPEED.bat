@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git add -A
git commit -m "SPEED BOOST: 2000 windows/run, 10 concurrency, 1min cron - same strict filters"
git push origin main --force

echo.
echo DONE! Sync will now:
echo - Run EVERY MINUTE (was 5 min)
echo - Process 2000 windows per run (was 100)
echo - Use 10 concurrent workers (was 5)
echo - Same strict filters (Public FFA only)
echo.
echo Check GitHub Actions in 2 minutes!
pause
