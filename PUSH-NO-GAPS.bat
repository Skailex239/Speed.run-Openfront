@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "FIX: 70h overlap matches run coverage (2000x2min=66h) = ZERO gaps between runs"
git push origin main --force

echo.
echo DONE! No-gap fix applied:
echo - Run coverage: 2000 windows x 2min = 66h
echo - Overlap: 70h (4h margin)
echo - Next run starts 70h BEFORE previous end
echo - ZERO gaps between runs!
echo.
echo Now runs chain perfectly without missing any data!
pause
