package com.moesol.cac.agent;

import java.lang.reflect.InvocationTargetException;
import java.security.Provider;

/**
 * JDK 8 impl, see src/main/java11 for JDK 11 impl
 */
public class Pkcs11ProviderImpl implements Pkcs11Provider {
	public Provider getProvider(String configName) {
        try {
            Class<Provider> cls = (Class<Provider>) Class.forName("sun.security.pkcs11.SunPKCS11");
            // We use refelction here because jdk 11 does not expose sun.security.pcks11.SunPKCS11
            return cls.getConstructor(String.class).newInstance(configName);
        } catch (InstantiationException | IllegalAccessException | IllegalArgumentException | InvocationTargetException
                | NoSuchMethodException | SecurityException | ClassNotFoundException e) {
            throw new RuntimeException(e);
        }
	}
}
