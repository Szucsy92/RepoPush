# GitHub Zip Uploader

Kell egy olyan app, amely belsőtárhelyről képes github-ra akár zip-et feltölteni és teljesen helyesen lecseréli, vagy beilleszti a repo fájlokat, valamint patch és diff kezelésével is megbírkózik. összekapcsolható, saját github fiókkal és kezelhetőek a saját repo-k.
Egyetlen zip fájl behúzása, tallózása elég. Nem jelent gondot a /.github/workflow/*.yml beillesztése vagy /.gitignore beillesztése. A zip az általános letöltött repo struktúra.
Automatikusan felülír és végrehajt. Nincs szükség védelemre. Csak akkor használom, ha tudom mit csinálok.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bfae6e07-30dc-4f22-abfb-b82f0b353f43).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
