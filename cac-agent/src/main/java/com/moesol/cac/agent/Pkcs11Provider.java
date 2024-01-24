package com.moesol.cac.agent;

import java.security.Provider;

public interface Pkcs11Provider {
	Provider getProvider(String configName);

    public static Provider get(String configName) {
        return new Pkcs11ProviderImpl().getProvider(configName);
    }
}
