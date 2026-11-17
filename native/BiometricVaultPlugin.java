package __PKG__;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keeps one small secret (the app PIN) behind the fingerprint.
 * The secret is encrypted with an Android Keystore AES key that can only be used right after a successful
 * BiometricPrompt (CryptoObject). The key is dropped by Android when the fingerprints change.
 * The CI copies this file into the generated Android project (package placeholder __PKG__) and registers it in MainActivity.
 */
@CapacitorPlugin(name = "BiometricVault")
public class BiometricVaultPlugin extends Plugin {
  private static final String ALIAS = "repopush_bio_key";
  private static final String PREFS = "repopush_bio";
  private static final int AUTH = BiometricManager.Authenticators.BIOMETRIC_STRONG;

  private interface OnAuth {
    void run(Cipher cipher) throws Exception;
  }

  @PluginMethod
  public void isAvailable(PluginCall call) {
    int r = BiometricManager.from(getContext()).canAuthenticate(AUTH);
    JSObject o = new JSObject();
    o.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
    o.put("code", r);
    o.put("reason", describeStatus(r));
    call.resolve(o);
  }

  @PluginMethod
  public void store(final PluginCall call) {
    final String secret = call.getString("secret");
    if (secret == null || secret.isEmpty()) {
      call.reject("hiányzó adat", "args");
      return;
    }
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, createKey());
      authenticate(call, cipher, "Biometrikus feloldás bekapcsolása", "Mégse", c -> {
        byte[] ct = c.doFinal(secret.getBytes(StandardCharsets.UTF_8));
        prefs().edit().putString("iv", b64(c.getIV())).putString("ct", b64(ct)).apply();
        call.resolve();
      });
    } catch (Exception e) {
      call.reject(describe(e), "init");
    }
  }

  @PluginMethod
  public void retrieve(final PluginCall call) {
    final String iv = prefs().getString("iv", null);
    final String ct = prefs().getString("ct", null);
    if (iv == null || ct == null) {
      call.reject("nincs mentett adat", "empty");
      return;
    }
    try {
      SecretKey key = loadKey();
      if (key == null) {
        wipe();
        call.reject("a kulcs hiányzik", "empty");
        return;
      }
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
      authenticate(call, cipher, "Feloldás", "PIN használata", c -> {
        byte[] pt = c.doFinal(Base64.decode(ct, Base64.NO_WRAP));
        JSObject o = new JSObject();
        o.put("secret", new String(pt, StandardCharsets.UTF_8));
        call.resolve(o);
      });
    } catch (KeyPermanentlyInvalidatedException e) {
      wipe();
      call.reject("az ujjlenyomatok megváltoztak", "invalidated");
    } catch (Exception e) {
      call.reject(describe(e), "init");
    }
  }

  @PluginMethod
  public void remove(PluginCall call) {
    wipe();
    call.resolve();
  }

  private void authenticate(final PluginCall call, final Cipher cipher, final String title, final String negative, final OnAuth onOk) {
    final FragmentActivity act = getActivity();
    if (act == null) {
      call.reject("nincs aktív képernyő", "activity");
      return;
    }
    act.runOnUiThread(() -> {
      try {
        BiometricPrompt.AuthenticationCallback cb = new BiometricPrompt.AuthenticationCallback() {
          @Override
          public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
            try {
              onOk.run(result.getCryptoObject().getCipher());
            } catch (Exception e) {
              call.reject(describe(e), "crypto");
            }
          }

          @Override
          public void onAuthenticationError(int code, @NonNull CharSequence msg) {
            call.reject(msg.toString(), String.valueOf(code));
          }
        };
        BiometricPrompt prompt = new BiometricPrompt(act, ContextCompat.getMainExecutor(act), cb);
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setNegativeButtonText(negative)
            .setAllowedAuthenticators(AUTH)
            .build();
        prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
      } catch (Exception e) {
        call.reject(describe(e), "prompt");
      }
    });
  }

  private SecretKey createKey() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
    KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUserAuthenticationRequired(true);
    if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
    if (Build.VERSION.SDK_INT >= 24) b.setInvalidatedByBiometricEnrollment(true);
    gen.init(b.build());
    return gen.generateKey();
  }

  private SecretKey loadKey() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    return ks.containsAlias(ALIAS) ? (SecretKey) ks.getKey(ALIAS, null) : null;
  }

  private void wipe() {
    try {
      KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
      ks.load(null);
      if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
    } catch (Exception ignored) {
      // nothing to clean up
    }
    prefs().edit().clear().apply();
  }

  private SharedPreferences prefs() {
    return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  private static String b64(byte[] b) {
    return Base64.encodeToString(b, Base64.NO_WRAP);
  }

  private static String describe(Exception e) {
    return e.getClass().getSimpleName() + ": " + e.getMessage();
  }

  private static String describeStatus(int r) {
    switch (r) {
      case BiometricManager.BIOMETRIC_SUCCESS:
        return "rendben";
      case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
        return "nincs biometrikus érzékelő";
      case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
        return "az érzékelő most nem elérhető";
      case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
        return "nincs beállított erős biometria (ujjlenyomat) a telefonon";
      case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:
        return "biztonsági rendszerfrissítés szükséges";
      case BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED:
        return "ez az Android-verzió nem támogatja";
      default:
        return "ismeretlen állapot";
    }
  }
}
