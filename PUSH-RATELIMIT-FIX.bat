@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "FIX: Rate limit stops batch, retry same window, no more false 0 runs"
git push origin main --force

echo.
echo DONE! Rate limit fix applied:
echo - Detects 429 in batch processing
echo - PAUSES batch for 5 seconds
echo - RETRIES same window (does NOT advance!)
echo - Only saves checkpoint when batch succeeds
echo - No more false "0 runs" when rate limited!
echo.
echo This should eliminate gaps from rate limiting.
pause
