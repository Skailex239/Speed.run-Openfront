@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "MAX COVERAGE: 10000 windows per run = 160h new per run, ~22 runs for full 3600h"
git push origin main --force

echo.
echo DONE! 10000 windows per run:
echo - 10000 fenêtres x 1min = 166h total
echo - Moins 6h overlap = 160h NOUVELLES par run
echo - 3600h / 160h = ~22 runs pour TOUT couvrir
echo - Cron 1 minute = run suivant rapide
echo.
echo Toutes les runs seront capturees!
pause
