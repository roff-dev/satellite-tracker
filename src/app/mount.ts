import { mount } from 'svelte';
import App from './App.svelte';
import Census from './components/Census.svelte';

export function mountApp(target: HTMLElement) {
  // The hero is static HTML for a fast first paint; the live census joins it underneath the subtitle
  const hero = target.querySelector('.hero');
  if (hero) mount(Census, { target: hero });
  return mount(App, { target });
}
