package com.moesol.cac.agent.jdk_interface_8;

import java.security.Provider;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.moesol.cac.agent.jdk_interface.Pkcs11SystemProvider;

public class Pkcs11SystemJdk8 implements Pkcs11SystemProvider {

	private static final Pattern VERSION_PATTERN = Pattern.compile("1\\.(\\d+)\\..*");

	@Override
	public boolean isCompatibleWithJre(String version) {
		Matcher matcher = VERSION_PATTERN.matcher(version);
		if (!matcher.matches()) {
			return false;
		}
		int major = Integer.parseInt(matcher.group(1));
		return (major == 8);
	}

	@SuppressWarnings("restriction")
	@Override
	public Provider getPkcs11Provider(String configName) {
		return new sun.security.pkcs11.SunPKCS11(configName);
	}

}
