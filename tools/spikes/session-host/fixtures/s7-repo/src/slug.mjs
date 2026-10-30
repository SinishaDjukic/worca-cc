// slug('Hello World') → 'hello-world'
export function slug(s) {
  return String(s).trim().toLowerCase().split(/\s+/).filter(Boolean).join('-');
}
