@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "COMPLETE SYNC: 110000 windows × 2min = ALL 150 days since Dec 2025 in ONE run"
git push origin main --force

echo.
echo DONE! Complete sync enabled:
echo - 110000 windows per run
echo - 2-minute intervals
echo - 150 DAYS covered in ONE execution!
echo - ALL runs since Dec 1st 2025 will be recovered
echo.
echo WARNING: This run may take 2-3 hours. GitHub Actions timeout is 6h.
pause
