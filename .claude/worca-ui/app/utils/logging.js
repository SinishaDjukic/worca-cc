export function debug(namespace) {
  const prefix = `worca-ui:${namespace}`;
  const enabled = typeof localStorage !== 'undefined'
    && (localStorage.getItem('debug') || '').includes('worca-ui');
  return (...args) => {
    if (enabled) console.log(prefix, ...args);
  };
}
