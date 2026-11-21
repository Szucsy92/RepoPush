package __PKG__;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Switches the launcher icon (colour theme) by enabling one of the launcher activity-aliases
 * (IconDefault, IconCoral, IconSky, IconSun, IconViolet) and disabling the others.
 * The CI copies this file and the icon resources (native/res) into the generated Android project,
 * adds the aliases to the manifest (package placeholder __PKG__) and registers the plugin in MainActivity.
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {
  private static final String[] NAMES = {"default", "coral", "sky", "sun", "violet"};
  private static final String[] ALIASES = {"IconDefault", "IconCoral", "IconSky", "IconSun", "IconViolet"};

  @PluginMethod
  public void set(PluginCall call) {
    String name = call.getString("name", "default");
    int idx = -1;
    for (int i = 0; i < NAMES.length; i++) {
      if (NAMES[i].equals(name)) idx = i;
    }
    if (idx < 0) {
      call.reject("ismeretlen ikon: " + name, "args");
      return;
    }
    try {
      PackageManager pm = getContext().getPackageManager();
      // The new entry first, then the old ones: there is never a moment without a launcher entry.
      pm.setComponentEnabledSetting(component(idx), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
      for (int i = 0; i < ALIASES.length; i++) {
        if (i != idx) {
          pm.setComponentEnabledSetting(component(i), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
      }
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getClass().getSimpleName() + ": " + e.getMessage(), "icon");
    }
  }

  @PluginMethod
  public void get(PluginCall call) {
    PackageManager pm = getContext().getPackageManager();
    String current = NAMES[0];
    for (int i = 0; i < ALIASES.length; i++) {
      int state = pm.getComponentEnabledSetting(component(i));
      // DEFAULT means "as in the manifest": only IconDefault is enabled there.
      if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED || (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && i == 0)) {
        current = NAMES[i];
        break;
      }
    }
    JSObject o = new JSObject();
    o.put("name", current);
    call.resolve(o);
  }

  private ComponentName component(int i) {
    return new ComponentName(getContext().getPackageName(), getClass().getPackage().getName() + "." + ALIASES[i]);
  }
}
