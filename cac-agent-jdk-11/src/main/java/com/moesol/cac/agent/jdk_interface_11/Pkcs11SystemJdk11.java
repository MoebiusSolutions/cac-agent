package com.moesol.cac.agent.jdk_interface_11;

import java.security.Provider;
import java.security.Security;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.moesol.cac.agent.jdk_interface.Pkcs11SystemProvider;

public class Pkcs11SystemJdk11 implements Pkcs11SystemProvider {

	private static final Pattern VERSION_PATTERN = Pattern.compile("(\\d+).*");

	@Override
	public boolean isCompatibleWithJre(String version) {
		Matcher matcher = VERSION_PATTERN.matcher(version);
		if (!matcher.matches()) {
			return false;
		}
		int major = Integer.parseInt(matcher.group(1));
		return (major >= 11);
	}

	@SuppressWarnings("restriction")
	@Override
	public Provider getPkcs11Provider(String configName) {
		Provider provider = Security.getProvider("SunPKCS11");
		return provider.configure(configName);
	}
}
