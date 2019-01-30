package com.moesol.cac.agent.jdk_interface_11;

import java.security.Provider;
import java.security.Security;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.moesol.cac.agent.jdk_interface.Pkcs11SystemProvider;

public class Pkcs11SystemJdk11 implements Pkcs11SystemProvider {

	@Override
	public Provider getProvider(String configName) {
		Provider provider = Security.getProvider("SunPKCS11");
		return provider.configure(configName);
	}
}
