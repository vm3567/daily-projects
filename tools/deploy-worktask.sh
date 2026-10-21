#!/bin/sh
# Put the latest Work Task server and Daily Projects app on worktask.in (Hostinger), over SSH.
#   sh tools/deploy-worktask.sh
# Only adds or updates files; never deletes anything on the server.
# Never touches: app/config.php (database password), uploads/ (staff photos), dpdata/ (your projects).
set -e
cd "$(dirname "$0")/.."
KEY="$HOME/.ssh/hostinger_dp"
HOST=u578596396@145.79.25.173
D=domains/worktask.in
SSH="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -p 65002"
# a new version stamp on every upload: open pages offer "New version ready — reload"
V="$(git rev-parse --short HEAD)-$(date +%s)"
echo "$V" > team/public_html/version.txt
echo "$V" > docs/version.txt
rsync -az -e "$SSH" --exclude config.php --exclude setup-code.txt team/app/ "$HOST:$D/app/"
rsync -az -e "$SSH" --exclude projects/ team/public_html/ "$HOST:$D/public_html/"
rsync -az -e "$SSH" --exclude .htaccess docs/ "$HOST:$D/public_html/projects/"
rsync -az -e "$SSH" team/projects.htaccess "$HOST:$D/public_html/projects/.htaccess"
echo "Deployed to https://worktask.in"
