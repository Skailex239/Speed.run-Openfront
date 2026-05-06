@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main

git add -A
git commit -m "3600H COVERAGE: 2000 windows x 2min = 66h per run, 70h overlap"
git push origin main --force

echo.
echo DONE! Force push successful!
pause
