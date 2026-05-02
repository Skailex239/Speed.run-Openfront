@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git add index.html
git commit -m "Show top 5 runs per map instead of top 50"
git push origin main

echo.
echo DONE! Leaderboard shows top 5 now.
pause
