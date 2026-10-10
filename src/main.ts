import './styles/fonts';
import './styles/hero.css';

// The hero is plain HTML so it paints immediately; the app (and three.js with it) loads after the first frame.
requestAnimationFrame(() => {
  setTimeout(async () => {
    const { mountApp } = await import('./app/mount');
    mountApp(document.getElementById('app')!);
  }, 0);
});
