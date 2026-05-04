@echo off
cd /d "c:\Users\rapto\Desktop\openfront-speedrun_1\openfront-speedrun"

git fetch origin
git reset --hard origin/main 2>nul

git add -A
git commit -m "Workflow: ensure manual trigger available"
git push origin main --force

echo.
echo DONE! Pour relancer manuellement si ca s'arrete encore:
echo 1. Va sur GitHub.com -> ton repo -> Actions
echo 2. Clique "Sync & Deploy" sur la gauche
echo 3. Clique "Run workflow" (bouton vert)
echo 4. Selectionne "main" et clique "Run workflow"
echo.
echo Le bouton "Run workflow" force le relancement immediatement!
pause
