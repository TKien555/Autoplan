const urlParams = new URLSearchParams(window.location.search);
const isAppView = urlParams.get('view') === 'app';

if (isAppView) {
  void import('./planner.jsx');
} else if (window.TrelloPowerUp) {
  const appKey = import.meta.env.VITE_TRELLO_API_KEY;
  const appName = import.meta.env.VITE_APP_NAME || 'AI WBS & RAG Planner';
  const plannerUrl = './?view=app';
  const icon = new URL('/favicon.svg', window.location.origin).href;

  window.TrelloPowerUp.initialize({
    'card-back-section': t => ({
      title: appName,
      icon,
      content: {
        type: 'iframe',
        url: t.signUrl(plannerUrl),
        height: 350
      }
    }),
    'card-buttons': () => [{
      icon,
      text: 'Lập kế hoạch AI',
      callback: t => t.popup({ title: appName, url: plannerUrl, height: 450 })
    }],
    'card-badges': async t => {
      const meta = await t.get('card', 'shared', 'aiTaskMeta', null);
      if (!meta) return [];
      const badges = [];
      if (meta.estimatedHours) {
        const hours = Number(meta.estimatedHours);
        badges.push({ text: `${hours}h`, color: hours > 16 ? 'red' : 'blue' });
      }
      if (meta.role) badges.push({ text: meta.role, color: 'green' });
      if (['High', 'Critical'].includes(meta.priority)) badges.push({ text: meta.priority, color: 'red' });
      if (meta.hasRag) badges.push({ text: 'RAG', color: 'purple' });
      return badges;
    },
    ...(appKey && {
      'authorization-status': async t => ({ authorized: Boolean(await t.getRestApi().isAuthorized()) }),
      'show-authorization': t => t.getRestApi().authorize({ scope: 'read,write', expiration: 'never' })
    })
  }, { appKey, appName });
}
