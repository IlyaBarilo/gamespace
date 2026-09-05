package ru.local.gamespace.loader;

import android.content.SharedPreferences;

final class SharedPreferencesTransactionStore implements SiteTransactionManager.TransactionStore {
    private static final String PREF_TRANSACTION_TYPE = "site_transaction_type";
    private static final String PREF_TRANSACTION_BASE_PATH = "site_transaction_base_path";
    private static final String PREF_TRANSACTION_PHASE = "site_transaction_phase";

    private final SharedPreferences preferences;

    SharedPreferencesTransactionStore(SharedPreferences preferences) {
        this.preferences = preferences;
    }

    @Override
    public String getType() {
        return preferences.getString(PREF_TRANSACTION_TYPE, "");
    }

    @Override
    public String getBasePath() {
        return preferences.getString(PREF_TRANSACTION_BASE_PATH, "");
    }

    @Override
    public String getPhase() {
        return preferences.getString(PREF_TRANSACTION_PHASE, SiteTransactionManager.PHASE_PREPARED);
    }

    @Override
    public boolean begin(String type, String basePath, String phase) {
        return preferences.edit()
            .putString(PREF_TRANSACTION_TYPE, type)
            .putString(PREF_TRANSACTION_BASE_PATH, basePath)
            .putString(PREF_TRANSACTION_PHASE, phase)
            .commit();
    }

    @Override
    public boolean setPhase(String phase) {
        return preferences.edit().putString(PREF_TRANSACTION_PHASE, phase).commit();
    }

    @Override
    public boolean clear() {
        return preferences.edit()
            .remove(PREF_TRANSACTION_TYPE)
            .remove(PREF_TRANSACTION_BASE_PATH)
            .remove(PREF_TRANSACTION_PHASE)
            .commit();
    }
}
