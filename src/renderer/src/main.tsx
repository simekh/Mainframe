import { render } from 'solid-js/web';

// Before anything renders: app.css keeps the Mac's own rules to html[data-platform='darwin'].
document.documentElement.dataset.platform = window.mainframe.platform;

// Each view loads through import(): App's stores subscribe to main as soon as they load, which the diff window must not do.
const view = new URLSearchParams(location.search).get('view') === 'diff' ? import('./diff/DiffApp') : import('./App');
void view.then(({ default: View }) => render(() => <View />, document.getElementById('root')!));
