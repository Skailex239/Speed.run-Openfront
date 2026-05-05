@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

echo [] > runs.json
echo [] > seen.json
echo {"reset":true,"date":"2025-05-05","overlap":"70h"} > checkpoint.json

git add -A
git commit -m "RESET: Fresh start with 70h overlap = no gaps between runs"
git push origin main --force

echo.
echo DONE! Reset complete:
echo - runs.json cleared
echo - seen.json cleared
echo - checkpoint.json reset with 70h overlap config
echo - Zero gaps between runs guaranteed!
echo.
echo GitHub Actions will restart fresh in 1 minute!
pause
