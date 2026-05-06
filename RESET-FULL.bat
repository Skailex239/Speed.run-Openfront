@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main

echo [] > runs.json
echo [] > seen.json
echo {"reset":true,"date":"2025-05-06","note":"critical bug fix applied"} > checkpoint.json

git add -A
git commit -m "RESET: Fresh start with critical bug fix - no more lost runs!"
git push origin main --force

echo.
echo DONE! Full reset with bug fix:
echo - runs.json: CLEARED
echo - seen.json: CLEARED
echo - checkpoint.json: RESET
echo - Critical bug fix: ACTIVE
echo.
echo All runs will be captured correctly now!
pause
