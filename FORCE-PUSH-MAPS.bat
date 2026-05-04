@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main

git add -A
git commit -m "ADD: 13 new v31 maps (Milky Way, Mare Nostrum, Great Lakes, Luna, etc.)"
git push origin main --force

echo.
echo DONE! Maps pushed with force.
pause
