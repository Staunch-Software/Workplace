// Scopes the Vessel Performance module's CSS (src/modules/vp) under .vp-root so its global resets, its
// :root variables and its plain class names cannot touch the rest of the workplace. Other files are untouched.
import prefixer from 'postcss-prefix-selector'

const ROOTS = new Set([':root', 'html', 'body', '#root'])

export default {
  plugins: [
    prefixer({
      prefix: '.vp-root',
      includeFiles: [/[\/]modules[\/]vp[\/]/],
      transform(prefix, selector, prefixed) {
        if (ROOTS.has(selector.trim())) return prefix   // page-level rules become rules of the module root
        return prefixed
      },
    }),
  ],
}
