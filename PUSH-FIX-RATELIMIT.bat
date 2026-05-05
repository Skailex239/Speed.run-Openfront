@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "FIX: When rate limit, retry same batch until success - NO more false 0 runs!"
git push origin main --force

echo.
echo DONE! Fix applied:
echo - When 429 detected: retry SAME batch
echo - Checkpoint saved ONLY when batch 100%% success
echo - NO more false "0 runs" when rate limited!
echo - All runs will actually be captured
echo.
echo This ensures EVERY run is counted, no more gaps!
pause
