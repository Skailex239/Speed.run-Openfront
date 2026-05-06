@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main

echo [] > runs.json
echo [] > seen.json
echo {"reset":true,"date":"2025-05-06"} > checkpoint.json

git add -A
git commit -m "RESET: All data cleared for fresh 3600h sync"
git push origin main --force

echo.
echo DONE! Reset complete:
echo - runs.json: CLEARED
echo - seen.json: CLEARED
echo - checkpoint.json: RESET
echo - Force push: DONE
echo.
echo Ready for 3600h coverage!
pause
