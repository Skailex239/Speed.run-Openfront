@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git rebase --abort 2>nul
git reset --hard origin/main 2>nul

echo [] > seen.json
echo {"reset":true} > checkpoint.json

git add -A
git commit -m "Fix: Relax list filter and reset data"
git push origin main --force

echo.
echo DONE! Check GitHub Actions in 2 minutes.
pause
