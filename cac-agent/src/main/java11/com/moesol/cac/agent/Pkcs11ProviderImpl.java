package com.moesol.cac.agent;

import java.security.Provider;
import java.security.Security;

import com.moesol.cac.agent.Pkcs11Provider;

/**
 * JDK 11 method to get the provider
 */
public class Pkcs11ProviderImpl implements Pkcs11Provider {
	public Provider getProvider(String configName) {
		Provider provider = Security.getProvider("SunPKCS11");
		return provider.configure(configName);
	}
}
