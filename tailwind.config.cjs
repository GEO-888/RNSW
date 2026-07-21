/**
 * Build-time Tailwind config for the vendored (offline) CSS.
 * Mirrors the brand palette in www/js/tailwind.config.js (which was the
 * runtime config for the old cdn.tailwindcss.com Play CDN). The Play CDN is
 * gone; this file drives `npm run build:css`, which compiles a static,
 * tree-shaken www/css/tailwind.css so the packaged app works offline.
 *
 * `content` scans every source that emits Tailwind class names. All classes
 * appear as literal tokens (dynamic string parts in app.js build custom
 * app.css classes like pill-*/msg-*, not Tailwind utilities), so text
 * scanning captures the full set the Play CDN generated at runtime.
 */
module.exports = {
  content: [
    './www/index.html',
    './www/js/app.js',
  ],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#040C1F', 900: '#071229', 800: '#0C1F44', 700: '#14305F', 600: '#1E4178' },
        sky:  { brand: '#5BB8FF', soft: '#A7CDEF' },
        rnswred: '#E8132E', gold: '#F2B33D',
      },
      fontFamily: { display: ['Archivo', 'sans-serif'], body: ['Inter', 'sans-serif'] },
    },
  },
}
