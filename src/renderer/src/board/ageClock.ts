import { createSignal } from 'solid-js';

const AGE_REFRESH_MS = 30_000;

// One clock for every age on the cards and in the panel: each tick rewrites only the age texts.
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), AGE_REFRESH_MS);

export { now };
