// Work Task is now part of the one app (worktask.in/projects/): the owner, the managers and the team all sign in
// and work there, in one design. This page only sends an old address (an installed app, a bookmark, an old
// notification or link) to the same place there.
import { oneAppAddress } from './logic.js';

const go = () => location.replace(oneAppAddress(location.search, location.hash));
// the phone notifications come through this site's service worker (sw.js): keep it registered, then go
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1')) {
  Promise.race([navigator.serviceWorker.register('sw.js'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {}).then(go);
} else go();
