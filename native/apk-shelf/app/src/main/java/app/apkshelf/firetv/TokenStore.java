package app.apkshelf.firetv;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Optional private-repository token, encrypted using the device's Android Keystore. */
final class TokenStore {
    private static final String ALIAS = "apk_shelf_github_token_v1";
    private final SharedPreferences preferences;
    TokenStore(Context context) { preferences = context.getSharedPreferences("credentials", Context.MODE_PRIVATE); }

    private SecretKey key() throws Exception {
        if (Build.VERSION.SDK_INT < 23) {
            throw new GeneralSecurityException("Private repositories require Fire OS 6 or newer. Public folders work without a token.");
        }
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    String read() throws Exception {
        String encrypted = preferences.getString("ciphertext", "");
        if (encrypted.isEmpty()) return "";
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        byte[] iv = Base64.decode(preferences.getString("iv", ""), Base64.NO_WRAP);
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), "UTF-8");
    }

    void write(String token) throws Exception {
        if (token.isEmpty()) {
            if (!preferences.edit().clear().commit()) throw new GeneralSecurityException("Could not save token settings.");
            return;
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String encrypted = Base64.encodeToString(cipher.doFinal(token.getBytes("UTF-8")), Base64.NO_WRAP);
        if (!preferences.edit().putString("ciphertext", encrypted)
                .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) {
            throw new GeneralSecurityException("Could not save token settings.");
        }
    }
}
