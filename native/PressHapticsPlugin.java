package __PKG__;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A short haptic tick for button presses (kind: light | medium | heavy).
 * The CI copies this file into the generated Android project (package placeholder __PKG__),
 * registers it in MainActivity and adds the VIBRATE permission.
 */
@CapacitorPlugin(name = "PressHaptics")
public class PressHapticsPlugin extends Plugin {
  @SuppressWarnings("deprecation")
  @PluginMethod
  public void tap(PluginCall call) {
    String kind = call.getString("kind", "light");
    try {
      Vibrator v = vibrator();
      if (v != null && v.hasVibrator()) {
        long ms = "heavy".equals(kind) ? 40 : "medium".equals(kind) ? 22 : 12;
        if (Build.VERSION.SDK_INT >= 26) {
          v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
          v.vibrate(ms);
        }
      }
    } catch (Exception ignored) {
      // no haptics on this device: the press itself must never fail
    }
    call.resolve();
  }

  private Vibrator vibrator() {
    if (Build.VERSION.SDK_INT >= 31) {
      VibratorManager m = (VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
      return m == null ? null : m.getDefaultVibrator();
    }
    return (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
  }
}
