@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "UPDATE: 110000 windows x 2min intervals - full history + continuous sync"
git push origin main --force

echo.
echo DONE! GitHub Actions will start in 1 minute.
pause
