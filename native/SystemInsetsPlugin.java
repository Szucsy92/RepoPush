package __PKG__;

import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reports the height of the status / navigation bars (and display cutout) in CSS pixels, so the web layout
 * can pad itself while the app draws behind the transparent bars. While the keyboard is up the bottom value is 0
 * (MainActivity already lifts the content above the keyboard).
 * The CI copies this file into the generated Android project (package placeholder __PKG__) and registers it in MainActivity.
 */
@CapacitorPlugin(name = "SystemInsets")
public class SystemInsetsPlugin extends Plugin {
  @PluginMethod
  public void get(PluginCall call) {
    double top = 0, right = 0, bottom = 0, left = 0;
    try {
      View decor = getActivity().getWindow().getDecorView();
      WindowInsetsCompat w = ViewCompat.getRootWindowInsets(decor);
      if (w != null) {
        Insets b = w.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        double d = getContext().getResources().getDisplayMetrics().density;
        top = b.top / d;
        left = b.left / d;
        right = b.right / d;
        bottom = w.isVisible(WindowInsetsCompat.Type.ime()) ? 0 : b.bottom / d;
      }
    } catch (Exception ignored) {
      // fall back to zeros: the layout simply gets no extra padding
    }
    JSObject o = new JSObject();
    o.put("top", top);
    o.put("right", right);
    o.put("bottom", bottom);
    o.put("left", left);
    call.resolve(o);
  }
}
