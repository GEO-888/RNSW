# Racing NSW App

Capacitor project built from the V9 HTML prototype.

## Structure
```
www/index.html              app shell + markup (51 KB, was 231 KB inline)
www/css/app.css             Liquid Glass styles
www/js/app.js               all app logic (122 functions)
www/js/tailwind.config.js   brand palette
www/golden-mingle.html      Golden Mingle mini-app (was an iframe srcdoc)
www/assets/                 13 extracted media files
```

## Run in a browser
```
npm install
npm run serve        # http://localhost:5173
```

## First native build
```
npx cap add ios
npx cap add android
npm run ios          # opens Xcode
npm run android      # opens Android Studio
```

## KNOWN ISSUE — must fix before store submission
`index.html` loads Tailwind and Google Fonts from CDNs. A packaged app must work
offline. Vendor both locally:
- compile Tailwind to `www/css/tailwind.css` (`npx tailwindcss -o`)
- download the font `.woff2` files into `www/assets/fonts/` and @font-face them
