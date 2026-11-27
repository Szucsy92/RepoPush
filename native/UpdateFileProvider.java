package __PKG__;

import androidx.core.content.FileProvider;

/**
 * Own FileProvider for the in-app update. Capacitor's template already registers androidx.core.content.FileProvider;
 * two providers with the same class name cannot live side by side (the second one is dropped), so the update uses
 * this subclass (authority: applicationId + ".updates", path: cache/updates/).
 */
public class UpdateFileProvider extends FileProvider {}
