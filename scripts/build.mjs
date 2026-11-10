import { readFile, writeFile } from 'node:fs/promises';

const html = await readFile('src/index.html', 'utf8');
const css = await readFile('src/style.css', 'utf8');
const js = await readFile('.build/app.js', 'utf8');
if (/<\/script/i.test(js) || /<\/style/i.test(css)) throw new Error('인라인 태그를 닫는 문자열이 있습니다.');
const output = html.replace('/* APP_CSS */', () => css).replace('/* APP_JS */', () => `(function () {\n${js}\n})();`);
await writeFile('index.html', output);
console.log('Built index.html');
