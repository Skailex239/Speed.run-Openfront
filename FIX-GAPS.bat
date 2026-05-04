@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "FIX GAPS: Never go backward, always forward from checkpoint + 5000 windows + 1min precision"
git push origin main --force

echo.
echo DONE! Gap fix applied:
echo - Checkpoint: NEVER goes backward
echo - 5000 windows per run (was 2000)
echo - 1-minute windows (was 2min)
echo - Continuous forward progress only
echo.
echo This should eliminate all gaps.
pause
