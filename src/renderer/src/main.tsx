import { render } from 'solid-js/web';
import App from './App';

// Before anything renders: app.css keeps the Mac's own rules to html[data-platform='darwin'].
document.documentElement.dataset.platform = window.mainframe.platform;

render(() => <App />, document.getElementById('root')!);
