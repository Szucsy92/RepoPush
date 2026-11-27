package __PKG__;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Pattern;

/**
 * In-app (OTA) update: downloads the new APK from a GitHub release into the app's own cache and hands it to the
 * system installer. The CI copies this file into the generated Android project (package placeholder __PKG__),
 * registers it in MainActivity, and adds the REQUEST_INSTALL_PACKAGES permission and the UpdateFileProvider.
 *
 * downloadAndInstall resolves { state }: installing = the installer opened; needsPermission = the "install unknown
 * apps" settings page of this app opened; the call is rejected when the download or the checks fail.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
  // Only GitHub release downloads are accepted (the JS side validates the same shape).
  private static final Pattern APK_URL = Pattern.compile("^https://github\\.com/[\\w.-]+/[\\w.-]+/releases/download/[^/]+/[\\w.-]+\\.apk$");
  private volatile boolean updating;

  /** versionCode of the installed APK: the latest release's build number is compared to it. */
  @PluginMethod
  public void versionCode(PluginCall call) {
    JSObject data = new JSObject();
    try {
      PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
      data.put("versionCode", (int) PackageInfoCompat.getLongVersionCode(info));
    } catch (Exception e) {
      data.put("versionCode", 0);
    }
    call.resolve(data);
  }

  @PluginMethod
  public void downloadAndInstall(PluginCall call) {
    String url = call.getString("url", "");
    if (url == null || !APK_URL.matcher(url).matches()) {
      call.reject("Invalid update URL");
      return;
    }
    if (updating) {
      call.reject("Update already running");
      return;
    }
    updating = true;
    new Thread(() -> {
      try {
        call.resolve(runUpdate(url));
      } catch (Exception e) {
        call.reject("Update failed");
      } finally {
        updating = false;
      }
    }, "repopush-update").start();
  }

  private void progress(int percent) {
    JSObject data = new JSObject();
    data.put("percent", percent);
    notifyListeners("updateProgress", data);
  }

  private boolean open(Intent intent) {
    try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      if (getActivity() != null) getActivity().startActivity(intent);
      else getContext().startActivity(intent);
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  private JSObject runUpdate(String url) throws Exception {
    Context context = getContext();
    File dir = new File(context.getCacheDir(), "updates");
    if (!dir.exists() && !dir.mkdirs()) throw new IOException("cache");
    File[] old = dir.listFiles();
    if (old != null) for (File f : old) f.delete();
    File part = new File(dir, "update.part");
    File apk = new File(dir, "update.apk");
    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
    connection.setConnectTimeout(15000);
    connection.setReadTimeout(30000);
    try {
      if (connection.getResponseCode() != 200) throw new IOException("http");
      long total = connection.getContentLengthLong();
      try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
        byte[] buffer = new byte[32768];
        long done = 0;
        int last = -1;
        int n;
        while ((n = in.read(buffer)) > 0) {
          out.write(buffer, 0, n);
          done += n;
          if (total > 0) {
            int percent = (int) (done * 100 / total);
            if (percent != last) {
              last = percent;
              progress(percent);
            }
          }
        }
      }
    } finally {
      connection.disconnect();
    }
    if (!part.renameTo(apk)) throw new IOException("rename");
    // Only an APK of this very app, and only a newer one, goes on to the installer.
    PackageInfo fresh = context.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
    PackageInfo current = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
    if (fresh == null || !context.getPackageName().equals(fresh.packageName)
        || PackageInfoCompat.getLongVersionCode(fresh) <= PackageInfoCompat.getLongVersionCode(current)) {
      apk.delete();
      throw new IOException("package");
    }
    JSObject data = new JSObject();
    if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
      // The "install unknown apps" page of this app; the user comes back and taps install again.
      open(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName())));
      data.put("state", "needsPermission");
      return data;
    }
    Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".updates", apk);
    Intent intent = new Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    if (!open(intent)) throw new IOException("installer");
    data.put("state", "installing");
    return data;
  }
}
