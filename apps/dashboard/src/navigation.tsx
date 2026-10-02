import { useEffect, useState } from 'react';

export type Page = 'overview' | 'workshop' | 'scenarios' | 'history' | 'run' | 'library' | 'invalid';
export function parseRoute(pathname: string): { page: Page; runId: string | null } {
  const normalized = pathname.replace(/\/$/, '') || '/';
  if (normalized.startsWith('/history/')) {
    const runId = normalized.slice('/history/'.length);
    return /^[\w.-]{1,160}$/.test(runId) ? { page: 'run', runId } : { page: 'invalid', runId: null };
  }
  const pages: Record<string, Page> = { '/': 'overview', '/workshop': 'workshop', '/scenarios': 'scenarios', '/history': 'history', '/library': 'library' };
  return { page: pages[normalized] ?? 'invalid', runId: null };
}

export function useNavigation() {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const changed = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  const navigate = (url: string) => {
    if (window.location.pathname !== url) window.history.pushState(null, '', url);
    setRoute(parseRoute(window.location.pathname));
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return { ...route, navigate };
}

const destinations = [
  ['/', 'Overview'], ['/workshop', 'Blueprint Workshop'], ['/scenarios', 'Scenarios'], ['/history', 'Run History'], ['/library', 'Blueprint Library'],
] as const;
export function MainNavigation({ page, navigate }: { page: Page; navigate: (url: string) => void }) {
  return <nav className="main-navigation" aria-label="Main navigation">{destinations.map(([href, label]) =>
    <a key={href} href={href} aria-current={page === (parseRoute(href).page) || page === 'run' && href === '/history' ? 'page' : undefined}
      onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(href); } }}>{label}</a>)}</nav>;
}
