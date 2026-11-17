# RepoPush

ZIP-ből vagy patch/diff fájlból közvetlenül frissítheted a saját GitHub repóidat, a saját GitHub tokeneddel. Nincs szerver és nincs közös kulcs: minden a böngésződben fut, és a token csak az `api.github.com`-nak megy.

## Mit tud
- ZIP behúzása vagy tallózása. A közös gyökérmappát (pl. `repo-main/`) levágja, a `.github/workflows/*.yml` és a `.gitignore` is felkerül.
- **Teljes csere** (ami nincs a ZIP-ben, törlődik) vagy **Beillesztés** (a többi fájl marad).
- Patch / diff alkalmazása (új, módosított, törölt, átnevezett fájlok).
- Minden egyetlen commitban megy fel. Előtte megerősítő ablak mutatja, hány fájl lesz új, módosított és törölt, melyik repóban és ágon.
- Üres repó esetén magától létrehozza az első commitot.
- Ami nem változott, azt nem tölti fel újra; ha semmi sem változott, nem készít üres commitot.
- Feltöltés után a buildek (GitHub Actions) indítása és követése. A teljes napló a böngészőből nem tölthető le (a GitHub átirányít egy másik tárhelyre, amit az app biztonsági szabálya szándékosan tilt), ezért a „⇩ log ZIP” gomb a GitHub saját letöltő linkjét nyitja meg (a böngésződ GitHub-bejelentkezésével, a ZIP a Letöltésekbe kerül), a „részletek” gomb pedig a hibás jobokat és lépéseket listázza, a hibás jobhoz naplólinkkel.

## Token készítése
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Válaszd ki a repókat, és adj meg lejáratot.
3. Repository permissions:
   - **Contents**: Read and write
   - **Actions**: Read and write
   - **Workflows**: Read and write
   - **Metadata**: Read
4. Klasszikus token esetén: `repo` + `workflow` jog.
5. Az appban illeszd be, nyomd meg a „Token ellenőrzése” gombot, majd a „Mentés és tovább” gombot.

A „Token megjegyzése ezen az eszközön” kapcsolóval a token az eszközön marad. Kikapcsolva a böngészőfül bezárásakor törlődik. A „Kijelentkezés” gomb törli.

## Telepítés appként (PWA)
- **Android / Chrome:** nyisd meg az oldalt, majd menü → **Alkalmazás telepítése** / **Hozzáadás a kezdőképernyőhöz**.
- **iPhone / Safari:** Megosztás → **Főképernyőhöz adás**.
- **Asztali Chrome / Edge:** a címsor jobb oldalán a telepítés ikon.

## Fejlesztés
```sh
bun install      # a bun.lock ehhez készült; npm install a rolldown override miatt összeomolhat
bun run dev      # http://localhost:8080
bun run test
bun run build    # dist/
```

## Android APK (aláírt, telepíthető)
Az APK-t a GitHub Actions építi (`.github/workflows/android.yml`), a webes app Capacitorral van becsomagolva. Az aláíró kulcsot a workflow az első futáskor egyszer létrehozza.

1. **Egyszeri előkészítés:** a repóban *Settings → Secrets and variables → Actions → New repository secret*. Név: `ANDROID_KEYSTORE_PASSWORD`, érték: egy hosszú (20+ karakteres), véletlenszerű jelszó. **Mentsd el jelszókezelőbe**: a GitHub nem mutatja meg újra, és elvesztésekor a kulcs használhatatlan lesz (az új APK-t csak a régi app törlése után lehet telepíteni).
2. *Actions → Android APK → Run workflow.* Az első futás létrehozza a kulcsot, titkosítva a `signing` ágra menti, és utána minden futás ugyanezt használja. (A kulcs egy külön ágon van, hogy a ZIP-es „Teljes csere” a `main` ágon ne törölhesse.)
3. Kész: *Releases* → `RepoPush.apk`. Állandó link a legfrissebbhez: `https://github.com/<felhasználó>/<repó>/releases/latest/download/RepoPush.apk`.
4. Az appban a fejléc alatt megjelenik a „⬇ Legfrissebb APK letöltése" gomb, amint kész egy release (privát repónál a tokennek olvasási joga kell hozzá, a letöltéshez pedig be kell lépned a böngészőben).
5. Telefonon nyisd meg a letöltött APK-t, és engedélyezd az ismeretlen forrásból telepítést. Az új verziók a régire települnek, az adatok (token) megmaradnak.

Az appon belüli „▶ Friss build indítása” gomb az Android workflow-t is elindítja (minden `workflow_dispatch` workflow-t indít).

## GitHub Pages
A `.github/workflows/deploy.yml` minden `main` push után lefuttatja a teszteket, megépíti az appot, és kiteszi GitHub Pagesre. A repóban: **Settings → Pages → Source: GitHub Actions**. A relatív elérési út miatt bármilyen `/<repo>/` alatt fut.
