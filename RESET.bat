@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

echo [] > runs.json
echo [] > seen.json  
echo {"reset":true} > checkpoint.json
echo RESET done > reset-marker.txt

git add -A
git commit -m "COMPLETE RESET of all data"
git push origin main --force

echo.
echo DONE! Check GitHub Actions in 2 minutes.
pause
