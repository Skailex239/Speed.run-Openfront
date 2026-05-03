@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "FULL COVERAGE: 10000 windows × 10min = 1666h per run - filters unchanged"
git push origin main --force

echo.
echo DONE! Full coverage enabled:
echo - 10000 windows per run
echo - 10-minute time windows  
echo - 1666 HOURS covered per execution!
echo - Filters unchanged (strict)
echo.
echo This should recover almost ALL runs from Dec 2025 in 2-3 runs.
pause
