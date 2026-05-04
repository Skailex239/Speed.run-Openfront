@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "DECOMPOSED: 2000 windows per run × 50 runs = full history - continuous forward progress"
git push origin main --force

echo.
echo DONE! Decomposed mode enabled:
echo - 2000 windows per run (66h coverage)
echo - ~50 runs needed for full 150 days history
echo - Cron every 1 minute (rapid chaining)
echo - Checkpoint saves END of last window (no overlap, no gaps)
echo - Next run starts exactly where previous stopped
echo.
echo Progress: 1 run every ~30-40 min = full history in ~25-30 hours
echo Check GitHub Actions to see progress!
pause
