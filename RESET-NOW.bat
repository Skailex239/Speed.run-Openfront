@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

echo [] > runs.json
echo [] > seen.json
echo {"reset":true,"date":"2025-05-05"} > checkpoint.json

git add -A
git commit -m "RESET: Fresh start with current config"
git push origin main --force

echo.
echo DONE! Reset complete:
echo - runs.json cleared
echo - seen.json cleared  
echo - checkpoint.json reset
echo - Sync will restart fresh in 1 minute
echo.
echo Check GitHub Actions in 1 minute!
pause
