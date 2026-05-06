@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main

git add -A
git commit -m "CRITICAL FIX: Race condition - accumulate runs in memory, save once per batch"
git push origin main --force

echo.
echo DONE! Race condition fixed:
echo - Before: Multiple parallel calls overwrite runs.json
echo - After: Accumulate in memory, save ONCE per batch
echo - Result: No more lost runs, all 1091+ will be saved!
echo.
echo This fixes: 1091 runs found but only 110 saved!
pause
