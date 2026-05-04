@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "OPTION A: 100000 windows × 2min = 3333h in ONE run - 10min cron - filters unchanged"
git push origin main --force

echo.
echo DONE! Option A enabled:
echo - 100000 windows per run (MAXIMUM)
echo - 2-minute precision
echo - 3333 HOURS covered in ONE run!
echo - Cron every 10 minutes (allows time to finish)
echo - Filters unchanged (strict)
echo.
echo This should capture ALL valid runs since Dec 2025 in 1-2 runs!
echo WARNING: First run will take ~2-3 hours. Be patient.
pause
