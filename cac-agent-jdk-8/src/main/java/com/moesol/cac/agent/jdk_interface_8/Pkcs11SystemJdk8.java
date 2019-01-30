package com.moesol.cac.agent.jdk_interface_8;

import java.security.Provider;

import com.moesol.cac.agent.jdk_interface.Pkcs11SystemProvider;

public class Pkcs11SystemJdk8 implements Pkcs11SystemProvider {

	@SuppressWarnings("restriction")
	@Override
	public Provider getProvider(String configName) {
		return new sun.security.pkcs11.SunPKCS11(configName);
	}

}
