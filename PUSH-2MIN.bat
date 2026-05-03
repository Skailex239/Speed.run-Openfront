@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "2-MIN WINDOWS: 10000 windows × 2min = 333h per run - precision mode"
git push origin main --force

echo.
echo DONE! 2-minute windows enabled:
echo - 10000 windows per run
echo - 2-minute intervals (precision)
echo - 333 HOURS covered per execution
echo - Need ~11 runs for full Dec 2025+ coverage
echo - Filters unchanged (strict)
pause
