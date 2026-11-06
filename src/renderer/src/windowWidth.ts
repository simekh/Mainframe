import { createSignal } from 'solid-js';

/** The window's width as it changes, which the columns' widths are clamped to. */
const [windowWidth, setWindowWidth] = createSignal(window.innerWidth);
window.addEventListener('resize', () => setWindowWidth(window.innerWidth));

export { windowWidth };
