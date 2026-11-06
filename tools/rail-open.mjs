// npm run rail: builds the prototype's generated files and opens it in the browser.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeAppCss } from '../plans/rail/prototype/gates/app-css.mjs';
import { writeComponentsJs } from '../plans/rail/prototype/gates/components-js.mjs';
import { writeTodayJs } from '../plans/rail/prototype/gates/today-js.mjs';

writeAppCss();
writeComponentsJs();
writeTodayJs();

const page = fileURLToPath(new URL('../plans/rail/prototype/index.html', import.meta.url));
const [cmd, ...args] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', ''] : ['xdg-open'];
spawn(cmd, [...args, page], { stdio: 'ignore', detached: true }).on('error', () => console.error(`Could not open a browser: open ${page} yourself`)).unref();
console.log(page);
